# DealMaker

合同模板生成工具（Tauri 2 + React + Python backend）。

## 功能

- 加载 Word 合同模板，填充字段后生成 DOCX / 导出 PDF
- 联系人管理（本地 `.contract_tool/`）
- 预付款比例自动拆分（默认 50%）
- 手动修改预付/尾款后校验合计；不等则提示并支持「自动修正」（以预付款为准重算尾款）
- 金额自动转中文大写
- PDF：优先 Microsoft Word 导出，否则 LibreOffice `writer_pdf_Export`（高保真排版）

## 技术栈

| 层 | 技术 |
|----|------|
| 桌面壳 / UI | Tauri 2 + React 18 + Vite + TypeScript |
| 设计系统 | 与 ShadowEncoder 对齐的 `theme.css` token（深色紫、无圆角） |
| 业务逻辑 | Python `backend/`（python-docx + OfficeCLI） |
| 文档引擎 | [OfficeCLI](https://github.com/iOfficeAI/OfficeCLI)（当前目标版本 v1.0.136） |

## 开发环境

- Python 3.10+（`pip install -r requirements.txt`）
- Node.js 18+
- Rust（Tauri 2）
- 将 `officecli-win-x64.exe` 放到项目根并命名为 `officecli.exe`

```powershell
# 安装前端依赖
cd app
npm install

# 开发模式
npm run tauri dev
# 或
.\dev-tauri.bat
```

## 后端 CLI（调试）

在项目根目录：

```powershell
python -m backend.cli ping
'{"amount":1234.56}' | python -m backend.cli amount_to_chinese
'{"total":10000,"ratio":50}' | python -m backend.cli split_payment
```

## 目录结构

```
DealMaker/
  app/                 # Tauri + React 前端
  backend/             # Python 业务逻辑 CLI
  _合同模板.docx
  officecli.exe        # 不进 git，需自行下载
  合同生成工具.py      # 旧版 PyQt6（已迁移，可参考）
```

## OfficeCLI

从 [Releases](https://github.com/iOfficeAI/OfficeCLI/releases) 下载 `officecli-win-x64.exe`，放到项目根目录并重命名为 `officecli.exe`。

推荐版本：**v1.0.136**。

```powershell
officecli.exe --version
```

## PDF 导出依赖

导出 PDF 需要其一：

1. **Microsoft Word**（Windows，COM 导出，优先）
2. **LibreOffice**（`soffice`，本机已验证可用）

可设置环境变量 `LIBREOFFICE_PATH` / `SOFFICE_PATH` 指向 `soffice.exe`。

```powershell
# 调试：仅从已有 docx 转 pdf
python -m backend.cli export_pdf '{"docx":"D:/path/合同.docx"}'
```

## 许可与署名

@繁星之子卡萨蒂亚
