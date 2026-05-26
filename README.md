# Model Auth Check - Visual Tool

基于 **Tauri v2 + SolidJS + Python FastAPI** 的可视化模型评测工具。

## 架构

```
visual-tool/
├── backend/server.py          # Python FastAPI 后端
├── src-tauri/src/lib.rs       # Tauri Rust 后端（管理 Python 进程）
└── src/                       # SolidJS 前端
```

## Quick Start

### 1. Install Python dependencies (one-time)

```powershell
cd backend
pip install -r requirements.txt
```

### 2. Install frontend dependencies (one-time)

```powershell
cd visual-tool
npm install
```

### 3. Launch

```powershell
npm run tauri dev
```

Tauri will automatically:
- Start the Python backend on `http://localhost:8765` at app launch
- Wait up to 15s for it to become ready (status indicator turns green)
- Kill the Python backend when the app window is closed

The sidebar shows the backend status ("Backend starting..." while Python boots).

## 功能说明

### Providers 页面
添加 API 提供商，填写名称、Base URL 和 API Key。

### Models 页面
- 点击提供商名称拉取该提供商下所有可用模型
- 勾选感兴趣的模型，点击 "Add Selected to Queue" 加入测试队列

### Tests 页面
- 查看当前测试队列
- 设置每个模型的测试题目数（1-10题）
- 点击 Run 执行评测，查看每个模型的通过率和响应时间

## 支持的提供商

任何兼容 OpenAI `/v1/models` 接口的提供商：

| 提供商 | Base URL 示例 |
|--------|--------------|
| OpenAI | `https://api.openai.com` |
| DeepSeek | `https://api.deepseek.com` |
| SiliconFlow | `https://api.siliconflow.cn` |
| Any proxy | 自定义 URL |

## Data Persistence

Data is saved in `backend/data.json`, containing all providers and models info.
