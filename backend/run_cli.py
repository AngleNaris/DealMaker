"""PyInstaller 入口：打包后等同于 python -m backend.cli"""
import os
import sys

# 必须在 import cli 之前尽量固定编码环境
os.environ.setdefault("PYTHONIOENCODING", "utf-8")
os.environ.setdefault("PYTHONUTF8", "1")

from backend.cli import main

if __name__ == "__main__":
    raise SystemExit(main())
