#!/bin/sh
# 把 serve.py 打成单文件二进制（免装 Python 分发）
# 用法：sh build.sh
# 产物：dist/starflow-backend（Windows 为 starflow-backend.exe）
# 注意：PyInstaller 不交叉编译——目标平台是什么就在什么系统上执行本脚本。
set -e
cd "$(dirname "$0")"

if ! command -v pyinstaller >/dev/null 2>&1; then
  echo "未找到 pyinstaller，请先安装：pip install pyinstaller" >&2
  exit 1
fi

pyinstaller --clean --noconfirm serve.spec

echo ""
echo "构建完成："
ls -la dist/
echo ""
echo "运行：./dist/starflow-backend   （监听 127.0.0.1:8000）"
