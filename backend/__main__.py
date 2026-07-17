"""
python -m backend → 默认 Agent CLI
python -m backend.cli <action> → GUI 兼容协议
python -m backend.agent <cmd> → Agent CLI
"""
import sys

from backend.agent import main as agent_main
from backend.cli import main as cli_main


def main() -> int:
    # 无参数：内置 skill help
    if len(sys.argv) <= 1:
        return agent_main(["help"])
    # 显式 cli 协议：python -m backend cli generate ...
    if sys.argv[1] == "cli":
        sys.argv = [sys.argv[0]] + sys.argv[2:]
        return cli_main()
    return agent_main(sys.argv[1:])


if __name__ == "__main__":
    raise SystemExit(main())
