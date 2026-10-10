<#
.SYNOPSIS
  Packages Leaflet as an MSIX for the Microsoft Store.

.DESCRIPTION
  1. Builds the release exe with `tauri build --no-bundle` (unless -SkipBuild).
  2. Stages the exe, the Store logos and AppxManifest.xml (version filled in).
  3. Indexes the logos into resources.pri with makepri.exe.
  4. Packs with makeappx.exe into apps\src-tauri\target\msix\.

  The Store signs submissions itself, so the package is left unsigned unless you
  pass -CertificatePath to sideload-test it locally (see docs/release-msix.md).

.EXAMPLE
  .\build-msix.ps1                       # full release build + package
  .\build-msix.ps1 -SkipBuild            # package the exe you already built
  .\build-msix.ps1 -SkipBuild -Configuration debug   # validate the manifest quickly
#>
param(
  [switch]$SkipBuild,
  [ValidateSet("release", "debug")]
  [string]$Configuration = "release",
  # A .pfx whose subject matches the manifest Publisher, for local sideload tests only.
  [string]$CertificatePath,
  [string]$CertificatePassword
)

$ErrorActionPreference = "Stop"
$here = $PSScriptRoot
$tauriDir = Split-Path -Parent $here
$appsDir = Split-Path -Parent $tauriDir

# The values compiled into the binary can be kept in `build.env`, beside this
# script, so that a release build is one command and none of them has to be
# typed into the window each time. Git ignores that file (it holds the Google
# client secret); `build.env.example` is its pattern. Only the names below are
# read from it, a value already set in this window wins, and what is printed
# is the names, never the values.
$fromFile = @("LEAFLET_GOOGLE_CLIENT_ID", "LEAFLET_GOOGLE_CLIENT_SECRET", "VITE_ENABLE_ACCOUNTS", "VITE_ENABLE_COMMUNITY", "LEAFLET_API_BASE")
$envFile = Join-Path $here "build.env"
if (Test-Path $envFile) {
  $taken = @()
  foreach ($line in Get-Content $envFile) {
    if ($line -match '^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$') {
      $name = $Matches[1]
      $value = $Matches[2].Trim('"').Trim("'")
      if (($fromFile -contains $name) -and $value -and -not [Environment]::GetEnvironmentVariable($name)) {
        [Environment]::SetEnvironmentVariable($name, $value, "Process")
        $taken += $name
      }
    }
  }
  if ($taken.Count -gt 0) {
    Write-Host "From build.env: $($taken -join ', ')"
  }
}

# Values compiled into the binary. Missing ones do not stop the build, but the
# feature they drive will be off in the package, so say so loudly.
$compiledIn = @{
  "LEAFLET_GOOGLE_CLIENT_ID"     = "Google Drive backup will be unavailable."
  "LEAFLET_GOOGLE_CLIENT_SECRET" = "Google Drive sign-in will fail for desktop clients."
  "VITE_ENABLE_ACCOUNTS"         = "The Account card will be hidden (set it to 'true' to ship accounts)."
  "VITE_ENABLE_COMMUNITY"        = "The Social tab's leaderboards and duels will be hidden (set it to 'true' to ship them)."
}
foreach ($name in $compiledIn.Keys) {
  if (-not [Environment]::GetEnvironmentVariable($name)) {
    Write-Warning "$name is not set. $($compiledIn[$name])"
  }
}

if (-not $SkipBuild) {
  if ($Configuration -ne "release") {
    throw "A build is always a release build; use -SkipBuild -Configuration debug to package an existing debug exe."
  }
  # Compiles out the Calibre auto-installer (Store policy: no downloaded code).
  $env:LEAFLET_STORE_BUILD = "1"
  Push-Location $appsDir
  try {
    npm run tauri build -- --no-bundle
    if ($LASTEXITCODE -ne 0) { throw "tauri build failed with exit code $LASTEXITCODE." }
  } finally {
    Pop-Location
  }
}

$exe = Join-Path $tauriDir "target\$Configuration\leaflet.exe"
if (-not (Test-Path $exe)) { throw "No exe at $exe. Build first, or drop -SkipBuild." }

