"""表单 / 联系人 / 报价 字段 schema（供 Agent 发现与校验）。"""

from __future__ import annotations

from typing import Any, Dict, List

# 与前端 FORM_GROUPS 对齐
FORM_FIELDS: List[Dict[str, str]] = [
    {"key": "替换的合同编号", "label": "合同编号", "group": "合同基本信息"},
    {"key": "替换的项目名称", "label": "项目名称", "group": "合同基本信息"},
    {"key": "替换的乙方名称", "label": "乙方名称", "group": "乙方基本信息"},
    {"key": "替换的服务内容", "label": "服务内容", "group": "服务内容"},
    {"key": "替换的交付格式", "label": "交付格式", "group": "服务内容"},
    {"key": "替换的交付时间", "label": "交付时间", "group": "服务内容"},
    {"key": "替换的总费用", "label": "总费用", "group": "费用信息"},
    {"key": "替换的总费用大写", "label": "总费用大写", "group": "费用信息"},
    {"key": "替换的税率", "label": "税率", "group": "费用信息"},
    {"key": "替换的预付款", "label": "预付款", "group": "费用信息"},
    {"key": "替换的预付款大写", "label": "预付款大写", "group": "费用信息"},
    {"key": "替换的尾款", "label": "尾款", "group": "费用信息"},
    {"key": "替换的尾款大写", "label": "尾款大写", "group": "费用信息"},
    {"key": "替换的费用表格图片", "label": "费用表格图片", "group": "费用信息"},
    {"key": "替换的开票内容", "label": "开票内容", "group": "开票信息"},
    {"key": "乙方银行账号", "label": "乙方银行账号", "group": "乙方财务信息"},
    {"key": "乙方银行开户行", "label": "乙方银行开户行", "group": "乙方财务信息"},
    {"key": "替换的乙方代表名称", "label": "乙方代表名称", "group": "乙方联系人信息"},
    {"key": "替换的乙方代表电话", "label": "乙方代表电话", "group": "乙方联系人信息"},
    {"key": "替换的乙方代表邮箱", "label": "乙方代表邮箱", "group": "乙方联系人信息"},
    {"key": "乙方地址", "label": "乙方地址", "group": "乙方地址"},
]

FORM_KEYS: List[str] = [f["key"] for f in FORM_FIELDS]

CONTACT_KEYS: List[str] = [
    "替换的乙方名称",
    "乙方银行账号",
    "乙方银行开户行",
    "替换的乙方代表名称",
    "替换的乙方代表电话",
    "替换的乙方代表邮箱",
    "乙方地址",
]

SPEC_TAG_KINDS: List[str] = ["尺寸", "格式", "码率", "需求", "交付"]

QUOTE_ROW_SCHEMA: Dict[str, Any] = {
    "id": "string (optional)",
    "name": "string 服务名称",
    "qty": "number 数量",
    "duration": "string 时长，默认 /",
    "unitPrice": "number 单价，或 \"/\" 另行计价；当合作价为 0 时 行金额=单价×数量",
    "partnerPrice": "number 合作价（行总价，不再×数量），或 \"/\" 另行计价不计入；≠0 时优先作为行金额",
    "specs": [{"kind": "尺寸|格式|码率|需求|交付", "value": "string", "id": "optional"}],
    "note": "string",
}

QUOTE_SCHEMA: Dict[str, Any] = {
    "title": "string 报价表标题",
    "taxNote": "string 总计说明，如 总计（含税1%）",
    "footNote": "string 页脚备注",
    "rows": [QUOTE_ROW_SCHEMA],
}

WORKSPACE_SCHEMA: Dict[str, Any] = {
    "form": {k: "string" for k in FORM_KEYS},
    "quote": QUOTE_SCHEMA,
    "ratio": "number 预付款比例 0-100，默认 50",
    "template_path": "string 合同模板 docx 路径",
    "output_dir": "string 输出目录，可空",
    "output_name": "string 输出文件名（无扩展名），可空",
    "selected_project_id": "string 当前关联历史项目 id",
    "selected_contact": "string 当前联系人名称",
}


def empty_form() -> Dict[str, str]:
    return {k: "" for k in FORM_KEYS}


def full_schema() -> Dict[str, Any]:
    return {
        "form_fields": FORM_FIELDS,
        "form_keys": FORM_KEYS,
        "contact_keys": CONTACT_KEYS,
        "quote": QUOTE_SCHEMA,
        "workspace": WORKSPACE_SCHEMA,
        "placeholder_syntax": "%字段名%",
        "address_template_keys": [
            "替换的乙方地址第一行最大字数",
            "替换的乙方地址第二行最大字数最大字",
            "替换的乙方地址第三行最大字数最大字",
        ],
        "notes": {
            "contact": "联系人仅保存 contact_keys，加载时不覆盖项目字段",
            "project": "项目按 合同编号+项目名称 唯一键保存完整快照",
            "workspace": "多步会话状态，路径 .contract_tool/workspace.json",
        },
    }
