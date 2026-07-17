"""
DealMaker 后端 CLI：stdin/参数 收 JSON，stdout 吐 JSON。

用法:
  python -m backend.cli <action> [json]
  echo '{"amount":100}' | python -m backend.cli amount_to_chinese
"""

from __future__ import annotations

import json
import os
import sys
from typing import Any, Dict

# Windows 子进程管道默认可能是 GBK，强制 UTF-8，避免前端收到乱码
def _force_utf8_stdio() -> None:
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")
    os.environ.setdefault("PYTHONUTF8", "1")
    for stream in (sys.stdout, sys.stderr, sys.stdin):
        try:
            stream.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
        except Exception:
            pass


_force_utf8_stdio()

from backend.core import (
    ContactManager,
    ProjectStore,
    TemplateProcessor,
    amount_to_chinese,
    auto_fix_final,
    build_output_path,
    default_template_path,
    docx_to_pdf,
    get_officecli_path,
    load_settings,
    pdf_engines_status,
    project_root,
    save_settings,
    split_by_ratio,
)
from backend.schema import full_schema
from backend.workspace import (
    load_workspace,
    merge_workspace,
    replace_workspace,
    workspace_meta,
)


def _ok(data: Any = None) -> Dict[str, Any]:
    return {"ok": True, "data": data}


def _err(msg: str) -> Dict[str, Any]:
    return {"ok": False, "error": msg}


