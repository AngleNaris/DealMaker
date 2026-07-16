# Thin wrapper: single source is ./VERSION (see sync_version.js)
param([string]$Version = "")
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root
if ($Version) {
  node "$Root\sync_version.js" $Version
} else {
  node "$Root\sync_version.js"
}
if ($LASTEXITCODE -ne 0) { throw "sync_version.js failed" }
