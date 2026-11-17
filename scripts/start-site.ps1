$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path dist/client/index.html)) { npm run build; if ($LASTEXITCODE -ne 0) { exit 1 } }
try { $taskHealth = Invoke-RestMethod http://127.0.0.1:4174/api/health -TimeoutSec 2 } catch { $taskHealth = $null }
if (-not $taskHealth.ok) { Start-Process -FilePath (Get-Command node).Source -ArgumentList 'scripts/serve-site.mjs' -WorkingDirectory $PWD.Path -WindowStyle Hidden -RedirectStandardOutput server.local.log -RedirectStandardError server-error.local.log }
Write-Output 'SITE http://127.0.0.1:4174'
