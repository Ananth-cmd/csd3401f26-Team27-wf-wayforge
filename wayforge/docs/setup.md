# Setup

## 1. Check what you have

Run each in a terminal. If it says "not found", install it from the next table.

```
git --version
cmake --version        # need 3.16 or newer
python3 --version      # (python on Windows)
ninja --version        # optional, faster builds
```
Windows: open "x64 Native Tools Command Prompt for VS 2022" and run `cl`. If that works you have the compiler.
Mac: `clang++ --version`. Linux: `g++ --version` (need C++20: GCC 11+, Clang 14+).

## 2. Install what is missing

| Tool | Where |
|---|---|
| Git | https://git-scm.com |
| CMake | https://cmake.org/download or `winget install Kitware.CMake` / `brew install cmake` / `sudo apt install cmake` |
| Ninja (optional) | `winget install Ninja-build.Ninja` / `brew install ninja` / `sudo apt install ninja-build` |
| Compiler, Windows | Visual Studio 2022 Community, workload "Desktop development with C++" |
| Compiler, Mac | `xcode-select --install` |
| Compiler, Linux | `sudo apt install build-essential` |
| Python 3 | https://python.org (tick "Add to PATH" on Windows) |
| Unity 6 (LTS) + Android Build Support | Unity Hub. Android module includes SDK, NDK and OpenJDK. |
| Android NDK (if not via Unity) | Android Studio > SDK Manager > SDK Tools > NDK (Side by side) |

## 3. Build and test the tool

```
git clone <repo url>
cd wayforge
core\script_build_and_run.bat        (Windows)
./core/script_build_and_run.sh       (Mac / Linux)
```
Expected ending: `100% tests passed out of 7`, `=== OK ===`. The Windows script also copies
`wayforge.dll` into `unity/Assets/Wayforge/Plugins/x86_64/`.

Manual equivalent:
```
cmake -S core -B build/desktop
cmake --build build/desktop --config Debug
ctest --test-dir build/desktop -C Debug --output-on-failure
build/desktop/Sandbox/wf_cli/wf_cli --version
```
Or open `core/` as a folder in Visual Studio / CLion / VS Code - `CMakePresets.json` is picked up.

## 4. Try the CLI

```
build/desktop/Sandbox/wf_cli/wf_cli --version
```

## 5. Unity

Build the core first (step 3), so `wayforge.dll` is in `unity/Assets/Wayforge/Plugins/x86_64/`. Building in Visual Studio copies it there automatically (close Unity before building, it locks the dll).
Then open `unity/` in Unity Hub and go to `Wayforge > Studio`. The sidebar shows `core 0.1.0` once a plan is loaded. If the Import / Open buttons are greyed out, the dll is missing.


## 6. Push to GitHub

```
git init
git add .
git commit -m "Wayforge tool skeleton (M1)"
```
Create an empty repository on github.com (no README), then:
```
git remote add origin https://github.com/<you>/wayforge.git
git branch -M main
git push -u origin main
```
The Actions tab will show the golden-checker, desktop (Ubuntu + Windows), docker and web jobs
from `.github/workflows/build.yml`.
