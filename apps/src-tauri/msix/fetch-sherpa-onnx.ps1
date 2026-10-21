<#
.SYNOPSIS
  Puts the Studio voice's native code for Android (sherpa-onnx 1.13.8 and its
  ONNX Runtime) where the Android build packs it from.

.DESCRIPTION
  The build never downloads anything for the Studio voice: this script does,
  once, by hand. It takes sherpa-onnx's official Android archive (the AAR of
  the v1.13.8 release, from GitHub) or a copy of it you already have
  (-Aar), takes out the two libraries the voice needs for each ABI, checks
  each against its SHA-256 below (the same list app/build.gradle.kts checks
  at every build), and writes them to

    apps\src-tauri\gen\android\vendor\sherpa-onnx-1.13.8\<abi>\<abi>\

  which git ignores. Without them the app builds and runs as before, with no
  Studio voice on Android (ReadAloud lists only the phone's own voices).

  arm64-v8a is the phone build's ABI. -Emulator adds x86_64, for a debug build
  on the x86_64 emulator (packed into debug builds only).

  sherpa-onnx 1.x compiles espeak-ng (GPL-3.0) in. Release builds leave these
  libraries out unless LEAFLET_STUDIO_VOICE=1 is set: don't set it for a Store
  build until Leaflet moves to sherpa-onnx 2.0, which drops espeak-ng (see
  docs\android.md, "Studio voice").

.EXAMPLE
  .\fetch-sherpa-onnx.ps1                 # arm64, downloading the AAR (50 MB)
  .\fetch-sherpa-onnx.ps1 -Emulator       # arm64 and x86_64
  .\fetch-sherpa-onnx.ps1 -Aar C:\dl\sherpa-onnx-1.13.8.aar -Emulator
#>
param(
  # A copy of sherpa-onnx-1.13.8.aar already on this PC (else it is downloaded).
  [string]$Aar,
  # Also x86_64, for the emulator.
  [switch]$Emulator
)

$ErrorActionPreference = "Stop"
$version = "1.13.8"
$url = "https://github.com/k2-fsa/sherpa-onnx/releases/download/v$version/sherpa-onnx-$version.aar"
# The AAR as it was on 2026-10-20. GitHub release files can be uploaded again
# (the per-library hashes are the ones that matter): a different AAR is only
# a warning, a different library is an error.
$aarSha = "633c24321e06b1fe79feafa03ea16cbc0f8a286641e2da3559bac91bdb13bd96"
$libs = @{
  "arm64-v8a/libonnxruntime.so"     = "33847ad43bffe204699fd4a27f7f3603452a8cdaf2f9a44983a0bc31ffcf2da1"
  "arm64-v8a/libsherpa-onnx-jni.so" = "3c6492ea91ea68fd3b72b9495efdde6dd913f6b58c387e3b07389cf335f4d26f"
  "x86_64/libonnxruntime.so"        = "087e84297cad64acb823c3d901d6e0cc934e91add7cdb20da802cd1c0bea5c3e"
  "x86_64/libsherpa-onnx-jni.so"    = "1dc24c88fb364f1022a5217b70ab3bc3c9cae3120ae2e1ed358e1f68ed120b04"
}
$abis = @("arm64-v8a")
if ($Emulator) { $abis += "x86_64" }

$here = $PSScriptRoot
$dest = Join-Path (Split-Path -Parent $here) "gen\android\vendor\sherpa-onnx-$version"

$temp = $null
if (-not $Aar) {
  $temp = Join-Path ([IO.Path]::GetTempPath()) ("sherpa-onnx-" + [Guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Force $temp | Out-Null
  $Aar = Join-Path $temp "sherpa-onnx-$version.aar"
  Write-Host "Downloading sherpa-onnx $version for Android (about 50 MB)..."
  $progress = $ProgressPreference
  $ProgressPreference = "SilentlyContinue"
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $url -OutFile $Aar -UserAgent "Mozilla/5.0" -UseBasicParsing
  } finally {
    $ProgressPreference = $progress
  }
}
if (-not (Test-Path $Aar)) { throw "No AAR at $Aar." }
$got = (Get-FileHash -Algorithm SHA256 $Aar).Hash.ToLowerInvariant()
if ($got -ne $aarSha) {
  Write-Warning "The AAR is not the one checked on 2026-10-20 (it may have been uploaded again); checking each library instead."
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead((Resolve-Path $Aar))
try {
  foreach ($abi in $abis) {
    foreach ($name in @("libonnxruntime.so", "libsherpa-onnx-jni.so")) {
      $key = "$abi/$name"
      $entry = $zip.GetEntry("jni/$key")
      if (-not $entry) { throw "The AAR has no jni/$key." }
      # <dest>\<abi>\<abi>\lib.so: each ABI is its own jniLibs folder (build.gradle.kts).
      $folder = Join-Path $dest "$abi\$abi"
      New-Item -ItemType Directory -Force $folder | Out-Null
      $out = Join-Path $folder $name
      $part = "$out.part"
      $stream = $entry.Open()
      try {
        $file = [IO.File]::Create($part)
        try { $stream.CopyTo($file) } finally { $file.Dispose() }
      } finally {
        $stream.Dispose()
      }
      $sha = (Get-FileHash -Algorithm SHA256 $part).Hash.ToLowerInvariant()
      if ($sha -ne $libs[$key]) {
        Remove-Item $part -Force
        throw "$key from the AAR is not the expected one (SHA-256 $sha)."
      }
      Move-Item -Force $part $out
      Write-Host ("{0,-32} {1,10:N0} bytes  ok" -f $key, (Get-Item $out).Length)
    }
  }
} finally {
  $zip.Dispose()
  if ($temp) { Remove-Item -Recurse -Force $temp }
}
Write-Host "Done: $dest"
