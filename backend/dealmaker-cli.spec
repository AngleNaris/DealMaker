# -*- mode: python ; coding: utf-8 -*-
# Agent CLI 单文件：dealmaker-cli.exe（避免与 GUI DealMaker.exe 在 Windows 上撞名）
from pathlib import Path

BACKEND = Path(SPECPATH).resolve()
ROOT = BACKEND.parent

a = Analysis(
    [str(BACKEND / "run_agent.py")],
    pathex=[str(ROOT)],
    binaries=[],
    datas=[],
    hiddenimports=[
        "docx",
        "docx.oxml",
        "docx.oxml.ns",
        "lxml",
        "lxml.etree",
        "lxml._elementpath",
        "backend.agent",
        "backend.schema",
        "backend.workspace",
        "backend.quote",
        "backend.core",
        "backend.cli",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["PyQt6", "PySide6", "tkinter", "matplotlib"],
    noarchive=False,
    optimize=1,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="dealmaker-cli",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
)
