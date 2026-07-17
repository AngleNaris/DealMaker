# DealMaker release build
# Output:
#   release/portable/DealMaker.exe   (single file; backend+officecli embedded)
#   release/DealMaker_*_x64-setup.exe (optional NSIS)
#
# Embedded: dealmaker-backend, officecli (extracted to %LOCALAPPDATA%\DealMaker\runtime on first run)
# NOT embedded: contract template (user selects / places next to exe)
# PDF: system WPS / Word; quote PNG: system Edge/Chrome

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host "==> [0/5] Sync version from VERSION..." -ForegroundColor Cyan
node "$Root\sync_version.js"
if ($LASTEXITCODE -ne 0) { throw "sync_version.js failed" }
$AppVersion = (Get-Content "$Root\VERSION" -Raw).Trim()
Write-Host "Building DealMaker v$AppVersion" -ForegroundColor Green

Write-Host "==> [1/5] Check tools..." -ForegroundColor Cyan
if (-not (Get-Command python -ErrorAction SilentlyContinue)) { throw "python required" }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw "npm required" }
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) { throw "cargo required" }
if (-not (Test-Path "$Root\officecli.exe")) { throw "missing officecli.exe in project root" }

$pyi = Get-Command pyinstaller -ErrorAction SilentlyContinue
if (-not $pyi) {
  Write-Host "Installing PyInstaller..."
  pip install pyinstaller -q
}

Write-Host "==> [2/5] Pack Python backend (embedded in DealMaker.exe)..." -ForegroundColor Cyan
$backendSpec = Join-Path $Root "backend\dealmaker-backend.spec"
Push-Location $Root
pyinstaller --noconfirm --clean --distpath "$Root\dist_backend" --workpath "$Root\build_backend" $backendSpec
Pop-Location
$backendExe = Join-Path $Root "dist_backend\dealmaker-backend.exe"
if (-not (Test-Path $backendExe)) { throw "backend pack failed: $backendExe" }

Write-Host "==> [3/5] Stage embed resources (no template)..." -ForegroundColor Cyan
$resDir = Join-Path $Root "app\src-tauri\resources"
New-Item -ItemType Directory -Force -Path $resDir | Out-Null
Copy-Item $backendExe (Join-Path $resDir "dealmaker-backend.exe") -Force
Copy-Item (Join-Path $Root "officecli.exe") (Join-Path $resDir "officecli.exe") -Force

Write-Host "==> [4/5] Frontend + Tauri release..." -ForegroundColor Cyan
Push-Location (Join-Path $Root "app")
npm install --silent
npm run build
if ($LASTEXITCODE -ne 0) { throw "frontend build failed" }
# Tauri writes progress to stderr; do not treat as terminating error
$prevEap = $ErrorActionPreference
$ErrorActionPreference = "Continue"
npx tauri build --bundles nsis
$tauriCode = $LASTEXITCODE
if ($tauriCode -ne 0) {
  Write-Host "NSIS failed (exit $tauriCode), try exe only..." -ForegroundColor Yellow
  npx tauri build --no-bundle
  $tauriCode = $LASTEXITCODE
}
$ErrorActionPreference = $prevEap
if ($tauriCode -ne 0) { throw "tauri build failed: $tauriCode" }
Pop-Location

$releaseExe = Join-Path $Root "app\src-tauri\target\release\dealmaker.exe"
if (-not (Test-Path $releaseExe)) {
  $alt = Get-ChildItem (Join-Path $Root "app\src-tauri\target\release") -Filter "*.exe" -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -notmatch "install|uninstall" } | Select-Object -First 1
  if ($alt) { $releaseExe = $alt.FullName }
}
if (-not (Test-Path $releaseExe)) { throw "release exe not found" }

Write-Host "==> [5/5] Assemble single-file portable..." -ForegroundColor Cyan
$portable = Join-Path $Root "release\portable"
if (Test-Path $portable) { Remove-Item $portable -Recurse -Force }
New-Item -ItemType Directory -Force -Path $portable | Out-Null
Copy-Item $releaseExe (Join-Path $portable "DealMaker.exe") -Force
# 单 exe：GUI + Agent CLI 同一 DealMaker.exe（双击=界面，参数=CLI）

$outNsis = Join-Path $Root "release"
New-Item -ItemType Directory -Force -Path $outNsis | Out-Null
# only current version installer
$nsis = Get-ChildItem (Join-Path $Root "app\src-tauri\target\release\bundle") -Recurse -Filter "DealMaker_${AppVersion}_*.exe" -ErrorAction SilentlyContinue
if (-not $nsis) {
  $nsis = Get-ChildItem (Join-Path $Root "app\src-tauri\target\release\bundle") -Recurse -Filter "*.exe" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
}
foreach ($f in $nsis) {
  Copy-Item $f.FullName $outNsis -Force
  Write-Host "Installer: $($f.FullName)" -ForegroundColor Green
}
# drop outdated setupers in release/
Get-ChildItem $outNsis -Filter "DealMaker_*_setup.exe" -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -notlike "DealMaker_${AppVersion}_*" } |
  Remove-Item -Force -ErrorAction SilentlyContinue

$exeSize = [math]::Round((Get-Item (Join-Path $portable "DealMaker.exe")).Length / 1MB, 2)
Write-Host ""
Write-Host "Done. DealMaker v$AppVersion" -ForegroundColor Green
Write-Host "Portable (single file): $portable"
Write-Host "  - DealMaker.exe  ($exeSize MB)  GUI + Agent CLI"
Write-Host "    double-click = GUI;  DealMaker.exe help = AI CLI"
Write-Host "Runtime deps extract to: %LOCALAPPDATA%\DealMaker\runtime\"
Write-Host "  - .version=$AppVersion; upgrade overwrites deps"
Write-Host "Template: NOT embedded (pick in UI or place next to exe)"
Write-Host "User data: exe-side .contract_tool/"
Write-Host "Agent: DealMaker.exe help  |  docs: AGENTS.md"
Write-Host "PDF: system WPS/Word; quote PNG: Edge/Chrome"
