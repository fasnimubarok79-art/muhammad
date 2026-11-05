# Starts the ClipKita-Pro web server and the video worker in two windows.
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
  Write-Host "WARNING: PostgreSQL is not running on port 5432. ClipKita-Pro will not work until it is started." -ForegroundColor Yellow
}

# Apply new database migrations (additive only, see docs/migrations), always after a backup.
Set-Location $Root
& npx prisma migrate status *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Host "New database migrations found. Making a backup first..."
  npm run backup
  if ($LASTEXITCODE -ne 0) { Write-Host "Backup failed, so the migrations were NOT applied. Check that PostgreSQL runs, then start again." -ForegroundColor Red; exit 1 }
  npx prisma migrate deploy
  if ($LASTEXITCODE -ne 0) { Write-Host "Migration failed. Your data is in the backup above; see scripts\backup\RECOVERY.md." -ForegroundColor Red; exit 1 }
}

Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$Root'; `$host.UI.RawUI.WindowTitle = 'ClipKita-Pro web'; npm start"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$Root'; `$host.UI.RawUI.WindowTitle = 'ClipKita-Pro worker'; npm run worker"
Start-Sleep -Seconds 8
Start-Process "http://localhost:3000"
Write-Host "Two windows opened (web and worker). Keep both open while you use ClipKita-Pro. Close them to stop."
