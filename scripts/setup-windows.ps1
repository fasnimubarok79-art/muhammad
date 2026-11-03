# ClipKita one-time setup for Windows (PowerShell 5.1+).
# Run from Command Prompt or PowerShell:
#   powershell -ExecutionPolicy Bypass -File C:\clipkita-pro\scripts\setup-windows.ps1
# Safe to run again: every step checks what already exists and skips it.
# Not yet tested on a real Windows machine; report any error message it prints.

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"   # makes Invoke-WebRequest much faster
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Root = Split-Path -Parent $PSScriptRoot
$PyDir = "C:\Python312"
$PyExe = Join-Path $PyDir "python.exe"
$FfDir = "C:\ffmpeg"
$FfExe = Join-Path $FfDir "bin\ffmpeg.exe"
$Downloads = Join-Path $env:TEMP "clipkita-setup"
New-Item -ItemType Directory -Force -Path $Downloads | Out-Null

function Step($n, $text) { Write-Host ""; Write-Host "[$n] $text" -ForegroundColor Cyan }
function Ok($text) { Write-Host "    OK  $text" -ForegroundColor Green }
function Fail($text) { Write-Host "    ERROR  $text" -ForegroundColor Red; Write-Host ""; Read-Host "Press Enter to close"; exit 1 }
function RandomHex($bytes) {
  $b = New-Object byte[] $bytes
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
  return -join ($b | ForEach-Object { $_.ToString("x2") })
}
function RandomPassword() {
  $chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789".ToCharArray()
  $b = New-Object byte[] 16
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
  return -join ($b | ForEach-Object { $chars[$_ % $chars.Length] })
}

Set-Location $Root
Write-Host "ClipKita setup in $Root" -ForegroundColor White

# 1. Node.js
Step 1 "Node.js"
try { $nodeV = (& node -v) } catch { Fail "Node.js is not installed. Install the LTS version from https://nodejs.org and run this script again." }
Ok "Node $nodeV"

# 2. Python (installed to C:\Python312, outside the user profile)
Step 2 "Python 3.12"
if (-not (Test-Path $PyExe)) {
  $pyInstaller = Join-Path $Downloads "python-3.12.8-amd64.exe"
  Write-Host "    Downloading Python (about 25 MB)..."
  try { Invoke-WebRequest "https://www.python.org/ftp/python/3.12.8/python-3.12.8-amd64.exe" -OutFile $pyInstaller -UseBasicParsing }
  catch { Fail "Could not download Python. Download python-3.12.8-amd64.exe from https://www.python.org/downloads/ and install it to C:\Python312, then run this script again." }
  Write-Host "    Installing Python to $PyDir ..."
  Start-Process $pyInstaller -ArgumentList "/quiet InstallAllUsers=0 TargetDir=$PyDir PrependPath=0 Include_test=0 Include_launcher=0 Shortcuts=0" -Wait
}
if (-not (Test-Path $PyExe)) { Fail "Python was not installed to $PyDir." }
Ok (& $PyExe --version)

# 3. FFmpeg (C:\ffmpeg)
Step 3 "FFmpeg"
if (-not (Test-Path $FfExe)) {
  $zip = Join-Path $Downloads "ffmpeg.zip"
  $tmp = Join-Path $Downloads "ffmpeg-unzip"
  Write-Host "    Downloading FFmpeg (about 100 MB)..."
  try { Invoke-WebRequest "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip" -OutFile $zip -UseBasicParsing }
  catch { Fail "Could not download FFmpeg. Download ffmpeg-release-essentials.zip from https://www.gyan.dev/ffmpeg/builds/, unzip it and rename the folder to C:\ffmpeg, then run this script again." }
  if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
  Expand-Archive $zip $tmp -Force
  $inner = Get-ChildItem $tmp -Directory | Select-Object -First 1
  Move-Item $inner.FullName $FfDir
}
if (-not (Test-Path $FfExe)) { Fail "FFmpeg not found at $FfExe." }
Ok ((& $FfExe -hide_banner -version | Select-Object -First 1))

# 4. PostgreSQL (needs the official installer and administrator rights)
Step 4 "PostgreSQL"
function FindPsql { Get-ChildItem "C:\Program Files\PostgreSQL\*\bin\psql.exe" -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1 }
$psql = FindPsql
if (-not $psql) {
  Write-Host "    PostgreSQL is not installed. Opening the official download page..." -ForegroundColor Yellow
  Start-Process "https://www.enterprisedb.com/downloads/postgres-postgresql-downloads"
  Write-Host "    1. Download version 16 for Windows x86-64 and run the installer."
  Write-Host "    2. Keep the defaults, port 5432. WRITE DOWN the password you choose for 'postgres'."
  Write-Host "    3. Skip Stack Builder at the end."
  Read-Host "    Press Enter here when the installation has finished"
  $psql = FindPsql
}
if (-not $psql) { Fail "psql.exe not found under C:\Program Files\PostgreSQL. Finish the PostgreSQL installation and run this script again." }
$psql = $psql.FullName
Ok $psql

