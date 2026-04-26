#!/bin/bash
set -euo pipefail

SPEC_NAME="cockpit-calabi-observer"
VERSION="1.2.3"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUILD_ROOT="${SCRIPT_DIR}/rpmbuild"

echo "==> Cleaning previous build artifacts"
rm -rf "${BUILD_ROOT}"
mkdir -p "${BUILD_ROOT}"/{BUILD,RPMS,SOURCES,SPECS,SRPMS}

echo "==> Creating source tarball"
TARBALL_DIR="${SPEC_NAME}-${VERSION}"
WORK=$(mktemp -d)
mkdir -p "${WORK}/${TARBALL_DIR}"
cp "${SCRIPT_DIR}"/{manifest.json,index.html,calabi-observer.js,calabi-observer.css,sparkline.js,collector.py,calabi_exporter.py,prometheus_exporter.py,prometheus_control.py,prometheus.json,calabi-exporter.service,calabi-node-exporter.service,calabi-observer-prometheus.tmpfiles} \
   "${WORK}/${TARBALL_DIR}/"
tar czf "${BUILD_ROOT}/SOURCES/${SPEC_NAME}-${VERSION}.tar.gz" -C "${WORK}" "${TARBALL_DIR}"
rm -rf "${WORK}"

echo "==> Copying spec file"
cp "${SCRIPT_DIR}/${SPEC_NAME}.spec" "${BUILD_ROOT}/SPECS/"

echo "==> Building RPM"
rpmbuild \
    --define "_topdir ${BUILD_ROOT}" \
    -ba "${BUILD_ROOT}/SPECS/${SPEC_NAME}.spec"

echo ""
echo "==> Build complete"
echo "RPMs:"
find "${BUILD_ROOT}/RPMS" -name "*.rpm" -print
echo "SRPMs:"
find "${BUILD_ROOT}/SRPMS" -name "*.rpm" -print
