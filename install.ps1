# Clawterm installer for Windows
# Usage: irm https://raw.githubusercontent.com/clawterm/clawterm/main/install.ps1 | iex

$ErrorActionPreference = 'Stop'
$Repo = 'clawterm/clawterm'
$AppName = 'Clawterm'

function Info($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Warn($msg) { Write-Host "==> $msg" -ForegroundColor Yellow }
function Err($msg) { Write-Host "error: $msg" -ForegroundColor Red; exit 1 }

# Uninstall mode
if ($args -contains '--uninstall') {
    Info "Uninstalling $AppName..."
    $uninstallKey = Get-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue |
        Where-Object { $_.DisplayName -like "*$AppName*" }
    if ($uninstallKey) {
        Info "Running uninstaller..."
        Start-Process -FilePath $uninstallKey.UninstallString -Wait
    } else {
        Warn "No installed version found in registry."
    }
    $configDir = Join-Path $env:APPDATA 'clawterm'
    if (Test-Path $configDir) {
        $answer = Read-Host "Remove config at $configDir? [y/N]"
        if ($answer -eq 'y' -or $answer -eq 'Y') {
            Remove-Item -Recurse -Force $configDir
            Info "Removed $configDir"
        } else {
            Info "Config preserved at $configDir"
        }
    }
    Info "$AppName has been uninstalled."
    exit 0
}

# Fetch latest release
Info "Fetching latest release..."
$release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest"
$tag = $release.tag_name
$version = $tag -replace '^v', ''
Info "Latest release: $tag"

# Find the Windows installer asset
$asset = $release.assets | Where-Object { $_.name -match 'x64-setup\.exe$' } | Select-Object -First 1
if (-not $asset) { Err "No Windows installer found in release $tag" }

$fileName = $asset.name
$url = $asset.browser_download_url

# Download
$tmpDir = Join-Path ([System.IO.Path]::GetTempPath()) "clawterm-install"
New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null
$outPath = Join-Path $tmpDir $fileName

Info "Downloading $fileName..."
Invoke-WebRequest -Uri $url -OutFile $outPath -UseBasicParsing

# Verify checksum against the per-target file published by the release workflow.
$sumsFile = 'checksums-x86_64-pc-windows-msvc.txt'
$sumsUrl = "https://github.com/$Repo/releases/download/$tag/$sumsFile"
try {
    $sums = Invoke-WebRequest -Uri $sumsUrl -UseBasicParsing -ErrorAction Stop
    $escaped = [regex]::Escape($fileName)
    $expected = ($sums.Content -split "`n" |
        Where-Object { $_ -match "\s$escaped\s*$" } |
        ForEach-Object { ($_ -split '\s+')[0] } |
        Select-Object -First 1)
    if ($expected) {
        Info "Verifying checksum..."
        $actual = (Get-FileHash -Path $outPath -Algorithm SHA256).Hash.ToLower()
        if ($expected.ToLower() -ne $actual) {
            Err "Checksum mismatch! Expected $expected, got $actual."
        }
        Info "Checksum verified."
    } else {
        Warn "Asset not found in $sumsFile - skipping verification."
    }
} catch {
    Warn "$sumsFile not available - skipping checksum verification."
}

# Run installer
Info "Running installer..."
Start-Process -FilePath $outPath -Wait

# Cleanup
Remove-Item -Recurse -Force $tmpDir -ErrorAction SilentlyContinue

Info "Done! $AppName $version is installed."
