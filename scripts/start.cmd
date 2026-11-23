@echo off
setlocal
cd /d "%~dp0\.."
docker info >nul 2>&1
if errorlevel 1 (
  echo Start Docker Desktop, then run this file again.
  pause
  exit /b 1
)
set "COMPOSE_DISABLE_ENV_FILE=1"
docker compose up --build -d --wait --wait-timeout 300
if errorlevel 1 (
  echo Startup failed. Review the messages above.
  pause
  exit /b 1
)
if not defined APP_PORT set APP_PORT=3000
echo Open http://localhost:%APP_PORT% and complete setup.
pause
