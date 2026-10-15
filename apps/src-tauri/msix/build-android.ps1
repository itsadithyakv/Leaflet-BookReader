<#
.SYNOPSIS
  Builds Leaflet for Android with the same compiled-in values as the Store build.

.DESCRIPTION
  Reads `build.env` (beside this script, the file build-msix.ps1 reads) for the
  Google Drive client and the account and community switches, finds the Android
  SDK, the NDK and JDK 21, and runs `tauri android build`. Prints the names of
  the values it took, never the values.

  The output is in apps\src-tauri\gen\android\app\build\outputs\. A debug APK
  is signed with Android's debug key and installs on any phone with USB
  debugging; a release build is unsigned until the upload key is set up (the
  owner's, like the Store's).

.EXAMPLE
  .\build-android.ps1                         # debug APK for a phone (arm64)
  .\build-android.ps1 -Target x86_64          # debug APK for the emulator
  .\build-android.ps1 -Release                # release APK and AAB (unsigned)
#>
param(
  [ValidateSet("aarch64", "armv7", "x86_64", "i686")]
  [string]$Target = "aarch64",
  [switch]$Release,
  # Another build.env to read (by default the one beside this script, or the
  # main checkout's when this is a git worktree, which has none of its own).
  [string]$EnvFile
)

$ErrorActionPreference = "Stop"
$here = $PSScriptRoot
$tauriDir = Split-Path -Parent $here
$appsDir = Split-Path -Parent $tauriDir

# The same names, file and rules as build-msix.ps1: only these are read, a
# value already set in this window wins, and only the names are printed.
$fromFile = @("LEAFLET_GOOGLE_CLIENT_ID", "LEAFLET_GOOGLE_CLIENT_SECRET", "VITE_ENABLE_ACCOUNTS", "VITE_ENABLE_COMMUNITY", "LEAFLET_API_BASE")
# (Not $envFile: PowerShell names ignore case, and that is the -EnvFile parameter.)
$envPath = if ($EnvFile) { $EnvFile } else { Join-Path $here "build.env" }
if (-not $EnvFile -and -not (Test-Path $envPath)) {
  # Git ignores build.env, so a worktree has none: use the main checkout's.
  $common = git -C $here rev-parse --path-format=absolute --git-common-dir 2>$null
  if ($LASTEXITCODE -eq 0 -and $common) {
    $mainFile = Join-Path (Split-Path -Parent $common) "apps\src-tauri\msix\build.env"
    if (Test-Path $mainFile) {
      $envPath = $mainFile
      Write-Host "Using the main checkout's build.env."
    }
  }
}
if (Test-Path $envPath) {
  $taken = @()
  foreach ($line in Get-Content $envPath) {
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
} else {
  Write-Warning "No build.env beside this script ($here). See build.env.example."
}

$compiledIn = @{
  "LEAFLET_GOOGLE_CLIENT_ID"     = "Google Drive will be unavailable on the phone."
  "LEAFLET_GOOGLE_CLIENT_SECRET" = "Google Drive sign-in will fail with the desktop client."
  "VITE_ENABLE_ACCOUNTS"         = "The Account card will be hidden (set it to 'true' to ship accounts)."
  "VITE_ENABLE_COMMUNITY"        = "The Social tab's community will be hidden (set it to 'true' to ship it)."
}
foreach ($name in $compiledIn.Keys) {
  if (-not [Environment]::GetEnvironmentVariable($name)) {
    Write-Warning "$name is not set. $($compiledIn[$name])"
  }
}

# The Android tools, where Android Studio's installer and docs/mobile.md put
# them; a value already set in this window wins.
if (-not $env:ANDROID_HOME) { $env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA "Android\Sdk" }
if (-not (Test-Path $env:ANDROID_HOME)) { throw "No Android SDK at $env:ANDROID_HOME. Set ANDROID_HOME." }
if (-not $env:NDK_HOME) {
  $ndk = Get-ChildItem (Join-Path $env:ANDROID_HOME "ndk") -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 1
  if (-not $ndk) { throw "No NDK under $env:ANDROID_HOME\ndk. Install one with sdkmanager, or set NDK_HOME." }
  $env:NDK_HOME = $ndk.FullName
}
# Gradle needs JDK 17 or 21; the `java` on the PATH may be newer and is not used.
if (-not $env:JAVA_HOME -or -not (Test-Path (Join-Path $env:JAVA_HOME "bin\java.exe"))) {
  $jdk = Get-ChildItem (Join-Path $env:LOCALAPPDATA "Programs\jdk21") -Directory -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $jdk) { throw "No JDK 21 under $env:LOCALAPPDATA\Programs\jdk21. Set JAVA_HOME to a JDK 17 or 21." }
  $env:JAVA_HOME = $jdk.FullName
}
$env:PATH = "$(Join-Path $env:JAVA_HOME 'bin');$env:PATH"
Write-Host "Android SDK: $env:ANDROID_HOME"
Write-Host "NDK: $env:NDK_HOME"
Write-Host "JDK: $env:JAVA_HOME"

$arguments = @("android", "build", "--target", $Target)
if ($Release) {
  $arguments += @("--apk", "--aab")
} else {
  $arguments += @("--apk", "--debug")
}

Push-Location $appsDir
try {
  npm run tauri -- @arguments
  if ($LASTEXITCODE -ne 0) { throw "tauri android build failed with exit code $LASTEXITCODE." }
} finally {
  Pop-Location
}

$outputs = Join-Path $tauriDir "gen\android\app\build\outputs"
Get-ChildItem $outputs -Recurse -Include *.apk, *.aab | Sort-Object LastWriteTime -Descending | Select-Object -First 3 | ForEach-Object {
  Write-Host "Built: $($_.FullName) ($([math]::Round($_.Length / 1MB)) MB)"
}
