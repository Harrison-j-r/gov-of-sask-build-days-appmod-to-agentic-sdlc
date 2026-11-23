#requires -Version 7.4
[CmdletBinding()]
param([string] $Root = (Join-Path $PSScriptRoot '..\..'))
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not $IsWindows) { throw 'BookCatalog smoke checks require Windows LocalDB.' }
$localDbCommand = Get-Command SqlLocalDB.exe -ErrorAction SilentlyContinue
$localDb = if ($localDbCommand) { $localDbCommand.Source } else { $null }
if (-not $localDb) {
    foreach ($version in '170', '160', '150') {
        $candidate = Join-Path $env:ProgramFiles "Microsoft SQL Server\$version\Tools\Binn\SqlLocalDB.exe"
        if (Test-Path -LiteralPath $candidate -PathType Leaf) { $localDb = $candidate; break }
    }
}
if (-not $localDb) { throw 'SQL Server LocalDB is required; install the Windows web/LocalDB prerequisites before running this gate.' }
$dotnet = (Get-Command dotnet -ErrorAction Stop).Source
$project = Join-Path $Root 'legacy-src\dotnet-bookcatalog\shared-legacy-app\src\BookCatalog.Web'
$dll = Join-Path $project 'bin\Release\net10.0\BookCatalog.Web.dll'
if (-not (Test-Path -LiteralPath $dll -PathType Leaf)) { throw 'Build BookCatalog.Web in Release before running the smoke check.' }
$id = [guid]::NewGuid().ToString('N')
$instance = "ModernizeSmoke_$id"
$state = Join-Path ([IO.Path]::GetTempPath()) "bookcatalog-smoke-$id"
New-Item -ItemType Directory -Path $state | Out-Null
$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
$listener.Start()
$port = ([Net.IPEndPoint] $listener.LocalEndpoint).Port
$listener.Stop()
$baseUri = [uri] "http://127.0.0.1:$port/"
$handler = [Net.Http.HttpClientHandler]::new()
$handler.AllowAutoRedirect = $false
$handler.UseProxy = $false
$handler.CookieContainer = [Net.CookieContainer]::new()
$client = [Net.Http.HttpClient]::new($handler)
$client.Timeout = [TimeSpan]::FromSeconds(10)
$script:app = $null
$createdInstance = $false

function Request([string] $Method, [string] $Path, [hashtable] $Fields) {
    $message = [Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::new($Method), [uri]::new($baseUri, $Path))
    if ($null -ne $Fields) {
        $values = [Collections.Generic.Dictionary[string, string]]::new()
        foreach ($key in $Fields.Keys) { $values.Add($key, [string] $Fields[$key]) }
        $message.Content = [Net.Http.FormUrlEncodedContent]::new($values)
    }
    try {
        $response = $client.SendAsync($message).GetAwaiter().GetResult()
        try {
            $html = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
            if ($html.Length -gt 1048576) { throw 'Unexpectedly large smoke response.' }
            return @{ Status = [int] $response.StatusCode; Html = $html }
        }
        finally { $response.Dispose() }
    }
    finally { $message.Dispose() }
}

function Assert-Status($Response, [int[]] $Expected) {
    if ($Response.Status -notin $Expected) { throw "HTTP smoke expected $($Expected -join '/') but got $($Response.Status)." }
}

function Form([string] $Path) {
    $page = Request GET $Path $null
    Assert-Status $page @(200)
    foreach ($inputTag in [regex]::Matches($page.Html, '<input\b[^>]*>', 'IgnoreCase')) {
        $name = [regex]::Match($inputTag.Value, '\bname\s*=\s*["'']([^"'']*)["'']', 'IgnoreCase')
        $value = [regex]::Match($inputTag.Value, '\bvalue\s*=\s*["'']([^"'']*)["'']', 'IgnoreCase')
        if ($name.Success -and $name.Groups[1].Value -ceq '__RequestVerificationToken' -and $value.Success) {
            return @{ __RequestVerificationToken = [Net.WebUtility]::HtmlDecode($value.Groups[1].Value) }
        }
    }
    throw 'A required antiforgery form token was not rendered.'
}

