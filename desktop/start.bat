@echo off
setlocal
set "INSTALLED=%LOCALAPPDATA%\Programs\Tom\Tom.exe"
if exist "%INSTALLED%" (
  start "" "%INSTALLED%" --disable-http-cache
  exit /b 0
)
cd /d "%~dp0"
if exist "node_modules\electron\dist\electron.exe" (
  start "" "node_modules\electron\dist\electron.exe" . --disable-http-cache
  exit /b 0
)
echo [Tom] No installed copy or local runtime found. Run the installer or npm install first.
pause
