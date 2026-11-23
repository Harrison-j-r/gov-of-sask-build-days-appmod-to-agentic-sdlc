#requires -Version 7.4
[CmdletBinding()]
param(
    [string] $Root = (Join-Path $PSScriptRoot '..\..'),
    [Parameter(Mandatory)] [string] $EvidenceDirectory
)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot '..\modernization\Modernization.psm1') -Force -DisableNameChecking
if (-not $IsWindows) { throw 'BookCatalog target smoke validation requires Windows and disposable LocalDB.' }
if ((Get-ValidationProfile $Root dotnet) -cne 'target') { throw 'BookCatalog must target net10.0 ASP.NET Core and EF Core.' }
$sdks = (& dotnet --list-sdks | Out-String)
if ($LASTEXITCODE -ne 0 -or $sdks -notmatch '(?m)^10\.') { throw 'The .NET 10 SDK is required.' }
$source = Resolve-RepositoryPath $Root (Get-ModernizationTrack dotnet).source
$solution = Join-Path $source 'BookCatalog.sln'
& dotnet restore $solution --nologo
if ($LASTEXITCODE -ne 0) { throw "BookCatalog restore failed: $LASTEXITCODE." }
& dotnet build $solution -c Release --no-restore --nologo
if ($LASTEXITCODE -ne 0) { throw "BookCatalog Release build failed: $LASTEXITCODE." }
$testProjects = @(Get-ChildItem -LiteralPath $source -Recurse -File -Filter '*.csproj' |
    Where-Object { $_.FullName -notmatch '[\\/](obj|bin|packages)[\\/]' } |
    Where-Object {
        $xml = Read-SafeXml $_.FullName
        $xml.SelectSingleNode("//*[local-name()='IsTestProject' and text()='true']") -or
            $xml.SelectSingleNode("//*[local-name()='PackageReference' and @Include='Microsoft.NET.Test.Sdk']")
    })
$unitTests = 0
if ($testProjects.Count) {
    $results = Join-Path $EvidenceDirectory 'trx'
    & dotnet test $solution -c Release --no-build --no-restore --logger trx --results-directory $results
    if ($LASTEXITCODE -ne 0) { throw "BookCatalog tests failed: $LASTEXITCODE." }
    foreach ($file in @(Get-ChildItem -LiteralPath $results -File -Filter '*.trx')) {
        $xml = Read-SafeXml $file.FullName
        $counters = $xml.SelectSingleNode("//*[local-name()='Counters']")
        if ($null -eq $counters -or [int] $counters.GetAttribute('failed') -ne 0 -or
            $counters.GetAttribute('executed') -cne $counters.GetAttribute('passed')) {
            throw 'BookCatalog test results contain failures or unexecuted cases.'
        }
        $unitTests += [int] $counters.GetAttribute('executed')
    }
    if ($unitTests -eq 0) { throw 'Test projects were present but no executed test evidence was produced.' }
}
& (Join-Path $PSScriptRoot 'Test-BookCatalogSmoke.ps1') -Root $Root
if (-not $?) { throw 'BookCatalog behavior smoke check failed.' }
Write-JsonFile (Join-Path $EvidenceDirectory 'validation.json') ([ordered]@{
    schemaVersion = 1; track = 'dotnet'; outcome = 'passed'; unitTests = $unitTests
    summary = "net10.0 Release build and synthetic LocalDB HTTP/CRUD/validation/antiforgery/restart-persistence smoke checks passed. Executed unit tests: $unitTests (zero is not claimed as unit-test coverage)."
})
