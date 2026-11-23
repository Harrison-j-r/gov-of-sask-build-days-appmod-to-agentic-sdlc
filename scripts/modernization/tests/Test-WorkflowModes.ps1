#requires -Version 7.4
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot '..\Modernization.psm1') -Force -DisableNameChecking
$runner = Join-Path $PSScriptRoot '..\Invoke-Modernization.ps1'
$bundleTool = Join-Path $PSScriptRoot '..\New-ModernizationPlanBundle.ps1'
$fixture = Join-Path ([IO.Path]::GetTempPath()) ("modernize-modes-" + [guid]::NewGuid().ToString('N'))
$root = Join-Path $fixture 'repository'
[IO.Directory]::CreateDirectory($root) | Out-Null
$gitExecutable = (Get-Command git -CommandType Application | Select-Object -First 1).Source
$environmentNames = @('GITHUB_ACTIONS', 'GITHUB_SERVER_URL', 'GITHUB_REPOSITORY', 'GITHUB_ACTOR', 'GITHUB_REF', 'GITHUB_EVENT_NAME', 'GH_HOST',
    'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'GITHUB_OUTPUT', 'GITHUB_STEP_SUMMARY', 'MODERNIZE_ENABLED',
    'GH_TOKEN', 'MODERNIZE_PUBLISH_TOKEN', 'MODERNIZE_COPILOT_TOKEN')
$environment = @{}
foreach ($name in $environmentNames) { $environment[$name] = [Environment]::GetEnvironmentVariable($name) }

function Write-Fixture([string] $Path, [string] $Content) {
    [IO.Directory]::CreateDirectory((Split-Path $Path)) | Out-Null
    [IO.File]::WriteAllText($Path, $Content, [Text.UTF8Encoding]::new($false))
}
function Commit-Fixture([string] $Message) {
    $null = Invoke-CheckedGit $root @('add', '--all')
    $null = Invoke-CheckedGit $root @('-c', 'commit.gpgsign=false', 'commit', '-m',
        "$Message`n`nCo-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>")
}
function Expect-Failure([scriptblock] $Action, [string] $Pattern) {
    $failure = $null
    try { & $Action | Out-Null } catch { $failure = $_ }
    if ($null -eq $failure -or $failure.Exception.Message -notmatch $Pattern) {
        throw "Expected '$Pattern'; actual failure: $failure"
    }
}

