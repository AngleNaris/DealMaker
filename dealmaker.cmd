@echo off
REM 开发用：等价于「DealMaker.exe <cmd>」的 Agent CLI
REM 发布版用户只需一个 DealMaker.exe（双击=GUI，带参数=CLI）
cd /d "%~dp0"
python -m backend.agent %*
