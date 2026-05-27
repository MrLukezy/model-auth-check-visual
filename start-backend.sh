#!/bin/bash

# 启动 Python 后端服务器
cd "$(dirname "$0")/backend"

# 检查 Python 是否安装
if ! command -v python3 &> /dev/null; then
    echo "[ERROR] Python3 not found. Please install Python 3.10+"
    exit 1
fi

# 检查依赖是否安装
if ! python3 -c "import fastapi" 2>/dev/null; then
    echo "[INFO] Installing Python dependencies..."
    pip3 install -r requirements.txt
    if [ $? -ne 0 ]; then
        echo "[ERROR] Failed to install dependencies"
        exit 1
    fi
fi

# 检查端口是否被占用
if ! lsof -i :8765 >/dev/null 2>&1; then
    echo "[INFO] Starting backend server on port 8765..."
    python3 server.py
else
    echo "[INFO] Backend server already running on port 8765"
fi