try {
    $null = Invoke-CheckedGit $root @('init', '-b', 'main')
    $null = Invoke-CheckedGit $root @('config', 'user.name', 'Synthetic fixture')
    $null = Invoke-CheckedGit $root @('config', 'user.email', 'fixture@example.invalid')
    $null = Invoke-CheckedGit $root @('config', 'core.autocrlf', 'false')
    $source = 'legacy-src/java-asset-manager'
    Write-Fixture (Join-Path $root '.gitignore') "**/target/`n"
    Write-Fixture (Join-Path $root "$source/pom.xml") '<project><parent><artifactId>spring-boot-starter-parent</artifactId><version>2.7.18</version></parent><properties><java.version>8</java.version></properties><modules><module>web</module><module>worker</module></modules></project>'
    Write-Fixture (Join-Path $root "$source/web/src/main/App.java") "synthetic-before`r`n"
    Write-Fixture (Join-Path $root 'specs/synthetic-approved.md') "# Synthetic application specification`n`n- **Status:** Approved`n- **Source root:** $source`n"
    Write-Fixture (Join-Path $root 'technical/plan.md') "# Synthetic plan`nPreserve behavior.`n"
    Write-Fixture (Join-Path $root 'technical/tasks.json') '{"tasks":[{"id":"synthetic","description":"Synthetic transformation, not a real migration."}]}'
    Write-Fixture (Join-Path $root "$source/mvnw.cmd") "@echo off`r`npwsh -NoProfile -File `"%~dp0synthetic-verify.ps1`"`r`nexit /b %ERRORLEVEL%`r`n"
    Write-Fixture (Join-Path $root "$source/mvnw") @'
#!/bin/sh
exec pwsh -NoProfile -File "$(dirname "$0")/synthetic-verify.ps1"
'@
    Write-Fixture (Join-Path $root "$source/synthetic-verify.ps1") @'
$ErrorActionPreference = 'Stop'
$directory = Join-Path $PSScriptRoot 'worker/target/surefire-reports'
New-Item -ItemType Directory -Force -Path $directory | Out-Null
[IO.File]::WriteAllText((Join-Path $directory 'TEST-synthetic.xml'),
    '<testsuite tests="1" failures="0" errors="0" skipped="0"><testcase classname="synthetic.S3FileProcessingServiceTest" name="downloadOriginalCopiesFileFromS3" /></testsuite>')
'@
    Commit-Fixture 'Synthetic baseline'
    & $bundleTool -Track java -PlanName synthetic -PlanDirectory (Join-Path $root 'technical') `
        -Specification 'specs/synthetic-approved.md' -AllowedPaths @("$source/**") -Root $root | Out-Null
    Commit-Fixture 'Synthetic reviewed plan'
    $approvedHead = Invoke-CheckedGit $root @('rev-parse', 'HEAD')
    $bundle = 'specs/work/java-modernization/ci-plans/synthetic'
    $manifest = Read-ApprovedBundle $root java $bundle
    $planPath = Join-Path $root "$bundle/plan.md"
    $originalPlan = [IO.File]::ReadAllBytes($planPath)
    Write-Fixture $planPath "# Tampered plan`n"
    Expect-Failure { Read-ApprovedBundle $root java $bundle } 'hash/size mismatch'
    [IO.File]::WriteAllBytes($planPath, $originalPlan)
    Write-Fixture (Join-Path $root 'README.md') "# Unrelated documentation`n"
    Commit-Fixture 'Synthetic documentation-only change'
    $base = Invoke-CheckedGit $root @('rev-parse', 'HEAD')
    if ((Get-ApplicationTree $root $base java) -cne $manifest.sourceTree) { throw 'Documentation changed the application tree unexpectedly.' }

    $global:ModernizeModeFixture = @{
        root = $root; git = $gitExecutable; approvedHead = $approvedHead; created = $null; pushes = 0; posts = 0
        noChange = $false; noReport = $false; mutateAssessment = $false
    }
    # API and remote-push calls never fall through to the network in these tests.
    function global:gh {
        $endpoint = @($args | Where-Object { $_ -is [string] -and $_.StartsWith('repos/') })[0]
        $methodIndex = [array]::IndexOf($args, '--method')
        $method = if ($methodIndex -ge 0) { $args[$methodIndex + 1] } else { 'GET' }
        $mock = $global:ModernizeModeFixture
        $reply = $null
        switch -Regex ($endpoint) {
            '^repos/synthetic/workshop$' { $reply = @{ id = 1; default_branch = 'main'; html_url = 'https://example.invalid/synthetic/workshop' }; break }
            '/collaborators/[^/]+/permission$' { $reply = @{ permission = 'write' }; break }
            '/pulls/1/reviews\?' {
                $reply = @(@{ id = 1; state = 'APPROVED'; commit_id = $mock.approvedHead; user = @{ login = 'synthetic-reviewer'; type = 'User' } }); break
            }
            '/pulls/1$' {
                $reply = @{ merged = $true; html_url = 'https://example.invalid/synthetic/workshop/pull/1';
                    base = @{ ref = 'main'; repo = @{ full_name = 'synthetic/workshop' } };
                    head = @{ sha = $mock.approvedHead; repo = @{ full_name = 'synthetic/workshop' } } }; break
            }
            '/pulls\?state=open' {
                $reply = @()
                if ($mock.created) { $reply = @($mock.created) }
                break
            }
            '/git/ref/heads/main$' {
                $reply = @{ object = @{ sha = (Invoke-CheckedGit $mock.root @('rev-parse', 'HEAD')) } }; break
            }
            '/contents/legacy-src\?ref=([a-f0-9]+)$' {
                $commit = $Matches[1]
                $reply = @(@{ name = 'java-asset-manager'; type = 'dir'; sha = (Get-ApplicationTree $mock.root $commit java) }); break
            }
            '/contents/(.+)\?ref=[a-f0-9]+$' {
                $path = Join-Path $mock.root $Matches[1]
                $bytes = [IO.File]::ReadAllBytes($path)
                $reply = @{ type = 'file'; encoding = 'base64'; size = $bytes.Length; content = [Convert]::ToBase64String($bytes) }; break
            }
            '/pulls$' {
                if ($method -cne 'POST') { throw 'Unexpected synthetic PR method.' }
                $index = [array]::IndexOf($args, '--input')
                $payload = Read-BoundedJson $args[$index + 1]
                $reply = @{ html_url = 'https://example.invalid/synthetic/workshop/pull/2'; body = $payload.body }
                $mock.created = $reply
                $mock.posts++
                break
            }
            '/actions/runs\?head_sha=([a-f0-9]+)&' {
                $reply = @{ workflow_runs = @(@{ path = '.github/workflows/ci-legacy-java.yml'; head_sha = $Matches[1] }) }; break
            }
            default { throw "Unexpected synthetic GitHub endpoint: $endpoint" }
        }
        $global:LASTEXITCODE = 0
        ConvertTo-Json -InputObject $reply -Depth 20 -Compress
    }
    function global:git {
        if ($args -contains 'push') {
            if (-not $env:MODERNIZE_PUBLISH_TOKEN) { throw 'Synthetic push has no isolated publication credential.' }
            $global:ModernizeModeFixture.pushes++
            $global:LASTEXITCODE = 0
            return
        }
        & $global:ModernizeModeFixture.git @args
        $global:LASTEXITCODE = $LASTEXITCODE
    }
    function global:java {
        $global:LASTEXITCODE = 0
        'openjdk version "21.0.0"'
    }
    function global:modernize {
        if ($args -contains '--version') { $global:LASTEXITCODE = 0; '1.0.95'; return }
        if ($args[0] -ceq 'assess') {
            $mock = $global:ModernizeModeFixture
            $index = [array]::IndexOf($args, '--output-path')
            if (-not $mock.noReport) {
                [IO.Directory]::CreateDirectory($args[$index + 1]) | Out-Null
                [IO.File]::WriteAllText((Join-Path $args[$index + 1] 'assessment.md'), '# Synthetic assessment fixture, not a real report')
            }
            if ($mock.mutateAssessment) {
                [IO.File]::WriteAllText((Join-Path (Get-Location).Path 'legacy-src/java-asset-manager/web/src/main/App.java'), 'synthetic forbidden assessment edit')
            }
            $global:LASTEXITCODE = 0
            return
        }
        if ($args[0] -cne 'plan' -or $args[1] -cne 'execute') { throw 'Unexpected synthetic Modernize command.' }
        if ($global:ModernizeModeFixture.noChange) { $global:LASTEXITCODE = 0; return }
        $cwd = (Get-Location).Path
        $pom = Join-Path $cwd 'legacy-src/java-asset-manager/pom.xml'
        $text = [IO.File]::ReadAllText($pom).Replace('2.7.18', '3.5.1').Replace('<java.version>8</java.version>', '<java.version>21</java.version>')
        [IO.File]::WriteAllText($pom, $text)
        $null = Invoke-CheckedGit $cwd @('add', '--', 'legacy-src/java-asset-manager/pom.xml')
        $null = Invoke-CheckedGit $cwd @('-c', 'commit.gpgsign=false', 'commit', '-m',
            "Synthetic committed agent edit`n`nCo-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>")
        [IO.File]::WriteAllText((Join-Path $cwd 'legacy-src/java-asset-manager/web/src/main/App.java'), "synthetic-after`r`n")
        [IO.File]::WriteAllText((Join-Path $cwd '.github/modernize/synthetic/progress.json'), '{"synthetic":true}')
        $global:LASTEXITCODE = 0
    }

    $env:GITHUB_ACTIONS = 'true'
    $env:GITHUB_SERVER_URL = 'https://github.com'
    $env:MODERNIZE_ENABLED = 'true'
    $env:GITHUB_REPOSITORY = 'synthetic/workshop'
    $env:GITHUB_ACTOR = 'synthetic-reviewer'
    $env:GITHUB_REF = 'refs/heads/main'
    $env:GITHUB_EVENT_NAME = 'workflow_dispatch'
    $env:GITHUB_RUN_ID = '123'
    $env:GITHUB_RUN_ATTEMPT = '1'
    $env:GITHUB_OUTPUT = Join-Path $fixture 'outputs.txt'
    $env:GITHUB_STEP_SUMMARY = Join-Path $fixture 'summary.md'
    $env:GH_TOKEN = 'synthetic-read-only'
    $env:MODERNIZE_PUBLISH_TOKEN = $null
    $env:MODERNIZE_COPILOT_TOKEN = $null
    $env:MODERNIZE_ENABLED = 'pilot'
    $env:GITHUB_EVENT_NAME = 'schedule'
    Expect-Failure {
        & $runner -Mode Assess -Track java -Root $root -CandidateRoot (Join-Path $fixture 'must-not-schedule') -OutputDirectory (Join-Path $fixture 'must-not-schedule-output')
    } 'Pilot mode'
    $env:GITHUB_EVENT_NAME = 'workflow_dispatch'
    $assessment = Join-Path $fixture 'assessment-output'
    & $runner -Mode Assess -Track java -Root $root -CandidateRoot (Join-Path $fixture 'assessment') -OutputDirectory $assessment | Out-Null
    $report = Read-BoundedJson (Join-Path $assessment 'evidence/manifest.json')
    if ($report.sourceTree -cne $manifest.sourceTree -or $report.runId -ne 123 -or
        $report.reportHash -cne (Get-ContentHash (Join-Path $assessment 'evidence/report.md'))) {
        throw 'Assessment lost its source/run/report provenance.'
    }
    $global:ModernizeModeFixture.noReport = $true
    Expect-Failure {
        & $runner -Mode Assess -Track java -Root $root -CandidateRoot (Join-Path $fixture 'missing-report') -OutputDirectory (Join-Path $fixture 'missing-report-output')
    } 'Cannot find path|does not exist|did not produce'
    $global:ModernizeModeFixture.noReport = $false
    $global:ModernizeModeFixture.mutateAssessment = $true
    Expect-Failure {
        & $runner -Mode Assess -Track java -Root $root -CandidateRoot (Join-Path $fixture 'mutated-assessment') -OutputDirectory (Join-Path $fixture 'mutated-assessment-output')
    } 'Assessment changed'
    $global:ModernizeModeFixture.mutateAssessment = $false
    $env:MODERNIZE_ENABLED = 'true'
    Write-Output 'PASS assessment binds real command output and rejects missing reports or source mutation'
    $requestDirectory = Join-Path $fixture 'request'
    & $runner -Mode Prepare -Track java -Root $root -Bundle $bundle -ApprovalPr 1 -OutputDirectory $requestDirectory | Out-Null
    $request = Read-BoundedJson (Join-Path $requestDirectory 'request.json')
    if ($request.baseSha -cne $base) { throw 'Preparation did not preserve docs-only source freshness.' }
    Write-Output 'PASS plan preparation binds reviewed content while permitting unrelated documentation commits'
    $sourceFile = Join-Path $root "$source/web/src/main/App.java"
    $originalSource = [IO.File]::ReadAllBytes($sourceFile)
    Write-Fixture $sourceFile "synthetic-stale-source`n"
    Commit-Fixture 'Synthetic changed application'
    Expect-Failure {
        & $runner -Mode Prepare -Track java -Root $root -Bundle $bundle -ApprovalPr 1 -OutputDirectory (Join-Path $fixture 'stale-request')
    } 'Application changed'
    [IO.File]::WriteAllBytes($sourceFile, $originalSource)
    Commit-Fixture 'Synthetic restored application'
    Write-Output 'PASS application changes invalidate approval while restored source remains identifiable'

    $execution = Join-Path $fixture 'execution-output'
    $env:GH_TOKEN = 'synthetic-inference'
    $global:ModernizeModeFixture.noChange = $true
    $noChange = Join-Path $fixture 'no-change-output'
    & $runner -Mode Execute -Track java -Root $root -InputDirectory $requestDirectory `
        -CandidateRoot (Join-Path $fixture 'no-change') -OutputDirectory $noChange | Out-Null
    if (Test-Path -LiteralPath (Join-Path $noChange 'candidate.patch')) { throw 'No-change execution fabricated a candidate patch.' }
    $global:ModernizeModeFixture.noChange = $false
    & $runner -Mode Execute -Track java -Root $root -InputDirectory $requestDirectory `
        -CandidateRoot (Join-Path $fixture 'execution') -OutputDirectory $execution | Out-Null
    $candidate = Read-BoundedJson (Join-Path $execution 'candidate.json')
    if ($candidate.paths.Count -ne 2) { throw 'Execution missed a committed or uncommitted source edit.' }
    $patch = [IO.File]::ReadAllBytes((Join-Path $execution 'candidate.patch'))
    if ([Text.Encoding]::UTF8.GetString($patch).Contains('progress.json')) { throw 'Ephemeral CLI state leaked into the patch.' }
    $unsafePatch = Join-Path $fixture 'unsafe.patch'
    [IO.File]::WriteAllText($unsafePatch, [Text.Encoding]::UTF8.GetString($patch).Replace(
        'legacy-src/java-asset-manager/web/src/main/App.java', '.github/workflows/injected.yml'))
    Expect-Failure { Assert-PatchBoundary $root $unsafePatch java @("$source/**") @($candidate.paths) } 'Protected path'
    Write-Output 'PASS execution captures committed and uncommitted edits without publishing runtime plan state'

    $inputDirectory = Join-Path $fixture 'input'
    [IO.Directory]::CreateDirectory((Join-Path $inputDirectory 'candidate')) | Out-Null
    Copy-Item -LiteralPath (Join-Path $requestDirectory 'request.json') -Destination $inputDirectory
    foreach ($name in 'candidate.json', 'candidate.patch') { Copy-Item -LiteralPath (Join-Path $execution $name) -Destination (Join-Path $inputDirectory 'candidate') }
    $env:GH_TOKEN = $null
    $env:MODERNIZE_PUBLISH_TOKEN = 'synthetic-publish'
    Expect-Failure {
        & $runner -Mode Validate -Track java -Root $root -InputDirectory $inputDirectory `
            -CandidateRoot (Join-Path $fixture 'must-not-run') -OutputDirectory (Join-Path $fixture 'denied-validation')
    } 'must not receive'
    $env:MODERNIZE_PUBLISH_TOKEN = $null
    $validation = Join-Path $fixture 'validation-output'
    & $runner -Mode Validate -Track java -Root $root -InputDirectory $inputDirectory `
        -CandidateRoot (Join-Path $fixture 'validation') -OutputDirectory $validation | Out-Null
    $receipt = Read-BoundedJson (Join-Path $validation 'validated/validation.json')
    if ($receipt.patchHash -cne $candidate.patchHash -or $receipt.outcome -cne 'passed') { throw 'Validation receipt lost patch identity.' }
    Write-Output 'PASS isolated validation applies the exact CRLF-preserving patch and produces bound evidence'

    Copy-Item -LiteralPath (Join-Path $validation 'validated') -Destination $inputDirectory -Recurse
    $env:GH_TOKEN = 'synthetic-read-only'
    $env:MODERNIZE_PUBLISH_TOKEN = 'synthetic-publish'
    & $runner -Mode Publish -Track java -Root $root -InputDirectory $inputDirectory `
        -CandidateRoot (Join-Path $fixture 'publication') -OutputDirectory (Join-Path $fixture 'publication-output') | Out-Null
    & $runner -Mode Publish -Track java -Root $root -InputDirectory $inputDirectory `
        -CandidateRoot (Join-Path $fixture 'duplicate') -OutputDirectory (Join-Path $fixture 'duplicate-output') | Out-Null
    if ($global:ModernizeModeFixture.pushes -ne 1 -or $global:ModernizeModeFixture.posts -ne 1) { throw 'Publication was not idempotent.' }
    Write-Output 'PASS publication observes the expected synthetic CI SHA and suppresses a duplicate PR'

    $unsafe = Join-Path $fixture 'execution/.github/workflows/unsafe.yml'
    Write-Fixture $unsafe "name: synthetic forbidden change`n"
    $null = Invoke-CheckedGit (Join-Path $fixture 'execution') @('add', '--', '.github/workflows/unsafe.yml')
    $null = Invoke-CheckedGit (Join-Path $fixture 'execution') @('-c', 'commit.gpgsign=false', 'commit', '-m',
        "Synthetic forbidden committed edit`n`nCo-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>")
    Expect-Failure { Get-CandidatePatch (Join-Path $fixture 'execution') $base java @("$source/**") '.github/modernize/synthetic' } 'Protected path'
    Write-Output 'PASS committed protected-path changes cannot evade the full-delta boundary'
}
finally {
    foreach ($name in 'gh', 'git', 'java', 'modernize') {
        if (Test-Path "Function:\global:$name") { Remove-Item "Function:\global:$name" }
    }
    Remove-Variable ModernizeModeFixture -Scope Global -ErrorAction SilentlyContinue
    foreach ($name in $environmentNames) { [Environment]::SetEnvironmentVariable($name, $environment[$name]) }
    if ((Split-Path $fixture -Leaf) -cnotmatch '^modernize-modes-[0-9a-f]{32}$') { throw 'Unexpected workflow fixture cleanup path.' }
    Remove-Item -LiteralPath $fixture -Recurse -Force
}