def dispatch(action: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    if action == "ping":
        engines = pdf_engines_status()
        return _ok(
            {
                "project_root": project_root(),
                "officecli": get_officecli_path(),
                "pdf_engines": engines,
            }
        )

    if action == "amount_to_chinese":
        amount = float(payload.get("amount", 0))
        return _ok({"chinese": amount_to_chinese(amount)})

    if action == "split_payment":
        total = float(payload.get("total", 0))
        ratio = float(payload.get("ratio", 50))
        prepaid, final = split_by_ratio(total, ratio)
        return _ok(
            {
                "prepaid": prepaid,
                "final": final,
                "prepaid_chinese": amount_to_chinese(prepaid),
                "final_chinese": amount_to_chinese(final),
                "total_chinese": amount_to_chinese(total),
            }
        )

    if action == "auto_fix_final":
        total = float(payload.get("total", 0))
        prepaid = float(payload.get("prepaid", 0))
        prepaid, final = auto_fix_final(total, prepaid)
        return _ok(
            {
                "prepaid": prepaid,
                "final": final,
                "prepaid_chinese": amount_to_chinese(prepaid),
                "final_chinese": amount_to_chinese(final),
            }
        )

    if action == "load_settings":
        settings = load_settings()
        tpl = (settings.get("template_path") or "").strip()
        # 路径不存在时（含历史 PowerShell 乱码路径）回退默认模板
        if not tpl or not os.path.isfile(tpl):
            dt = default_template_path()
            if dt:
                settings["template_path"] = dt
                settings["_template_reset"] = True
        return _ok(settings)

    if action == "bootstrap":
        """启动一次加载 settings + contacts + projects + workspace。"""
        settings = load_settings()
        tpl = (settings.get("template_path") or "").strip()
        if not tpl or not os.path.isfile(tpl):
            dt = default_template_path()
            if dt:
                settings["template_path"] = dt
                settings["_template_reset"] = True
        cm = ContactManager()
        store = ProjectStore()
        return _ok(
            {
                "settings": settings,
                "contacts": {
                    "names": cm.get_names(),
                    "contacts": cm.contacts,
                },
                "projects": store.list_summaries(),
                "workspace": load_workspace(),
                "workspace_meta": workspace_meta(),
            }
        )

    if action == "schema":
        return _ok(full_schema())

    if action == "workspace_get":
        return _ok(load_workspace())

    if action == "workspace_meta":
        return _ok(workspace_meta())

    if action == "workspace_put":
        """GUI 全量写入工作区，供 CLI/AI 与界面共编。"""
        body = payload.get("workspace") or payload
        updated_by = str(payload.get("updated_by") or "gui")
        if not isinstance(body, dict):
            return _err("workspace_put 需要对象")
        return _ok(replace_workspace(body, updated_by=updated_by))

    if action == "workspace_merge":
        body = payload.get("workspace") or payload
        updated_by = str(payload.get("updated_by") or "gui")
        if not isinstance(body, dict):
            return _err("workspace_merge 需要对象")
        return _ok(merge_workspace(body, updated_by=updated_by))

    if action == "save_settings":
        save_settings(payload.get("settings") or payload)
        return _ok(True)

    if action == "list_contacts":
        cm = ContactManager()
        return _ok({"names": cm.get_names(), "contacts": cm.contacts})

    if action == "get_contact":
        name = payload.get("name", "")
        cm = ContactManager()
        contact = cm.get_contact(name)
        if not contact:
            return _err(f"联系人不存在: {name}")
        return _ok(contact)

    if action == "save_contact":
        data = payload.get("data") or payload
        name = (data.get("替换的乙方名称", "") or data.get("乙方名称", "")).strip()
        if not name:
            return _err("请先填写乙方名称")
        cm = ContactManager()
        cm.add_contact(data)  # 内部仅保留乙方字段
        return _ok({"name": name, "names": cm.get_names()})

    if action == "delete_contact":
        name = payload.get("name", "")
        if not name:
            return _err("缺少联系人名称")
        cm = ContactManager()
        cm.delete_contact(name)
        return _ok({"names": cm.get_names()})

    if action == "generate":
        template = payload.get("template") or ""
        data = payload.get("data") or {}
        output_dir = payload.get("output_dir") or ""
        output_name = payload.get("output_name") or ""
        also_pdf = bool(payload.get("pdf") or payload.get("also_pdf"))
        if not template:
            return _err("请先选择模板")
        try:
            out_path = build_output_path(template, data, output_dir, output_name, ext="docx")
            processor = TemplateProcessor(template)
            processor.generate(data, out_path)
            result: Dict[str, Any] = {"path": out_path, "docx": out_path}
            if also_pdf:
                pdf_path = build_output_path(template, data, output_dir, output_name, ext="pdf")
                pdf_info = docx_to_pdf(out_path, pdf_path)
                result["pdf"] = pdf_info["path"]
                result["pdf_engine"] = pdf_info["engine"]
                result["path"] = pdf_info["path"]
            return _ok(result)
        except Exception as e:
            return _err(str(e))

    if action == "list_projects":
        store = ProjectStore()
        return _ok({"projects": store.list_summaries()})

    if action == "get_project":
        pid = payload.get("id") or ""
        if not pid:
            return _err("缺少项目 id")
        store = ProjectStore()
        proj = store.get(pid)
        if not proj:
            return _err("项目不存在")
        return _ok(proj)

    if action == "save_project":
        """按 合同编号+项目名称 新建或更新项目快照。"""
        try:
            store = ProjectStore()
            result = store.upsert(payload)
            return _ok(
                {
                    "action": result["action"],
                    "project": result["project"],
                    "projects": store.list_summaries(),
                }
            )
        except ValueError as e:
            return _err(str(e))
        except Exception as e:
            return _err(str(e))

    if action == "delete_project":
        pid = payload.get("id") or ""
        if not pid:
            return _err("缺少项目 id")
        store = ProjectStore()
        if not store.delete(pid):
            return _err("项目不存在")
        return _ok({"projects": store.list_summaries()})

    if action == "export_quote_png":
        """Pillow 本地绘制报价 PNG（不依赖浏览器）。"""
        from backend.core import get_config_dir
        from backend.quote import export_quote_png, quote_png_filename

        quote = payload.get("quote") or payload.get("data") or {}
        filename = (payload.get("filename") or "").strip()
        project_name = str(payload.get("project_name") or payload.get("projectName") or "")
        contract_no = str(payload.get("contract_no") or payload.get("contractNo") or "")
        out = (payload.get("out") or payload.get("path") or "").strip()
        try:
            if not out:
                if not filename:
                    filename = quote_png_filename(project_name, contract_no)
                filename = os.path.basename(filename).replace("..", "")
                if not filename.lower().endswith(".png"):
                    filename += ".png"
                out = os.path.join(get_config_dir(), "quotes", filename)
            info = export_quote_png(
                quote if isinstance(quote, dict) else {},
                out,
                project_name=project_name,
                contract_no=contract_no,
            )
            return _ok(info)
        except Exception as e:
            return _err(str(e))

    if action == "save_quote_image":
        """保存报价表 PNG（base64）到 .contract_tool/quotes/（同项目名覆盖）"""
        import base64

        from backend.quote import quote_png_filename

        b64 = payload.get("base64") or ""
        filename = (payload.get("filename") or "").strip()
        if not b64:
            return _err("缺少图片数据")
        if not filename:
            filename = quote_png_filename(
                str(payload.get("project_name") or payload.get("projectName") or ""),
                str(payload.get("contract_no") or payload.get("contractNo") or ""),
            )
        # 安全文件名
        filename = os.path.basename(filename).replace("..", "")
        if not filename.lower().endswith(".png"):
            filename += ".png"
        try:
            from backend.core import get_config_dir

            out_dir = os.path.join(get_config_dir(), "quotes")
            os.makedirs(out_dir, exist_ok=True)
            path = os.path.join(out_dir, filename)
            raw = base64.b64decode(b64)
            with open(path, "wb") as f:
                f.write(raw)
            return _ok({"path": path, "size": len(raw)})
        except Exception as e:
            return _err(str(e))

    if action == "export_pdf":
        """从已有 docx 转 PDF，或先生成合同再转 PDF。"""
        docx_path = payload.get("docx") or payload.get("docx_path") or ""
        template = payload.get("template") or ""
        data = payload.get("data") or {}
        output_dir = payload.get("output_dir") or ""
        output_name = payload.get("output_name") or ""
        try:
            if not docx_path:
                if not template:
                    return _err("请先选择模板或指定 docx")
                docx_path = build_output_path(template, data, output_dir, output_name, ext="docx")
                processor = TemplateProcessor(template)
                processor.generate(data, docx_path)
                pdf_path = build_output_path(template, data, output_dir, output_name, ext="pdf")
            else:
                pdf_path = (
                    payload.get("pdf")
                    or payload.get("pdf_path")
                    or os.path.splitext(docx_path)[0] + ".pdf"
                )
            info = docx_to_pdf(docx_path, pdf_path)
            return _ok(
                {
                    "path": info["path"],
                    "pdf": info["path"],
                    "docx": docx_path,
                    "pdf_engine": info["engine"],
                }
            )
        except Exception as e:
            return _err(str(e))

    return _err(f"未知 action: {action}")


def main() -> int:
    if len(sys.argv) < 2:
        print(
            json.dumps(
                _err(
                    "用法: python -m backend.cli <action> [json] "
                    "或 Agent: python -m backend.agent <command> ..."
                ),
                ensure_ascii=False,
            )
        )
        return 1

    action = sys.argv[1]

    # Agent CLI：子命令 或 agent 前缀（与 GUI 共用同一后端 exe）
    try:
        from backend.agent import AGENT_ROOT_COMMANDS, main as agent_main

        if action == "agent":
            return agent_main(sys.argv[2:])
        if action in AGENT_ROOT_COMMANDS:
            return agent_main(sys.argv[1:])
    except Exception:
        pass

    try:
        if len(sys.argv) >= 3:
            payload = json.loads(sys.argv[2])
        else:
            raw = sys.stdin.read().strip()
            payload = json.loads(raw) if raw else {}
    except json.JSONDecodeError as e:
        print(json.dumps(_err(f"JSON 解析失败: {e}"), ensure_ascii=False))
        return 1

    result = dispatch(action, payload)
    # 显式 UTF-8 写出，避免 Windows 管道用系统代码页
    out = json.dumps(result, ensure_ascii=False)
    try:
        sys.stdout.buffer.write(out.encode("utf-8"))
        sys.stdout.buffer.write(b"\n")
        sys.stdout.buffer.flush()
    except Exception:
        print(out)
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
