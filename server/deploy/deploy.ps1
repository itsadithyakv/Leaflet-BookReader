<#
.SYNOPSIS
  Ships server/ to the Oracle VM and restarts leaflet-api.

.DESCRIPTION
  Packs server/ (without node_modules, .env, tests or logs), copies it to the VM
  with scp, then over ssh unpacks it into /opt/leaflet-api, runs
  `npm ci --omit=dev`, installs the systemd unit and restarts the service.

  Idempotent: safe to run again for every release. It never touches /var/www,
  the Caddyfile or any existing Caddy site block, and it never writes
  /etc/leaflet-api.env (create that once by hand; see server/README.md).

.EXAMPLE
  ./deploy.ps1 -Host 203.0.113.10 -KeyPath ~/.ssh/oracle.key
#>
param(
  [Parameter(Mandatory = $true)][Alias("Host")][string]$HostName,
  [Parameter(Mandatory = $true)][string]$KeyPath,
  [string]$User = "ubuntu",
  [string]$RemoteDir = "/opt/leaflet-api"
)

$ErrorActionPreference = "Stop"

$serverDir = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $serverDir "package-lock.json"))) {
  throw "package-lock.json is missing in $serverDir; npm ci needs it."
}
if (-not (Test-Path $KeyPath)) {
  throw "SSH key not found: $KeyPath"
}

$stamp = Get-Date -Format "yyyyMMddHHmmss"
$archive = Join-Path ([System.IO.Path]::GetTempPath()) "leaflet-api-$stamp.tgz"
$remoteArchive = "/tmp/leaflet-api-$stamp.tgz"
$target = "$User@$HostName"
$sshOptions = @("-i", $KeyPath, "-o", "StrictHostKeyChecking=accept-new")

Write-Host "Packing $serverDir"
# Windows 10+ ships bsdtar as tar.exe.
& tar.exe -czf $archive -C $serverDir `
  --exclude=node_modules --exclude=.env --exclude=test --exclude=*.log `
  package.json package-lock.json src deploy
if ($LASTEXITCODE -ne 0) { throw "tar failed" }

try {
  Write-Host "Copying to $target"
  & scp.exe @sshOptions $archive "${target}:$remoteArchive"
  if ($LASTEXITCODE -ne 0) { throw "scp failed" }

  # Runs on the VM. Every step tolerates being run again.
  $remote = @"
set -euo pipefail
ARCHIVE='$remoteArchive'
DEST='$RemoteDir'

id leaflet >/dev/null 2>&1 || sudo useradd --system --home-dir /nonexistent --shell /usr/sbin/nologin leaflet
test -f /etc/leaflet-api.env || { echo 'Missing /etc/leaflet-api.env -- create it first (see server/README.md).' >&2; exit 1; }

STAGE=`$(mktemp -d)
tar -xzf "`$ARCHIVE" -C "`$STAGE"
cd "`$STAGE"
npm ci --omit=dev --no-audit --no-fund

sudo mkdir -p "`$DEST"
sudo rsync -a --delete "`$STAGE"/ "`$DEST"/ 2>/dev/null || { sudo rm -rf "`$DEST".new && sudo cp -a "`$STAGE" "`$DEST".new && sudo rm -rf "`$DEST" && sudo mv "`$DEST".new "`$DEST"; }
sudo chown -R root:root "`$DEST"
sudo chmod -R go-w "`$DEST"
sudo chmod -R o+rX "`$DEST"

sudo install -m 644 "`$DEST/deploy/leaflet-api.service" /etc/systemd/system/leaflet-api.service
sudo systemctl daemon-reload
sudo systemctl enable leaflet-api >/dev/null
sudo systemctl restart leaflet-api

rm -rf "`$STAGE" "`$ARCHIVE"

# Connecting to MongoDB and building indexes takes a few seconds, so wait for
# the health check (up to 30 s) rather than a fixed pause. If the service
# stops instead (it restarts itself every 5 s), show why.
for attempt in `$(seq 1 30); do
  if curl -fsS http://127.0.0.1:8787/health >/dev/null 2>&1; then
    echo 'leaflet-api is up: http://127.0.0.1:8787/health answers {"ok":true}'
    sudo journalctl -u leaflet-api -n 3 --no-pager -o cat
    exit 0
  fi
  systemctl is-active --quiet leaflet-api || break
  sleep 1
done
echo '' >&2
echo 'leaflet-api did not come up. Its last log lines:' >&2
sudo journalctl -u leaflet-api -n 25 --no-pager -o cat >&2
exit 1
"@
  # ssh via bash -s so the script is not mangled by quoting; strip CRs.
  Write-Host "Installing on $target"
  $remote.Replace("`r", "") | & ssh.exe @sshOptions $target "bash -s"
  if ($LASTEXITCODE -ne 0) { throw "remote install failed" }
}
finally {
  Remove-Item $archive -ErrorAction SilentlyContinue
}
