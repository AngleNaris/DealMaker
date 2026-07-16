# DealMaker

合同模板生成工具（Tauri 2 + React + Python backend）。

## 功能

- 加载 Word 合同模板，填充字段后生成 DOCX / 导出 PDF
- 联系人管理（本地 `.contract_tool/`）
- 预付款比例自动拆分（默认 50%）
- 手动修改预付/尾款后校验合计；不等则提示并支持「自动修正」（以预付款为准重算尾款）
- 金额自动转中文大写
- PDF：优先 **WPS** COM 导出，其次 **Microsoft Word**；均无则提示安装（不使用 LibreOffice）

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
# 或根目录
.\dev.bat
```

## 版本号（单一来源）

仓库根目录 `VERSION` 为唯一版本源。修改后执行：

```powershell
node .\sync_version.js              # 按 VERSION 同步到各配置
# 或
node .\sync_version.js 2.2.0        # 写入 VERSION 并同步
# 或
.\sync_version.ps1 -Version 2.2.0
```

会更新：`app/package.json`、`package-lock` 根版本、`Cargo.toml`、`tauri.conf.json`、`app/src/version.ts`。  
**不会**改动依赖包版本。发布脚本 `build_release.ps1` 会自动先跑同步。

## 发布打包（单文件便携版）

```powershell
# 在项目根执行（自动 sync 版本）
.\build_release.ps1
```

产出：

| 路径 | 说明 |
|------|------|
| `release\portable\DealMaker.exe` | **单文件**主程序（内嵌 backend + officecli） |
| `release\DealMaker_*_x64-setup.exe` | 可选 NSIS 安装包 |

### 运行时依赖（自动解压）

首次启动或**版本升级**时，将内嵌依赖写入：

`%LOCALAPPDATA%\DealMaker\runtime\`

| 文件 | 说明 |
|------|------|
| `dealmaker-backend.exe` | 业务后端（python-docx） |
| `officecli.exe` | 文档引擎 |
| `.version` | 与主程序 `CARGO_PKG_VERSION` 对齐；版本变化则覆盖上述依赖 |

**不内嵌合同模板**（体积与可替换性）：请在界面中选择模板，或自行把模板放到 exe 旁后选择。

**不内置**（使用系统已安装）：WPS / Microsoft Word（仅导出 PDF 时需要其一）。  
**报价表截图**：使用系统 Edge / Chrome（Windows 通常自带 Edge）。

用户数据：`exe` 同级 `.contract_tool/`（联系人、历史项目、报价图、设置）。

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

导出 PDF 按优先级使用：

1. **WPS Office**（`Kwps.Application` COM `ExportAsFixedFormat`）
2. **Microsoft Word** 桌面版（`Word.Application`）

二者都没有时，界面会提示安装 WPS 或 Word。**不使用 LibreOffice。**

```powershell
# 调试：仅从已有 docx 转 pdf
python -m backend.cli export_pdf '{"docx":"D:/path/合同.docx"}'
python -m backend.cli ping
```

## 许可与署名

@繁星之子卡萨蒂亚
