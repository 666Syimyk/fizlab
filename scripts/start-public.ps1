$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
& ./scripts/start-site.ps1
$taskTunnel = Join-Path $PWD 'tools.local/cloudflared.exe'
if (-not (Test-Path $taskTunnel)) {
  New-Item -ItemType Directory -Path tools.local -Force | Out-Null
  $ProgressPreference = 'SilentlyContinue'
  Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile $taskTunnel -TimeoutSec 60 -UseBasicParsing
}
Start-Process -FilePath $taskTunnel -ArgumentList 'tunnel --url http://127.0.0.1:4174 --protocol http2' -WorkingDirectory $PWD.Path -WindowStyle Hidden -RedirectStandardOutput tunnel.local.log -RedirectStandardError tunnel-error.local.log
for ($taskAttempt=0; $taskAttempt -lt 30; $taskAttempt++) {
  Start-Sleep -Seconds 1
  $taskLog = Get-Content -Raw tunnel-error.local.log -ErrorAction SilentlyContinue
  if ($taskLog -match 'https://[a-z0-9-]+\.trycloudflare\.com') {
    $taskAddress = $Matches[0]
    @{ url=$taskAddress } | ConvertTo-Json | Set-Content -Encoding UTF8 public-site.local.json
    Write-Output "PUBLIC $taskAddress"
    exit 0
  }
}
Get-Content tunnel-error.local.log -Tail 8
throw 'Tunnel did not return a public URL'
