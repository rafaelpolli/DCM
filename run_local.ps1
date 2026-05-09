$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ProjectRoot

Write-Host ""
Write-Host "Data Contract Manager - servidor local" -ForegroundColor Cyan
Write-Host "Pasta: $ProjectRoot"
Write-Host ""

Write-Host "Verificando Python..." -ForegroundColor Yellow
python --version

Write-Host ""
Write-Host "Iniciando aplicacao em http://127.0.0.1:8010/login" -ForegroundColor Green
Write-Host "Deixe esta janela aberta enquanto usa a aplicacao."
Write-Host "Para parar o servidor, pressione Ctrl+C."
Write-Host ""

Start-Job -ScriptBlock {
    Start-Sleep -Seconds 3
    Start-Process "http://127.0.0.1:8010/login"
} | Out-Null

python -m uvicorn datacontracts.app.main:app --reload --host 127.0.0.1 --port 8010
