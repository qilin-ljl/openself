@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
set "OPENSELF_CHECK="
if /i "%~1"=="--check" set "OPENSELF_CHECK=1"
set "OPENSELF_NODE="
set "OPENSELF_PNPM="
set "OPENSELF_DOCKER="
for /f "delims=" %%N in ('where.exe node.exe 2^>nul') do if not defined OPENSELF_NODE set "OPENSELF_NODE=%%N"
if not defined OPENSELF_NODE if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" set "OPENSELF_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not defined OPENSELF_NODE (
  echo 未找到 Node.js。请先安装 Node.js 22 或更新版本。
  goto fail
)
for %%N in ("%OPENSELF_NODE%") do set "PATH=%%~dpN;%PATH%"
"%OPENSELF_NODE%" -e "process.exit(Number(process.versions.node.split('.')[0]) >= 22 ? 0 : 1)"
if errorlevel 1 (
  echo Node.js 版本过旧，请使用 Node.js 22 或更新版本。
  goto fail
)
for /f "delims=" %%P in ('where.exe pnpm.cmd 2^>nul') do if not defined OPENSELF_PNPM set "OPENSELF_PNPM=%%P"
if not defined OPENSELF_PNPM for /f "delims=" %%P in ('where.exe pnpm.exe 2^>nul') do if not defined OPENSELF_PNPM set "OPENSELF_PNPM=%%P"
if not defined OPENSELF_PNPM if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd" set "OPENSELF_PNPM=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd"
if not defined OPENSELF_PNPM (
  echo 未找到 pnpm。请按 README 安装依赖后再启动。
  goto fail
)
for %%P in ("%OPENSELF_PNPM%") do set "PATH=%%~dpP;%PATH%"
for /f "delims=" %%D in ('where.exe docker.exe 2^>nul') do if not defined OPENSELF_DOCKER set "OPENSELF_DOCKER=%%D"
if not defined OPENSELF_DOCKER if exist "%LOCALAPPDATA%\Programs\DockerDesktop\resources\bin\docker.exe" set "OPENSELF_DOCKER=%LOCALAPPDATA%\Programs\DockerDesktop\resources\bin\docker.exe"
if not defined OPENSELF_DOCKER if exist "%ProgramFiles%\Docker\Docker\resources\bin\docker.exe" set "OPENSELF_DOCKER=%ProgramFiles%\Docker\Docker\resources\bin\docker.exe"
if not defined OPENSELF_DOCKER (
  echo 未找到 Docker Desktop，请先安装并打开它。
  goto fail
)
for %%D in ("%OPENSELF_DOCKER%") do set "PATH=%%~dpD;%PATH%"
if not exist ".env" (
  echo 缺少 .env。请先按 README 配置 GitHub 登录。
  goto fail
)
if not exist "node_modules\.bin\turbo.cmd" (
  echo 缺少项目依赖。请先按 README 安装依赖。
  goto fail
)
if defined OPENSELF_CHECK (
  "%OPENSELF_NODE%" --version
  call "%OPENSELF_PNPM%" exec pnpm --version
  if errorlevel 1 goto fail
  "%OPENSELF_DOCKER%" --version
  if errorlevel 1 goto fail
  echo 本地启动环境检查通过。
  exit /b 0
)
"%OPENSELF_NODE%" -e "const s=require('net').connect(3000,'127.0.0.1');s.once('connect',()=>{s.destroy();process.exit(10)});s.once('error',()=>process.exit(0));s.setTimeout(1500,()=>{s.destroy();process.exit(0)})"
if errorlevel 1 (
  echo 3000 端口已被占用。请先关闭旧的 OpenSelf 启动窗口，或直接打开 http://localhost:3000/zh
  goto fail
)
"%OPENSELF_DOCKER%" info >nul 2>&1
if errorlevel 1 (
  echo 请先打开 Docker Desktop，等待引擎启动后，再双击此文件。
  goto fail
)
"%OPENSELF_DOCKER%" compose up -d --wait --wait-timeout 60
if errorlevel 1 goto fail
set "NODE_ENV=development"
set "E2E_FAKE_AUTH=0"
call "%OPENSELF_PNPM%" db:migrate
if errorlevel 1 goto fail
echo 正在启动网站与后台。就绪后打开 http://localhost:3000/zh
echo 使用期间保留此窗口；停止时按 Ctrl+C。
call "%OPENSELF_PNPM%" dev
if errorlevel 1 goto fail
exit /b 0
:fail
echo 启动未完成，请查看上方提示。
if not defined OPENSELF_CHECK pause
exit /b 1
