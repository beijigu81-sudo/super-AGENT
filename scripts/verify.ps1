# Independent verification: bypass every sub-agent and ask the sources directly.
# This script IS the cross-check step. What the sub-agents claim is irrelevant;
# what this script prints is the fact.
#
# Usage (Windows PowerShell 5.1 or pwsh):
#   powershell -ExecutionPolicy Bypass -File .\scripts\verify.ps1
#
# Two environment constraints are baked in, both measured on 2026-11-07:
#   1. WMI/CIM is denied inside the sandbox -> Get-CimInstance / Get-Volume fail.
#   2. .NET TLS (schannel) cannot acquire credentials -> Invoke-RestMethod /
#      Invoke-WebRequest fail with "connection closed / SEC_E_NO_CREDENTIALS".
#      Node.js ships its own OpenSSL stack, so HTTP goes through node -e instead.
#
# Kept ASCII-only on purpose: Windows PowerShell reads BOM-less .ps1 files as ANSI,
# and non-ASCII strings break on non-English locales.

$ErrorActionPreference = 'Stop'
$fail = 0

function Write-Section([string]$title) {
    Write-Host ''
    Write-Host ('== ' + $title + ' ==') -ForegroundColor Cyan
}

function Get-Json([string]$js) {
    $out = & node -e $js 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host ('  node failed: ' + ($out -join ' ')) -ForegroundColor Red
        return $null
    }
    return ($out | Out-String).Trim()
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host 'node not found: web checks cannot run here.' -ForegroundColor Red
    $fail++
}

Write-Section '1/4 vscode latest release (GitHub API)'
$js1 = "fetch('https://api.github.com/repos/microsoft/vscode/releases/latest',{headers:{'user-agent':'super-agent-verify'}}).then(r=>{if(!r.ok)throw new Error('HTTP '+r.status);return r.json()}).then(j=>console.log(JSON.stringify({tag_name:j.tag_name,prerelease:j.prerelease,published_at:j.published_at})))"
$r1 = Get-Json $js1
if ($r1) {
    $o = $r1 | ConvertFrom-Json
    'tag_name     : {0}' -f $o.tag_name
    'prerelease   : {0}' -f $o.prerelease
    'published_at : {0}' -f $o.published_at
} else { $fail++ }

Write-Section '2/4 Node.js latest LTS (nodejs.org/dist/index.json)'
$js2 = "fetch('https://nodejs.org/dist/index.json').then(r=>{if(!r.ok)throw new Error('HTTP '+r.status);return r.json()}).then(a=>{const x=a.find(v=>v.lts!==false);console.log(JSON.stringify({version:x.version,lts:x.lts,date:x.date}))})"
$r2 = Get-Json $js2
if ($r2) {
    $o = $r2 | ConvertFrom-Json
    'version : {0}' -f $o.version
    'lts     : {0}' -f $o.lts
    'date    : {0}' -f $o.date
} else { $fail++ }

Write-Section '3/4 npm typescript latest (registry.npmjs.org)'
$js3 = "fetch('https://registry.npmjs.org/typescript/latest').then(r=>{if(!r.ok)throw new Error('HTTP '+r.status);return r.json()}).then(j=>console.log(JSON.stringify({name:j.name,version:j.version})))"
$r3 = Get-Json $js3
if ($r3) {
    $o = $r3 | ConvertFrom-Json
    'name    : {0}' -f $o.name
    'version : {0}' -f $o.version
} else { $fail++ }

Write-Section '4/4 Local hardware (no WMI, no Get-PSDrive)'
'PROCESSOR_IDENTIFIER : {0}' -f $env:PROCESSOR_IDENTIFIER
'NUMBER_OF_PROCESSORS : {0}' -f $env:NUMBER_OF_PROCESSORS
$d = [System.IO.DriveInfo]::new('C:\')
'C: free              : {0:N1} GB / {1:N1} GB' -f ($d.AvailableFreeSpace / 1GB), ($d.TotalSize / 1GB)

Write-Host ''
if ($fail -gt 0) {
    Write-Host ("DONE with {0} failed section(s)." -f $fail) -ForegroundColor Red
    exit 1
}
Write-Host 'DONE. Compare field by field with what the sub-agents claimed.' -ForegroundColor Green
