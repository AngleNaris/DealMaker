# -*- mode: python ; coding: utf-8 -*-
# PyInstaller: 将业务后端打成单文件 exe（含 python-docx）
import sys
from pathlib import Path

# SPECPATH = 含 .spec 的目录，即 backend/
BACKEND = Path(SPECPATH).resolve()
ROOT = BACKEND.parent  # DealMaker/

a = Analysis(
    [str(BACKEND / "run_cli.py")],
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
    name="dealmaker-backend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,  # 后台子进程，保留 console 便于排错（窗口隐藏由父进程控制）
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
