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

from backend.core import (
    ContactManager,
    TemplateProcessor,
    amount_to_chinese,
    auto_fix_final,
    build_output_path,
    default_template_path,
    docx_to_pdf,
    find_soffice,
    get_officecli_path,
    load_settings,
    project_root,
    save_settings,
    split_by_ratio,
)


def _ok(data: Any = None) -> Dict[str, Any]:
    return {"ok": True, "data": data}


def _err(msg: str) -> Dict[str, Any]:
    return {"ok": False, "error": msg}


def dispatch(action: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    if action == "ping":
        return _ok(
            {
                "project_root": project_root(),
                "officecli": get_officecli_path(),
                "soffice": find_soffice(),
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
        if not settings.get("template_path"):
            dt = default_template_path()
            if dt:
                settings["template_path"] = dt
        return _ok(settings)

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
        name = data.get("替换的乙方名称", "") or data.get("乙方名称", "")
        if not name:
            return _err("请先填写乙方名称")
        cm = ContactManager()
        cm.add_contact(data)
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
        print(json.dumps(_err("用法: python -m backend.cli <action> [json]"), ensure_ascii=False))
        return 1

    action = sys.argv[1]
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
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
