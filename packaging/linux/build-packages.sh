#!/bin/sh
# Build native Debian and RPM packages from dist/starflow-backend.
# Requirements: dpkg-deb, rpmbuild, install, sed.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
BIN="${BIN:-$ROOT/dist/starflow-backend}"
UNIT="$ROOT/packaging/linux/starflow-backend.service"
CONTROL_IN="$ROOT/packaging/linux/debian/control.in"
SPEC="$ROOT/packaging/linux/starflow-backend.spec"
SCRIPTS="$ROOT/packaging/linux/scripts"
OUT_DIR="${OUT_DIR:-$ROOT/release}"
VERSION="${PACKAGE_VERSION:-1.0.0}"
VERSION="${VERSION#v}"

if [ ! -f "$BIN" ]; then
  echo "未找到后端二进制：$BIN" >&2
  exit 1
fi
command -v dpkg-deb >/dev/null 2>&1 || { echo "缺少 dpkg-deb" >&2; exit 1; }
command -v rpmbuild >/dev/null 2>&1 || { echo "缺少 rpmbuild" >&2; exit 1; }

DEB_VERSION=$(printf '%s' "$VERSION" | tr -c 'A-Za-z0-9.+~' '.')
RPM_VERSION=$(printf '%s' "$VERSION" | tr -c 'A-Za-z0-9._+' '_')
[ -n "$DEB_VERSION" ] || DEB_VERSION=1.0.0
[ -n "$RPM_VERSION" ] || RPM_VERSION=1.0.0

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$OUT_DIR"

# Debian package
DEB_ROOT="$WORK/deb"
mkdir -p "$DEB_ROOT/DEBIAN" "$DEB_ROOT/usr/bin" "$DEB_ROOT/etc/systemd/system"
install -m 0755 "$BIN" "$DEB_ROOT/usr/bin/starflow-backend"
install -m 0644 "$UNIT" "$DEB_ROOT/etc/systemd/system/starflow-backend.service"
sed "s/@VERSION@/$DEB_VERSION/g" "$CONTROL_IN" > "$DEB_ROOT/DEBIAN/control"
install -m 0755 "$SCRIPTS/preinst" "$DEB_ROOT/DEBIAN/preinst"
install -m 0755 "$SCRIPTS/postinst" "$DEB_ROOT/DEBIAN/postinst"
install -m 0755 "$SCRIPTS/prerm" "$DEB_ROOT/DEBIAN/prerm"
install -m 0755 "$SCRIPTS/postrm" "$DEB_ROOT/DEBIAN/postrm"
DEB_OUT="$OUT_DIR/starflow-backend_${DEB_VERSION}_amd64.deb"
dpkg-deb --root-owner-group --build "$DEB_ROOT" "$DEB_OUT"

# RPM package
RPM_TOP="$WORK/rpm"
mkdir -p "$RPM_TOP/BUILD" "$RPM_TOP/BUILDROOT" "$RPM_TOP/RPMS" "$RPM_TOP/SOURCES" "$RPM_TOP/SPECS" "$RPM_TOP/SRPMS"
rpmbuild -bb \
  --define "_topdir $RPM_TOP" \
  --define "starflow_version $RPM_VERSION" \
  --define "backend_source $BIN" \
  --define "unit_source $UNIT" \
  "$SPEC"
for rpm_file in "$RPM_TOP"/RPMS/*/*.rpm; do
  [ -f "$rpm_file" ] || continue
  mv "$rpm_file" "$OUT_DIR/"
done

dpkg-deb --info "$DEB_OUT" >/dev/null
for rpm_file in "$OUT_DIR"/*.rpm; do
  [ -f "$rpm_file" ] || { echo "未生成 RPM 包" >&2; exit 1; }
  rpm -qpl "$rpm_file" >/dev/null
done

echo "Debian: $DEB_OUT"
echo "RPM:"
for rpm_file in "$OUT_DIR"/*.rpm; do
  [ -f "$rpm_file" ] && echo "  $rpm_file"
done
