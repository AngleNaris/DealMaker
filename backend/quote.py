"""报价表：数据结构、HTML 渲染、无头浏览器导出 PNG。"""

from __future__ import annotations

import html
import os
import re
import subprocess
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from backend.core import get_config_dir

SPEC_KINDS = ("尺寸", "格式", "码率", "需求", "交付")

QUOTE_CSS = """
* { box-sizing: border-box; }
html, body {
  margin: 0;
  padding: 0;
  background: #ffffff;
}
body {
  color: #000000;
  font-family: "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Heiti SC", "Source Han Sans SC", "Noto Sans CJK SC", sans-serif;
  font-size: 12.5px;
  line-height: 1.4;
  -webkit-font-smoothing: antialiased;
  width: fit-content;
}
table {
  width: 1100px;
  max-width: 1100px;
  border-collapse: collapse;
  border: 1px solid #000000;
  font-size: 12.5px;
}
.title-row td {
  border: 1px solid #000000;
  background: #d6d6d6;
  color: #000000;
  text-align: center;
  font-size: 18px;
  font-weight: 700;
  letter-spacing: 3px;
  padding: 11px 8px;
}
thead th {
  border: 1px solid #000000;
  background: #ececec;
  color: #000000;
  font-weight: 700;
  font-size: 12.5px;
  text-align: center !important;
  vertical-align: middle;
  padding: 8px 6px;
  white-space: nowrap;
}
tbody td {
  border: 1px solid #000000;
  padding: 9px 8px;
  vertical-align: middle;
  color: #000000;
}
.c-idx { width: 42px; }
.c-name { width: 132px; }
.c-qty { width: 64px; }
.c-dur { width: 56px; }
.c-price { width: 104px; }
.c-partner { width: 104px; }
.c-spec { width: auto; min-width: 250px; }
.c-note { width: 124px; }
tbody .c-idx { text-align: center; }
tbody .c-name { text-align: center; font-weight: 600; word-break: break-word; }
tbody .c-qty { text-align: center; }
tbody .c-dur { text-align: center; }
tbody .c-price { text-align: right; font-family: Consolas, "Courier New", monospace; font-size: 14px; }
tbody .c-partner { text-align: right; }
tbody .c-spec { text-align: left; }
tbody .c-note { text-align: left; font-size: 11px; word-break: break-word; }
.price-lg {
  font-family: Consolas, "Courier New", monospace;
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 0.3px;
}
.price-lg-symbol {
  font-family: "Microsoft YaHei", sans-serif;
  font-size: 15px;
  font-weight: 700;
  margin-right: 1px;
}
.spec-tags { display: flex; flex-wrap: wrap; gap: 4px 6px; margin: 0; }
.tag {
  display: inline-flex;
  align-items: center;
  padding: 1px 7px;
  border: 1px solid #c4c4c4;
  background: #f0f0f0;
  font-size: 12px;
  line-height: 1.6;
  white-space: nowrap;
  color: #000000;
  max-width: 100%;
}
.tag .k { font-weight: 700; margin-right: 4px; }
.tag .v { color: #000000; white-space: normal; word-break: break-word; }
tfoot td {
  border: 1px solid #000000;
  padding: 10px 8px;
  background: #f2f2f2;
  font-weight: 700;
  font-size: 12.5px;
  color: #000000;
}
.foot-label { text-align: center; }
.foot-amount { text-align: right; }
.foot-amount .price-lg { font-size: 17px; }
.foot-amount .price-lg-symbol { font-size: 16px; }
.foot-note { text-align: center; font-weight: 400; word-break: break-word; }
"""


def _esc(s: Any) -> str:
    return html.escape("" if s is None else str(s), quote=True)


def _num(v: Any, default: float = 0.0) -> float:
    try:
        n = float(v)
        return n if n == n else default  # NaN check
    except (TypeError, ValueError):
        return default


def _price(v: Any) -> Any:
    """价格允许为数字或占位符 "/"（代表此项另行计价 / 暂不填）。"""
    if isinstance(v, str) and v.strip() == "/":
        return "/"
    return _num(v)


def format_money(n: Any) -> str:
    if isinstance(n, str) and n.strip() == "/":
        return "/"
    n = _num(n)
    if abs(n - round(n)) < 1e-9:
        return f"{int(round(n)):,}"
    return f"{n:,.2f}"


def qty_label(qty: Any) -> str:
    try:
        n = max(0, int(float(qty)))
    except (TypeError, ValueError):
        n = 0
    return f"{n} 项"


def labeled_spec_tags(specs: List[Dict[str, Any]]) -> List[Tuple[str, str]]:
    totals: Dict[str, int] = {}
    counts: Dict[str, int] = {}
    for t in specs or []:
        kind = str(t.get("kind") or "")
        totals[kind] = totals.get(kind, 0) + 1
    out: List[Tuple[str, str]] = []
    for t in specs or []:
        kind = str(t.get("kind") or "")
        counts[kind] = counts.get(kind, 0) + 1
        key = f"{kind}{counts[kind]}" if totals.get(kind, 0) > 1 else kind
        out.append((key, str(t.get("value") or "")))
    return out


