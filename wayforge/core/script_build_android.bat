@echo off
REM Android build on Windows. Needs ANDROID_NDK set, e.g. set ANDROID_NDK=%LOCALAPPDATA%\Android\Sdk\ndk\26.1.10909125
setlocal
cd /d "%~dp0\.."
if "%ANDROID_NDK%"=="" (echo Set ANDROID_NDK first, e.g. set ANDROID_NDK=%%LOCALAPPDATA%%\Android\Sdk\ndk\26.1.10909125 & exit /b 1)
if not exist "%ANDROID_NDK%\build\cmake\android.toolchain.cmake" (echo no toolchain file under %ANDROID_NDK% & exit /b 1)
set ABI=arm64-v8a
echo === Wayforge Android build (%ABI%) ===
cmake -S core -B build\android-%ABI% -G Ninja ^
  -DCMAKE_TOOLCHAIN_FILE="%ANDROID_NDK%\build\cmake\android.toolchain.cmake" ^
  -DANDROID_ABI=%ABI% -DANDROID_PLATFORM=android-26 -DANDROID_STL=c++_static ^
  -DCMAKE_BUILD_TYPE=Release -DWF_BUILD_VIEWER=OFF -DWF_BUILD_TESTS=OFF -DWF_BUILD_CLI=OFF || exit /b 1
cmake --build build\android-%ABI% -j || exit /b 1
if not exist unity\Assets\Wayforge\Plugins\Android\libs\%ABI% mkdir unity\Assets\Wayforge\Plugins\Android\libs\%ABI%
copy /y build\android-%ABI%\Engine\wf_api\libwayforge.so unity\Assets\Wayforge\Plugins\Android\libs\%ABI%\ >nul
echo === wrote unity\Assets\Wayforge\Plugins\Android\libs\%ABI%\libwayforge.so ===
