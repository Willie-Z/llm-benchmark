[CmdletBinding()]
param(
    [string]$PackageVersion = "1.0.0"
)

$ErrorActionPreference = "Stop"
$PackageVersion = $PackageVersion.Trim()
if ($PackageVersion.StartsWith("v")) {
    $PackageVersion = $PackageVersion.Substring(1)
}
if (-not $env:GOPROXY) {
    $env:GOPROXY = "https://goproxy.cn"
}
if (-not $env:GOSUMDB) {
    $env:GOSUMDB = "sum.golang.google.cn"
}

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$BackendSpec = Join-Path $Root "serve.spec"
$ServiceDir = Join-Path $PSScriptRoot "service"
$DistDir = Join-Path $PSScriptRoot "dist"
$ServiceExe = Join-Path $DistDir "starflow-backend-service.exe"

New-Item -ItemType Directory -Force -Path $DistDir | Out-Null

python -m PyInstaller --clean --noconfirm --distpath "$Root\dist" $BackendSpec
if ($LASTEXITCODE -ne 0) {
    throw "PyInstaller build failed with exit code $LASTEXITCODE"
}

Push-Location $ServiceDir
try {
    go mod download
    if ($LASTEXITCODE -ne 0) { throw "go mod download failed" }
    go vet .
    if ($LASTEXITCODE -ne 0) { throw "go vet failed" }
    go test .
    if ($LASTEXITCODE -ne 0) { throw "go test failed" }
    go build -trimpath -buildvcs=false -ldflags "-s -w" -o $ServiceExe .
    if ($LASTEXITCODE -ne 0) { throw "go build failed" }
}
finally {
    Pop-Location
}

$ISCC = @(
    (Join-Path ${env:ProgramFiles(x86)} "Inno Setup 6\ISCC.exe"),
    (Join-Path $env:ProgramFiles "Inno Setup 6\ISCC.exe")
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $ISCC) {
    throw "Inno Setup 6 compiler (ISCC.exe) was not found"
}

& $ISCC "/DPackageVersion=$PackageVersion" (Join-Path $PSScriptRoot "installer.iss")
if ($LASTEXITCODE -ne 0) {
    throw "Inno Setup build failed with exit code $LASTEXITCODE"
}

$Installer = Join-Path $DistDir ("starflow-backend-{0}-windows-x64-setup.exe" -f $PackageVersion)
if (-not (Test-Path $Installer)) {
    throw "Expected installer was not created: $Installer"
}
Write-Output $Installer
