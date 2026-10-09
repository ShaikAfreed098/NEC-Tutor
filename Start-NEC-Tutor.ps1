$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (!(Test-Path -LiteralPath '.env.local')) { Copy-Item -LiteralPath '.env.example' -Destination '.env.local' }
if (!(Test-Path -LiteralPath 'node_modules')) { & npm.cmd install; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } }
if (!(Test-Path -LiteralPath '.data\catalog.json')) { & npm.cmd run import:materials -- --ocr; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } }
Write-Host 'NEC Tutor will open at http://127.0.0.1:3000'
& npm.cmd run dev
