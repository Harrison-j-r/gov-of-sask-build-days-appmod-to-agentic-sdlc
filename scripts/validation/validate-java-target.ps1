#requires -Version 7.4
[CmdletBinding()]
param(
    [string] $Root = (Join-Path $PSScriptRoot '..\..'),
    [Parameter(Mandatory)] [string] $EvidenceDirectory
)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot '..\modernization\Modernization.psm1') -Force -DisableNameChecking
if ((Get-ValidationProfile $Root java) -cne 'target') { throw 'Java target validation requires Java 21 and Spring Boot 3.' }
$version = (& java -version 2>&1 | Out-String)
if ($LASTEXITCODE -ne 0 -or $version -notmatch 'version "21(?:\.|")') { throw 'Select JDK 21 before running the target gate.' }
$source = Resolve-RepositoryPath $Root (Get-ModernizationTrack java).source
$wrapper = Join-Path $source $(if ($IsWindows) { 'mvnw.cmd' } else { 'mvnw' })
Push-Location $source
try {
    if ($IsWindows) { & $wrapper -B -ntp clean verify }
    else { & bash $wrapper -B -ntp clean verify }
    if ($LASTEXITCODE -ne 0) { throw "Java target clean verify failed: $LASTEXITCODE." }
}
finally { Pop-Location }
$reports = @(Get-ChildItem -LiteralPath $source -Recurse -File -Filter 'TEST-*.xml' |
    Where-Object { $_.FullName -match '[\\/]target[\\/](surefire-reports|failsafe-reports)[\\/]' })
$tests = 0
$requiredCase = $false
foreach ($report in $reports) {
    $xml = Read-SafeXml $report.FullName
    foreach ($suite in $xml.SelectNodes("//*[local-name()='testsuite']")) {
        foreach ($attribute in 'tests', 'failures', 'errors', 'skipped') {
            if ($suite.GetAttribute($attribute) -cnotmatch '^\d+$') { throw 'Java test report counters are incomplete or invalid.' }
        }
        $tests += [int] $suite.GetAttribute('tests')
        if ([int] $suite.GetAttribute('failures') -ne 0 -or [int] $suite.GetAttribute('errors') -ne 0 -or
            [int] $suite.GetAttribute('skipped') -ne 0) { throw 'Java target reports contain failures, errors, or skipped tests.' }
    }
    if ($xml.SelectNodes("//*[local-name()='testcase']/*[local-name()='failure' or local-name()='error' or local-name()='skipped']").Count) {
        throw 'Java target test cases contain failures, errors, or skips.'
    }
    foreach ($case in $xml.SelectNodes("//*[local-name()='testcase']")) {
        if ($case.GetAttribute('classname') -match 'S3FileProcessingServiceTest$' -and
            $case.GetAttribute('name') -match '^downloadOriginalCopiesFileFromS3(?:$|\()') { $requiredCase = $true }
    }
}
if ($tests -eq 0 -or -not $requiredCase) { throw 'Java target must run real tests, including the repaired upstream download case.' }
Write-JsonFile (Join-Path $EvidenceDirectory 'validation.json') ([ordered]@{
    schemaVersion = 1; track = 'java'; outcome = 'passed'; tests = $tests
    summary = "JDK 21 clean verify passed with $tests tests, no failures/errors/skips, and the formerly failing download test present."
})
