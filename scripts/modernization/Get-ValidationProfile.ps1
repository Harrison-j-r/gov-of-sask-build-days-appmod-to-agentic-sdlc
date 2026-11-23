#requires -Version 7.4
[CmdletBinding()]
param(
    [Parameter(Mandatory)] [ValidateSet('java', 'dotnet')] [string] $Track,
    [string] $Root = (Join-Path $PSScriptRoot '..\..')
)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'Modernization.psm1') -Force -DisableNameChecking
$profile = Get-ValidationProfile -Root $Root -Track $Track
Set-WorkflowOutput -Name profile -Value $profile
Write-Output "$Track validation profile: $profile"