def line_amount(row: Dict[str, Any]) -> float:
    """单行金额。

    - 合作价为 ``/``：另行计价，本行 0
    - 合作价为有效数字（≠0）：**合作价即行金额**（已是该行总价，不再 × 数量）
    - 合作价为 0 / 未填：用 **单价 × 数量**（解决只填单价+数量时合计为 0 的问题）
    - 单价为 ``/`` 且合作价为 0：0
    """
    qty = max(0.0, _num(row.get("qty"), 0))
    partner = row.get("partnerPrice")
    unit = row.get("unitPrice")
    if partner == "/":
        return 0.0
    p = _num(partner)
    if abs(p) > 1e-12:
        return round(p, 2)
    if unit == "/":
        return 0.0
    return round(_num(unit) * qty, 2)


def sum_partner(rows: List[Dict[str, Any]]) -> float:
    """报价合计 = 各行 line_amount 之和。"""
    return round(sum(line_amount(r) for r in (rows or [])), 2)


def alloc_row_id(existing_rows: List[Dict[str, Any]]) -> str:
    """生成不与现有行冲突的 id：row_<max+1>，否则随机串。"""
    used = {str(r.get("id") or "") for r in (existing_rows or [])}
    max_n = 0
    for uid in used:
        m = re.match(r"^row_(\d+)$", uid)
        if m:
            max_n = max(max_n, int(m.group(1)))
    n = max_n + 1
    while f"row_{n}" in used:
        n += 1
    candidate = f"row_{n}"
    if candidate not in used:
        return candidate
    # 极端情况：随机
    for _ in range(20):
        rid = f"row_{uuid.uuid4().hex[:8]}"
        if rid not in used:
            return rid
    return f"row_{uuid.uuid4().hex}"


