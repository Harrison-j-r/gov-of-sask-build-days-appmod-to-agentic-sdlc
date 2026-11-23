#requires -Version 7.4
[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string] $Url,
    [Parameter(Mandatory)] [string] $Sha256,
    [Parameter(Mandatory)] [string] $Destination
)

$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'Modernization.psm1') -Force -DisableNameChecking
$version = (Get-ModernizationConfig).modernizeVersion
Assert-ReleasePin $Url $Sha256 $version
if (Test-Path -LiteralPath $Destination) { throw 'Modernize installation requires a new task-owned directory.' }
New-Item -ItemType Directory -Path $Destination | Out-Null
$name = ([uri] $Url).Segments[-1]
$archive = Join-Path $Destination $name
Invoke-WebRequest -Uri $Url -OutFile $archive -MaximumRedirection 5 -TimeoutSec 120
if ((Get-ContentHash $archive) -cne $Sha256) { throw 'Modernize release digest mismatch; refusing extraction or execution.' }
$expanded = Join-Path $Destination 'expanded'
New-Item -ItemType Directory -Path $expanded | Out-Null
if ($name.EndsWith('.zip')) {
    $zip = [IO.Compression.ZipFile]::OpenRead($archive)
    try {
        foreach ($entry in $zip.Entries) {
            $entryName = $entry.FullName.TrimEnd('/')
            if ($entryName) { Assert-RepositoryPath $entryName }
            if ((($entry.ExternalAttributes -shr 16) -band 0xF000) -eq 0xA000) {
                throw 'Modernize ZIP contains an unsupported symbolic link.'
            }
        }
    }
    finally { $zip.Dispose() }
    Expand-Archive -LiteralPath $archive -DestinationPath $expanded
}
elseif ($name.EndsWith('.tar.gz')) {
    $entries = & tar -tzf $archive
    if ($LASTEXITCODE -ne 0) { throw 'Unable to inspect the pinned archive.' }
    foreach ($entry in $entries) {
        $entryName = ($entry -replace '^\./', '').TrimEnd('/')
        if ($entryName) { Assert-RepositoryPath $entryName }
    }
    & tar -xzf $archive -C $expanded
    if ($LASTEXITCODE -ne 0) { throw 'Pinned archive extraction failed.' }
}
elseif ($IsWindows) {
    $process = Start-Process msiexec.exe -ArgumentList @('/a', "`"$archive`"", '/qn', "TARGETDIR=`"$expanded`"") -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw "MSI administrative extraction failed: $($process.ExitCode)." }
}
else { throw 'MSI extraction requires Windows.' }
$executableName = if ($IsWindows) { 'modernize.exe' } else { 'modernize' }
$executables = @(Get-ChildItem -LiteralPath $expanded -Recurse -File -Filter $executableName)
if ($executables.Count -ne 1) { throw 'Expected exactly one Modernize executable in the pinned distribution.' }
$executable = $executables[0].FullName
$actual = (& $executable --version | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $actual -cnotmatch ('^' + [regex]::Escape($version) + '(?:\+[a-zA-Z0-9.]+)?$')) {
    throw 'Installed Modernize version does not match the approved pin.'
}
if ($env:GITHUB_PATH) { Add-Content -LiteralPath $env:GITHUB_PATH -Value $executables[0].DirectoryName -Encoding utf8 }
Write-Output "Verified Modernize $version."