# 5. Database + .env
Step 5 "Database and .env"
$envFile = Join-Path $Root ".env"
if (Test-Path $envFile) {
  Ok ".env already exists, keeping it (delete it and rerun to regenerate)"
} else {
  $sec = Read-Host "    Enter the password of the 'postgres' user (set during PostgreSQL install)" -AsSecureString
  $env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
  $dbPass = RandomPassword
  $exists = (& $psql -U postgres -h 127.0.0.1 -tAc "SELECT 1 FROM pg_roles WHERE rolname='clipkita'")
  if ($LASTEXITCODE -ne 0) { Fail "Could not connect to PostgreSQL. Check the postgres password and that the PostgreSQL service is running." }
  if ($exists -match "1") { & $psql -U postgres -h 127.0.0.1 -qc "ALTER ROLE clipkita WITH LOGIN PASSWORD '$dbPass' CREATEDB;" }
  else { & $psql -U postgres -h 127.0.0.1 -qc "CREATE ROLE clipkita LOGIN PASSWORD '$dbPass' CREATEDB;" }
  if ($LASTEXITCODE -ne 0) { Fail "Could not create the database user." }
  $dbExists = (& $psql -U postgres -h 127.0.0.1 -tAc "SELECT 1 FROM pg_database WHERE datname='clipkita'")
  if (-not ($dbExists -match "1")) {
    & $psql -U postgres -h 127.0.0.1 -qc "CREATE DATABASE clipkita OWNER clipkita;"
    if ($LASTEXITCODE -ne 0) { Fail "Could not create the database." }
  }
  Remove-Item Env:\PGPASSWORD

  $ownerPass = RandomPassword
  $rootFwd = $Root -replace "\\", "/"
  $content = @"
DATABASE_URL=postgresql://clipkita:$dbPass@127.0.0.1:5432/clipkita
APP_URL=http://localhost:3000
STORAGE_DIR=$rootFwd/storage
SECRET_KEY=$(RandomHex 32)
OWNER_EMAIL=ADMIN16112000@gmail.com
OWNER_USERNAME=ADMINPRO16112000
OWNER_INITIAL_PASSWORD=$ownerPass
WHISPER_MODEL=small
WHISPER_PYTHON=$rootFwd/.venv/Scripts/python.exe
WHISPER_LANGUAGE=id
FFMPEG_PATH=C:/ffmpeg/bin/ffmpeg.exe
FFPROBE_PATH=C:/ffmpeg/bin/ffprobe.exe
MAX_UPLOAD_MB=500
"@
  # UTF-8 without BOM, otherwise the first variable name is unreadable
  [IO.File]::WriteAllText($envFile, $content, (New-Object System.Text.UTF8Encoding $false))
  Ok ".env written"
  Write-Host ""
  Write-Host "    Owner admin login (write this down, you must change it at first login):" -ForegroundColor Yellow
  Write-Host "      username: ADMINPRO16112000  (or email ADMIN16112000@gmail.com)" -ForegroundColor Yellow
  Write-Host "      password: $ownerPass" -ForegroundColor Yellow
}
New-Item -ItemType Directory -Force -Path (Join-Path $Root "storage") | Out-Null

# 6. Node packages, tables, owner account
Step 6 "Node packages, database tables, owner account"
if (-not (Test-Path (Join-Path $Root "node_modules\.bin\next.cmd"))) { & npm ci; if ($LASTEXITCODE -ne 0) { Fail "npm ci failed." } }
& npx prisma migrate deploy
if ($LASTEXITCODE -ne 0) { Fail "Database migration failed." }
& npm run db:seed
if ($LASTEXITCODE -ne 0) { Fail "Owner account setup failed." }
Ok "database ready"

# 7. Whisper (speech recognition)
Step 7 "Whisper speech recognition and link import (a few minutes)"
$venvPy = Join-Path $Root ".venv\Scripts\python.exe"
if (-not (Test-Path $venvPy)) { & $PyExe -m venv (Join-Path $Root ".venv") }
& $venvPy -m pip install --disable-pip-version-check -q -r (Join-Path $Root "worker\stt\requirements.txt")
if ($LASTEXITCODE -ne 0) { Fail "Installing faster-whisper failed." }
& $venvPy -c "import faster_whisper; print('faster-whisper', faster_whisper.__version__)"
if ($LASTEXITCODE -ne 0) { Fail "faster-whisper does not import." }
& $venvPy -m yt_dlp --version
if ($LASTEXITCODE -ne 0) { Fail "yt-dlp (link import) is not installed." }
& $venvPy -c "import cv2; print('opencv', cv2.__version__)"
if ($LASTEXITCODE -ne 0) { Fail "OpenCV (face tracking) is not installed." }
Ok "Whisper installed (the 'small' model, about 480 MB, downloads on the first transcription)"

# 8. Build
Step 8 "Building the web app"
& npm run build
if ($LASTEXITCODE -ne 0) { Fail "Build failed. Copy the error above and send it." }
Ok "build complete"

Write-Host ""
Write-Host "Setup finished. Start ClipKita with:" -ForegroundColor Green
Write-Host "  powershell -ExecutionPolicy Bypass -File $Root\scripts\start-windows.ps1" -ForegroundColor Green
Write-Host "Then open http://localhost:3000"
Read-Host "Press Enter to close"