def normalize_quote(data: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    data = data if isinstance(data, dict) else {}
    rows_in = data.get("rows") if isinstance(data.get("rows"), list) else []
    rows: List[Dict[str, Any]] = []
    used_ids: set = set()
    for i, r in enumerate(rows_in):
        if not isinstance(r, dict):
            continue
        specs = []
        for s in r.get("specs") or []:
            if not isinstance(s, dict):
                continue
            specs.append(
                {
                    "id": str(s.get("id") or f"spec_{uuid.uuid4().hex[:8]}"),
                    "kind": str(s.get("kind") or "需求"),
                    "value": str(s.get("value") or ""),
                }
            )
        rid = str(r.get("id") or "").strip()
        if not rid or rid in used_ids:
            # 缺 id 或与已有冲突 → 分配唯一 id（避免 row_1 覆盖）
            rid = alloc_row_id([{"id": x} for x in used_ids] + rows)
        used_ids.add(rid)
        rows.append(
            {
                "id": rid,
                "name": str(r.get("name") or ""),
                "qty": _num(r.get("qty"), 1),
                "duration": str(r.get("duration") if r.get("duration") is not None else "/"),
                "unitPrice": _price(r.get("unitPrice")),
                "partnerPrice": _price(r.get("partnerPrice")),
                "specs": specs,
                "note": str(r.get("note") or ""),
            }
        )
    if not rows:
        rows = [
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
        ]
    return {
        "title": str(data.get("title") or "项目标题 报价明细"),
        "taxNote": str(data.get("taxNote") or "总计（含税1%）"),
        "footNote": str(data.get("footNote") or ""),
        "rows": rows,
    }


def build_quote_html(data: Dict[str, Any]) -> str:
    q = normalize_quote(data)
    total = sum_partner(q["rows"])
    rows_html = []
    for i, row in enumerate(q["rows"]):
        tags = labeled_spec_tags(row.get("specs") or [])
        if tags:
            tags_html = (
                '<div class="spec-tags">'
                + "".join(
                    f'<span class="tag"><span class="k">{_esc(k)}</span>'
                    f'<span class="v">{_esc(v)}</span></span>'
                    for k, v in tags
                )
                + "</div>"
            )
        else:
            tags_html = "—"
        unit_price = row.get("unitPrice")
        partner_price = row.get("partnerPrice")
        unit_cell = "/" if unit_price == "/" else f"¥{_esc(format_money(unit_price))}"
        if partner_price == "/":
            partner_cell = "/"
        else:
            partner_cell = (
                '<span class="price-lg-symbol">¥</span>'
                f'<span class="price-lg">{_esc(format_money(partner_price))}</span>'
            )
        rows_html.append(
            f"""<tr>
  <td class="c-idx">{i + 1}</td>
  <td class="c-name">{_esc(row.get("name") or "—")}</td>
  <td class="c-qty">{_esc(qty_label(row.get("qty")))}</td>
  <td class="c-dur">{_esc(row.get("duration") or "/")}</td>
  <td class="c-price">{unit_cell}</td>
  <td class="c-partner">{partner_cell}</td>
  <td class="c-spec">{tags_html}</td>
  <td class="c-note">{_esc(row.get("note") or "")}</td>
</tr>"""
        )
    body_rows = "\n".join(rows_html)
    return f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>{QUOTE_CSS}</style>
</head>
<body>
<table>
  <thead>
    <tr class="title-row"><td colspan="8">{_esc(q.get("title") or "项目标题 报价明细")}</td></tr>
    <tr>
      <th class="c-idx">编号</th>
      <th class="c-name">服务名称</th>
      <th class="c-qty">数量</th>
      <th class="c-dur">时长</th>
      <th class="c-price">单价</th>
      <th class="c-partner">合作价</th>
      <th class="c-spec">交付规格</th>
      <th class="c-note">其它备注</th>
    </tr>
  </thead>
  <tbody>
{body_rows}
  </tbody>
  <tfoot>
    <tr>
      <td class="foot-label" colspan="4">{_esc(q.get("taxNote") or "总计")}</td>
      <td class="foot-amount" colspan="2"><span class="price-lg-symbol">¥</span><span class="price-lg">{_esc(format_money(total))}</span></td>
      <td class="foot-note" colspan="2">{_esc(q.get("footNote") or "")}</td>
    </tr>
  </tfoot>
</table>
</body>
</html>"""


def quotes_dir() -> str:
    d = os.path.join(get_config_dir(), "quotes")
    os.makedirs(d, exist_ok=True)
    return d


_SAFE_FILENAME_RE = re.compile(r'[\\/:*?"<>|\r\n]+')


def safe_filename_part(s: str, max_len: int = 80) -> str:
    """去掉 Windows 非法文件名字符，压缩空白。"""
    t = _SAFE_FILENAME_RE.sub("_", str(s or "").strip())
    t = re.sub(r"\s+", " ", t).strip(" ._")
    if len(t) > max_len:
        t = t[:max_len].rstrip(" ._")
    return t


def quote_png_filename(
    project_name: str = "",
    contract_no: str = "",
) -> str:
    """同项目稳定文件名：项目名称_合同编号.png（可覆盖）。"""
    a = safe_filename_part(project_name)
    b = safe_filename_part(contract_no)
    if a and b:
        stem = f"{a}_{b}"
    elif a:
        stem = a
    elif b:
        stem = b
    else:
        stem = "报价表"
    return f"{stem}.png"


def export_quote_html(data: Dict[str, Any], out_path: Optional[str] = None) -> str:
    html_str = build_quote_html(data)
    if not out_path:
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        out_path = os.path.join(quotes_dir(), f"报价表_{ts}.html")
    out_path = os.path.abspath(out_path)
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(html_str)
    return out_path


def quote_calc(data: Dict[str, Any], tax_rate: Optional[float] = None) -> Dict[str, Any]:
    """报价合计。

    行金额：合作价≠0 用合作价（行总价）；否则 单价×数量。税率为百分比。
    """
    q = normalize_quote(data)
    lines = []
    for i, r in enumerate(q["rows"]):
        amt = line_amount(r)
        lines.append(
            {
                "index": i + 1,
                "id": r.get("id"),
                "name": r.get("name") or "",
                "qty": r.get("qty"),
                "unitPrice": r.get("unitPrice"),
                "partnerPrice": r.get("partnerPrice"),
                "amount": amt,
            }
        )
    subtotal = round(sum(x["amount"] for x in lines), 2)
    rate = tax_rate
    if rate is None:
        m = re.search(r"含税\s*([0-9]+(?:\.[0-9]+)?)\s*%", str(q.get("taxNote") or ""))
        rate = float(m.group(1)) if m else 0.0
    try:
        rate = float(rate or 0)
    except (TypeError, ValueError):
        rate = 0.0
    tax_amount = round(subtotal * rate / 100.0, 2) if rate else 0.0
    return {
        "subtotal": subtotal,
        "tax_rate": rate,
        "tax": tax_amount,
        "total": subtotal,
        "total_with_tax_note": round(subtotal + tax_amount, 2) if rate else subtotal,
        "row_count": len(q["rows"]),
        "taxNote": q.get("taxNote") or "",
        "lines": lines,
        "rule": "合作价≠0→行金额=合作价；否则行金额=单价×数量；合作价为/→0",
    }


def validate_quote(data: Dict[str, Any]) -> Dict[str, Any]:
    q = normalize_quote(data)
    errors: List[str] = []
    warnings: List[str] = []
    if not q.get("title"):
        warnings.append("标题为空")
    for i, row in enumerate(q["rows"]):
        idx = i + 1
        for s in row.get("specs") or []:
            kind = str(s.get("kind") or "")
            if kind and kind not in SPEC_KINDS:
                errors.append(f"第{idx}行 specs.kind 非法: {kind}（允许: {', '.join(SPEC_KINDS)}）")
        if _num(row.get("partnerPrice")) < 0 or _num(row.get("unitPrice")) < 0:
            errors.append(f"第{idx}行价格不能为负")
    return {"ok": len(errors) == 0, "errors": errors, "warnings": warnings, "quote": q}


def _find_row_index(rows: List[Dict[str, Any]], key: str) -> int:
    """key 为 1-based 序号或 row id。"""
    key = str(key).strip()
    if key.isdigit():
        i = int(key) - 1
        if 0 <= i < len(rows):
            return i
        raise ValueError(f"行号超出范围: {key}（共 {len(rows)} 行，从 1 开始）")
    for i, r in enumerate(rows):
        if str(r.get("id")) == key:
            return i
    raise ValueError(f"未找到行: {key}")


def quote_row_add(
    data: Dict[str, Any],
    row: Dict[str, Any],
    at: Optional[int] = None,
) -> Dict[str, Any]:
    q = normalize_quote(data)
    rows = list(q["rows"])
    row = dict(row or {})
    rid = str(row.get("id") or "").strip()
    used = {str(r.get("id") or "") for r in rows}
    if not rid or rid in used:
        rid = alloc_row_id(rows)
    row["id"] = rid
    new_row = normalize_quote({"rows": [row]})["rows"][0]
    # normalize 可能因 used 空又改 id；强制最终唯一
    if new_row.get("id") in used:
        new_row["id"] = alloc_row_id(rows)
    if at is None:
        rows.append(new_row)
    else:
        # at 为 1-based 插入位置
        pos = 0
        if int(at) >= 1:
            pos = min(len(rows), int(at) - 1)
        rows.insert(pos, new_row)
    q["rows"] = rows
    return q


def quote_row_update(data: Dict[str, Any], key: str, patch: Dict[str, Any]) -> Dict[str, Any]:
    q = normalize_quote(data)
    rows = list(q["rows"])
    i = _find_row_index(rows, key)
    cur = dict(rows[i])
    if not isinstance(patch, dict):
        raise ValueError("update 需要 JSON 对象")
    for k, v in patch.items():
        if k == "specs" and isinstance(v, list):
            cur["specs"] = v
        elif k in ("name", "duration", "note", "id"):
            cur[k] = v
        elif k in ("qty", "unitPrice", "partnerPrice"):
            cur[k] = _price(v) if k in ("unitPrice", "partnerPrice") else _num(v)
    rows[i] = normalize_quote({"rows": [cur]})["rows"][0]
    q["rows"] = rows
    return q


def quote_row_delete(data: Dict[str, Any], key: str) -> Dict[str, Any]:
    q = normalize_quote(data)
    rows = list(q["rows"])
    if len(rows) <= 1:
        raise ValueError("至少保留一行，无法删除")
    i = _find_row_index(rows, key)
    rows.pop(i)
    q["rows"] = rows
    return q


def quote_row_move(data: Dict[str, Any], src: str, dst: str) -> Dict[str, Any]:
    """把 src 行移到 dst 位置（均为 1-based 序号或 id）。"""
    q = normalize_quote(data)
    rows = list(q["rows"])
    i = _find_row_index(rows, src)
    # dst 作为目标序号
    if str(dst).isdigit():
        j = max(0, min(len(rows) - 1, int(dst) - 1))
    else:
        j = _find_row_index(rows, dst)
    row = rows.pop(i)
    rows.insert(j, row)
    q["rows"] = rows
    return q


def quote_row_swap(data: Dict[str, Any], a: str, b: str) -> Dict[str, Any]:
    q = normalize_quote(data)
    rows = list(q["rows"])
    i = _find_row_index(rows, a)
    j = _find_row_index(rows, b)
    rows[i], rows[j] = rows[j], rows[i]
    q["rows"] = rows
    return q


def _load_cjk_font(size: int, bold: bool = False):
    """加载系统中文字体（不依赖浏览器）。"""
    from PIL import ImageFont

    windir = os.environ.get("WINDIR", r"C:\Windows")
    candidates = []
    if bold:
        candidates.extend(
            [
                os.path.join(windir, "Fonts", "msyhbd.ttc"),  # 微软雅黑 Bold
                os.path.join(windir, "Fonts", "msyhbd.ttf"),
                os.path.join(windir, "Fonts", "simhei.ttf"),
            ]
        )
    candidates.extend(
        [
            os.path.join(windir, "Fonts", "msyh.ttc"),
            os.path.join(windir, "Fonts", "msyh.ttf"),
            os.path.join(windir, "Fonts", "simsun.ttc"),
            os.path.join(windir, "Fonts", "simhei.ttf"),
            "/System/Library/Fonts/PingFang.ttc",
            "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
        ]
    )
    for path in candidates:
        if not os.path.isfile(path):
            continue
        try:
            return ImageFont.truetype(path, size=size)
        except OSError:
            continue
    return ImageFont.load_default()


def _text_size(draw, text: str, font) -> Tuple[int, int]:
    if not text:
        return 0, 0
    box = draw.textbbox((0, 0), text, font=font)
    return max(0, box[2] - box[0]), max(0, box[3] - box[1])


def _wrap_lines(draw, text: str, font, max_width: int) -> List[str]:
    """按像素宽度折行（中英混排按字符切）。"""
    text = str(text or "").replace("\r\n", "\n").replace("\r", "\n")
    if not text:
        return [""]
    lines: List[str] = []
    for para in text.split("\n"):
        if not para:
            lines.append("")
            continue
        cur = ""
        for ch in para:
            trial = cur + ch
            w, _ = _text_size(draw, trial, font)
            if w <= max_width or not cur:
                cur = trial
            else:
                lines.append(cur)
                cur = ch
        if cur:
            lines.append(cur)
    return lines or [""]


def render_quote_png(data: Dict[str, Any], out_path: str) -> Dict[str, Any]:
    """用 Pillow 本地绘制报价表 PNG，无需浏览器。"""
    try:
        from PIL import Image, ImageDraw
    except ImportError as e:
        raise RuntimeError("导出报价图需要 Pillow，请 pip install pillow") from e

    q = normalize_quote(data)
    total = sum_partner(q["rows"])

    # 列宽（合计 1100，与 HTML 模板一致）
    col_ws = [48, 140, 72, 64, 112, 120, 300, 144]
    table_w = sum(col_ws)
    pad_x = 8
    pad_y = 8
    line_gap = 3
    border = (0, 0, 0)
    bg_title = (214, 214, 214)
    bg_head = (236, 236, 236)
    bg_foot = (242, 242, 242)
    bg_cell = (255, 255, 255)
    tag_bg = (240, 240, 240)
    tag_border = (196, 196, 196)

    font_title = _load_cjk_font(18, bold=True)
    font_head = _load_cjk_font(13, bold=True)
    font_cell = _load_cjk_font(12)
    font_cell_b = _load_cjk_font(12, bold=True)
    font_price = _load_cjk_font(15, bold=True)
    font_tag = _load_cjk_font(11)

    # 临时图用于量字
    measure = Image.new("RGB", (10, 10), "white")
    md = ImageDraw.Draw(measure)

    headers = ["编号", "服务名称", "数量", "时长", "单价", "合作价", "交付规格", "其它备注"]

    def cell_lines(col: int, text: str, font) -> List[str]:
        return _wrap_lines(md, text, font, max(10, col_ws[col] - pad_x * 2))

    def lines_height(lines: List[str], font) -> int:
        if not lines:
            _, th = _text_size(md, " ", font)
            return th + pad_y * 2
        h = 0
        for i, ln in enumerate(lines):
            _, th = _text_size(md, ln or " ", font)
            h += th
            if i:
                h += line_gap
        return h + pad_y * 2

    # 标题 / 表头高度（标题跨全宽折行）
    title_lines = _wrap_lines(
        md, q.get("title") or "项目标题 报价明细", font_title, table_w - pad_x * 2
    )
    title_h = max(44, lines_height(title_lines, font_title))
    _, head_th = _text_size(md, "编号", font_head)
    head_h = max(36, head_th + pad_y * 2)

    # 数据行内容
    row_payloads: List[List[Tuple[List[str], Any]]] = []
    row_heights: List[int] = []
    for i, row in enumerate(q["rows"]):
        unit = row.get("unitPrice")
        partner = row.get("partnerPrice")
        unit_s = "/" if unit == "/" else f"¥{format_money(unit)}"
        partner_s = "/" if partner == "/" else f"¥{format_money(partner)}"
        tags = labeled_spec_tags(row.get("specs") or [])
        if tags:
            spec_s = "  ".join(f"{k} {v}" for k, v in tags)
        else:
            spec_s = "—"
        cells = [
            (cell_lines(0, str(i + 1), font_cell), font_cell),
            (cell_lines(1, row.get("name") or "—", font_cell_b), font_cell_b),
            (cell_lines(2, qty_label(row.get("qty")), font_cell), font_cell),
            (cell_lines(3, str(row.get("duration") or "/"), font_cell), font_cell),
            (cell_lines(4, unit_s, font_cell), font_cell),
            (cell_lines(5, partner_s, font_price if partner != "/" else font_cell), font_price if partner != "/" else font_cell),
            (cell_lines(6, spec_s, font_tag), font_tag),
            (cell_lines(7, str(row.get("note") or ""), font_cell), font_cell),
        ]
        # 规格用标签视觉时可能更高：按行文本高度
        rh = max(lines_height(lines, font) for lines, font in cells)
        rh = max(rh, 36)
        row_payloads.append(cells)
        row_heights.append(rh)

    tax = str(q.get("taxNote") or "总计")
    foot_note = str(q.get("footNote") or "")
    total_s = f"¥{format_money(total)}"
    # 页脚：左 4 列标签、中 2 列金额、右 2 列备注
    foot_label_w = sum(col_ws[:4])
    foot_amt_w = sum(col_ws[4:6])
    foot_note_w = sum(col_ws[6:])
    foot_label_lines = _wrap_lines(md, tax, font_cell_b, foot_label_w - pad_x * 2)
    foot_amt_lines = _wrap_lines(md, total_s, font_price, foot_amt_w - pad_x * 2)
    foot_note_lines = _wrap_lines(md, foot_note, font_cell, foot_note_w - pad_x * 2)
    foot_h = max(
        40,
        lines_height(foot_label_lines, font_cell_b),
        lines_height(foot_amt_lines, font_price),
        lines_height(foot_note_lines, font_cell),
    )

    table_h = title_h + head_h + sum(row_heights) + foot_h
    img = Image.new("RGB", (table_w + 2, table_h + 2), "white")
    draw = ImageDraw.Draw(img)

    def draw_rect(x0, y0, x1, y1, fill):
        draw.rectangle([x0, y0, x1, y1], fill=fill, outline=border, width=1)

    def draw_text_block(x, y, w, h, lines, font, align="center"):
        total_th = 0
        sizes = []
        for ln in lines:
            tw, th = _text_size(draw, ln or " ", font)
            sizes.append((tw, th))
            total_th += th
        total_th += line_gap * max(0, len(lines) - 1)
        cy = y + max(0, (h - total_th) // 2)
        for (ln, (tw, th)) in zip(lines, sizes):
            if align == "center":
                tx = x + (w - tw) // 2
            elif align == "right":
                tx = x + w - pad_x - tw
            else:
                tx = x + pad_x
            draw.text((tx, cy), ln, fill=(0, 0, 0), font=font)
            cy += th + line_gap

    ox, oy = 1, 1
    # 标题
    draw_rect(ox, oy, ox + table_w, oy + title_h, bg_title)
    draw_text_block(ox, oy, table_w, title_h, title_lines, font_title, "center")
    y = oy + title_h

    # 表头
    x = ox
    for i, htxt in enumerate(headers):
        draw_rect(x, y, x + col_ws[i], y + head_h, bg_head)
        draw_text_block(x, y, col_ws[i], head_h, [htxt], font_head, "center")
        x += col_ws[i]
    y += head_h

    # 数据行
    for cells, rh in zip(row_payloads, row_heights):
        x = ox
        aligns = ["center", "center", "center", "center", "right", "right", "left", "left"]
        for i, ((lines, font), align) in enumerate(zip(cells, aligns)):
            draw_rect(x, y, x + col_ws[i], y + rh, bg_cell)
            draw_text_block(x, y, col_ws[i], rh, lines, font, align)
            x += col_ws[i]
        y += rh

    # 页脚三块
    draw_rect(ox, y, ox + foot_label_w, y + foot_h, bg_foot)
    draw_text_block(ox, y, foot_label_w, foot_h, foot_label_lines, font_cell_b, "center")
    x = ox + foot_label_w
    draw_rect(x, y, x + foot_amt_w, y + foot_h, bg_foot)
    draw_text_block(x, y, foot_amt_w, foot_h, foot_amt_lines, font_price, "right")
    x = x + foot_amt_w
    draw_rect(x, y, x + foot_note_w, y + foot_h, bg_foot)
    draw_text_block(x, y, foot_note_w, foot_h, foot_note_lines, font_cell, "center")

    out_path = os.path.abspath(out_path)
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    img.save(out_path, format="PNG")
    return {
        "path": out_path,
        "size": os.path.getsize(out_path),
        "width": img.size[0],
        "height": img.size[1],
        "engine": "pillow",
    }


def list_browsers() -> List[Tuple[str, str]]:
    """列出本机可用浏览器，顺序：Edge → Chrome → Firefox。"""
    import shutil

    groups: List[Tuple[str, List[str], str]] = [
        (
            "edge",
            [
                r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
                r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
            ],
            "msedge",
        ),
        (
            "chrome",
            [
                r"C:\Program Files\Google\Chrome\Application\chrome.exe",
                r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
            ],
            "chrome",
        ),
        (
            "firefox",
            [
                r"C:\Program Files\Mozilla Firefox\firefox.exe",
                r"C:\Program Files (x86)\Mozilla Firefox\firefox.exe",
            ],
            "firefox",
        ),
    ]
    out: List[Tuple[str, str]] = []
    seen = set()
    for engine, paths, which_name in groups:
        hit = None
        for p in paths:
            if os.path.isfile(p):
                hit = p
                break
        if not hit:
            w = shutil.which(which_name)
            if w and os.path.isfile(w):
                hit = w
        if hit and hit not in seen:
            seen.add(hit)
            out.append((hit, engine))
    return out


def find_browser() -> Optional[Tuple[str, str]]:
    """自动寻找本机浏览器。优先级：Edge → Chrome → Firefox。"""
    browsers = list_browsers()
    return browsers[0] if browsers else None


def _cleanup_quote_temps(qdir: Optional[str] = None) -> None:
    """清理 quotes 目录里历史残留的临时导出文件。"""
    d = qdir or quotes_dir()
    try:
        for name in os.listdir(d):
            if not (
                name.startswith("_quote_export_")
                or name.startswith("_quote_shot_")
                or name.endswith(".trim.png")
            ):
                continue
            try:
                os.remove(os.path.join(d, name))
            except OSError:
                pass
    except OSError:
        pass


def trim_white_png(path: str, threshold: int = 248) -> bool:
    """裁掉截图四周近白边。始终写回 path。临时文件放系统 temp，不污染 quotes。"""
    try:
        from PIL import Image
    except ImportError:
        return False

    img = Image.open(path).convert("RGB")
    w, h = img.size
    if w == 0 or h == 0:
        return False
    pixels = img.load()

    def is_white(x: int, y: int) -> bool:
        r, g, b = pixels[x, y]
        return r >= threshold and g >= threshold and b >= threshold

    top = 0
    found = False
    for y in range(h):
        for x in range(w):
            if not is_white(x, y):
                top = y
                found = True
                break
        if found:
            break
    if not found:
        return False

    bottom = h - 1
    for y in range(h - 1, top - 1, -1):
        if any(not is_white(x, y) for x in range(w)):
            bottom = y
            break

    left = 0
    for x in range(w):
        if any(not is_white(x, y) for y in range(top, bottom + 1)):
            left = x
            break

    right = w - 1
    for x in range(w - 1, left - 1, -1):
        if any(not is_white(x, y) for y in range(top, bottom + 1)):
            right = x
            break

    tw = right - left + 1
    th = bottom - top + 1
    if tw <= 0 or th <= 0:
        return False
    if top == 0 and left == 0 and tw == w and th == h:
        return False

    cropped = img.crop((left, top, right + 1, bottom + 1))
    import tempfile

    fd, tmp = tempfile.mkstemp(suffix=".png", prefix="dm_trim_")
    os.close(fd)
    try:
        cropped.save(tmp, format="PNG")
        os.replace(tmp, path)
    finally:
        try:
            if os.path.isfile(tmp):
                os.remove(tmp)
        except OSError:
            pass
    return True


def _file_url(path: str) -> str:
    abs_html = os.path.abspath(path).replace("\\", "/")
    if re.match(r"^[A-Za-z]:/", abs_html):
        return "file:///" + abs_html
    return "file://" + abs_html


def _run_hidden(cmd: List[str], *, cwd: Optional[str] = None) -> subprocess.CompletedProcess:
    kwargs: Dict[str, Any] = {"capture_output": True, "text": True, "cwd": cwd}
    if os.name == "nt":
        kwargs["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000)
    return subprocess.run(cmd, **kwargs)


def _find_shot_file(tmp_dir: str, preferred: str, stderr: str = "") -> Optional[str]:
    """定位浏览器实际写出的截图（路径/文件名各版本不一致）。"""
    candidates: List[str] = []
    if preferred:
        candidates.append(preferred)
    # stderr: "123 bytes written to file C:\path\out.png"
    m = re.search(r"bytes written to file\s+(.+)", stderr or "", re.I)
    if m:
        p = m.group(1).strip().strip('"').strip("'")
        # 可能被截断，仍先尝试
        candidates.append(p)
    for name in ("screenshot.png", "out.png", "shot.png"):
        candidates.append(os.path.join(tmp_dir, name))
    # 扫临时目录里最新 png
    try:
        pngs = [
            os.path.join(tmp_dir, n)
            for n in os.listdir(tmp_dir)
            if n.lower().endswith(".png")
        ]
        pngs.sort(key=lambda p: os.path.getmtime(p), reverse=True)
        candidates.extend(pngs)
    except OSError:
        pass

    seen = set()
    for p in candidates:
        if not p or p in seen:
            continue
        seen.add(p)
        if os.path.isfile(p) and os.path.getsize(p) > 100:
            return p
    return None


def _chromium_screenshot(
    browser: str,
    engine: str,
    file_url: str,
    shot_path: str,
    tmp_dir: str,
) -> str:
    """Edge/Chrome headless 截图，返回实际截图路径。"""
    import time

    # 独立用户目录：避免与正在运行的 Edge 抢 profile 导致无图仍 exit 0
    user_data = os.path.join(tmp_dir, f"{engine}_profile")
    os.makedirs(user_data, exist_ok=True)

    # 截图路径用正斜杠，部分 Edge 版本对反斜杠/长路径更稳
    shot_arg = shot_path.replace("\\", "/")

    base_flags = [
        "--disable-gpu",
        "--hide-scrollbars",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-extensions",
        "--disable-background-networking",
        "--disable-sync",
        "--disable-translate",
        "--allow-file-access-from-files",
        f"--user-data-dir={user_data}",
        "--force-device-scale-factor=2",
        "--default-background-color=ffffffff",
        "--window-size=2400,6400",
    ]

    attempts: List[List[str]] = [
        # 新 headless（首选）
        [browser, "--headless=new", *base_flags, f"--screenshot={shot_arg}", file_url],
        # 旧 headless
        [browser, "--headless", *base_flags, f"--screenshot={shot_arg}", file_url],
        # 相对文件名写到 tmp_dir
        [
            browser,
            "--headless=new",
            *base_flags,
            "--screenshot=screenshot.png",
            file_url,
        ],
    ]

    last_err = ""
    for cmd in attempts:
        # 清理可能残留
        for p in (shot_path, os.path.join(tmp_dir, "screenshot.png")):
            try:
                if os.path.isfile(p):
                    os.remove(p)
            except OSError:
                pass

        result = _run_hidden(cmd, cwd=tmp_dir)
        # 等文件落盘
        for _ in range(20):
            found = _find_shot_file(tmp_dir, shot_path, result.stderr or "")
            if found:
                return found
            time.sleep(0.05)

        found = _find_shot_file(tmp_dir, shot_path, result.stderr or "")
        if found:
            return found

        last_err = (result.stderr or result.stdout or "").strip() or str(result.returncode)

    raise RuntimeError(f"{engine} 未生成截图: {last_err[:300]}")


def _firefox_screenshot(browser: str, file_url: str, shot_path: str, tmp_dir: str) -> str:
    import time

    for p in (shot_path, os.path.join(tmp_dir, "screenshot.png")):
        try:
            if os.path.isfile(p):
                os.remove(p)
        except OSError:
            pass

    cmd = [browser, "-headless", "-screenshot", shot_path, file_url]
    result = _run_hidden(cmd, cwd=tmp_dir)
    for _ in range(20):
        found = _find_shot_file(tmp_dir, shot_path, result.stderr or "")
        if found:
            return found
        time.sleep(0.05)
    found = _find_shot_file(tmp_dir, shot_path, result.stderr or "")
    if found:
        return found
    err = (result.stderr or result.stdout or "").strip() or str(result.returncode)
    raise RuntimeError(f"firefox 未生成截图: {err[:300]}")


def _export_quote_png_with_browser(
    data: Dict[str, Any],
    out_path: str,
    browser: str,
    engine: str,
) -> Dict[str, Any]:
    """指定浏览器导出一帧 PNG。"""
    import tempfile
    import time

    token = uuid.uuid4().hex[:12]
    tmp_dir = tempfile.mkdtemp(prefix="dm_quote_")
    html_path = os.path.join(tmp_dir, f"quote_{token}.html")
    shot_path = os.path.join(tmp_dir, f"shot_{token}.png")

    try:
        with open(html_path, "w", encoding="utf-8") as f:
            f.write(build_quote_html(data))

        file_url = _file_url(html_path)

        try:
            if os.path.isfile(out_path):
                os.remove(out_path)
        except OSError:
            pass

        if engine in ("edge", "chrome"):
            actual_shot = _chromium_screenshot(browser, engine, file_url, shot_path, tmp_dir)
        else:
            actual_shot = _firefox_screenshot(browser, file_url, shot_path, tmp_dir)

        for _ in range(15):
            try:
                if os.path.isfile(actual_shot) and os.path.getsize(actual_shot) > 100:
                    break
            except OSError:
                pass
            time.sleep(0.05)

        if not os.path.isfile(actual_shot) or os.path.getsize(actual_shot) <= 100:
            raise RuntimeError(f"{engine} 截图文件无效: {actual_shot}")

        trimmed = trim_white_png(actual_shot)
        try:
            from PIL import Image as _Image

            with _Image.open(actual_shot) as im:
                too_big = im.size[1] > 4000 or im.size[0] >= 2390
            if too_big:
                trim_white_png(actual_shot)
                trimmed = True
        except Exception:
            pass

        os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
        width = height = 0
        try:
            from PIL import Image

            with Image.open(actual_shot) as im:
                im.load()
                width, height = im.size
                im.convert("RGB").save(out_path, format="PNG")
        except Exception:
            import shutil

            for _ in range(8):
                try:
                    shutil.copy2(actual_shot, out_path)
                    break
                except OSError:
                    time.sleep(0.15)
            else:
                raise RuntimeError(f"无法写入导出图: {out_path}")

        return {
            "path": out_path,
            "size": os.path.getsize(out_path),
            "width": width,
            "height": height,
            "engine": engine,
            "trimmed": trimmed,
        }
    finally:
        try:
            for root, dirs, files in os.walk(tmp_dir, topdown=False):
                for name in files:
                    p = os.path.join(root, name)
                    for _ in range(5):
                        try:
                            os.remove(p)
                            break
                        except OSError:
                            time.sleep(0.1)
                for name in dirs:
                    try:
                        os.rmdir(os.path.join(root, name))
                    except OSError:
                        pass
            try:
                os.rmdir(tmp_dir)
            except OSError:
                pass
        except OSError:
            pass


def export_quote_png(
    data: Dict[str, Any],
    out_path: Optional[str] = None,
    *,
    project_name: str = "",
    contract_no: str = "",
) -> Dict[str, Any]:
    """导出报价表 PNG：浏览器 headless 截图（Edge → Chrome → Firefox）。

    CLI 与 GUI 共用。临时文件在系统 temp，quotes 目录只留最终那一张图。
    """
    if not out_path:
        out_path = os.path.join(
            quotes_dir(),
            quote_png_filename(project_name, contract_no),
        )
    out_path = os.path.abspath(out_path)
    if not out_path.lower().endswith(".png"):
        out_path += ".png"
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)

    _cleanup_quote_temps()

    browsers = list_browsers()
    if not browsers:
        raise RuntimeError("未找到 Edge / Chrome / Firefox，无法导出报价图")

    errors: List[str] = []
    for browser, engine in browsers:
        try:
            return _export_quote_png_with_browser(data, out_path, browser, engine)
        except Exception as e:
            errors.append(f"{engine}: {e}")

    raise RuntimeError(
        "浏览器导出失败（已尝试 Edge/Chrome/Firefox）: " + " | ".join(errors)
    )
