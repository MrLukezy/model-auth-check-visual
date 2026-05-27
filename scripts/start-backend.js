import { spawn, execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { platform } from 'process';

const isWindows = platform === 'win32';
const backendDir = join(process.cwd(), 'backend');
const requirementsPath = join(backendDir, 'requirements.txt');

// 检查 Python 是否安装
function checkPython() {
  try {
    const cmd = isWindows ? 'python --version' : 'python3 --version';
    execSync(cmd, { stdio: 'ignore' });
    return true;
  } catch {
    console.error('[ERROR] Python not found. Please install Python 3.10+');
    process.exit(1);
  }
}

// 安装依赖
function installDeps() {
  if (!existsSync(requirementsPath)) {
    console.error('[ERROR] requirements.txt not found');
    process.exit(1);
  }

  try {
    const python = isWindows ? 'python' : 'python3';
    execSync(`${python} -c "import fastapi"`, { stdio: 'ignore' });
    console.log('[INFO] Python dependencies already installed');
  } catch {
    console.log('[INFO] Installing Python dependencies...');
    try {
      const pip = isWindows ? 'pip' : 'pip3';
      execSync(`${pip} install -r "${requirementsPath}"`, { stdio: 'inherit' });
      console.log('[INFO] Dependencies installed successfully');
    } catch (error) {
      console.error('[ERROR] Failed to install dependencies');
      process.exit(1);
    }
  }
}

// 启动服务器
function startServer() {
  const python = isWindows ? 'python' : 'python3';
  const args = ['server.py'];
  
  console.log('[INFO] Starting backend server on port 8765...');
  
  const server = spawn(python, args, {
    cwd: backendDir,
    stdio: 'inherit',
    shell: false
  });

  server.on('error', (error) => {
    console.error('[ERROR] Failed to start server:', error.message);
    process.exit(1);
  });

  server.on('exit', (code) => {
    console.log(`[INFO] Server exited with code ${code}`);
    process.exit(code);
  });

  // 处理进程信号
  process.on('SIGINT', () => {
    console.log('\n[INFO] Shutting down server...');
    server.kill('SIGINT');
  });

  process.on('SIGTERM', () => {
    console.log('[INFO] Shutting down server...');
    server.kill('SIGTERM');
  });
}

// 主流程
checkPython();
installDeps();
startServer();
