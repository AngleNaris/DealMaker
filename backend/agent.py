"""
DealMaker Agent CLI — 供 AI Agent / 脚本多步操作。

用法:
  DealMaker.exe <command> ...           # 发布版单文件（无参数=GUI）
  python -m backend.agent <command> ... # 开发
  dealmaker-backend.exe <command> ...   # 内嵌后端直接调

所有命令默认 stdout 输出一行 JSON: {"ok":true,"data":...} / {"ok":false,"error":"..."}
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any, Dict, List, Optional

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
    pick_contact_fields,
    project_root,
    save_settings,
    split_by_ratio,
)
from backend.quote import (
    export_quote_html,
    export_quote_png,
    normalize_quote,
    quote_calc,
    quote_row_add,
    quote_row_delete,
    quote_row_move,
    quote_row_swap,
    quote_row_update,
    validate_quote,
)
from backend.schema import CONTACT_KEYS, FORM_KEYS, full_schema
from backend.skill_prompt import skill_payload
from backend.workspace import (
    apply_project,
    clear_workspace,
    create_snapshot,
    list_snapshots,
    load_workspace,
    merge_workspace,
    restore_snapshot,
    restore_workspace_rev,
    save_workspace,
    set_field,
    snapshot_for_project,
    undo_workspace,
    workspace_path,
)
import re


def _ok(data: Any = None) -> Dict[str, Any]:
    return {"ok": True, "data": data}


def _err(msg: str) -> Dict[str, Any]:
    return {"ok": False, "error": str(msg)}


def _print(result: Dict[str, Any]) -> int:
    out = json.dumps(result, ensure_ascii=False)
    try:
        sys.stdout.buffer.write(out.encode("utf-8"))
        sys.stdout.buffer.write(b"\n")
        sys.stdout.buffer.flush()
    except Exception:
        print(out)
    return 0 if result.get("ok") else 1


def resolve_user_path(p: str) -> str:
    """规范化用户传入路径，给出 Windows 友好错误。"""
    raw = (p or "").strip().strip('"').strip("'")
    if not raw:
        raise ValueError("路径为空")
    # git-bash / cygwin: /c/Users/... -> C:/Users/...
    m = re.match(r"^/([A-Za-z])/(.*)$", raw.replace("\\", "/"))
    if m:
        raw = f"{m.group(1).upper()}:/{m.group(2)}"
    elif raw.startswith("/") and os.name == "nt" and not raw.startswith("//"):
        raise ValueError(
            f"文件不存在或路径无效: {p}（检测到 Unix 风格路径，请使用 Windows 绝对路径，如 C:/Users/.../x.json）"
        )
    path = os.path.expanduser(raw)
    path = os.path.abspath(path)
    return path


def _read_json_arg(s: Optional[str], file_path: Optional[str]) -> Any:
    if file_path:
        try:
            path = resolve_user_path(file_path)
        except ValueError as e:
            raise ValueError(str(e)) from e
        if not os.path.isfile(path):
            raise ValueError(
                f"文件不存在或路径无效: {file_path}（解析为 {path}；请使用 Windows 风格绝对路径，如 C:/.../x.json）"
            )
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except json.JSONDecodeError as e:
            raise ValueError(f"JSON 解析失败 ({path}): {e}") from e
    if s is None or s == "":
        return None
    if s == "-":
        raw = sys.stdin.read()
        if not raw.strip():
            return {}
        try:
            return json.loads(raw)
        except json.JSONDecodeError as e:
            raise ValueError(f"stdin JSON 解析失败: {e}") from e
    try:
        return json.loads(s)
    except json.JSONDecodeError as e:
        raise ValueError(f"JSON 解析失败: {e}") from e


def _resolve_template(ws: Dict[str, Any], override: Optional[str] = None) -> str:
    tpl = (override or ws.get("template_path") or "").strip()
    if not tpl:
        settings = load_settings()
        tpl = (settings.get("template_path") or "").strip()
    if not tpl or not os.path.isfile(tpl):
        dt = default_template_path()
        if dt:
            tpl = dt
    return tpl or ""


# ── handlers ──────────────────────────────────────────────


def cmd_schema(_: argparse.Namespace) -> Dict[str, Any]:
    return _ok(full_schema())


def cmd_ping(_: argparse.Namespace) -> Dict[str, Any]:
    return _ok(
        {
            "project_root": project_root(),
            "config_workspace": workspace_path(),
            "officecli": get_officecli_path(),
            "pdf_engines": pdf_engines_status(),
            "form_keys": FORM_KEYS,
            "contact_keys": CONTACT_KEYS,
        }
    )


def cmd_help_json(_: argparse.Namespace) -> Dict[str, Any]:
    return _ok(
        {
            "commands": [
                "help",
                "skill",
                "schema",
                "ping",
                "help-json",
                "workspace get|set|set-field|clear|path|undo|restore|snapshot|snapshots",
                "settings get|set",
                "form get|set|set-field",
                "contact list|get|save|delete|apply [--dry-run][--force]",
                "project list|get|save|delete|load|find",
                "quote get|set|validate|calc|sync-total|swap|row add|row update|row delete|row move|export-html|export-png",
                "amount chinese|split|fix",
                "generate docx|pdf|preview",
            ],
            "flags": {
                "dry-run": "quote set / workspace set / quote row* / quote swap / contact apply",
                "json-stdin": "--json -",
                "file-path": "Windows 绝对路径 C:/.../x.json",
            },
            "usage": "DealMaker.exe <command> ...",
            "exit_codes": {"0": "ok", "1": "error"},
            "output": "single-line JSON {ok,data|error}（无 usage 文本混出）",
            "gui_coedit": True,
            "undo": "单文件 workspace_undo.json 环形栈（最多 20 次 CLI 写入；GUI 自动保存不入栈）",
        }
    )


def cmd_skill(_: argparse.Namespace) -> Dict[str, Any]:
    return _ok(skill_payload())


def cmd_help(_: argparse.Namespace) -> Dict[str, Any]:
    return _ok(
        {
            **skill_payload(),
            "quick_start": [
                "DealMaker.exe help",
                "DealMaker.exe workspace get",
                "DealMaker.exe schema",
                "DealMaker.exe project list",
                'DealMaker.exe form set --json "{\\"替换的合同编号\\":\\"T001\\",\\"替换的项目名称\\":\\"示例项目\\"}"',
                "DealMaker.exe form set-field 替换的税率 3",
            ],
            "note": "请完整阅读 skill_markdown。单文件 DealMaker.exe：无参数=GUI，有子命令=CLI；与界面共享工作区。",
        }
    )


def cmd_workspace(args: argparse.Namespace) -> Dict[str, Any]:
    sub = args.ws_action
    if sub == "get":
        return _ok(load_workspace())
    if sub == "path":
        return _ok({"path": workspace_path()})
    if sub == "clear":
        return _ok(clear_workspace(updated_by="cli"))
    if sub == "set":
        try:
            patch = _read_json_arg(args.json, args.file)
        except ValueError as e:
            return _err(str(e))
        if patch is None:
            return _err("请提供 --json 或 --file")
        if not isinstance(patch, dict):
            return _err("workspace set 需要 JSON 对象")
        if getattr(args, "dry_run", False):
            cur = load_workspace()
            preview = dict(cur)
            if "form" in patch and isinstance(patch["form"], dict):
                preview["form"] = {**(preview.get("form") or {}), **{k: str(v) for k, v in patch["form"].items()}}
            for k in ("quote", "ratio", "template_path", "output_dir", "output_name"):
                if k in patch:
                    preview[k] = patch[k]
            return _ok({"dry_run": True, "would_write": preview})
        return _ok(merge_workspace(patch, updated_by="cli"))
    if sub == "set-field":
        if not args.key:
            return _err("缺少 key")
        return _ok(set_field(args.key, args.value if args.value is not None else "", updated_by="cli"))
    if sub == "undo":
        try:
            return _ok(undo_workspace(updated_by="cli"))
        except ValueError as e:
            return _err(str(e))
    if sub == "restore":
        if getattr(args, "snapshot", None):
            try:
                return _ok(restore_snapshot(args.snapshot, updated_by="cli"))
            except ValueError as e:
                return _err(str(e))
        if args.rev is not None:
            try:
                return _ok(restore_workspace_rev(int(args.rev), updated_by="cli"))
            except ValueError as e:
                return _err(str(e))
        return _err("请指定 --rev N 或 --snapshot ID")
    if sub == "snapshot":
        return _ok(create_snapshot(label=getattr(args, "label", "") or "", updated_by="cli"))
    if sub == "snapshots":
        return _ok({"snapshots": list_snapshots()})
    return _err(f"未知 workspace 子命令: {sub}")


def cmd_settings(args: argparse.Namespace) -> Dict[str, Any]:
    if args.settings_action == "get":
        s = load_settings()
        tpl = (s.get("template_path") or "").strip()
        if not tpl or not os.path.isfile(tpl):
            dt = default_template_path()
            if dt:
                s = dict(s)
                s["template_path"] = dt
        return _ok(s)
    # set
    s = load_settings() or {}
    if args.template is not None:
        s["template_path"] = args.template
    if args.output_dir is not None:
        s["output_dir"] = args.output_dir
    save_settings(s)
    # 同步到工作区路径字段
    patch: Dict[str, Any] = {}
    if args.template is not None:
        patch["template_path"] = args.template
    if args.output_dir is not None:
        patch["output_dir"] = args.output_dir
    if patch:
        merge_workspace(patch)
    return _ok(s)


def cmd_form(args: argparse.Namespace) -> Dict[str, Any]:
    if args.form_action == "get":
        return _ok({"form": load_workspace().get("form") or {}})
    if args.form_action == "set-field":
        if not args.key:
            return _err("缺少 key")
        return _ok(set_field(args.key, args.value if args.value is not None else ""))
    # set
    data = _read_json_arg(args.json, args.file)
    if data is None:
        return _err("请提供 --json 或 --file")
    if not isinstance(data, dict):
        return _err("form set 需要 JSON 对象")
    return _ok(merge_workspace({"form": data}, updated_by="cli"))


def cmd_contact(args: argparse.Namespace) -> Dict[str, Any]:
    cm = ContactManager()
    act = args.contact_action
    if act == "list":
        return _ok({"names": cm.get_names(), "contacts": cm.contacts})
    if act == "get":
        name = (args.name or "").strip()
        if not name:
            return _err("缺少联系人名称 --name")
        c = cm.get_contact(name)
        if not c:
            return _err(f"联系人不存在: {name}")
        return _ok(c)
    if act == "delete":
        name = (args.name or "").strip()
        if not name:
            return _err("缺少 --name")
        cm.delete_contact(name)
        return _ok({"names": cm.get_names()})
    if act == "save":
        data = _read_json_arg(args.json, args.file)
        if data is None:
            # 从工作区取乙方字段
            data = pick_contact_fields(load_workspace().get("form") or {})
        if not isinstance(data, dict):
            return _err("contact save 需要 JSON 对象")
        name = (data.get("替换的乙方名称") or data.get("乙方名称") or "").strip()
        if not name:
            return _err("请先填写乙方名称")
        cm.add_contact(data)
        return _ok({"name": name, "names": cm.get_names(), "contact": cm.get_contact(name)})
    if act == "apply":
        name = (args.name or "").strip()
        if not name:
            return _err("缺少 --name")
        c = cm.get_contact(name)
        if not c:
            return _err(f"联系人不存在: {name}")
        form_patch = {}
        for k in CONTACT_KEYS:
            if k in c:
                form_patch[k] = str(c.get(k) or "")
        cur_form = load_workspace().get("form") or {}
        conflicts = []
        for k, v in form_patch.items():
            old = str(cur_form.get(k) or "").strip()
            if old and old != str(v).strip():
                conflicts.append({"key": k, "from": old, "to": v})
        if getattr(args, "dry_run", False):
            return _ok({"dry_run": True, "name": name, "form_patch": form_patch, "conflicts": conflicts})
        if conflicts and not getattr(args, "force", False):
            return _ok(
                {
                    "applied": False,
                    "name": name,
                    "conflicts": conflicts,
                    "hint": "将覆盖已有字段。确认后加 --force，或先 --dry-run 查看",
                }
            )
        ws = merge_workspace({"form": form_patch, "selected_contact": name}, updated_by="cli")
        return _ok({"applied": name, "conflicts": conflicts, "workspace": ws})
    return _err(f"未知 contact 子命令: {act}")


def cmd_project(args: argparse.Namespace) -> Dict[str, Any]:
    store = ProjectStore()
    act = args.project_action
    if act == "list":
        return _ok({"projects": store.list_summaries()})
    if act == "get":
        pid = (args.id or "").strip()
        if not pid:
            return _err("缺少 --id")
        p = store.get(pid)
        if not p:
            return _err("项目不存在")
        return _ok(p)
    if act == "find":
        no = (args.contract_no or "").strip()
        name = (args.name or args.project_name or "").strip()
        if not no and not name:
            return _err("请提供 --contract-no 和/或 --name")
        from backend.core import make_project_key

        key = make_project_key(no, name)
        p = store.get_by_key(key)
        if not p:
            # 模糊：编号或名称匹配
            hits = [
                x
                for x in store.projects
                if (not no or (x.get("contract_no") or "") == no)
                and (not name or (x.get("project_name") or "") == name)
            ]
            if len(hits) == 1:
                return _ok(hits[0])
            if hits:
                return _ok({"matches": hits})
            return _err("未找到项目")
        return _ok(p)
    if act == "delete":
        pid = (args.id or "").strip()
        if not pid:
            return _err("缺少 --id")
        if not store.delete(pid):
            return _err("项目不存在")
        return _ok({"projects": store.list_summaries()})
    if act == "load":
        pid = (args.id or "").strip()
        p = None
        if pid:
            p = store.get(pid)
        elif args.contract_no or args.name or args.project_name:
            no = (args.contract_no or "").strip()
            name = (args.name or args.project_name or "").strip()
            from backend.core import make_project_key

            p = store.get_by_key(make_project_key(no, name))
            if not p:
                hits = [
                    x
                    for x in store.projects
                    if (not no or (x.get("contract_no") or "") == no)
                    and (not name or (x.get("project_name") or "") == name)
                ]
                if len(hits) == 1:
                    p = hits[0]
        if not p:
            return _err("项目不存在，请指定 --id 或 --contract-no/--name")
        ws = apply_project(p)
        return _ok({"project": p, "workspace": ws})
    if act == "save":
        payload = snapshot_for_project()
        if args.json or args.file:
            extra = _read_json_arg(args.json, args.file)
            if isinstance(extra, dict):
                payload.update(extra)
                if "form" in extra and isinstance(extra["form"], dict):
                    payload["form"] = {**(payload.get("form") or {}), **extra["form"]}
        try:
            result = store.upsert(payload)
            merge_workspace({"selected_project_id": result["project"].get("id") or ""})
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
    return _err(f"未知 project 子命令: {act}")


def cmd_quote(args: argparse.Namespace) -> Dict[str, Any]:
    act = args.quote_action
    if act == "get":
        return _ok(normalize_quote(load_workspace().get("quote")))
    if act == "set":
        try:
            data = _read_json_arg(args.json, args.file)
        except ValueError as e:
            return _err(str(e))
        if data is None:
            return _err("请提供 --json 或 --file（或 --json - 从 stdin）")
        q = normalize_quote(data)
        v = validate_quote(q)
        if not v["ok"] and not getattr(args, "force", False):
            return _err("报价校验失败: " + "; ".join(v["errors"]))
        if getattr(args, "dry_run", False):
            return _ok({"dry_run": True, "quote": q, "validation": v})
        ws = merge_workspace({"quote": q}, updated_by="cli")
        return _ok(ws.get("quote"))
    if act == "validate":
        q = normalize_quote(load_workspace().get("quote"))
        return _ok(validate_quote(q))
    if act == "calc":
        q = normalize_quote(load_workspace().get("quote"))
        tax = getattr(args, "tax", None)
        return _ok(quote_calc(q, tax_rate=tax))
    if act == "sync-total":
        q = normalize_quote(load_workspace().get("quote"))
        tax = getattr(args, "tax", None)
        calc = quote_calc(q, tax_rate=tax)
        total = calc["subtotal"]
        ratio = float(load_workspace().get("ratio") or 50)
        prepaid, final = split_by_ratio(total, ratio)
        form_patch = {
            "替换的总费用": str(total),
            "替换的总费用大写": amount_to_chinese(total),
            "替换的预付款": str(prepaid),
            "替换的预付款大写": amount_to_chinese(prepaid),
            "替换的尾款": str(final),
            "替换的尾款大写": amount_to_chinese(final),
        }
        if tax is not None:
            form_patch["替换的税率"] = str(tax)
            q = dict(q)
            q["taxNote"] = f"总计（含税{tax}%）"
        result = {
            "calc": calc,
            "form_patch": form_patch,
            "ratio": ratio,
            "prepaid": prepaid,
            "final": final,
        }
        if getattr(args, "apply", False):
            patch: Dict[str, Any] = {"form": form_patch}
            if tax is not None:
                patch["quote"] = q
            merge_workspace(patch, updated_by="cli")
            result["applied"] = True
        return _ok(result)
    if act == "row":
        return cmd_quote_row(args)
    if act == "swap":
        q = normalize_quote(load_workspace().get("quote"))
        try:
            q2 = quote_row_swap(q, str(args.a), str(args.b))
        except ValueError as e:
            return _err(str(e))
        if getattr(args, "dry_run", False):
            return _ok({"dry_run": True, "quote": q2})
        merge_workspace({"quote": q2}, updated_by="cli")
        return _ok(q2)
    if act == "export-html":
        ws = load_workspace()
        q = normalize_quote(ws.get("quote"))
        path = export_quote_html(q, args.out)
        return _ok({"path": path, "quote": q})
    if act == "export-png":
        ws = load_workspace()
        q = normalize_quote(ws.get("quote"))
        form = ws.get("form") or {}
        try:
            info = export_quote_png(
                q,
                args.out,
                project_name=str(form.get("替换的项目名称") or ""),
                contract_no=str(form.get("替换的合同编号") or ""),
            )
        except Exception as e:
            return _err(str(e))
        if args.apply:
            merge_workspace({"form": {"替换的费用表格图片": info["path"]}}, updated_by="cli")
            info["applied_to_form"] = True
        return _ok(info)
    return _err(f"未知 quote 子命令: {act}")


def cmd_quote_row(args: argparse.Namespace) -> Dict[str, Any]:
    row_act = args.row_action
    q = normalize_quote(load_workspace().get("quote"))
    try:
        if row_act == "add":
            data = _read_json_arg(args.json, args.file)
            if data is None:
                data = {
                    "name": getattr(args, "name", "") or "",
                    "qty": getattr(args, "qty", 1) or 1,
                    "unitPrice": getattr(args, "unit_price", 0) or 0,
                    "partnerPrice": getattr(args, "partner_price", 0) or 0,
                    "duration": getattr(args, "duration", None) or "/",
                    "note": getattr(args, "note", "") or "",
                    "specs": [],
                }
            at = getattr(args, "at", None)
            q2 = quote_row_add(q, data if isinstance(data, dict) else {}, at=at)
        elif row_act == "update":
            data = _read_json_arg(args.json, args.file)
            if data is None:
                return _err("请提供 --json 或 --file 差异字段")
            q2 = quote_row_update(q, str(args.row_key), data if isinstance(data, dict) else {})
        elif row_act == "delete":
            q2 = quote_row_delete(q, str(args.row_key))
        elif row_act == "move":
            q2 = quote_row_move(q, str(args.src), str(args.dst))
        else:
            return _err(f"未知 quote row 子命令: {row_act}")
    except ValueError as e:
        return _err(str(e))
    if getattr(args, "dry_run", False):
        return _ok({"dry_run": True, "quote": q2})
    merge_workspace({"quote": q2}, updated_by="cli")
    return _ok(q2)


def cmd_amount(args: argparse.Namespace) -> Dict[str, Any]:
    act = args.amount_action
    if act == "chinese":
        amount = float(args.amount)
        return _ok({"amount": amount, "chinese": amount_to_chinese(amount)})
    if act == "split":
        total = float(args.total)
        ratio = float(args.ratio if args.ratio is not None else 50)
        prepaid, final = split_by_ratio(total, ratio)
        result = {
            "total": total,
            "ratio": ratio,
            "prepaid": prepaid,
            "final": final,
            "prepaid_chinese": amount_to_chinese(prepaid),
            "final_chinese": amount_to_chinese(final),
            "total_chinese": amount_to_chinese(total),
        }
        if args.apply:
            merge_workspace(
                {
                    "form": {
                        "替换的总费用": str(total),
                        "替换的总费用大写": result["total_chinese"],
                        "替换的预付款": str(prepaid),
                        "替换的预付款大写": result["prepaid_chinese"],
                        "替换的尾款": str(final),
                        "替换的尾款大写": result["final_chinese"],
                    },
                    "ratio": ratio,
                }
            )
            result["applied"] = True
        return _ok(result)
    if act == "fix":
        total = float(args.total)
        prepaid = float(args.prepaid)
        prepaid, final = auto_fix_final(total, prepaid)
        result = {
            "total": total,
            "prepaid": prepaid,
            "final": final,
            "prepaid_chinese": amount_to_chinese(prepaid),
            "final_chinese": amount_to_chinese(final),
        }
        if args.apply:
            merge_workspace(
                {
                    "form": {
                        "替换的预付款": str(prepaid),
                        "替换的预付款大写": result["prepaid_chinese"],
                        "替换的尾款": str(final),
                        "替换的尾款大写": result["final_chinese"],
                    }
                }
            )
            result["applied"] = True
        return _ok(result)
    return _err(f"未知 amount 子命令: {act}")


def cmd_generate(args: argparse.Namespace) -> Dict[str, Any]:
    ws = load_workspace()
    form = dict(ws.get("form") or {})
    if args.json or args.file:
        try:
            extra = _read_json_arg(args.json, args.file)
        except ValueError as e:
            return _err(str(e))
        if isinstance(extra, dict):
            form.update({k: str(v) for k, v in extra.items() if v is not None})
    if args.gen_action == "preview":
        empty_keys = [k for k in FORM_KEYS if not str(form.get(k) or "").strip()]
        # 地址占位符依赖 乙方地址
        addr_keys = [
            "替换的乙方地址第一行最大字数",
            "替换的乙方地址第二行最大字数最大字",
            "替换的乙方地址第三行最大字数最大字",
        ]
        if not str(form.get("乙方地址") or "").strip():
            empty_keys.extend(addr_keys)
        template = _resolve_template(ws, args.template)
        return _ok(
            {
                "template": template,
                "template_ok": bool(template and os.path.isfile(template)),
                "empty_form_keys": empty_keys,
                "placeholders": [f"%{k}%" for k in empty_keys],
                "ready": bool(template and os.path.isfile(template)) and not empty_keys,
            }
        )
    template = _resolve_template(ws, args.template)
    if not template or not os.path.isfile(template):
        return _err("请先设置模板路径（settings set --template 或 workspace）")
    output_dir = args.output_dir if args.output_dir is not None else (ws.get("output_dir") or "")
    output_name = args.output_name if args.output_name is not None else (ws.get("output_name") or "")
    want_pdf = args.gen_action == "pdf" or bool(args.pdf)
    try:
        docx_path = build_output_path(template, form, output_dir, output_name, ext="docx")
        TemplateProcessor(template).generate(form, docx_path)
        result: Dict[str, Any] = {"docx": docx_path, "path": docx_path}
        if want_pdf:
            pdf_path = build_output_path(template, form, output_dir, output_name, ext="pdf")
            info = docx_to_pdf(docx_path, pdf_path)
            result["pdf"] = info["path"]
            result["pdf_engine"] = info["engine"]
            result["path"] = info["path"]
        if args.save_project:
            try:
                store = ProjectStore()
                snap = snapshot_for_project(ws)
                snap["form"] = form
                saved = store.upsert(snap)
                result["project_action"] = saved["action"]
                result["project_id"] = saved["project"].get("id")
            except Exception as e:
                result["project_save_error"] = str(e)
        return _ok(result)
    except Exception as e:
        return _err(str(e))


# ── argparse ─────────────────────────────────────────────

AGENT_ROOT_COMMANDS = {
    "help",
    "skill",
    "schema",
    "ping",
    "help-json",
    "workspace",
    "settings",
    "form",
    "contact",
    "project",
    "quote",
    "amount",
    "generate",
}


class _JsonArgParser(argparse.ArgumentParser):
    """参数错误抛 ValueError，由 main 统一输出 JSON（避免 usage 文本 + JSON 双份）。"""

    def error(self, message: str) -> None:  # type: ignore[override]
        raise ValueError(message)


def build_parser() -> argparse.ArgumentParser:
    p = _JsonArgParser(
        prog="DealMaker.exe",
        description="DealMaker Agent CLI — AI/脚本自动化入口",
    )
    sub = p.add_subparsers(dest="command", required=True, parser_class=_JsonArgParser)

    sub.add_parser("help", help="内置 Skill 提示词 + 用法（AI 首选）")
    sub.add_parser("skill", help="仅输出内置 Agent Skill 全文")
    sub.add_parser("schema", help="输出字段与报价 schema")
    sub.add_parser("ping", help="探测环境")
    sub.add_parser("help-json", help="机器可读命令列表")

    # workspace
    ws = sub.add_parser("workspace", help="多步工作区")
    ws_sub = ws.add_subparsers(dest="ws_action", required=True)
    ws_sub.add_parser("get")
    ws_sub.add_parser("path")
    ws_sub.add_parser("clear")
    ws_sub.add_parser("undo")
    ws_sub.add_parser("snapshots")
    ws_set = ws_sub.add_parser("set")
    ws_set.add_argument("--json", dest="json", default=None)
    ws_set.add_argument("--file", dest="file", default=None)
    ws_set.add_argument("--dry-run", action="store_true")
    ws_sf = ws_sub.add_parser("set-field")
    ws_sf.add_argument("key")
    ws_sf.add_argument("value", nargs="?", default="")
    ws_rest = ws_sub.add_parser("restore")
    ws_rest.add_argument("--rev", type=int, default=None)
    ws_rest.add_argument("--snapshot", default=None)
    ws_snap = ws_sub.add_parser("snapshot")
    ws_snap.add_argument("--label", default="")

    # settings
    st = sub.add_parser("settings", help="全局设置")
    st_sub = st.add_subparsers(dest="settings_action", required=True)
    st_sub.add_parser("get")
    st_set = st_sub.add_parser("set")
    st_set.add_argument("--template", default=None)
    st_set.add_argument("--output-dir", default=None)

    # form
    fm = sub.add_parser("form", help="当前表单（工作区内）")
    fm_sub = fm.add_subparsers(dest="form_action", required=True)
    fm_sub.add_parser("get")
    fm_set = fm_sub.add_parser("set")
    fm_set.add_argument("--json", dest="json", default=None)
    fm_set.add_argument("--file", dest="file", default=None)
    fm_sf = fm_sub.add_parser("set-field")
    fm_sf.add_argument("key")
    fm_sf.add_argument("value", nargs="?", default="")

    # contact
    ct = sub.add_parser("contact", help="联系人（仅乙方字段）")
    ct_sub = ct.add_subparsers(dest="contact_action", required=True)
    ct_sub.add_parser("list")
    ct_get = ct_sub.add_parser("get")
    ct_get.add_argument("--name", required=True)
    ct_del = ct_sub.add_parser("delete")
    ct_del.add_argument("--name", required=True)
    ct_save = ct_sub.add_parser("save")
    ct_save.add_argument("--json", dest="json", default=None)
    ct_save.add_argument("--file", dest="file", default=None)
    ct_app = ct_sub.add_parser("apply")
    ct_app.add_argument("--name", required=True)
    ct_app.add_argument("--dry-run", action="store_true")
    ct_app.add_argument("--force", action="store_true")

    # project
    pr = sub.add_parser("project", help="历史项目")
    pr_sub = pr.add_subparsers(dest="project_action", required=True)
    pr_sub.add_parser("list")
    pr_get = pr_sub.add_parser("get")
    pr_get.add_argument("--id", required=True)
    pr_find = pr_sub.add_parser("find")
    pr_find.add_argument("--contract-no", default="")
    pr_find.add_argument("--name", default="")
    pr_find.add_argument("--project-name", default="")
    pr_del = pr_sub.add_parser("delete")
    pr_del.add_argument("--id", required=True)
    pr_load = pr_sub.add_parser("load")
    pr_load.add_argument("--id", default="")
    pr_load.add_argument("--contract-no", default="")
    pr_load.add_argument("--name", default="")
    pr_load.add_argument("--project-name", default="")
    pr_save = pr_sub.add_parser("save")
    pr_save.add_argument("--json", dest="json", default=None)
    pr_save.add_argument("--file", dest="file", default=None)

    # quote
    qt = sub.add_parser("quote", help="报价表")
    qt_sub = qt.add_subparsers(dest="quote_action", required=True)
    qt_sub.add_parser("get")
    qt_sub.add_parser("validate")
    qt_set = qt_sub.add_parser("set")
    qt_set.add_argument("--json", dest="json", default=None)
    qt_set.add_argument("--file", dest="file", default=None)
    qt_set.add_argument("--dry-run", action="store_true")
    qt_set.add_argument("--force", action="store_true")
    qt_calc = qt_sub.add_parser("calc")
    qt_calc.add_argument("--tax", type=float, default=None)
    qt_sync = qt_sub.add_parser("sync-total")
    qt_sync.add_argument("--apply", action="store_true")
    qt_sync.add_argument("--tax", type=float, default=None)
    qt_swap = qt_sub.add_parser("swap")
    qt_swap.add_argument("a")
    qt_swap.add_argument("b")
    qt_swap.add_argument("--dry-run", action="store_true")
    qt_row = qt_sub.add_parser("row")
    qt_row_sub = qt_row.add_subparsers(dest="row_action", required=True)
    qr_add = qt_row_sub.add_parser("add")
    qr_add.add_argument("--json", dest="json", default=None)
    qr_add.add_argument("--file", dest="file", default=None)
    qr_add.add_argument("--at", type=int, default=None)
    qr_add.add_argument("--name", default="")
    qr_add.add_argument("--qty", type=float, default=1)
    qr_add.add_argument("--unit-price", type=float, default=0)
    qr_add.add_argument("--partner-price", type=float, default=0)
    qr_add.add_argument("--duration", default="/")
    qr_add.add_argument("--note", default="")
    qr_add.add_argument("--dry-run", action="store_true")
    qr_up = qt_row_sub.add_parser("update")
    qr_up.add_argument("row_key")
    qr_up.add_argument("--json", dest="json", default=None)
    qr_up.add_argument("--file", dest="file", default=None)
    qr_up.add_argument("--dry-run", action="store_true")
    qr_del = qt_row_sub.add_parser("delete")
    qr_del.add_argument("row_key")
    qr_del.add_argument("--dry-run", action="store_true")
    qr_mv = qt_row_sub.add_parser("move")
    qr_mv.add_argument("src")
    qr_mv.add_argument("dst")
    qr_mv.add_argument("--dry-run", action="store_true")
    qt_html = qt_sub.add_parser("export-html")
    qt_html.add_argument("--out", default=None)
    qt_png = qt_sub.add_parser("export-png")
    qt_png.add_argument("--out", default=None)
    qt_png.add_argument("--apply", action="store_true", help="写入工作区 费用表格图片")

    # amount
    am = sub.add_parser("amount", help="金额工具")
    am_sub = am.add_subparsers(dest="amount_action", required=True)
    am_c = am_sub.add_parser("chinese")
    am_c.add_argument("--amount", type=float, required=True)
    am_s = am_sub.add_parser("split")
    am_s.add_argument("--total", type=float, required=True)
    am_s.add_argument("--ratio", type=float, default=50)
    am_s.add_argument("--apply", action="store_true")
    am_f = am_sub.add_parser("fix")
    am_f.add_argument("--total", type=float, required=True)
    am_f.add_argument("--prepaid", type=float, required=True)
    am_f.add_argument("--apply", action="store_true")

    # generate
    gen = sub.add_parser("generate", help="生成合同")
    gen_sub = gen.add_subparsers(dest="gen_action", required=True)
    for name in ("docx", "pdf", "preview"):
        g = gen_sub.add_parser(name)
        g.add_argument("--template", default=None)
        g.add_argument("--output-dir", default=None)
        g.add_argument("--output-name", default=None)
        g.add_argument("--json", dest="json", default=None)
        g.add_argument("--file", dest="file", default=None)
        if name != "preview":
            g.add_argument("--save-project", action="store_true")
        if name == "docx":
            g.add_argument("--pdf", action="store_true")

    return p


def dispatch_agent(args: argparse.Namespace) -> Dict[str, Any]:
    cmd = args.command
    handlers = {
        "help": cmd_help,
        "skill": cmd_skill,
        "schema": cmd_schema,
        "ping": cmd_ping,
        "help-json": cmd_help_json,
        "workspace": cmd_workspace,
        "settings": cmd_settings,
        "form": cmd_form,
        "contact": cmd_contact,
        "project": cmd_project,
        "quote": cmd_quote,
        "amount": cmd_amount,
        "generate": cmd_generate,
    }
    fn = handlers.get(cmd)
    if not fn:
        return _err(f"未知命令: {cmd}")
    try:
        return fn(args)
    except Exception as e:
        return _err(str(e))


def main(argv: Optional[List[str]] = None) -> int:
    # Windows 管道 UTF-8
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")
    os.environ.setdefault("PYTHONUTF8", "1")
    for stream in (sys.stdout, sys.stderr, sys.stdin):
        try:
            stream.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
        except Exception:
            pass

    # 无参数 → 输出内置 skill help（方便 AI 冷启动）
    if argv is not None and len(argv) == 0:
        return _print(cmd_help(argparse.Namespace()))
    if argv is None and len(sys.argv) <= 1:
        return _print(cmd_help(argparse.Namespace()))

    parser = build_parser()
    try:
        args = parser.parse_args(argv)
    except ValueError as e:
        return _print(_err(f"参数错误: {e}。运行 DealMaker.exe help 查看用法"))
    except SystemExit as e:
        # 仅 -h/--help 等仍可能 SystemExit
        code = int(e.code) if e.code is not None else 1
        if code == 0:
            return 0
        return _print(_err("参数错误。请运行: DealMaker.exe help"))
    return _print(dispatch_agent(args))


if __name__ == "__main__":
    raise SystemExit(main())