function Index-Rows {
    $page = Request GET 'Books' $null
    Assert-Status $page @(200)
    if ($page.Html -notmatch 'Book\s*Catalog') { throw 'Book Catalog heading is missing.' }
    $rows = @()
    foreach ($row in [regex]::Matches($page.Html, '<tr\b[^>]*>.*?</tr>', 'Singleline,IgnoreCase')) {
        $details = [regex]::Match($row.Value, 'href=["'']/Books/Details/(\d+)["'']', 'IgnoreCase')
        if (-not $details.Success) { continue }
        $title = [regex]::Match($row.Value, '<td\b[^>]*>\s*([^<]*)</td>', 'Singleline,IgnoreCase')
        if (-not $title.Success) { throw 'Unable to identify a catalog row title.' }
        $rows += @{ Id = [int] $details.Groups[1].Value; Title = [Net.WebUtility]::HtmlDecode($title.Groups[1].Value.Trim()) }
    }
    $titles = @($rows | ForEach-Object { $_.Title })
    $sorted = @($titles | Sort-Object)
    if (($titles -join "`n") -cne ($sorted -join "`n")) { throw 'Active catalog titles are not ordered.' }
    $rows
}

function Stop-App {
    if ($null -ne $script:app) {
        if (-not $script:app.HasExited) { $script:app.Kill($true); $script:app.WaitForExit() }
        $script:app.Dispose()
        $script:app = $null
    }
}

function Start-App {
    $start = [Diagnostics.ProcessStartInfo]::new($dotnet)
    $start.UseShellExecute = $false
    $start.WorkingDirectory = $project
    foreach ($argument in @($dll, '--urls', $baseUri.AbsoluteUri.TrimEnd('/'))) { $start.ArgumentList.Add($argument) }
    $start.Environment['ASPNETCORE_ENVIRONMENT'] = 'Development'
    $start.Environment['InitializeDatabase'] = 'true'
    $connection = [Data.Common.DbConnectionStringBuilder]::new()
    $connection['Server'] = "(localdb)\$instance"
    $connection['Database'] = "BookCatalog_$id"
    $connection['AttachDbFilename'] = Join-Path $state 'BookCatalog.mdf'
    $connection['Integrated Security'] = 'true'
    $connection['Encrypt'] = 'false'
    $start.Environment['ConnectionStrings__BookCatalogContext'] = $connection.ConnectionString
    $script:app = [Diagnostics.Process]::Start($start)
    $clock = [Diagnostics.Stopwatch]::StartNew()
    while ($clock.Elapsed.TotalSeconds -lt 60) {
        if ($script:app.HasExited) { throw "BookCatalog exited before readiness: $($script:app.ExitCode)." }
        try {
            $ready = Request GET 'Books' $null
            Assert-Status $ready @(200)
            return
        }
        catch [Net.Http.HttpRequestException] {
            Start-Sleep -Milliseconds 500
        }
    }
    throw 'BookCatalog did not become ready within the smoke-check deadline.'
}

