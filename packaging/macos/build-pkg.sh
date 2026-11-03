#!/bin/sh
# 把 dist/starflow-backend 打成 macOS 安装包（.pkg）：
#   - 二进制安装到 /usr/local/bin/starflow-backend（755，root:wheel）
#   - LaunchAgent 安装到 /Library/LaunchAgents/com.starflow.backend.plist（登录自启）
# 用法：先 sh prototype/build.sh，再 sh packaging/macos/build-pkg.sh
# 安装：sudo installer -pkg prototype/dist/starflow-backend.pkg -target /
set -e
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)

BIN="${BIN:-$REPO_ROOT/prototype/dist/starflow-backend}"
PKG_ID=com.starflow.backend
PKG_VER="${PKG_VER:-${PACKAGE_VERSION:-1.0.0}}"
PKG_VER="${PKG_VER#v}"
PKG_OUT="${PKG_OUT:-$REPO_ROOT/prototype/dist/starflow-backend.pkg}"

if [ ! -f "$BIN" ]; then
  echo "未找到 $BIN，请先执行：sh build.sh" >&2
  exit 1
fi

mkdir -p "$(dirname "$PKG_OUT")"

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
ROOT="$WORK/root"

mkdir -p "$ROOT/usr/local/bin" "$ROOT/Library/LaunchAgents" "$WORK/scripts"
cp "$BIN" "$ROOT/usr/local/bin/starflow-backend"
chmod 755 "$ROOT/usr/local/bin/starflow-backend"
cp "$SCRIPT_DIR/com.starflow.backend.plist" "$ROOT/Library/LaunchAgents/"
chmod 644 "$ROOT/Library/LaunchAgents/com.starflow.backend.plist"
cp "$SCRIPT_DIR/postinstall" "$WORK/scripts/postinstall"
chmod 755 "$WORK/scripts/postinstall"

pkgbuild \
  --root "$ROOT" \
  --scripts "$WORK/scripts" \
  --identifier "$PKG_ID" \
  --version "$PKG_VER" \
  --ownership recommended \
  --install-location / \
  "$PKG_OUT"

echo ""
echo "打包完成：$PKG_OUT"
echo ""
echo "安装：  sudo installer -pkg $PKG_OUT -target /"
echo "状态：  launchctl print gui/\$(id -u)/com.starflow.backend | head"
echo "卸载：  sudo launchctl bootout gui/\$(id -u)/com.starflow.backend"
echo "        sudo rm /usr/local/bin/starflow-backend /Library/LaunchAgents/com.starflow.backend.plist"
