# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec：把 serve.py 打成单文件后端（starflow-backend）
# 用法：cd prototype && pyinstaller --clean --noconfirm serve.spec  （或 sh build.sh）
a = Analysis(
    ["serve.py"],
    pathex=[],
    binaries=[],
    datas=[],
    hiddenimports=[],
    hookspath=[],
    runtime_hooks=[],
    excludes=["tkinter", "PyQt5", "PySide2"],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="starflow-backend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,   # 带控制台：可看启动提示，Ctrl+C 退出
)
