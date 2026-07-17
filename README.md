<p align="center">
  <img src="DealMaker.svg" width="88" alt="DealMaker" />
</p>

<h1 align="center">DealMaker</h1>

<p align="center">
  <strong style="color:#bfabf1">合同模板填充 · 联系人与项目 · 一键导出 DOCX / PDF</strong>
</p>

<p align="center">
  <a href="#-用户手册"><img src="https://img.shields.io/badge/用户手册-4f378b?style=for-the-badge" alt="用户手册" /></a>
  <a href="#-开发手册"><img src="https://img.shields.io/badge/开发手册-5c4a99?style=for-the-badge" alt="开发手册" /></a>
  <a href="https://github.com/AngleNaris/DealMaker/releases"><img src="https://img.shields.io/badge/下载_Release-bfabf1?style=for-the-badge&labelColor=4f378b" alt="Release" /></a>
</p>

---

<table>
<tr>
<td width="4" bgcolor="#4f378b"></td>
<td>

**DealMaker** 是 Windows 桌面端合同工具：在 Word 模板里埋好占位符，软件填表后生成正式合同文档。  
支持历史项目、乙方联系人、报价表图片，以及 DOCX / PDF 导出。

</td>
</tr>
</table>

<br />

# 📖 用户手册

## 快速开始

