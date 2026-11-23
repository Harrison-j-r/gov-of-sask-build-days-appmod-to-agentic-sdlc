[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$Spec
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..')).Path
$specFile = (Resolve-Path $Spec).Path
$relativeSpec = $specFile.Substring($repoRoot.Length).TrimStart('\','/')

if (-not $relativeSpec.StartsWith("specs$([IO.Path]::DirectorySeparatorChar)") -and
    -not $relativeSpec.StartsWith("specs/")) {
    throw 'Spec must be inside specs/.'
}

$content = Get-Content -LiteralPath $specFile -Raw
$status = git -C $repoRoot --no-pager status --short

Write-Output "Specification: $relativeSpec"
Write-Output "Approval markers:"
foreach ($marker in @('Status:', 'Status', 'Human approval', 'Approved specification commit')) {
    $matches = [regex]::Matches($content, "(?m)^.*$([regex]::Escape($marker)).*$")
    foreach ($match in $matches) { Write-Output "  $($match.Value.Trim())" }
}
Write-Output ""
Write-Output "Worktree changes:"
if ($status) { $status | ForEach-Object { Write-Output "  $_" } } else { Write-Output "  none" }

Write-Output ""
Write-Output "Allowed-path and source-root lines:"
$boundaries = [regex]::Matches(
    $content,
    '(?m)^\s*(?:[-*]\s*)?(?:\*\*)?(?:Allowed paths|Source root|Primary validation command)\*\*?:?.*$|^\s*[-*]\s+`[^`]+`.*$'
) | ForEach-Object Value
if ($boundaries) { $boundaries | ForEach-Object { Write-Output "  $_" } } else { Write-Output "  none found" }

Write-Output ""
Write-Output "Audit complete; no worktree change was made."
