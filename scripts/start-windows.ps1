# Starts the ClipKita web server and the video worker in two windows.
#   powershell -ExecutionPolicy Bypass -File C:\clipkita-pro\scripts\start-windows.ps1
$Root = Split-Path -Parent $PSScriptRoot

# If PostgreSQL runs from a user data folder (no admin rights, C:\clipkita-pg), start it when it is not running.
$PgData = "C:\clipkita-pg"
$listening = Get-NetTCPConnection -LocalPort 5432 -State Listen -ErrorAction SilentlyContinue
if (-not $listening -and (Test-Path (Join-Path $PgData "PG_VERSION"))) {
  $pgCtl = Get-ChildItem "C:\Program Files\PostgreSQL\*\bin\pg_ctl.exe" -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1
  if ($pgCtl) {
    Write-Host "Starting PostgreSQL from $PgData ..."
    & $pgCtl.FullName -D $PgData -l (Join-Path $PgData "server.log") -w start
  }
}
if (-not (Get-NetTCPConnection -LocalPort 5432 -State Listen -ErrorAction SilentlyContinue)) {
  Write-Host "WARNING: PostgreSQL is not running on port 5432. ClipKita will not work until it is started." -ForegroundColor Yellow
}

Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$Root'; `$host.UI.RawUI.WindowTitle = 'ClipKita web'; npm start"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$Root'; `$host.UI.RawUI.WindowTitle = 'ClipKita worker'; npm run worker"
Start-Sleep -Seconds 8
Start-Process "http://localhost:3000"
Write-Host "Two windows opened (web and worker). Keep both open while you use ClipKita. Close them to stop."
