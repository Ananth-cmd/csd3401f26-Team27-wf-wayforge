@echo off
REM Desktop build + test + smoke run (Windows, Visual Studio 2022). Run from anywhere.
REM Usage: core\script_build_and_run.bat [Debug|Release]
setlocal
cd /d "%~dp0\.."
set CONFIG=%1
if "%CONFIG%"=="" set CONFIG=Debug
echo === Wayforge desktop build (%CONFIG%) ===
where cmake >nul 2>nul || (echo missing: cmake - see docs\setup.md & exit /b 1)
if exist build\desktop rmdir /s /q build\desktop
cmake -S core -B build\desktop -G "Visual Studio 18 2026" -A x64 || exit /b 1
cmake --build build\desktop --config %CONFIG% -j || exit /b 1
echo === tests ===
ctest --test-dir build\desktop --output-on-failure -C %CONFIG% || exit /b 1
echo === smoke run ===
set CLI=build\desktop\Sandbox\wf_cli\%CONFIG%\wf_cli.exe
%CLI% --version || exit /b 1
echo === copying wayforge.dll into the Unity project ===
copy /y build\desktop\Engine\wf_api\%CONFIG%\wayforge.dll unity\Assets\Wayforge\Plugins\x86_64\wayforge.dll >nul
echo === OK ===
