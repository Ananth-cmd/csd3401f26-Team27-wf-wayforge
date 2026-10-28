@echo off
rem deploy.bat - build the Navigator website and put it on the team server in one go
rem run it from anywhere:  wayforge\navigator\deploy\deploy.bat
rem needs: Node.js 22 LTS on this PC, and SSH key login to the server (see deploy\README.md)
rem
rem every upload goes into its own dated folder on the server (/var/www/site2/releases/<date>)
rem and /var/www/site2/current is switched to it, so a bad upload can be undone (see README).
rem
rem \author Joel Chua (c.jialiang@digipen.edu)
rem AI declaration: Claude Opus was used as a support tool for debugging, build infrastructure and the header comments.
rem \date 2026-10-22

setlocal
set SERVER=team27@51.79.243.238
cd /d "%~dp0\.."

if not exist node_modules (
  echo == installing packages
  call npm.cmd ci || goto :fail
)

echo == building the website
call npm.cmd run build || goto :fail

echo == packing
if exist "%TEMP%\navigator-upload.tgz" del "%TEMP%\navigator-upload.tgz"
tar -czf "%TEMP%\navigator-upload.tgz" -C dist . || goto :fail

echo == uploading
scp "%TEMP%\navigator-upload.tgz" %SERVER%:navigator-upload.tgz || goto :fail

echo == installing on the server (keeps the newest 5 uploads)
ssh %SERVER% "set -e; R=/var/www/site2/releases/$(date -u +%%Y%%m%%d-%%H%%M%%S); mkdir -p $R; tar -xzf ~/navigator-upload.tgz -C $R; chmod -R a+rX $R; ln -sfn $R /var/www/site2/current; ls -1d /var/www/site2/releases/* | sort -r | tail -n +6 | xargs -r rm -rf; rm -f ~/navigator-upload.tgz; echo live: $R" || goto :fail

echo.
echo Done. Open https://navigation.duckdns.org
exit /b 0

:fail
echo.
echo Something failed, scroll up for the error.
exit /b 1
