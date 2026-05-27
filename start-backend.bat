@echo off
setlocal enabledelayedexpansion

REM 启动 Python 后端服务器
cd /d "%~dp0backend"

REM 检查 Python 是否安装
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python not found. Please install Python 3.10+
    exit /b 1
)

REM 检查依赖是否安装
python -c "import fastapi" >nul 2>&1
if errorlevel 1 (
    echo [INFO] Installing Python dependencies...
    pip install -r requirements.txt
    if errorlevel 1 (
        echo [ERROR] Failed to install dependencies
        exit /b 1
    )
)

REM 检查端口是否被占用
netstat -ano | findstr :8765 >nul 2>&1
if errorlevel 1 (
    echo [INFO] Starting backend server on port 8765...
    python server.py
) else (
    echo [INFO] Backend server already running on port 8765
)
