#requires -Version 7.4
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-ModernizationConfig {
    Get-Content -LiteralPath (Join-Path $PSScriptRoot 'config.json') -Raw |
        ConvertFrom-Json -AsHashtable
}

function Get-ModernizationTrack {
    param([ValidateSet('java', 'dotnet')] [string] $Track)
    (Get-ModernizationConfig).tracks[$Track]
}

function Get-TextHash {
    param([Parameter(Mandatory)] [AllowEmptyString()] [string] $Text)
    [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData(
        [Text.Encoding]::UTF8.GetBytes($Text))).ToLowerInvariant()
}

function Get-ContentHash {
    param([Parameter(Mandatory)] [string] $Path)
    (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Get-CanonicalText {
    param([byte[]] $Bytes)
    $text = [Text.UTF8Encoding]::new($false, $true).GetString($Bytes)
    if ($text.StartsWith([string] [char] 0xFEFF)) { $text = $text.Substring(1) }
    if ($text.Contains([char] 0)) { throw 'Approval/configuration text must be UTF-8, not binary or UTF-16.' }
    $text.Replace("`r`n", "`n")
}

function Get-TextFileHash {
    param([string] $Path)
    Get-TextHash (Get-CanonicalText ([IO.File]::ReadAllBytes($Path)))
}

function Get-ModernizationPolicyHash {
    Get-TextFileHash (Join-Path $PSScriptRoot 'config.json')
}

function Assert-Sha {
    param([string] $Value, [ValidateSet(40, 64)] [int] $Length = 64)
    if ($Value -cnotmatch "^[0-9a-f]{$Length}$" -or $Value -match '^0+$') {
        throw "Expected a nonzero lowercase $Length-character digest."
    }
}

function Assert-RepositoryPath {
    param([Parameter(Mandatory)] [string] $Path)
    if ($Path -cnotmatch '^[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*$' -or
        @($Path.Split('/') | Where-Object { $_ -in '.', '..' -or $_.EndsWith('.') }).Count) {
        throw 'Expected a normalized repository-relative path without traversal or shell syntax.'
    }
}

function Resolve-RepositoryPath {
    param([string] $Root, [string] $Path, [switch] $MustExist)
    Assert-RepositoryPath $Path
    $resolvedRoot = [IO.Path]::GetFullPath($Root)
    if ((Get-Item -LiteralPath $resolvedRoot -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw 'Repository/evidence roots must not be symbolic links or reparse points.'
    }
    $current = $resolvedRoot
    foreach ($part in $Path.Split('/')) {
        $current = Join-Path $current $part
        if (Test-Path -LiteralPath $current) {
            $item = Get-Item -LiteralPath $current -Force
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
                throw 'Repository paths must not traverse symbolic links or reparse points.'
            }
        }
    }
    if ($MustExist -and -not (Test-Path -LiteralPath $current -PathType Leaf)) {
        throw "Required file is absent: $Path"
    }
    $current
}

function Invoke-CheckedGit {
    param([string] $Root, [Parameter(Mandatory)] [string[]] $Arguments)
    $output = & git -C $Root --no-pager @Arguments
    if ($LASTEXITCODE -ne 0) {
        $diagnostics = @($output | Where-Object { $_ -match ':\d+: (trailing whitespace|space before tab|new blank line at EOF|leftover conflict marker)' } |
            Select-Object -First 5) -join '; '
        throw "Git $($Arguments[0]) failed with exit code $LASTEXITCODE. $diagnostics"
    }
    ($output -join "`n").TrimEnd("`r", "`n")
}

function Get-ApplicationTree {
    param([string] $Root, [string] $Commit, [string] $Track)
    Assert-Sha $Commit 40
    $source = (Get-ModernizationTrack $Track).source
    $tree = Invoke-CheckedGit $Root @('rev-parse', "${Commit}:$source")
    Assert-Sha $tree 40
    $tree
}

function Assert-ReleasePin {
    param([string] $Url, [string] $Sha256, [string] $Version)
    Assert-Sha $Sha256
    $escaped = [regex]::Escape($Version)
    if ($Url -cnotmatch "^https://github\.com/microsoft/modernize-cli/releases/download/v?$escaped/[A-Za-z0-9._-]+\.(zip|tar\.gz|msi)$") {
        throw 'Release URL must identify an approved archive/MSI of the pinned Modernize release.'
    }
}

function Read-SafeXml {
    param([string] $Path)
    $settings = [Xml.XmlReaderSettings]::new()
    $settings.DtdProcessing = [Xml.DtdProcessing]::Prohibit
    $settings.XmlResolver = $null
    $settings.MaxCharactersInDocument = 2097152
    $reader = [Xml.XmlReader]::Create($Path, $settings)
    try {
        $document = [Xml.XmlDocument]::new()
        $document.XmlResolver = $null
        $document.Load($reader)
        return ,$document
    }
    finally {
        $reader.Dispose()
    }
}

function Get-ValidationProfile {
    param([string] $Root, [ValidateSet('java', 'dotnet')] [string] $Track)
    $source = (Get-ModernizationTrack $Track).source
    if ($Track -eq 'java') {
        $xml = Read-SafeXml (Resolve-RepositoryPath $Root "$source/pom.xml" -MustExist)
        $parent = $xml.SelectSingleNode("/*[local-name()='project']/*[local-name()='parent']")
        $java = $xml.SelectSingleNode("/*[local-name()='project']/*[local-name()='properties']/*[local-name()='java.version']")
        $modules = @($xml.SelectNodes("/*[local-name()='project']/*[local-name()='modules']/*[local-name()='module']") |
            ForEach-Object { $_.InnerText.Trim() } | Sort-Object)
        if ($null -eq $parent -or $null -eq $java -or ($modules -join ',') -cne 'web,worker') {
            throw 'Unsupported Java reactor: both web and worker and an explicit Java version are required.'
        }
        $artifact = $parent.SelectSingleNode("*[local-name()='artifactId']")
        $version = $parent.SelectSingleNode("*[local-name()='version']")
        if ($null -eq $artifact -or $null -eq $version -or $artifact.InnerText -cne 'spring-boot-starter-parent') {
            throw 'Unsupported Java parent; expected the Spring Boot parent.'
        }
        if ($java.InnerText.Trim() -ceq '8' -and $version.InnerText.Trim() -match '^2\.7\.\d+$') {
            return 'baseline'
        }
        if ($java.InnerText.Trim() -ceq '21' -and $version.InnerText.Trim() -match '^3\.\d+\.\d+$') {
            return 'target'
        }
        throw 'Unsupported Java transition; only Java 8/Boot 2.7 or Java 21/Boot 3 is allowed.'
    }
    $xml = Read-SafeXml (Resolve-RepositoryPath $Root "$source/src/BookCatalog.Web/BookCatalog.Web.csproj" -MustExist)
    $framework = @($xml.SelectNodes("//*[local-name()='TargetFrameworkVersion']"))
    $targets = @($xml.SelectNodes("//*[local-name()='TargetFramework' or local-name()='TargetFrameworks']"))
    if (-not $xml.DocumentElement.HasAttribute('Sdk') -and $framework.Count -eq 1 -and
        $framework[0].InnerText -ceq 'v4.8' -and $targets.Count -eq 0) {
        return 'baseline'
    }
    if ($xml.DocumentElement.GetAttribute('Sdk') -cne 'Microsoft.NET.Sdk.Web' -or
        $framework.Count -ne 0 -or $targets.Count -ne 1 -or
        $targets[0].LocalName -cne 'TargetFramework' -or $targets[0].InnerText.Trim() -cne 'net10.0') {
        throw 'Unsupported BookCatalog profile; expected classic Framework 4.8 or SDK-style net10.0 Web.'
    }
    $legacy = @($xml.SelectNodes("//*[local-name()='Reference' or local-name()='PackageReference']") |
        Where-Object { $_.GetAttribute('Include') -match '^(System\.Web|EntityFramework(?:,|$)|Microsoft\.AspNet\.Mvc)' })
    $ef = @($xml.SelectNodes("//*[local-name()='PackageReference']") |
        Where-Object { $_.GetAttribute('Include') -ceq 'Microsoft.EntityFrameworkCore.SqlServer' })
    if ($legacy.Count -or $ef.Count -ne 1 -or $ef[0].GetAttribute('Version') -notmatch '^10\.\d+\.\d+$') {
        throw 'The .NET target must use explicit EF Core 10 SQL Server packages, without MVC 5/EF6/System.Web.'
    }
    'target'
}

function Assert-AllowedPaths {
    param([string] $Track, [string[]] $Paths)
    $source = (Get-ModernizationTrack $Track).source
    if ($Paths.Count -eq 0 -or $Paths.Count -gt 100) { throw 'A bounded nonempty allowed-path list is required.' }
    foreach ($path in $Paths) {
        $literal = if ($path.EndsWith('/**')) { $path.Substring(0, $path.Length - 3) } else { $path }
        Assert-RepositoryPath $literal
        if ($literal -cne $source -and -not $literal.StartsWith("$source/", [StringComparison]::Ordinal)) {
            throw 'An allowed path leaves the selected source root.'
        }
    }
}

function Assert-ChangedPaths {
    param([string] $Track, [string[]] $Paths, [string[]] $AllowedPaths)
    Assert-AllowedPaths $Track $AllowedPaths
    if ($Paths.Count -gt (Get-ModernizationConfig).maxChangedFiles) { throw 'Patch exceeds the file-count limit.' }
    foreach ($path in $Paths) {
        Assert-RepositoryPath $path
        if ($path -match '(?i)(^|/)(\.git[^/]*|\.github|\.copilot|\.azure[^/]*|\.env[^/]*|AGENTS\.md|[^/]*\.instructions\.md|copilot-instructions\.md|LICENSE[^/]*|THIRD_PARTY[^/]*|UPSTREAM[^/]*|bin|obj|target|node_modules|packages)(/|$)' -or
            $path -match '(?i)(\.pem|\.key|\.pfx|\.p12|\.mdf|\.ldf|\.dll|\.exe|\.jar)$' -or
            $path -match '(?i)(^|/)secrets?\.') {
            throw "Protected path in candidate: $path"
        }
        $allowed = $false
        foreach ($pattern in $AllowedPaths) {
            if ($pattern.EndsWith('/**')) {
                if ($path.StartsWith($pattern.Substring(0, $pattern.Length - 2), [StringComparison]::Ordinal)) { $allowed = $true }
            }
            elseif ($path -ceq $pattern) { $allowed = $true }
        }
        if (-not $allowed) { throw "Candidate leaves the approved paths: $path" }
    }
}

function Assert-NoSecretMaterial {
    param([string] $Text)
    if ($Text -match '(?i)(github_pat_[a-z0-9_]{20,}|gh[pousr]_[a-z0-9_]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:AccountKey|SharedAccessKey)\s*=\s*[A-Za-z0-9+/]{16,})') {
        throw 'Secret-like material was detected; content will not be published.'
    }
}

function Write-JsonFile {
    param([string] $Path, [object] $Value)
    $parent = Split-Path $Path
    if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent | Out-Null }
    [IO.File]::WriteAllText($Path, ($Value | ConvertTo-Json -Depth 20) + "`n", [Text.UTF8Encoding]::new($false))
}

function Read-BoundedJson {
    param([string] $Path, [int] $MaxBytes = 1048576)
    $item = Get-Item -LiteralPath $Path -Force
    if (-not ($item -is [IO.FileInfo]) -or $item.Length -gt $MaxBytes -or
        ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw 'Expected a bounded regular JSON file.'
    }
    Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json -AsHashtable
}

function Assert-ExactKeys {
    param([Collections.IDictionary] $Value, [string[]] $Keys)
    if ((($Value.Keys | Sort-Object) -join ',') -cne (($Keys | Sort-Object) -join ',')) {
        throw 'Manifest fields do not match the supported schema.'
    }
}

function Read-ApprovedBundle {
    param([string] $Root, [string] $Track, [string] $Bundle)
    $policy = Get-ModernizationTrack $Track
    Assert-RepositoryPath $Bundle
    if ($Bundle -cnotmatch ("^" + [regex]::Escape($policy.bundleRoot) + '/[a-z][a-z0-9-]{0,47}$')) {
        throw 'Plan bundle must be a named directory under this track''s ci-plans root.'
    }
    $manifestPath = Resolve-RepositoryPath $Root "$Bundle/manifest.json" -MustExist
    $manifest = Read-BoundedJson $manifestPath
    Assert-ExactKeys $manifest @('schemaVersion', 'track', 'target', 'sourceCommit', 'sourceTree',
        'specPath', 'specSha256', 'planName', 'planSha256', 'tasksSha256', 'allowedPaths')
    if ($manifest.schemaVersion -ne 1 -or $manifest.track -cne $Track -or $manifest.target -cne $policy.target -or
        $manifest.planName -cnotmatch '^[a-z][a-z0-9-]{0,47}$') { throw 'Unsupported plan identity or target.' }
    Assert-Sha $manifest.sourceCommit 40
    Assert-Sha $manifest.sourceTree 40
    Assert-AllowedPaths $Track @($manifest.allowedPaths)
    if ($manifest.specPath -cnotmatch '^specs/[A-Za-z0-9_./-]+\.md$') { throw 'Specification must be a Markdown file under specs/.' }
    $files = [ordered]@{
        $manifest.specPath = $manifest.specSha256
        "$Bundle/plan.md" = $manifest.planSha256
        "$Bundle/tasks.json" = $manifest.tasksSha256
    }
    foreach ($entry in $files.GetEnumerator()) {
        Assert-Sha $entry.Value
        $file = Resolve-RepositoryPath $Root $entry.Key -MustExist
        if ((Get-Item -LiteralPath $file).Length -eq 0 -or (Get-Item -LiteralPath $file).Length -gt 1048576 -or
            (Get-TextFileHash $file) -cne $entry.Value) {
            throw "Approved input hash/size mismatch: $($entry.Key)"
        }
        Assert-NoSecretMaterial (Get-Content -LiteralPath $file -Raw)
    }
    $spec = Get-CanonicalText ([IO.File]::ReadAllBytes((Resolve-RepositoryPath $Root $manifest.specPath)))
    $withoutFences = [regex]::Replace($spec, '(?ms)^```.*?^```[^\r\n]*', '')
    if ($withoutFences -cnotmatch '(?m)^- \*\*Status:\*\* Approved\s*$') {
        throw 'The reviewed application specification must explicitly have Status: Approved.'
    }
    $sourceMatch = [regex]::Match($withoutFences, '(?m)^- \*\*Source root:\*\* ([^\r\n]+)$')
    if (-not $sourceMatch.Success -or $sourceMatch.Groups[1].Value.Trim().Trim('`').Replace('\', '/') -cne $policy.source) {
        throw 'The reviewed specification must identify exactly the configured application source root.'
    }
    $tasks = Read-BoundedJson (Resolve-RepositoryPath $Root "$Bundle/tasks.json")
    if (($tasks -isnot [Collections.IDictionary] -and $tasks -isnot [array]) -or $tasks.Count -eq 0 -or
        ($tasks -is [Collections.IDictionary] -and $tasks.Contains('tasks') -and @($tasks.tasks).Count -eq 0)) {
        throw 'Technical task input must be a nonempty JSON object or array.'
    }
    $manifest
}

function Invoke-GitHubJson {
    param([string] $Endpoint, [ValidateSet('GET', 'POST')] [string] $Method = 'GET', [string] $InputFile)
    if ($Endpoint -match '^[a-z]+:' -or $Endpoint.Contains('..') -or $Endpoint.StartsWith('/')) {
        throw 'GitHub endpoints must be relative API paths.'
    }
    $arguments = @('api', '--hostname', 'github.com', '--method', $Method, '-H', 'Accept: application/vnd.github+json', $Endpoint)
    if ($InputFile) { $arguments += @('--input', $InputFile) }
    $output = & gh @arguments
    if ($LASTEXITCODE -ne 0) { throw "GitHub $Method request failed (exit $LASTEXITCODE): $Endpoint" }
    ($output -join "`n") | ConvertFrom-Json -AsHashtable
}

function Get-GitHubPages {
    param([string] $Endpoint)
    $separator = if ($Endpoint.Contains('?')) { '&' } else { '?' }
    for ($page = 1; $page -le 10; $page++) {
        $items = @(Invoke-GitHubJson "${Endpoint}${separator}per_page=100&page=$page")
        foreach ($item in $items) { $item }
        if ($items.Count -lt 100) { return }
    }
    throw 'GitHub pagination limit reached; refusing incomplete approval/deduplication evidence.'
}

function Assert-HumanReview {
    param([Collections.IDictionary] $PullRequest, [object[]] $Reviews, [string[]] $AuthorizedReviewers,
        [string] $Repository, [string] $DefaultBranch)
    if (-not $PullRequest.merged -or $PullRequest.base.repo.full_name -cne $Repository -or
        $PullRequest.head.repo.full_name -cne $Repository -or $PullRequest.base.ref -cne $DefaultBranch) {
        throw 'Approval must be a merged, same-repository PR into the default branch.'
    }
    $latest = @{}
    foreach ($review in ($Reviews | Sort-Object id)) {
        if ($review.state -in 'APPROVED', 'CHANGES_REQUESTED', 'DISMISSED') { $latest[$review.user.login] = $review }
    }
    $approved = @($latest.Values | Where-Object {
        $_.state -ceq 'APPROVED' -and $_.commit_id -ceq $PullRequest.head.sha -and
        $_.user.type -ceq 'User' -and $_.user.login -cin $AuthorizedReviewers
    })
    if ($approved.Count -eq 0) { throw 'No current authorized human approval of the exact plan PR head was found.' }
}

function Assert-AssessmentRun {
    param([Collections.IDictionary] $Run, [Collections.IDictionary] $Repository, [string] $Track)
    $policy = Get-ModernizationTrack $Track
    if ($Run.repository.id -ne $Repository.id -or $Run.head_repository.id -ne $Repository.id -or
        $Run.head_branch -cne $Repository.default_branch -or $Run.event -notin 'schedule', 'workflow_dispatch' -or
        $Run.status -cne 'completed' -or $Run.conclusion -cne 'success' -or
        ($Run.path -split '@')[0] -cne $policy.assessmentWorkflow) {
        throw 'Assessment run origin, workflow, branch, event, or conclusion is not trusted.'
    }
    Assert-Sha $Run.head_sha 40
}

function Expand-EvidenceArchive {
    param([string] $Archive, [string] $Destination, [string[]] $ExpectedFiles)
    if (Test-Path -LiteralPath $Destination) { throw 'Evidence extraction requires a new destination.' }
    $zip = [IO.Compression.ZipFile]::OpenRead($Archive)
    try {
        $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
        $total = 0L
        foreach ($entry in $zip.Entries) {
            Assert-RepositoryPath $entry.FullName
            $mode = ($entry.ExternalAttributes -shr 16) -band 0xF000
            $total += $entry.Length
            if (-not $seen.Add($entry.FullName) -or $entry.FullName -cnotin $ExpectedFiles -or
                $mode -in 0xA000, 0x4000 -or (($entry.ExternalAttributes -shr 16) -band 0x49) -ne 0 -or
                $entry.Length -gt 2097152 -or $total -gt 4194304) {
                throw 'Evidence archive has duplicate, unexpected, executable, linked, or oversized entries.'
            }
        }
        if ($seen.Count -ne $ExpectedFiles.Count) { throw 'Evidence archive is incomplete.' }
        [IO.Directory]::CreateDirectory($Destination) | Out-Null
        foreach ($entry in $zip.Entries) {
            [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, (Join-Path $Destination $entry.FullName), $false)
        }
    }
    finally {
        $zip.Dispose()
    }
}

function Set-WorkflowOutput {
    param([string] $Name, [string] $Value)
    if ($Name -cnotmatch '^[a-z_]+$' -or $Value.Contains("`n") -or $Value.Contains("`r")) {
        throw 'Invalid workflow output.'
    }
    if ($env:GITHUB_OUTPUT) { Add-Content -LiteralPath $env:GITHUB_OUTPUT -Value "$Name=$Value" -Encoding utf8 }
}

function Get-RemoteApplicationTree {
    param([string] $Repository, [string] $Commit, [string] $Track)
    Assert-Sha $Commit 40
    $parts = (Get-ModernizationTrack $Track).source.Split('/')
    $parent = $parts[0..($parts.Length - 2)] -join '/'
    $items = @(Invoke-GitHubJson "repos/$Repository/contents/${parent}?ref=$Commit")
    $directory = @($items | Where-Object { $_.name -ceq $parts[-1] -and $_.type -ceq 'dir' })
    if ($directory.Count -ne 1) { throw 'Application directory metadata is missing or ambiguous.' }
    Assert-Sha $directory[0].sha 40
    $directory[0].sha
}

function Assert-RemoteFileHash {
    param([string] $Repository, [string] $Commit, [string] $Path, [string] $ExpectedHash)
    Assert-RepositoryPath $Path
    Assert-Sha $Commit 40
    $file = Invoke-GitHubJson "repos/$Repository/contents/${Path}?ref=$Commit"
    if ($file.type -cne 'file' -or $file.encoding -cne 'base64' -or $file.size -gt 1048576) {
        throw 'Reviewed input must be a bounded regular GitHub file.'
    }
    $bytes = [Convert]::FromBase64String($file.content)
    $actual = Get-TextHash (Get-CanonicalText $bytes)
    if ($actual -cne $ExpectedHash) { throw "Current input differs from the reviewed PR: $Path" }
}

function Get-VerifiedPlanRequest {
    param([string] $Root, [string] $Repository, [string] $Track, [string] $Bundle, [long] $ApprovalPr,
        [string] $Actor, [string] $DefaultBranch)
    if ($ApprovalPr -le 0 -or $Actor -cnotmatch '^[A-Za-z0-9-]+$') { throw 'Invalid approval PR or actor.' }
    $permission = Invoke-GitHubJson "repos/$Repository/collaborators/$Actor/permission"
    if ($permission.permission -notin 'admin', 'write', 'maintain') { throw 'Upgrade dispatch requires repository write authority.' }
    $manifest = Read-ApprovedBundle $Root $Track $Bundle
    $pr = Invoke-GitHubJson "repos/$Repository/pulls/$ApprovalPr"
    $reviews = @(Get-GitHubPages "repos/$Repository/pulls/$ApprovalPr/reviews")
    $authorized = @()
    foreach ($login in @($reviews | Where-Object { $_.user.type -ceq 'User' } |
            ForEach-Object { $_.user.login } | Sort-Object -Unique)) {
        if ($login -cnotmatch '^[A-Za-z0-9-]+$') { throw 'Unexpected reviewer identity.' }
        $access = Invoke-GitHubJson "repos/$Repository/collaborators/$login/permission"
        if ($access.permission -in 'admin', 'write', 'maintain') { $authorized += $login }
    }
    Assert-HumanReview $pr $reviews $authorized $Repository $DefaultBranch
    $manifestHash = Get-TextFileHash (Resolve-RepositoryPath $Root "$Bundle/manifest.json")
    foreach ($entry in ([ordered]@{
        "$Bundle/manifest.json" = $manifestHash
        "$Bundle/plan.md" = $manifest.planSha256
        "$Bundle/tasks.json" = $manifest.tasksSha256
        $manifest.specPath = $manifest.specSha256
    }).GetEnumerator()) {
        Assert-RemoteFileHash $Repository $pr.head.sha $entry.Key $entry.Value
    }
    $base = Invoke-CheckedGit $Root @('rev-parse', 'HEAD')
    $tree = Get-ApplicationTree $Root $base $Track
    if ($tree -cne $manifest.sourceTree -or
        (Get-ApplicationTree $Root $manifest.sourceCommit $Track) -cne $manifest.sourceTree) {
        throw 'Application changed since the reviewed plan; reassess and reapprove instead of rebasing silently.'
    }
    $policyHash = Get-ModernizationPolicyHash
    [ordered]@{
        schemaVersion = 1
        repository = $Repository
        track = $Track
        bundle = $Bundle
        approvalPr = $ApprovalPr
        baseSha = $base
        sourceTree = $tree
        planHash = $manifestHash
        policyHash = $policyHash
        fingerprint = Get-TextHash "$Track|$manifestHash|$tree|$policyHash"
    }
}

function Assert-PlanRequest {
    param([string] $Root, [Collections.IDictionary] $Request)
    Assert-ExactKeys $Request @('schemaVersion', 'repository', 'track', 'bundle', 'approvalPr', 'baseSha',
        'sourceTree', 'planHash', 'policyHash', 'fingerprint')
    if ($Request.schemaVersion -ne 1 -or $Request.repository -cnotmatch '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$' -or
        $Request.track -cnotin @('java', 'dotnet') -or $Request.approvalPr -le 0) { throw 'Invalid plan request identity.' }
    Assert-Sha $Request.baseSha 40
    Assert-Sha $Request.sourceTree 40
    foreach ($key in 'planHash', 'policyHash', 'fingerprint') { Assert-Sha $Request[$key] }
    if ($Request.policyHash -cne (Get-ModernizationPolicyHash) -or
        $Request.planHash -cne (Get-TextFileHash (Resolve-RepositoryPath $Root "$($Request.bundle)/manifest.json" -MustExist)) -or
        $Request.sourceTree -cne (Get-ApplicationTree $Root $Request.baseSha $Request.track) -or
        $Request.fingerprint -cne (Get-TextHash "$($Request.track)|$($Request.planHash)|$($Request.sourceTree)|$($Request.policyHash)")) {
        throw 'Plan request content, source or policy provenance changed.'
    }
    $null = Read-ApprovedBundle $Root $Request.track $Request.bundle
}

function Get-CandidatePatch {
    param([string] $Root, [string] $BaseCommit, [string] $Track, [string[]] $AllowedPaths, [string] $RuntimePlan)
    Assert-Sha $BaseCommit 40
    $pathspec = @('.')
    if ($RuntimePlan) {
        if ($RuntimePlan -cnotmatch '^\.github/modernize/[a-z][a-z0-9-]{0,47}$') { throw 'Invalid task-owned runtime plan directory.' }
        $pathspec += ":(exclude)$RuntimePlan/**"
    }
    $null = Invoke-CheckedGit $Root @('add', '--all')
    $names = Invoke-CheckedGit $Root (@('-c', 'core.quotePath=false', 'diff', '--cached', '--name-only', '--no-renames', $BaseCommit, '--') + $pathspec)
    $paths = @($names -split "`n" | Where-Object { $_ })
    Assert-ChangedPaths $Track $paths $AllowedPaths
    $raw = Invoke-CheckedGit $Root (@('diff', '--cached', '--raw', '--no-renames', $BaseCommit, '--') + $pathspec)
    foreach ($line in @($raw -split "`n" | Where-Object { $_ })) {
        if ($line -notmatch '^:(\d{6}) (\d{6}) ' -or $Matches[2] -notin '000000', '100644', '100755') {
            throw 'Candidate contains unsupported linked or submodule file modes.'
        }
    }
    $deleted = Invoke-CheckedGit $Root (@('diff', '--cached', '--name-only', '--diff-filter=D', '--no-renames', $BaseCommit, '--') + $pathspec)
    if ($deleted -match '(?im)(/src/test/|/tests?/|\.Tests/)') { throw 'Deleting existing tests requires a separately reviewed change.' }
    $patchFile = Join-Path ([IO.Path]::GetTempPath()) ("modernize-diff-" + [guid]::NewGuid().ToString('N') + '.patch')
    $git = (Get-Command git -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
    try {
        $arguments = @('-C', $Root, '--no-pager', 'diff', '--cached', '--binary', '--full-index', '--no-renames', '--no-ext-diff', '--no-textconv', '--no-color', $BaseCommit, '--') + $pathspec
        & $git @arguments > $patchFile
        if ($LASTEXITCODE -ne 0) { throw 'Unable to export the complete candidate diff.' }
        if ((Get-Item -LiteralPath $patchFile).Length -gt (Get-ModernizationConfig).maxPatchBytes) { throw 'Candidate patch exceeds the byte limit.' }
        $patch = [Text.UTF8Encoding]::new($false, $true).GetString([IO.File]::ReadAllBytes($patchFile))
    }
    finally { if (Test-Path -LiteralPath $patchFile) { Remove-Item -LiteralPath $patchFile -Force } }
    if ($patch -match 'GIT binary patch' -or [Text.Encoding]::UTF8.GetByteCount($patch) -gt (Get-ModernizationConfig).maxPatchBytes) {
        throw 'Binary or oversized candidate patches are not supported.'
    }
    Assert-NoSecretMaterial $patch
    [ordered]@{ paths = $paths; patch = $patch; sha256 = Get-TextHash $patch }
}

function Assert-PatchBoundary {
    param([string] $Root, [string] $PatchPath, [string] $Track, [string[]] $AllowedPaths, [string[]] $ExpectedPaths)
    $stats = Invoke-CheckedGit $Root @('apply', '--numstat', '-z', '--', $PatchPath)
    $paths = @()
    foreach ($record in @($stats.Split([char] 0) | Where-Object { $_ })) {
        if ($record -notmatch '^\d+\t\d+\t(.+)$') { throw 'Only bounded text patches without rename records are supported.' }
        $paths += $Matches[1]
    }
    Assert-ChangedPaths $Track $paths $AllowedPaths
    if ($paths.Count -eq 0 -or @($paths | Sort-Object -Unique).Count -ne $paths.Count -or
        (($paths | Sort-Object) -join "`n") -cne (($ExpectedPaths | Sort-Object) -join "`n")) {
        throw 'Parsed patch paths differ from the declared candidate.'
    }
    $summary = Invoke-CheckedGit $Root @('apply', '--summary', '--', $PatchPath)
    if ($summary -match '(?:create|delete) mode (?!100644\b|100755\b)\d{6}' -or
        $summary -match 'mode change \d{6} => (?!100644\b|100755\b)\d{6}') {
        throw 'Linked or submodule patch modes are forbidden before application.'
    }
}

function Receive-WorkflowEvidence {
    param([string] $Repository, [long] $RunId, [string] $Name, [string] $Destination, [string[]] $Files)
    if ($RunId -le 0 -or $Name -cnotmatch '^[a-z0-9-]+$') { throw 'Invalid evidence run or name.' }
    $result = Invoke-GitHubJson "repos/$Repository/actions/runs/$RunId/artifacts?per_page=100"
    if ($result.total_count -gt 100) { throw 'Artifact listing exceeds its limit.' }
    $artifacts = @($result.artifacts | Where-Object { $_.name -ceq $Name })
    if ($artifacts.Count -ne 1 -or $artifacts[0].expired -or $artifacts[0].size_in_bytes -gt 4194304 -or
        $artifacts[0].workflow_run.id -ne $RunId -or $artifacts[0].id -le 0) { throw 'Required artifact is missing, expired, ambiguous or oversized.' }
    $zip = "$Destination.zip"
    if (Test-Path -LiteralPath $zip) { throw 'Evidence download requires a new file.' }
    & gh api --hostname github.com "repos/$Repository/actions/artifacts/$($artifacts[0].id)/zip" > $zip
    if ($LASTEXITCODE -ne 0) { throw 'Artifact download failed.' }
    try { Expand-EvidenceArchive $zip $Destination $Files }
    finally { Remove-Item -LiteralPath $zip -Force }
}

Export-ModuleMember -Function *
