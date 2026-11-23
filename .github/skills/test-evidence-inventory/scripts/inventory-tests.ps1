[CmdletBinding()]
param(
    [string]$ProjectRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..')).Path
$root = if ($ProjectRoot) {
    (Resolve-Path (Join-Path $repoRoot $ProjectRoot)).Path
} else {
    (Resolve-Path (Join-Path $repoRoot 'legacy-src\dotnet-bookcatalog\shared-legacy-app')).Path
}

$relativeRoot = $root.Substring($repoRoot.Length).TrimStart('\','/')
$java = $relativeRoot -match '(^|/|\\)java-asset-manager($|/|\\)'
$dotnet = $relativeRoot -match '(^|/|\\)dotnet-bookcatalog($|/|\\)'
if ($java -and $dotnet) { throw 'ProjectRoot is ambiguous across tracks.' }

Write-Output "Test evidence inventory: $relativeRoot"
if ($java) {
    $testFiles = Get-ChildItem -Path $root -Filter '*Test*.java' -Recurse -File
    $poms = Get-ChildItem -Path $root -Filter 'pom.xml' -Recurse -File
    Write-Output "Track: Java / Maven"
    Write-Output "Test files: $(if ($testFiles) { $testFiles.Count } else { 'none' })"
    foreach ($file in $testFiles) { Write-Output "  $($file.FullName.Substring($repoRoot.Length).TrimStart('\','/'))" }
    foreach ($pom in $poms) {
        $content = Get-Content -LiteralPath $pom.FullName -Raw
        if ($content -match 'junit|spring-boot-starter-test|mockito') {
            Write-Output "  Framework declaration: $($pom.FullName.Substring($repoRoot.Length).TrimStart('\','/'))"
        }
    }
    Write-Output "Proposed read-only inventory command: ./mvnw -B test"
} elseif ($dotnet) {
    $projects = Get-ChildItem -Path $root -Filter '*.csproj' -Recurse -File |
        Where-Object { $_.FullName -notmatch '[\\/](bin|obj|packages)[\\/]' }
    $testProjects = $projects | Where-Object {
        $_.Name -match 'Test|Spec' -or (Get-Content -LiteralPath $_.FullName -Raw) -match 'xunit|nunit|mstest|Microsoft.NET.Test.Sdk'
    }
    Write-Output "Track: classic .NET / MSBuild"
    Write-Output "C# projects: $($projects.Count)"
    Write-Output "Test projects: $(if ($testProjects) { $testProjects.Count } else { 'none' })"
    foreach ($project in $testProjects) { Write-Output "  $($project.FullName.Substring($repoRoot.Length).TrimStart('\','/'))" }
    Write-Output "Proposed validation: msbuild BookCatalog.sln -restore -p:Configuration=Release"
} else {
    throw 'ProjectRoot must be legacy-src/java-asset-manager or legacy-src/dotnet-bookcatalog/shared-legacy-app.'
}

Write-Output "Inventory complete; no test or build command was run."
