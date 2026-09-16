#!/bin/bash
# Desktop build + test + smoke run (Linux / macOS). Run from the repo root or from core/.
# Usage: ./core/script_build_and_run.sh [Debug|Release]
set -e
cd "$(dirname "$0")/.."                      # repo root
CONFIG=${1:-Debug}
echo "=== Wayforge desktop build ($CONFIG) ==="
for tool in cmake git; do command -v $tool >/dev/null || { echo "missing: $tool (see docs/setup.md)"; exit 1; }; done
GEN=""
command -v ninja >/dev/null && GEN="-G Ninja"
rm -rf build/desktop
cmake -S core -B build/desktop $GEN -DCMAKE_BUILD_TYPE=$CONFIG
cmake --build build/desktop --config $CONFIG -j"$(nproc 2>/dev/null || sysctl -n hw.ncpu)"
echo "=== tests ==="
ctest --test-dir build/desktop --output-on-failure -C $CONFIG
echo "=== smoke run ==="
CLI=build/desktop/Sandbox/wf_cli/wf_cli
[ -x "$CLI" ] || CLI=build/desktop/Sandbox/wf_cli/$CONFIG/wf_cli
$CLI --version
echo "=== OK ==="
