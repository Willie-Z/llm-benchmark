# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec：把 serve.py 打成单文件后端（starflow-backend）
# 用法：pyinstaller --clean --noconfirm serve.spec  （或 sh build.sh）
# exe 文件属性版本跟发版号走：构建前设置环境变量 STARFLOW_VERSION（如 0.7.1），缺省 0.0.0
import os

ROOT = os.path.abspath(SPECPATH)
DATAS = [(os.path.join(ROOT, "extension", "pages"), "extension/pages")]

VERSION = os.environ.get("STARFLOW_VERSION", "0.0.0")

def _ver_tuple(v):
    out = []
    for p in str(v).split("."):
        digits = "".join(c for c in p if c.isdigit())
        out.append(int(digits) if digits else 0)
    return tuple((out + [0, 0, 0, 0])[:4])

# Windows PE 版本资源（右键属性→详细信息）；非 Windows 平台 PyInstaller 忽略该参数
_vt = _ver_tuple(VERSION)
_version_file = os.path.join(ROOT, "build", "starflow-version-info.txt")
os.makedirs(os.path.dirname(_version_file), exist_ok=True)
with open(_version_file, "w", encoding="utf-8") as _f:
    _f.write(
        "VSVersionInfo(\n"
        "  ffi=FixedFileInfo(\n"
        "    filevers=%r,\n"
        "    prodvers=%r,\n"
        "    mask=0x3f,\n"
        "    flags=0x0,\n"
        "    OS=0x40004,\n"
        "    fileType=0x1,\n"
        "    subtype=0x0,\n"
        "    date=(0, 0)\n"
        "  ),\n"
        "  kids=[\n"
        "    StringFileInfo([\n"
        "      StringTable('040904B0', [\n"
        "        StringStruct('CompanyName', 'Starflow'),\n"
        "        StringStruct('FileDescription', 'Starflow LLM Verification Backend'),\n"
        "        StringStruct('FileVersion', '%s'),\n"
        "        StringStruct('InternalName', 'starflow-backend'),\n"
        "        StringStruct('OriginalFilename', 'starflow-backend.exe'),\n"
        "        StringStruct('ProductName', 'Starflow LLM Verification Backend'),\n"
        "        StringStruct('ProductVersion', '%s')\n"
        "      ])\n"
        "    ]),\n"
        "    VarFileInfo([VarStruct('Translation', [1033, 1200])])\n"
        "  ]\n"
        ")\n" % (_vt, _vt, VERSION, VERSION)
    )

a = Analysis(
    ["serve.py"],
    pathex=[],
    binaries=[],
    datas=DATAS,
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
    version=_version_file,
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,   # 带控制台：可看启动提示，Ctrl+C 退出
)
