"""多步工作区：当前表单 / 报价 / 路径，供 Agent CLI 会话使用。"""

from __future__ import annotations

import json
import os
from copy import deepcopy
from typing import Any, Dict, List, Optional

from backend.core import get_config_dir, load_settings
from backend.schema import FORM_KEYS, empty_form


def workspace_path() -> str:
    return os.path.join(get_config_dir(), "workspace.json")


def default_quote(project_name: str = "") -> Dict[str, Any]:
    title = f"{project_name} 报价明细" if project_name else "项目标题 报价明细"
    return {
        "title": title,
        "taxNote": "总计（含税1%）",
        "footNote": "",
        "rows": [
            {
                "id": "row_1",
                "name": "",
                "qty": 1,
                "duration": "/",
                "unitPrice": 0,
                "partnerPrice": 0,
                "specs": [],
                "note": "",
            }
        ],
    }


def empty_workspace() -> Dict[str, Any]:
    settings = load_settings() or {}
    return {
        "form": empty_form(),
        "quote": default_quote(),
        "ratio": 50,
        "template_path": (settings.get("template_path") or "").strip(),
        "output_dir": (settings.get("output_dir") or "").strip(),
        "output_name": "",
        "selected_project_id": "",
        "selected_contact": "",
        "rev": 0,
        "updated_by": "",
    }


def _normalize(ws: Dict[str, Any]) -> Dict[str, Any]:
    base = empty_workspace()
    if not isinstance(ws, dict):
        return base
    form = base["form"]
    src = ws.get("form") or {}
    if isinstance(src, dict):
        for k in FORM_KEYS:
            if k in src and src[k] is not None:
                form[k] = str(src[k])
        # 允许额外键写入 form（兼容）
        for k, v in src.items():
            if k not in form and v is not None:
                form[k] = str(v)
    quote = ws.get("quote")
    if not isinstance(quote, dict) or not isinstance(quote.get("rows"), list):
        quote = default_quote(form.get("替换的项目名称") or "")
    ratio = ws.get("ratio", 50)
    try:
        ratio = float(ratio)
    except (TypeError, ValueError):
        ratio = 50
    try:
        rev = int(ws.get("rev") or 0)
    except (TypeError, ValueError):
        rev = 0
    return {
        "form": form,
        "quote": quote,
        "ratio": ratio,
        "template_path": str(ws.get("template_path") or base["template_path"] or ""),
        "output_dir": str(ws.get("output_dir") or base["output_dir"] or ""),
        "output_name": str(ws.get("output_name") or ""),
        "selected_project_id": str(ws.get("selected_project_id") or ""),
        "selected_contact": str(ws.get("selected_contact") or ""),
        "rev": rev,
        "updated_by": str(ws.get("updated_by") or ""),
    }


def workspace_meta() -> Dict[str, Any]:
    """轻量元数据，供 GUI 轮询是否被 CLI/AI 改动。"""
    path = workspace_path()
    mtime = 0.0
    size = 0
    rev = 0
    updated_by = ""
    if os.path.isfile(path):
        try:
            st = os.stat(path)
            mtime = float(st.st_mtime)
            size = int(st.st_size)
        except OSError:
            pass
        try:
            with open(path, "r", encoding="utf-8") as f:
                raw = json.load(f)
            rev = int((raw or {}).get("rev") or 0)
            updated_by = str((raw or {}).get("updated_by") or "")
        except Exception:
            pass
    return {
        "path": path,
        "exists": os.path.isfile(path),
        "mtime": mtime,
        "size": size,
        "rev": rev,
        "updated_by": updated_by,
    }


def load_workspace() -> Dict[str, Any]:
    path = workspace_path()
    if not os.path.isfile(path):
        return empty_workspace()
    try:
        with open(path, "r", encoding="utf-8") as f:
            raw = json.load(f)
        return _normalize(raw)
    except Exception:
        return empty_workspace()


# 单文件 undo 栈（替代海量 rev_*.json）
UNDO_MAX = 20


def undo_stack_path() -> str:
    return os.path.join(get_config_dir(), "workspace_undo.json")


def snapshots_dir() -> str:
    d = os.path.join(get_config_dir(), "snapshots")
    os.makedirs(d, exist_ok=True)
    return d


def _load_undo_stack() -> List[Dict[str, Any]]:
    path = undo_stack_path()
    if not os.path.isfile(path):
        return []
    try:
        with open(path, "r", encoding="utf-8") as f:
            raw = json.load(f)
        stack = raw.get("stack") if isinstance(raw, dict) else raw
        if not isinstance(stack, list):
            return []
        return [x for x in stack if isinstance(x, dict)]
    except Exception:
        return []


