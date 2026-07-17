# DealMaker Agent（单 exe）

用户只安装 / 拷贝 **一个** `DealMaker.exe`：

| 用法 | 行为 |
|------|------|
| 双击 / 无参数 | 打开图形界面 |
| `DealMaker.exe help` | Agent CLI，输出内置 Skill |
| `DealMaker.exe <command> ...` | 与 GUI **共享工作区**，用户可实时看到 AI 编辑 |

## 冷启动

```text
DealMaker.exe help
```

返回 JSON，字段 `skill_markdown` 为完整 Skill 提示词（无需外部文档）。

输出格式：一行 JSON `{"ok":true,"data":...}` / `{"ok":false,"error":"..."}`，退出码 0/1。

## 开发环境

```text
python -m backend.agent help
.\dealmaker.cmd project list
```

## 共编

- 工作区：`.contract_tool/workspace.json`（exe 同级）
- GUI 轮询 `rev`；CLI 写入后界面约 1 秒内刷新
- 协作原则：多 `workspace get`、表单可 `form set --json` 批量或 `form set-field` 逐条、少 `workspace clear`
- 报价 PNG：浏览器截图 Edge→Chrome→Firefox（2×清晰度）；合计=合作价或 单价×数量

## 常用命令

```text
DealMaker.exe schema
DealMaker.exe workspace get
DealMaker.exe project list
DealMaker.exe project load --id <uuid>
DealMaker.exe form set --json "{\"替换的合同编号\":\"T001\",\"替换的项目名称\":\"项目A\"}"
DealMaker.exe form set-field 替换的税率 3
DealMaker.exe contact apply --name 某公司 --dry-run
DealMaker.exe quote row add --name 剪辑 --partner-price 5000
DealMaker.exe quote swap 2 3
DealMaker.exe quote sync-total --apply
DealMaker.exe quote export-png --apply
DealMaker.exe generate preview
DealMaker.exe generate pdf --save-project
DealMaker.exe workspace undo
```

完整字段与流程见 `help` → `skill_markdown`。

### 撤销与历史

- **undo 栈**：单文件 `.contract_tool/workspace_undo.json`，仅保留最近约 20 次 **CLI/AI** 写入；GUI 防抖保存不入栈。
- **snapshot**：显式长期备份目录 `.contract_tool/snapshots/`。
- 旧版 `workspace_history/rev_*.json` 会在 CLI 写入时自动清理。