try {
    & $localDb create $instance
    if ($LASTEXITCODE -ne 0) { throw 'Could not create the task-owned LocalDB instance.' }
    $createdInstance = $true
    & $localDb start $instance
    if ($LASTEXITCODE -ne 0) { throw 'Could not start the task-owned LocalDB instance.' }
    Start-App
    $initial = @(Index-Rows)
    if ($initial.Count -ne 6 -or @($initial | Where-Object { $_.Title -match 'Matrix' }).Count) {
        throw 'Fresh synthetic database must show six active books and no inactive Matrix row.'
    }
    foreach ($missing in 'Books/Details/2147483000', 'Books/Edit/2147483000', 'Books/Delete/2147483000') {
        Assert-Status (Request GET $missing $null) @(404)
    }
    $valid = @{ Title = "Modernize synthetic $($id.Substring(0, 8))"; Author = 'Synthetic Author'; ISBN = '0000000000000'; PublishedYear = '2000'; IsActive = 'true' }
    Assert-Status (Request POST 'Books/Create' $valid) @(400, 403)
    foreach ($invalid in @(@{ Title = '' }, @{ Author = '' }, @{ PublishedYear = '1799' },
            @{ PublishedYear = '2101' }, @{ Title = ('x' * 201) }, @{ Author = ('x' * 101) }, @{ ISBN = ('0' * 14) })) {
        $fields = $valid.Clone()
        foreach ($key in $invalid.Keys) { $fields[$key] = $invalid[$key] }
        $fields += Form 'Books/Create'
        $response = Request POST 'Books/Create' $fields
        Assert-Status $response @(200)
        if ($response.Html -notmatch 'field-validation-error|validation-summary-errors') { throw 'Invalid input was not visibly rejected.' }
        if (@(Index-Rows).Count -ne $initial.Count) { throw 'Invalid or tokenless input changed the catalog.' }
    }
    $fields = $valid.Clone()
    $fields += Form 'Books/Create'
    Assert-Status (Request POST 'Books/Create' $fields) @(302, 303)
    $created = @(Index-Rows | Where-Object { $_.Title -ceq $valid.Title })
    if ($created.Count -ne 1) { throw 'Created synthetic book was not listed exactly once.' }
    $bookId = $created[0].Id
    $details = Request GET "Books/Details/$bookId" $null
    Assert-Status $details @(200)
    if (-not $details.Html.Contains($valid.Title)) { throw 'Created book details are incorrect.' }
    $editedTitle = "$($valid.Title) updated"
    foreach ($active in 'false', 'true') {
        $fields = $valid.Clone()
        $fields.Title = $editedTitle
        $fields.Id = "$bookId"
        $fields.IsActive = $active
        $fields += Form "Books/Edit/$bookId"
        Assert-Status (Request POST "Books/Edit/$bookId" $fields) @(302, 303)
        $visible = @(Index-Rows | Where-Object { $_.Id -eq $bookId })
        if (($active -ceq 'true' -and $visible.Count -ne 1) -or ($active -ceq 'false' -and $visible.Count -ne 0)) {
            throw 'Active-only filtering was not preserved.'
        }
    }
    Stop-App
    Start-App
    $persisted = @(Index-Rows | Where-Object { $_.Id -eq $bookId -and $_.Title -ceq $editedTitle })
    if ($persisted.Count -ne 1) { throw 'Edited data did not persist across restart.' }
    $fields = Form "Books/Delete/$bookId"
    $fields.id = "$bookId"
    Assert-Status (Request POST "Books/Delete/$bookId" $fields) @(302, 303)
    if (@(Index-Rows).Count -ne $initial.Count) { throw 'Deletion did not restore the initial active catalog count.' }
    Assert-Status (Request GET "Books/Details/$bookId" $null) @(404)
    Write-Output 'BookCatalog synthetic CRUD, validation, antiforgery, filtering, ordering and restart-persistence smoke checks passed.'
}
finally {
    Stop-App
    $client.Dispose()
    $handler.Dispose()
    if ($createdInstance) {
        & $localDb stop $instance -k
        $stopCode = $LASTEXITCODE
        & $localDb delete $instance
        if ($LASTEXITCODE -ne 0 -or $stopCode -ne 0) { throw 'Task-owned LocalDB cleanup failed; inspect the named smoke instance.' }
    }
    if ((Split-Path $state -Leaf) -cnotmatch '^bookcatalog-smoke-[0-9a-f]{32}$') { throw 'Unexpected smoke cleanup path.' }
    Remove-Item -LiteralPath $state -Recurse -Force
}