def _save_undo_stack(stack: List[Dict[str, Any]]) -> None:
    path = undo_stack_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"stack": stack[-UNDO_MAX:], "max": UNDO_MAX}, f, ensure_ascii=False, indent=2)


def _push_undo(prev: Dict[str, Any]) -> None:
    """压入撤销栈（单文件环形，最多 UNDO_MAX 份）。"""
    stack = _load_undo_stack()
    stack.append(_normalize(prev))
    _save_undo_stack(stack)


def _cleanup_legacy_rev_files() -> None:
    """清理旧版 workspace_history/rev_*.json（若存在）。"""
    legacy = os.path.join(get_config_dir(), "workspace_history")
    if not os.path.isdir(legacy):
        return
    try:
        for name in os.listdir(legacy):
            if name.startswith("rev_") and name.endswith(".json"):
                try:
                    os.remove(os.path.join(legacy, name))
                except OSError:
                    pass
        # 目录空则删除
        if not os.listdir(legacy):
            os.rmdir(legacy)
    except OSError:
        pass


def save_workspace(ws: Dict[str, Any], *, bump: bool = True, updated_by: str = "") -> Dict[str, Any]:
    """
    写入工作区。
    bump=True 时 rev+1。
    仅当 updated_by 不是 gui 时压入 undo 栈（GUI 防抖写入极频繁，不入栈）。
    """
    path = workspace_path()
    prev_norm: Optional[Dict[str, Any]] = None
    if os.path.isfile(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                prev = json.load(f)
            if isinstance(prev, dict):
                prev_norm = _normalize(prev)
        except Exception:
            pass

    data = _normalize(ws)
    if bump:
        data["rev"] = int(data.get("rev") or 0) + 1
    if updated_by:
        data["updated_by"] = updated_by

    # CLI/AI 写入才记 undo；GUI 自动同步与 undo/restore 本身不入栈
    if (
        prev_norm is not None
        and bump
        and updated_by
        and updated_by not in ("gui", "undo", "restore", "snapshot")
    ):
        _push_undo(prev_norm)
        _cleanup_legacy_rev_files()

    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    return data


def clear_workspace(updated_by: str = "cli") -> Dict[str, Any]:
    cur = load_workspace()
    ws = empty_workspace()
    ws["rev"] = int(cur.get("rev") or 0)
    return save_workspace(ws, bump=True, updated_by=updated_by)


def undo_workspace(updated_by: str = "cli") -> Dict[str, Any]:
    """弹出 undo 栈顶，恢复为当前工作区。"""
    stack = _load_undo_stack()
    if not stack:
        raise ValueError("没有可撤销的历史（undo 栈为空；仅 CLI/AI 写入会入栈）")
    prev = stack.pop()
    _save_undo_stack(stack)
    restored = _normalize(prev)
    cur = load_workspace()
    restored["rev"] = int(cur.get("rev") or 0)
    # 恢复本身也算一次 CLI 写入，但不要把「刚弹出的状态」再压回去——用特殊标记
    return save_workspace(restored, bump=True, updated_by=updated_by or "undo")


def restore_workspace_rev(rev: int, updated_by: str = "cli") -> Dict[str, Any]:
    """从 undo 栈中查找指定 rev 的快照并恢复。"""
    target = int(rev)
    stack = _load_undo_stack()
    found = None
    for item in reversed(stack):
        try:
            if int(item.get("rev") or -1) == target:
                found = item
                break
        except (TypeError, ValueError):
            continue
    if found is None:
        raise ValueError(
            f"undo 栈中未找到 rev={target}（栈仅保留最近 {UNDO_MAX} 次 CLI 写入；可用 workspace snapshot 做长期备份）"
        )
    restored = _normalize(found)
    cur = load_workspace()
    restored["rev"] = int(cur.get("rev") or 0)
    return save_workspace(restored, bump=True, updated_by=updated_by or "restore")


def create_snapshot(label: str = "", updated_by: str = "cli") -> Dict[str, Any]:
    import uuid
    from datetime import datetime

    ws = load_workspace()
    sid = datetime.now().strftime("%Y%m%d_%H%M%S") + "_" + uuid.uuid4().hex[:6]
    meta = {
        "id": sid,
        "label": label or "",
        "created_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "rev": ws.get("rev"),
        "updated_by": updated_by,
    }
    path = os.path.join(snapshots_dir(), f"{sid}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"meta": meta, "workspace": ws}, f, ensure_ascii=False, indent=2)
    return meta


def list_snapshots() -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    try:
        names = sorted(os.listdir(snapshots_dir()), reverse=True)
    except OSError:
        return out
    for name in names:
        if not name.endswith(".json"):
            continue
        try:
            with open(os.path.join(snapshots_dir(), name), "r", encoding="utf-8") as f:
                raw = json.load(f)
            meta = raw.get("meta") or {"id": name[:-5]}
            out.append(meta)
        except Exception:
            out.append({"id": name[:-5], "label": "", "error": "read_failed"})
    return out


def restore_snapshot(snapshot_id: str, updated_by: str = "cli") -> Dict[str, Any]:
    sid = snapshot_id.strip()
    path = os.path.join(snapshots_dir(), f"{sid}.json")
    if not os.path.isfile(path):
        # 允许只给前缀
        matches = [x for x in (list_snapshots()) if str(x.get("id", "")).startswith(sid)]
        if len(matches) == 1:
            path = os.path.join(snapshots_dir(), f"{matches[0]['id']}.json")
        else:
            raise ValueError(f"未找到快照: {snapshot_id}")
    with open(path, "r", encoding="utf-8") as f:
        raw = json.load(f)
    ws = raw.get("workspace") or raw
    restored = _normalize(ws)
    cur = load_workspace()
    restored["rev"] = int(cur.get("rev") or 0)
    return save_workspace(restored, bump=True, updated_by=updated_by or "snapshot")


def merge_workspace(patch: Dict[str, Any], updated_by: str = "cli") -> Dict[str, Any]:
    ws = load_workspace()
    if not isinstance(patch, dict):
        return save_workspace(ws, bump=True, updated_by=updated_by)
    if "form" in patch and isinstance(patch["form"], dict):
        for k, v in patch["form"].items():
            if v is not None:
                ws["form"][k] = str(v)
    if "quote" in patch and isinstance(patch["quote"], dict):
        ws["quote"] = patch["quote"]
    for key in ("ratio", "template_path", "output_dir", "output_name", "selected_project_id", "selected_contact"):
        if key in patch and patch[key] is not None:
            ws[key] = patch[key]
    return save_workspace(ws, bump=True, updated_by=updated_by)


def replace_workspace(ws: Dict[str, Any], updated_by: str = "gui") -> Dict[str, Any]:
    """GUI 全量覆盖写入（表单+报价+路径）。"""
    cur = load_workspace()
    data = _normalize(ws)
    # 继承 rev 再 bump
    data["rev"] = int(cur.get("rev") or 0)
    return save_workspace(data, bump=True, updated_by=updated_by)


def set_field(key: str, value: Any, updated_by: str = "cli") -> Dict[str, Any]:
    ws = load_workspace()
    ws["form"][key] = "" if value is None else str(value)
    return save_workspace(ws, bump=True, updated_by=updated_by)


def apply_project(project: Dict[str, Any]) -> Dict[str, Any]:
    """将历史项目快照载入工作区。"""
    ws = load_workspace()
    form = empty_form()
    src = project.get("form") or {}
    if isinstance(src, dict):
        for k in FORM_KEYS:
            if k in src and src[k] is not None:
                form[k] = str(src[k])
        for k, v in src.items():
            if k not in form and v is not None:
                form[k] = str(v)
    ws["form"] = form
    if isinstance(project.get("ratio"), (int, float)):
        ws["ratio"] = float(project["ratio"])
    q = project.get("quote")
    if isinstance(q, dict) and isinstance(q.get("rows"), list):
        ws["quote"] = q
    if project.get("template_path"):
        ws["template_path"] = str(project["template_path"])
    if project.get("output_dir") is not None:
        ws["output_dir"] = str(project.get("output_dir") or "")
    if project.get("output_name") is not None:
        ws["output_name"] = str(project.get("output_name") or "")
    ws["selected_project_id"] = str(project.get("id") or "")
    return save_workspace(ws, bump=True, updated_by="cli")


def snapshot_for_project(ws: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """从工作区构造 save_project 用 payload。"""
    ws = ws or load_workspace()
    form = ws.get("form") or {}
    return {
        "contract_no": (form.get("替换的合同编号") or "").strip(),
        "project_name": (form.get("替换的项目名称") or "").strip(),
        "form": deepcopy(form),
        "ratio": ws.get("ratio", 50),
        "quote": ws.get("quote"),
        "template_path": ws.get("template_path") or "",
        "output_dir": ws.get("output_dir") or "",
        "output_name": ws.get("output_name") or "",
    }
