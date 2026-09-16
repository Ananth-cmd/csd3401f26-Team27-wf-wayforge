#!/bin/bash
# Android build: the SAME CMake project, pointed at the NDK toolchain file.
# Produces libwayforge.so for arm64-v8a and copies it into the Unity project.
# Usage: ANDROID_NDK=/path/to/ndk ./core/script_build_android.sh
set -e
cd "$(dirname "$0")/.."
: "${ANDROID_NDK:?Set ANDROID_NDK to your NDK path first, e.g. export ANDROID_NDK=\$HOME/Android/Sdk/ndk/26.1.10909125}"
[ -f "$ANDROID_NDK/build/cmake/android.toolchain.cmake" ] || { echo "no toolchain file under $ANDROID_NDK"; exit 1; }
ABI=${ANDROID_ABI:-arm64-v8a}
GEN=""
command -v ninja >/dev/null && GEN="-G Ninja"
echo "=== Wayforge Android build ($ABI, NDK at $ANDROID_NDK) ==="
cmake -S core -B build/android-$ABI $GEN \
  -DCMAKE_TOOLCHAIN_FILE="$ANDROID_NDK/build/cmake/android.toolchain.cmake" \
  -DANDROID_ABI=$ABI \
  -DANDROID_PLATFORM=android-26 \
  -DANDROID_STL=c++_static \
  -DCMAKE_BUILD_TYPE=Release \
  -DWF_BUILD_VIEWER=OFF -DWF_BUILD_TESTS=OFF -DWF_BUILD_CLI=OFF
cmake --build build/android-$ABI -j"$(nproc 2>/dev/null || sysctl -n hw.ncpu)"
DEST=unity/Assets/Wayforge/Plugins/Android/libs/$ABI
mkdir -p "$DEST"
cp build/android-$ABI/Engine/wf_api/libwayforge.so "$DEST/"
echo "=== wrote $DEST/libwayforge.so ==="
ls -la "$DEST/libwayforge.so"
