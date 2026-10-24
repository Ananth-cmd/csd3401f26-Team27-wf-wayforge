@echo off
rem deploy.bat - build the Studio and put it on the team server in one go
rem run it from anywhere:  wayforge\studio-web\deploy\deploy.bat
rem it asks for the server password twice (once to upload, once to install)

setlocal
set SERVER=team27@51.79.243.238
cd /d "%~dp0\..\.."

echo == building the website (also copies in the 3D viewer if it's built)
pushd studio-web
call npm.cmd run build || goto :fail
popd

echo == packing (engine source + website + Studio server + Kervin's API for the Navigator)
if exist "%TEMP%\studio-upload.tgz" del "%TEMP%\studio-upload.tgz"
tar -czf "%TEMP%\studio-upload.tgz" core studio-web/package.json studio-web/dist studio-web/server/server.mjs studio-web/src/lib studio-web/deploy backend/package.json backend/package-lock.json backend/tsconfig.json backend/src || goto :fail

echo == uploading
scp "%TEMP%\studio-upload.tgz" %SERVER%:studio-upload.tgz || goto :fail

echo == installing on the server
ssh %SERVER% "mkdir -p ~/wayforge && rm -rf ~/wayforge/studio-web/dist && tar -xzf ~/studio-upload.tgz -C ~/wayforge && sed -i 's/\r$//' ~/wayforge/studio-web/deploy/*.sh && bash ~/wayforge/studio-web/deploy/setup-vm.sh" || goto :fail

echo.
echo Done. Studio: https://wayforgestudio.duckdns.org   Navigator: https://navigation.duckdns.org
exit /b 0

:fail
echo.
echo Something failed, scroll up for the error.
exit /b 1
