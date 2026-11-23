#requires -Version 7.4
[CmdletBinding()]
param(
    [Parameter(Mandatory)] [ValidateSet('java', 'dotnet')] [string] $Track,
    [Parameter(Mandatory)] [ValidatePattern('^[a-z][a-z0-9-]{0,47}$')] [string] $PlanName,
    [Parameter(Mandatory)] [string] $PlanDirectory,
    [Parameter(Mandatory)] [string] $Specification,
    [Parameter(Mandatory)] [string[]] $AllowedPaths,
    [string] $Root = (Join-Path $PSScriptRoot '..\..')
)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'Modernization.psm1') -Force -DisableNameChecking
$Root = [IO.Path]::GetFullPath($Root)
$policy = Get-ModernizationTrack $Track
$specPath = $Specification.Replace('\', '/')
$spec = Resolve-RepositoryPath $Root $specPath -MustExist
$allowed = @($AllowedPaths | ForEach-Object { $_.Replace('\', '/') })
Assert-AllowedPaths $Track $allowed
$base = Invoke-CheckedGit $Root @('rev-parse', 'HEAD')
$dirty = Invoke-CheckedGit $Root @('status', '--porcelain', '--untracked-files=all', '--', $policy.source)
if ($dirty) { throw 'Commit or set aside application edits before packaging a source-bound plan.' }
$plan = Join-Path $PlanDirectory 'plan.md'
$tasks = Join-Path $PlanDirectory 'tasks.json'
foreach ($file in @($plan, $tasks, $spec)) {
    $item = Get-Item -LiteralPath $file
    if ($item.Length -eq 0 -or $item.Length -gt 1048576 -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw 'Plan inputs must be nonempty bounded regular files.'
    }
    Assert-NoSecretMaterial (Get-Content -LiteralPath $file -Raw)
}
$null = Read-BoundedJson $tasks
$bundle = "$($policy.bundleRoot)/$PlanName"
$destination = Resolve-RepositoryPath $Root $bundle
if (Test-Path -LiteralPath $destination) { throw 'Plan bundle already exists; do not overwrite reviewed inputs.' }
New-Item -ItemType Directory -Path $destination | Out-Null
Copy-Item -LiteralPath $plan -Destination (Join-Path $destination 'plan.md')
Copy-Item -LiteralPath $tasks -Destination (Join-Path $destination 'tasks.json')
Write-JsonFile (Join-Path $destination 'manifest.json') ([ordered]@{
    schemaVersion = 1
    track = $Track
    target = $policy.target
    sourceCommit = $base
    sourceTree = Get-ApplicationTree $Root $base $Track
    specPath = $specPath
    specSha256 = Get-TextFileHash $spec
    planName = $PlanName
    planSha256 = Get-TextFileHash $plan
    tasksSha256 = Get-TextFileHash $tasks
    allowedPaths = $allowed
})
Write-Output "Prepared $bundle. This does not approve or execute the plan. Review the specification and bundle together in a PR."