# The Store needs a four-part version whose last part is 0.
$conf = Get-Content (Join-Path $tauriDir "tauri.conf.json") -Raw | ConvertFrom-Json
$parts = @($conf.version.Split(".") | ForEach-Object { [int]$_ })
while ($parts.Count -lt 3) { $parts += 0 }
$version = "{0}.{1}.{2}.0" -f $parts[0], $parts[1], $parts[2]

$makeappx = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\makeappx.exe" -ErrorAction SilentlyContinue |
  Sort-Object FullName -Descending | Select-Object -First 1
if (-not $makeappx) { throw "makeappx.exe not found. Install the Windows 10/11 SDK (App packaging tools)." }
# From the same SDK folder, so both tools are one version.
$makepri = Join-Path (Split-Path $makeappx.FullName) "makepri.exe"
if (-not (Test-Path $makepri)) { throw "makepri.exe not found next to $($makeappx.FullName)." }

# Stage.
$stage = Join-Path $tauriDir "target\msix\stage"
$outDir = Join-Path $tauriDir "target\msix"
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path (Join-Path $stage "Assets") | Out-Null
Copy-Item $exe (Join-Path $stage "leaflet.exe")

$icons = Join-Path $tauriDir "icons"
foreach ($logo in "StoreLogo.png", "Square44x44Logo.png", "Square150x150Logo.png", "Square310x310Logo.png", "Wide310x150Logo.png") {
  Copy-Item (Join-Path $icons $logo) (Join-Path $stage "Assets\$logo")
}
# Taskbar, Start and Explorer icons (from msix\windows-icons.py). Without the
# unplated variants Windows draws the 44x44 logo shrunk onto an accent plate.
$targetSizes = @(Get-ChildItem (Join-Path $icons "Square44x44Logo.targetsize-*.png"))
if ($targetSizes.Count -eq 0) { throw "No Square44x44Logo.targetsize-* icons in $icons. Run msix\windows-icons.py." }
$targetSizes | Copy-Item -Destination (Join-Path $stage "Assets")
# Pip on reading-reminder toasts (ms-appx:///Assets/PipToast.png, used by
# src\reminders\toast.rs). A packaged app's AppData is virtualised, so the toast
# cannot point at a file the app writes there; it has to ship in the package.
Copy-Item (Join-Path $appsDir "src\assets\pip\pip-256.png") (Join-Path $stage "Assets\PipToast.png")

$largeTiles = ' Wide310x150Logo="Assets\Wide310x150Logo.png" Square310x310Logo="Assets\Square310x310Logo.png"'
$manifest = (Get-Content (Join-Path $here "AppxManifest.xml") -Raw).
  Replace("__VERSION__", $version).
  Replace("__LARGE_TILE_ATTRS__", $largeTiles)
Set-Content -Path (Join-Path $stage "AppxManifest.xml") -Value $manifest -Encoding UTF8

# Windows only finds qualified files such as *.targetsize-24_altform-unplated.png
# through resources.pri; without it every surface gets the plain 44x44 logo.
# The config stays outside the stage so it is neither indexed nor packed.
$priConfig = Join-Path $outDir "priconfig.xml"
& $makepri createconfig /cf $priConfig /dq en-US /pv 10.0.0 /o | Out-Null
if ($LASTEXITCODE -ne 0) { throw "makepri createconfig failed with exit code $LASTEXITCODE." }
& $makepri new /pr $stage /cf $priConfig /mn (Join-Path $stage "AppxManifest.xml") /of (Join-Path $stage "resources.pri") /o
if ($LASTEXITCODE -ne 0) { throw "makepri new failed with exit code $LASTEXITCODE." }

# Pack. makeappx validates the manifest against the schema here.
$package = Join-Path $outDir "Leaflet_${version}_x64.msix"
if (Test-Path $package) { Remove-Item $package -Force }
& $makeappx.FullName pack /d $stage /p $package /o
if ($LASTEXITCODE -ne 0) { throw "makeappx failed with exit code $LASTEXITCODE." }

if ($CertificatePath) {
  $signtool = Join-Path (Split-Path $makeappx.FullName) "signtool.exe"
  & $signtool sign /fd SHA256 /f $CertificatePath /p $CertificatePassword $package
  if ($LASTEXITCODE -ne 0) { throw "signtool failed with exit code $LASTEXITCODE." }
  Write-Host "Signed for local testing. Do not upload this signed copy's certificate anywhere."
}

Write-Host ""
Write-Host "Package: $package"
Write-Host "Version: $version"