1. 从 [Releases](https://github.com/AngleNaris/DealMaker/releases) 下载 **便携版**（`*_portable.exe`）或 **安装包**
2. 双击运行（首次启动会自动准备运行组件，稍等片刻）
3. 选择你的 **合同模板**（`.docx`）
4. 填写字段 → 生成 DOCX 或导出 PDF

> **PDF 导出**需要本机已安装 **WPS** 或 **Microsoft Word**（优先使用 WPS）。  
> **报价表图片**：自动找本机浏览器截图（优先 Edge，其次 Chrome，最后 Firefox），2× 清晰度并裁白边。

数据保存在程序同级目录的 `.contract_tool/`（联系人、历史项目、设置），换机器时可一并拷贝。

---

## 日常使用

| 功能 | 说明 |
|------|------|
| **历史项目** | 保存 / 加载整份填写快照（含报价草稿）；生成 DOCX/PDF 时也会自动保存 |
| **联系人** | 仅保存**乙方**信息（名称、银行、代表、地址），**不会**覆盖合同编号、费用等项目字段 |
| **预付款比例** | 默认 50%，改总费用或比例时自动拆分预付 / 尾款 |
| **金额大写** | 填写数字金额后自动生成中文大写，可再手改 |
| **制作报价表** | 在费用表格处进入报价编辑，导出图片后自动填入「费用表格图片」；文件名为「项目名称_合同编号.png」，同项目再次导出覆盖 |

建议流程：选模板 → 加载联系人（可选）→ 填项目与费用 → 保存项目 → 生成文档。

---

## 制作自己的合同模板

模板就是普通的 **Word（.docx）** 文件。在需要被软件替换的位置，写入 **半角百分号** 包裹的占位符即可。

### 规则

```
%占位符名称%
```

- 名称须与下表 **完全一致**（含「替换的」等前缀）
- 可写在正文、表格单元格中
- 同一占位符可在模板中出现多次
- 不要用全角 `％`；占位符中间不要断行、不要改成多个文本框拆开的半截文字

**示例：**

```text
合同编号：%替换的合同编号%
项目名称：%替换的项目名称%
乙　　方：%替换的乙方名称%
```

### 占位符一览

<table>
<thead>
<tr>
  <th align="left">分类</th>
  <th align="left">模板中写入</th>
  <th align="left">界面字段</th>
</tr>
</thead>
<tbody>
<tr><td rowspan="2"><b style="color:#bfabf1">合同</b></td>
  <td><code>%替换的合同编号%</code></td><td>合同编号</td></tr>
<tr><td><code>%替换的项目名称%</code></td><td>项目名称</td></tr>
<tr><td><b style="color:#bfabf1">乙方</b></td>
  <td><code>%替换的乙方名称%</code></td><td>乙方名称</td></tr>
<tr><td rowspan="3"><b style="color:#bfabf1">服务</b></td>
  <td><code>%替换的服务内容%</code></td><td>服务内容</td></tr>
<tr><td><code>%替换的交付格式%</code></td><td>交付格式</td></tr>
<tr><td><code>%替换的交付时间%</code></td><td>交付时间</td></tr>
<tr><td rowspan="8"><b style="color:#bfabf1">费用</b></td>
  <td><code>%替换的总费用%</code></td><td>总费用</td></tr>
<tr><td><code>%替换的总费用大写%</code></td><td>总费用大写</td></tr>
<tr><td><code>%替换的税率%</code></td><td>税率</td></tr>
<tr><td><code>%替换的预付款%</code></td><td>预付款</td></tr>
<tr><td><code>%替换的预付款大写%</code></td><td>预付款大写</td></tr>
<tr><td><code>%替换的尾款%</code></td><td>尾款</td></tr>
<tr><td><code>%替换的尾款大写%</code></td><td>尾款大写</td></tr>
<tr><td><code>%替换的费用表格图片%</code></td><td>费用表格图片（插入图片）</td></tr>
<tr><td><b style="color:#bfabf1">开票</b></td>
  <td><code>%替换的开票内容%</code></td><td>开票内容</td></tr>
<tr><td rowspan="2"><b style="color:#bfabf1">财务</b></td>
  <td><code>%乙方银行账号%</code></td><td>乙方银行账号</td></tr>
<tr><td><code>%乙方银行开户行%</code></td><td>乙方银行开户行</td></tr>
<tr><td rowspan="3"><b style="color:#bfabf1">代表</b></td>
  <td><code>%替换的乙方代表名称%</code></td><td>代表名称</td></tr>
<tr><td><code>%替换的乙方代表电话%</code></td><td>代表电话</td></tr>
<tr><td><code>%替换的乙方代表邮箱%</code></td><td>代表邮箱</td></tr>
</tbody>
</table>

### 乙方地址（自动分行）

界面只需填 **一整段**「乙方地址」。生成时会拆成最多三行，模板中请使用：

| 模板占位符 | 含义 |
|------------|------|
| `%替换的乙方地址第一行最大字数%` | 地址第 1 行 |
| `%替换的乙方地址第二行最大字数最大字%` | 地址第 2 行 |
| `%替换的乙方地址第三行最大字数最大字%` | 地址第 3 行 |

（名称需与上表一致，对应程序内固定键名。）

### 制作步骤建议

1. 用 Word 做好版式（字体、页眉、签章区等）
2. 把可变内容改成上表中的 `%…%` 占位符
3. 另存为 `.docx`，在 DealMaker 中「选择文件」指向该模板
4. 填一组测试数据生成 DOCX，检查替换与换行是否符合预期
5. 确认无误后再用于正式合同

> 合同模板属于私有内容，**不会**随软件分发；请自行保管模板文件。

<br />

# 🛠 开发手册

## 技术栈

| 层 | 技术 |
|----|------|
| 桌面壳 / UI | Tauri 2 · React · Vite · TypeScript |
| 业务后端 | Python（`python-docx` + OfficeCLI） |
| 主题 | 深色紫强调色 `#4f378b` / `#bfabf1` |

## 环境准备

- **Python 3.10+** · **Node.js 18+** · **Rust**（Tauri）
- 项目根目录放置 `officecli.exe`（[OfficeCLI Releases](https://github.com/iOfficeAI/OfficeCLI/releases)）
- 本地私有模板：自行准备 `.docx`（勿提交到 Git）

```powershell
pip install -r requirements.txt
cd app
npm install
```

## 开发与发布

```powershell
# GUI 开发
.\dev.bat

# 开发
.\dev.bat
.\dealmaker.cmd help          # 等同发布版 DealMaker.exe help

# 发布（单文件）
.\build_release.ps1
```

| 产出 | 说明 |
|------|------|
| `release/portable/DealMaker.exe` | **唯一用户文件**：双击=GUI，带参数=Agent CLI |
| `release/DealMaker_*_setup.exe` | 可选安装包 |

```text
DealMaker.exe                 → 图形界面
DealMaker.exe help            → AI / 自动化 CLI（内置 Skill）
DealMaker.exe project list    → 与界面共编
```

运行时依赖解压到 `%LOCALAPPDATA%\DealMaker\runtime\`。详见 **[AGENTS.md](./AGENTS.md)**。

## 版本号

唯一来源：仓库根目录 `VERSION`。

```powershell
node .\sync_version.js           # 按 VERSION 同步
node .\sync_version.js 2.2.0     # 改版本并同步
```

发布脚本会自动执行同步。

## 目录结构

```
DealMaker/
├── app/                 # Tauri + React
├── backend/             # Python CLI 业务
├── assets/              # 报价表等静态资源
├── VERSION              # 版本号唯一来源
├── build_release.ps1
└── sync_version.js
```

**请勿提交：** `*.docx` 合同模板、`.contract_tool/`、任意 `*.exe`、本地构建缓存。

---

<p align="center">
  <span style="color:#9e90a8">@繁星之子卡萨蒂亚</span>
  ·
  <a href="https://github.com/AngleNaris/DealMaker" style="color:#bfabf1">GitHub</a>
</p>
