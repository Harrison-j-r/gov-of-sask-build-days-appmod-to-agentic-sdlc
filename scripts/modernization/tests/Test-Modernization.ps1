#requires -Version 7.4
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Import-Module (Join-Path $PSScriptRoot '..\Modernization.psm1') -Force -DisableNameChecking
$script:passed = 0
$fixture = Join-Path ([IO.Path]::GetTempPath()) ("modernize-tests-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixture | Out-Null

function Assert-Equal($Actual, $Expected) {
    if ($Actual -cne $Expected) { throw "Expected '$Expected', got '$Actual'." }
}
function Assert-Throws([scriptblock] $Action, [string] $Message) {
    $caught = $null
    try { & $Action | Out-Null } catch { $caught = $_ }
    if ($null -eq $caught -or $caught.Exception.Message -notmatch $Message) {
        throw "Expected failure matching '$Message'; actual: $caught"
    }
}
function Test-Case([string] $Name, [scriptblock] $Action) {
    & $Action
    $script:passed++
    Write-Output "PASS $Name"
}
function Set-FixtureFile([string] $Relative, [string] $Content) {
    $path = Join-Path $fixture $Relative
    [IO.Directory]::CreateDirectory((Split-Path $path)) | Out-Null
    [IO.File]::WriteAllText($path, $Content, [Text.UTF8Encoding]::new($false))
    $path
}
function Set-JavaFixture([string] $Java, [string] $Boot, [string] $Modules = '<module>web</module><module>worker</module>') {
    $null = Set-FixtureFile 'legacy-src/java-asset-manager/pom.xml' @"
<project xmlns="http://maven.apache.org/POM/4.0.0"><parent><artifactId>spring-boot-starter-parent</artifactId><version>$Boot</version></parent><properties><java.version>$Java</java.version></properties><modules>$Modules</modules></project>
"@
}
function New-ZipFixture([string] $Name, [string[]] $Entries, [switch] $Symlink) {
    $path = Join-Path $fixture $Name
    $zip = [IO.Compression.ZipFile]::Open($path, [IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($name in $Entries) {
            $entry = $zip.CreateEntry($name)
            if ($Symlink) { $entry.ExternalAttributes = [int] (0xA000 -shl 16) }
            $writer = [IO.StreamWriter]::new($entry.Open())
            try { $writer.Write('synthetic') } finally { $writer.Dispose() }
        }
    }
    finally { $zip.Dispose() }
    $path
}

try {
    Test-Case 'baseline and target Java profiles remain distinct' {
        Set-JavaFixture '8' '2.7.18'
        Assert-Equal (Get-ValidationProfile $fixture java) baseline
        Set-JavaFixture '21' '3.5.1'
        Assert-Equal (Get-ValidationProfile $fixture java) target
        Set-JavaFixture '17' '3.5.1'
        Assert-Throws { Get-ValidationProfile $fixture java } 'Unsupported Java transition'
        Set-JavaFixture '21' '3.5.1' '<module>web</module>'
        Assert-Throws { Get-ValidationProfile $fixture java } 'both web and worker'
    }
    Test-Case 'target .NET cannot retain legacy references or silently multitarget' {
        $path = 'legacy-src/dotnet-bookcatalog/shared-legacy-app/src/BookCatalog.Web/BookCatalog.Web.csproj'
        $null = Set-FixtureFile $path '<Project><PropertyGroup><TargetFrameworkVersion>v4.8</TargetFrameworkVersion></PropertyGroup></Project>'
        Assert-Equal (Get-ValidationProfile $fixture dotnet) baseline
        $target = '<Project Sdk="Microsoft.NET.Sdk.Web"><PropertyGroup><TargetFramework>net10.0</TargetFramework></PropertyGroup><ItemGroup><PackageReference Include="Microsoft.EntityFrameworkCore.SqlServer" Version="10.0.12" /></ItemGroup></Project>'
        $null = Set-FixtureFile $path $target
        Assert-Equal (Get-ValidationProfile $fixture dotnet) target
        $null = Set-FixtureFile $path ($target.Replace('</ItemGroup>', '<Reference Include="System.Web" /></ItemGroup>'))
        Assert-Throws { Get-ValidationProfile $fixture dotnet } 'without MVC 5'
        $null = Set-FixtureFile $path ($target.Replace('net10.0', 'net10.0;net8.0'))
        Assert-Throws { Get-ValidationProfile $fixture dotnet } 'Unsupported BookCatalog'
    }
    Test-Case 'project XML cannot resolve external entities' {
        $path = Set-FixtureFile 'unsafe.xml' '<!DOCTYPE project [<!ENTITY external SYSTEM "file:///must-not-be-read">]><project>&external;</project>'
        Assert-Throws { Read-SafeXml $path } 'DTD'
    }
    Test-Case 'paths reject prefix collisions, traversal and protected content' {
        $source = 'legacy-src/java-asset-manager'
        Assert-ChangedPaths java @("$source/web/src/main/App.java") @("$source/**")
        foreach ($path in @("$source-evil/App.java", "$source/../App.java", "$source/.github/workflows/steal.yml",
                "$source/AGENTS.md", "$source/.env", "$source/worker/target/out.jar", 'scripts/validation/check.ps1')) {
            Assert-Throws { Assert-ChangedPaths java @($path) @("$source/**") } 'path|traversal'
        }
        Assert-Throws { Assert-AllowedPaths java @('legacy-src/**') } 'leaves'
        Assert-Throws { Assert-RepositoryPath 'a/$(command)' } 'shell syntax'
        Assert-Throws { Assert-RepositoryPath 'a\b' } 'normalized'
        $limit = (Get-ModernizationConfig).maxChangedFiles
        $within = @(1..$limit | ForEach-Object { "$source/web/File$_.java" })
        Assert-ChangedPaths java $within @("$source/**")
        Assert-Throws { Assert-ChangedPaths java ($within + "$source/web/OneTooMany.java") @("$source/**") } 'file-count'
    }
    Test-Case 'release installer fails closed without approved immutable pins' {
        $hash = '1' * 64
        Assert-ReleasePin 'https://github.com/microsoft/modernize-cli/releases/download/v1.0.95/synthetic.zip' $hash '1.0.95'
        Assert-Throws { Assert-ReleasePin 'https://example.invalid/download.zip' $hash '1.0.95' } 'Release URL'
        Assert-Throws { Assert-ReleasePin 'https://github.com/microsoft/modernize-cli/releases/latest/download/synthetic.zip' $hash '1.0.95' } 'Release URL'
        Assert-Throws { Assert-ReleasePin 'https://github.com/microsoft/modernize-cli/releases/download/v1.0.95/synthetic.zip' ('0' * 64) '1.0.95' } 'nonzero'
    }
    Test-Case 'evidence ZIP extraction rejects traversal, links, duplicate and missing entries' {
        $good = New-ZipFixture 'good.zip' @('manifest.json', 'report.md')
        Expand-EvidenceArchive $good (Join-Path $fixture 'good') @('manifest.json', 'report.md')
        $bad = New-ZipFixture 'traversal.zip' @('../report.md')
        Assert-Throws { Expand-EvidenceArchive $bad (Join-Path $fixture 'bad1') @('report.md') } 'traversal'
        $bad = New-ZipFixture 'link.zip' @('report.md') -Symlink
        Assert-Throws { Expand-EvidenceArchive $bad (Join-Path $fixture 'bad2') @('report.md') } 'linked'
        $bad = New-ZipFixture 'duplicate.zip' @('report.md', 'REPORT.md')
        Assert-Throws { Expand-EvidenceArchive $bad (Join-Path $fixture 'bad3') @('report.md') } 'duplicate'
        $bad = New-ZipFixture 'missing.zip' @('report.md')
        Assert-Throws { Expand-EvidenceArchive $bad (Join-Path $fixture 'bad4') @('manifest.json', 'report.md') } 'incomplete'
    }
    Test-Case 'only approval of the exact latest PR head by a permitted human counts' {
        $repo = @{ full_name = 'synthetic/workshop' }
        $pr = @{ merged = $true; base = @{ repo = $repo; ref = 'main' }; head = @{ repo = $repo; sha = 'a' * 40 } }
        $review = @{ id = 1; state = 'APPROVED'; commit_id = 'a' * 40; user = @{ login = 'synthetic-reviewer'; type = 'User' } }
        Assert-HumanReview $pr @($review) @('synthetic-reviewer') 'synthetic/workshop' main
        Assert-Throws { Assert-HumanReview $pr @($review) @() 'synthetic/workshop' main } 'No current'
        $review.commit_id = 'b' * 40
        Assert-Throws { Assert-HumanReview $pr @($review) @('synthetic-reviewer') 'synthetic/workshop' main } 'No current'
        $review.commit_id = 'a' * 40
        $review.user.type = 'Bot'
        Assert-Throws { Assert-HumanReview $pr @($review) @('synthetic-reviewer') 'synthetic/workshop' main } 'No current'
        $review.user.type = 'User'
        $later = @{ id = 2; state = 'CHANGES_REQUESTED'; commit_id = 'a' * 40; user = $review.user }
        Assert-Throws { Assert-HumanReview $pr @($review, $later) @('synthetic-reviewer') 'synthetic/workshop' main } 'No current'
    }
    Test-Case 'assessment provenance rejects fork, failure and the wrong workflow' {
        $repo = @{ id = 1; default_branch = 'main' }
        $run = @{ repository = @{ id = 1 }; head_repository = @{ id = 1 }; head_branch = 'main'; event = 'schedule';
            status = 'completed'; conclusion = 'success'; path = '.github/workflows/modernize-assess-java.yml'; head_sha = 'a' * 40 }
        Assert-AssessmentRun $run $repo java
        $run.head_repository.id = 2
        Assert-Throws { Assert-AssessmentRun $run $repo java } 'not trusted'
        $run.head_repository.id = 1
        $run.conclusion = 'failure'
        Assert-Throws { Assert-AssessmentRun $run $repo java } 'not trusted'
        $run.conclusion = 'success'
        Assert-Throws { Assert-AssessmentRun $run $repo dotnet } 'not trusted'
    }
    Test-Case 'manifest schemas reject executable extra fields' {
        Assert-ExactKeys @{ a = 1; b = 2 } @('a', 'b')
        Assert-Throws { Assert-ExactKeys @{ a = 1; b = 2; command = 'untrusted' } @('a', 'b') } 'schema'
    }
    Test-Case 'review hashes survive checkout newline conventions without hiding text edits' {
        $lf = Set-FixtureFile 'lf.md' "# Synthetic plan`nA real requirement.`n"
        $crlf = Set-FixtureFile 'crlf.md' "# Synthetic plan`r`nA real requirement.`r`n"
        Assert-Equal (Get-TextFileHash $lf) (Get-TextFileHash $crlf)
        $changed = Set-FixtureFile 'changed.md' "# Synthetic plan`nA changed requirement.`n"
        if ((Get-TextFileHash $lf) -ceq (Get-TextFileHash $changed)) { throw 'Review hash lost a semantic edit.' }
    }
    & (Join-Path $PSScriptRoot 'Test-WorkflowModes.ps1')
    Write-Output "Passed $script:passed modernization boundary tests."
}
finally {
    if ((Split-Path $fixture -Leaf) -cnotmatch '^modernize-tests-[0-9a-f]{32}$') { throw 'Unexpected fixture cleanup path.' }
    Remove-Item -LiteralPath $fixture -Recurse -Force
}
