"""可选独立 Agent CLI 打包入口（发布默认已并入 DealMaker.exe）。"""
import os
import sys

os.environ.setdefault("PYTHONIOENCODING", "utf-8")
os.environ.setdefault("PYTHONUTF8", "1")

from backend.agent import main

if __name__ == "__main__":
    raise SystemExit(main())
