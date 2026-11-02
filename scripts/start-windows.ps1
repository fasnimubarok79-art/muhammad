# Starts the ClipKita web server and the video worker in two windows.
#   powershell -ExecutionPolicy Bypass -File C:\clipkita-pro\scripts\start-windows.ps1
$Root = Split-Path -Parent $PSScriptRoot
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$Root'; `$host.UI.RawUI.WindowTitle = 'ClipKita web'; npm start"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$Root'; `$host.UI.RawUI.WindowTitle = 'ClipKita worker'; npm run worker"
Start-Sleep -Seconds 8
Start-Process "http://localhost:3000"
Write-Host "Two windows opened (web and worker). Keep both open while you use ClipKita. Close them to stop."
