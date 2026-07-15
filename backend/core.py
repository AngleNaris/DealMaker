"""
合同生成核心逻辑：金额大写、模板处理、联系人、设置。
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
from typing import Dict, List, Optional

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Inches, Pt


def project_root() -> str:
    """backend/ 的上一级目录。"""
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def get_app_dir() -> str:
    """可写配置目录所在根：打包后用 exe 旁，否则用项目根。"""
    if getattr(sys, "frozen", False):
        return os.path.dirname(sys.executable)
    return project_root()


def get_config_dir() -> str:
    return os.path.join(get_app_dir(), ".contract_tool")


def get_officecli_path() -> str:
    """获取 officecli 可执行文件路径。"""
    if getattr(sys, "frozen", False):
        meipass = getattr(sys, "_MEIPASS", None)
        if meipass:
            p = os.path.join(meipass, "officecli.exe")
            if os.path.exists(p):
                return p
        base = os.path.dirname(sys.executable)
        for p in (
            os.path.join(base, "_internal", "officecli.exe"),
            os.path.join(base, "officecli.exe"),
        ):
            if os.path.exists(p):
                return p
    p = os.path.join(project_root(), "officecli.exe")
    if os.path.exists(p):
        return p
    return "officecli"


def amount_to_chinese(amount: float) -> str:
    """将数字金额转换为中文大写金额。"""
    digits = ["零", "壹", "贰", "叁", "肆", "伍", "陆", "柒", "捌", "玖"]
    units = ["", "拾", "佰", "仟"]
    big_units = ["", "万", "亿", "兆"]

    if amount == 0:
        return "零元整"
    if amount < 0:
        return "负" + amount_to_chinese(-amount)

    amount = round(amount, 2)
    int_part = int(amount)
    dec_part = round((amount - int_part) * 100)
    result = ""

    if int_part > 0:
        int_str = str(int_part)
        n = len(int_str)
        zero_flag = False
        for i, ch in enumerate(int_str):
            d = int(ch)
            pos = n - i - 1
            unit_idx = pos % 4
            big_idx = pos // 4
            if d == 0:
                zero_flag = True
                if unit_idx == 0 and big_idx > 0:
                    result += big_units[big_idx]
            else:
                if zero_flag:
                    result += "零"
                    zero_flag = False
                result += digits[d] + units[unit_idx]
                if unit_idx == 0 and big_idx > 0:
                    result += big_units[big_idx]
        result += "元"

    if dec_part == 0:
        result += "整"
    else:
        jiao = dec_part // 10
        fen = dec_part % 10
        if jiao > 0:
            result += digits[jiao] + "角"
        elif fen > 0:
            result += "零"
        if fen > 0:
            result += digits[fen] + "分"
    return result


def split_by_ratio(total: float, ratio_percent: float) -> tuple[float, float]:
    """按比例拆分预付款/尾款，保证两者之和等于 total。"""
    prepaid = round(total * ratio_percent / 100.0, 2)
    final = round(total - prepaid, 2)
    return prepaid, final


def auto_fix_final(total: float, prepaid: float) -> tuple[float, float]:
    """策略 A：以预付款为准修正尾款。"""
    prepaid = round(prepaid, 2)
    if prepaid > total:
        prepaid = round(total, 2)
        return prepaid, 0.0
    if prepaid < 0:
        prepaid = 0.0
    return prepaid, round(total - prepaid, 2)


class TemplateProcessor:
    """模板处理器：加载模板、识别占位符、替换内容。"""

    PLACEHOLDER_PATTERN = re.compile(r"%([^%]+)%")

    def __init__(self, template_path: str):
        self.template_path = template_path
        self.doc = None
        self.placeholders: List[str] = []
        self.load_template()

    def load_template(self):
        self.doc = Document(self.template_path)
        self.placeholders = self._find_placeholders()

    def _find_placeholders(self) -> List[str]:
        placeholders = set()

        def extract(text: str):
            text = text.replace("%%", "%\x00")
            for m in self.PLACEHOLDER_PATTERN.findall(text):
                if "\x00" not in m:
                    placeholders.add(m)

        for para in self.doc.paragraphs:
            extract(para.text)
        for table in self.doc.tables:
            for row in table.rows:
                for cell in row.cells:
                    for para in cell.paragraphs:
                        extract(para.text)
        return sorted(placeholders)

    def _resolve_placeholder(self, key: str) -> str:
        if key in self.placeholders:
            return key
        for ph in self.placeholders:
            if ph.startswith(key):
                return ph
        return key

    def generate(self, replacements: Dict[str, str], output_path: str) -> str:
        shutil.copy2(self.template_path, output_path)
        processed = dict(replacements)

        address = processed.pop("乙方地址", "")
        if address:
            lines: List[str] = []
            remaining = address
            for max_len in (17, 20, 20):
                if not remaining:
                    break
                if len(remaining) <= max_len:
                    lines.append(remaining)
                    remaining = ""
                else:
                    break_point = max_len
                    for i in range(max_len - 1, max_len // 2, -1):
                        if remaining[i] in "，。、；：！？,.;:!? ":
                            break_point = i + 1
                            break
                    lines.append(remaining[:break_point])
                    remaining = remaining[break_point:]
            if remaining:
                if lines:
                    lines[-1] += remaining
                else:
                    lines.append(remaining)
            while len(lines) < 3:
                lines.append("")
            processed["替换的乙方地址第一行最大字数"] = lines[0]
            processed["替换的乙方地址第二行最大字数最大字"] = lines[1]
            processed["替换的乙方地址第三行最大字数最大字"] = lines[2]

        img_path = processed.pop("替换的费用表格图片", "")

        for key in list(processed.keys()):
            if "大写" in key:
                actual_key = self._resolve_placeholder(key)
                v = str(processed[key])
                if not actual_key.endswith("整") and not actual_key.endswith("元整"):
                    if v.endswith("元整"):
                        processed[key] = v[:-2]
                    elif v.endswith("整"):
                        processed[key] = v[:-1]

        commands = []
        for key, value in processed.items():
            actual_key = self._resolve_placeholder(key)
            commands.append(
                {
                    "command": "set",
                    "path": "/",
                    "props": {"find": f"%{actual_key}%", "replace": str(value)},
                }
            )

        if commands:
            batch_file = output_path + ".batch.json"
            with open(batch_file, "w", encoding="utf-8") as f:
                json.dump(commands, f, ensure_ascii=False)
            result = subprocess.run(
                [get_officecli_path(), "batch", output_path, "--input", batch_file],
                capture_output=True,
                text=True,
            )
            try:
                os.remove(batch_file)
            except OSError:
                pass
            if result.returncode != 0:
                err = (result.stderr or result.stdout or "officecli batch 失败").strip()
                raise RuntimeError(err)

        if img_path and os.path.isfile(img_path):
            doc = Document(output_path)
            self._insert_image(doc, img_path)
            doc.save(output_path)

        doc = Document(output_path)
        self._normalize_address_font(doc)
        doc.save(output_path)
        return output_path

    def _insert_image(self, doc, img_path: str):
        for para in doc.paragraphs:
            if "替换的费用表格图片" in para.text:
                for run in para.runs:
                    run.text = ""
                run = para.add_run()
                run.add_picture(img_path, width=Inches(5.5))
                para.alignment = WD_ALIGN_PARAGRAPH.CENTER
                return

    def _normalize_address_font(self, doc):
        addr_start = -1
        for i, para in enumerate(doc.paragraphs):
            if "乙方:" in para.text or "乙方：" in para.text:
                addr_start = i + 1
                break
        if addr_start < 0:
            return
        for offset in range(3):
            idx = addr_start + offset
            if idx < len(doc.paragraphs):
                para = doc.paragraphs[idx]
                for run in para.runs:
                    if run.text.strip():
                        run.font.name = "宋体"
                        run.font.size = Pt(12)


class ContactManager:
    def __init__(self, config_dir: Optional[str] = None):
        self.config_dir = config_dir or get_config_dir()
        self.contacts_file = os.path.join(self.config_dir, "contacts.json")
        self.contacts: List[Dict] = []
        self.load_contacts()

    def load_contacts(self):
        if os.path.exists(self.contacts_file):
            try:
                with open(self.contacts_file, "r", encoding="utf-8") as f:
                    self.contacts = json.load(f)
            except Exception:
                self.contacts = []
        else:
            self.contacts = []

    def save_contacts(self):
        os.makedirs(self.config_dir, exist_ok=True)
        with open(self.contacts_file, "w", encoding="utf-8") as f:
            json.dump(self.contacts, f, ensure_ascii=False, indent=2)

    def _get_company_name(self, contact: Dict) -> str:
        return contact.get("替换的乙方名称", "") or contact.get("乙方名称", "")

    def add_contact(self, contact: Dict):
        name = self._get_company_name(contact)
        if not name:
            return
        for i, c in enumerate(self.contacts):
            if self._get_company_name(c) == name:
                self.contacts[i] = contact
                self.save_contacts()
                return
        self.contacts.append(contact)
        self.save_contacts()

    def delete_contact(self, name: str):
        self.contacts = [c for c in self.contacts if self._get_company_name(c) != name]
        self.save_contacts()

    def get_contact(self, name: str) -> Optional[Dict]:
        for c in self.contacts:
            if self._get_company_name(c) == name:
                return c
        return None

    def get_names(self) -> List[str]:
        return [self._get_company_name(c) for c in self.contacts if self._get_company_name(c)]


def load_settings() -> Dict:
    path = os.path.join(get_config_dir(), "settings.json")
    if not os.path.exists(path):
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def save_settings(settings: Dict) -> None:
    os.makedirs(get_config_dir(), exist_ok=True)
    path = os.path.join(get_config_dir(), "settings.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(settings, f, ensure_ascii=False, indent=2)


def default_template_path() -> Optional[str]:
    candidates = []
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        candidates.append(os.path.join(meipass, "_合同模板.docx"))
    candidates.append(os.path.join(get_app_dir(), "_合同模板.docx"))
    for p in candidates:
        if os.path.exists(p):
            return p
    return None


def build_output_path(
    template_path: str,
    data: Dict[str, str],
    output_dir: str = "",
    output_name: str = "",
    ext: str = "docx",
) -> str:
    out_dir = output_dir or os.path.dirname(template_path) or get_app_dir()
    name = output_name
    if not name:
        contract_no = data.get("替换的合同编号", "")
        project_name = data.get("替换的项目名称", "")
        company = data.get("替换的乙方名称", "")
        parts = []
        if contract_no:
            parts.append(contract_no)
        if project_name and company:
            parts.append(f"{project_name}（{company}）")
        elif project_name:
            parts.append(project_name)
        elif company:
            parts.append(company)
        name = "_".join(parts) if parts else "合同"
    return os.path.join(out_dir, f"{name}.{ext}")
