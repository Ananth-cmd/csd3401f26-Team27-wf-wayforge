@echo off
rem pull-backups.bat - copy the team server's nightly backups to this PC
rem run it from anywhere:  wayforge\studio-web\deploy\pull-backups.bat
rem the backups land in %USERPROFILE%\wayforge-backups (made by deploy\backup-vm.sh on the server)
rem needs SSH key login to the server (see deploy\README.md)
rem
rem \author Joel Chua (c.jialiang@digipen.edu)
rem AI declaration: Claude Opus was used as a support tool for debugging, build infrastructure and the header comments.
rem \date 2026-10-21

setlocal
set SERVER=team27@51.79.243.238
set DEST=%USERPROFILE%\wayforge-backups

if not exist "%DEST%" mkdir "%DEST%"
scp "%SERVER%:backups/vm-backup-*.tgz" "%DEST%\" || goto :fail

echo.
echo Done. Backups are in %DEST%
exit /b 0

:fail
echo.
echo Copying failed, scroll up for the error.
exit /b 1
