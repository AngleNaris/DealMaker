"""允许 python -m backend 启动 CLI。"""
from backend.cli import main

if __name__ == "__main__":
    raise SystemExit(main())
