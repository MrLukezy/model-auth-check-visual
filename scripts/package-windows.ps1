<#
.SYNOPSIS
    把 Real-O-Meter 打成便携版：一个文件夹，双击 exe 即用。

.DESCRIPTION
    1. 用 tauri build 编译出 release exe
    2. 下载 Python embeddable (Windows x64) 到 python/
    3. 启用 site-packages（让 pip 生效）
    4. 安装 pip 与 backend 依赖（fastapi/uvicorn/httpx/...）
    5. 复制 backend/ 与 data/ 到便携目录
    6. 打包成 dist-portable/Real-O-Meter-Portable.zip
#>

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue" # 加速 Invoke-WebRequest

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)  # visual-tool 目录
$src = $PSScriptRoot  # visual-tool/scripts
$visualTool = $src.Substring(0, $src.LastIndexOf("\scripts")) # 兼容非标准位置
$visualTool = "C:\Lukezy\ForkProject\modelTest\model-auth-check\visual-tool"

$distRoot = Join-Path $visualTool "dist-portable"
$bundleName = "Real-O-Meter"
$bundleDir = Join-Path $distRoot $bundleName

$pyVersion = "3.12.8"
$pyShort = $pyVersion -replace '\.\d+$', ''      # "3.12"
$pyTag = $pyVersion.Replace(".", "") -replace '\d$', ''  # "312"
$pyZipUrl = "https://www.python.org/ftp/python/$pyVersion/python-$pyVersion-embed-amd64.zip"
$getPipUrl = "https://bootstrap.pypa.io/get-pip.py"

Write-Host ""
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host "  Real-O-Meter portable packaging" -ForegroundColor Cyan
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host ""

# ------------------------------------------------------------
# Step 1: Build Tauri (release)
# ------------------------------------------------------------
Write-Host "[1/6] Building Tauri exe (release)..." -ForegroundColor Yellow
Push-Location $visualTool
try {
    & npm run build | Out-Null
    & npx tauri build | Out-Null
} finally {
    Pop-Location
}
$exeSrc = Join-Path $visualTool "src-tauri\target\x86_64-pc-windows-msvc\release\real-o-meter.exe"
if (!(Test-Path $exeSrc)) {
    throw "Tauri build failed: $exeSrc not found"
}
Write-Host "       OK -> $exeSrc" -ForegroundColor Green

# ------------------------------------------------------------
# Step 2: Prepare bundle directory
# ------------------------------------------------------------
Write-Host "[2/6] Preparing bundle directory..." -ForegroundColor Yellow
if (Test-Path $distRoot) { Remove-Item -Recurse -Force $distRoot }
New-Item -ItemType Directory -Path $bundleDir | Out-Null
New-Item -ItemType Directory -Path (Join-Path $bundleDir "python") | Out-Null
Write-Host "       OK -> $bundleDir" -ForegroundColor Green

# ------------------------------------------------------------
# Step 3: Copy exe
# ------------------------------------------------------------
Write-Host "[3/6] Copying exe and data..." -ForegroundColor Yellow
Copy-Item $exeSrc (Join-Path $bundleDir "$bundleName.exe")

$backendSrc = Join-Path $visualTool "backend"
$backendDst = Join-Path $bundleDir "backend"
Copy-Item -Path $backendSrc -Destination $backendDst -Recurse
Remove-Item (Join-Path $backendDst "__pycache__") -Recurse -Force -ErrorAction SilentlyContinue

$dataSrc = Join-Path $visualTool "..\data"
$dataDst = Join-Path $bundleDir "data"
Copy-Item -Path $dataSrc -Destination $dataDst -Recurse
Write-Host "       OK" -ForegroundColor Green

# ------------------------------------------------------------
# Step 4: Download Python embeddable
# ------------------------------------------------------------
Write-Host "[4/6] Downloading Python $pyVersion embeddable..." -ForegroundColor Yellow
$pyZipLocal = Join-Path $distRoot "python-embed.zip"
if (!(Test-Path $pyZipLocal)) {
    Invoke-WebRequest -Uri $pyZipUrl -OutFile $pyZipLocal -UseBasicParsing
}
Expand-Archive -Path $pyZipLocal -DestinationPath (Join-Path $bundleDir "python") -Force
Write-Host "       OK" -ForegroundColor Green

# ------------------------------------------------------------
# Step 5: Enable site-packages and install pip + deps
# ------------------------------------------------------------
Write-Host "[5/6] Enabling pip in embedded Python..." -ForegroundColor Yellow

# python3x._pth restricts sys.path. Uncomment "import site" so that
# Lib/site-packages from pip becomes visible.
$pthFiles = Get-ChildItem (Join-Path $bundleDir "python") -Filter "python*._pth"
if ($pthFiles.Count -eq 0) {
    throw "Could not find python*._pth file"
}
foreach ($f in $pthFiles) {
    $content = Get-Content $f.FullName
    $newContent = $content -replace '^\s*#\s*import site', 'import site'
    Set-Content -Path $f.FullName -Value $newContent
    Write-Host "       Edited $($f.Name)" -ForegroundColor DarkGray
}

# Download get-pip.py
$getPipLocal = Join-Path $bundleDir "python\get-pip.py"
if (!(Test-Path $getPipLocal)) {
    Invoke-WebRequest -Uri $getPipUrl -OutFile $getPipLocal -UseBasicParsing
}

$pyExe = Join-Path $bundleDir "python\python.exe"
Write-Host "       Installing pip via get-pip.py..." -ForegroundColor Yellow
& $pyExe $getPipLocal --no-warn-script-location 2>&1 | Out-Null

Write-Host "       Installing backend requirements..." -ForegroundColor Yellow
$req = Join-Path $backendSrc "requirements.txt"
& $pyExe -m pip install --no-warn-script-location -r $req 2>&1 | Out-Null

# Cleanup get-pip.py and Scripts dir we don't need
Remove-Item $getPipLocal -ErrorAction SilentlyContinue
Remove-Item (Join-Path $bundleDir "python\Scripts") -Recurse -Force -ErrorAction SilentlyContinue

Write-Host "       OK" -ForegroundColor Green

# ------------------------------------------------------------
# Step 6: Zip it up
# ------------------------------------------------------------
Write-Host "[6/6] Creating ZIP archive..." -ForegroundColor Yellow
$zipOut = Join-Path $distRoot "$bundleName-Portable.zip"
if (Test-Path $zipOut) { Remove-Item $zipOut -Force }
Compress-Archive -Path $bundleDir -DestinationPath $zipOut -CompressionLevel Optimal

$zipSize = [math]::Round(((Get-Item $zipOut).Length / 1MB), 2)
$bundleSize = [math]::Round(((Get-ChildItem $bundleDir -Recurse | Measure-Object -Property Length -Sum).Sum / 1MB), 2)

Write-Host ""
Write-Host "=================================================" -ForegroundColor Green
Write-Host "  DONE" -ForegroundColor Green
Write-Host "=================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Bundle folder: $bundleDir"
Write-Host "Bundle size:   $bundleSize MB (extracted)"
Write-Host ""
Write-Host "ZIP file:      $zipOut" -ForegroundColor Cyan
Write-Host "ZIP size:      $zipSize MB (distributable)"
Write-Host ""
Write-Host "Usage:" -ForegroundColor Yellow
Write-Host "  1. Extract the ZIP anywhere"
Write-Host "  2. Double-click Real-O-Meter.exe"
Write-Host "  3. Done. No install, no system Python required."
Write-Host ""
