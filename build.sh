#!/bin/sh
# 把 serve.py 打成单文件二进制（免装 Python 分发）
# 用法：sh build.sh        （可选 STARFLOW_VERSION=0.7.1 sh build.sh 注入 exe 文件属性版本）
# 产物：dist/starflow-backend（Windows 为 starflow-backend.exe）
# 注意：PyInstaller 不交叉编译——目标平台是什么就在什么系统上执行本脚本。
set -e
cd "$(dirname "$0")"

if ! command -v pyinstaller >/dev/null 2>&1; then
  echo "未找到 pyinstaller，请先安装：pip install pyinstaller" >&2
  exit 1
fi

# exe 文件属性版本（serve.spec 读取生成 PE 版本资源）；CI 由 build.ps1 注入发版号
export STARFLOW_VERSION="${STARFLOW_VERSION:-0.0.0}"

pyinstaller --clean --noconfirm serve.spec

echo ""
echo "构建完成："
ls -la dist/
echo ""
echo "运行：./dist/starflow-backend   （监听 127.0.0.1:8000）"
