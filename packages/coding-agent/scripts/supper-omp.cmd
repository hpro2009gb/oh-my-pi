@echo off
REM Side-by-side Super Pi launcher for Windows. Installs as supper-omp.cmd, never omp.cmd.
setlocal EnableExtensions

if not defined PI_CONFIG_DIR set "PI_CONFIG_DIR=.supper-omp"
if not defined OMP_XDG_APP_NAME set "OMP_XDG_APP_NAME=supper-omp"
if not defined OMP_DEFAULT_PRESET set "OMP_DEFAULT_PRESET=pi-super"
if not defined OMP_DEV_LAUNCH_DIR set "OMP_DEV_LAUNCH_DIR=%USERPROFILE%\.supper-omp\.dev-cwd"

set "SCRIPTS_DIR=%~dp0"
set "CLI=%SCRIPTS_DIR%..\src\cli.ts"
set "PRELOAD=%SCRIPTS_DIR%omp.ts"

if not exist "%OMP_DEV_LAUNCH_DIR%" mkdir "%OMP_DEV_LAUNCH_DIR%"
set "OMP_LAUNCH_CWD=%CD%"
cd /d "%OMP_DEV_LAUNCH_DIR%"

bun --preload "%PRELOAD%" "%CLI%" %*
set "EXIT_CODE=%ERRORLEVEL%"
cd /d "%OMP_LAUNCH_CWD%"
exit /b %EXIT_CODE%
