@echo off
REM Copies wayforge.dll from a Visual Studio build into the Unity project.
REM Use after building in Visual Studio 2022 (File > Open > Folder... > wayforge\core,
REM pick the "Desktop Release (Ninja)" or "Desktop Debug (Ninja)" preset, Build > Build All).
REM Close Unity first: Unity locks the dll while it is open.
setlocal
cd /d "%~dp0\.."
tasklist /FI "IMAGENAME eq Unity.exe" 2>nul | find /I "Unity.exe" >nul && (echo Unity is open - close it first, it locks wayforge.dll. & exit /b 1)
set DST=unity\Assets\Wayforge\Plugins\x86_64
if not exist %DST% mkdir %DST%
for %%P in (build\desktop-release\Engine\wf_api\wayforge.dll build\desktop\Engine\wf_api\wayforge.dll build\desktop\Engine\wf_api\Release\wayforge.dll build\desktop\Engine\wf_api\Debug\wayforge.dll) do (
    if exist %%P (
        copy /y %%P %DST%\wayforge.dll >nul || exit /b 1
        echo Copied %%P -^> %DST%\wayforge.dll
        exit /b 0
    )
)
echo No wayforge.dll found. Build the core in Visual Studio first (see the top of this file).
exit /b 1
