<#
.SYNOPSIS  Read-only health check of the local BESTWAY stack. Exit code 0 = all PASS.
.PARAMETER Phone / Password  Synthetic account used for the proxy login probe (defaults match seed_local_dev).
#>
param([string]$Phone = '+998900000010', [string]$Password = 'LocalDev-2026!')
$ErrorActionPreference = 'Continue'
. (Join-Path $PSScriptRoot 'local-common.ps1')
$fail = 0
function Check($name, [scriptblock]$test) {
    try { $r = & $test; if ($r -eq $true) { Write-Ok $name } else { Write-Bad "$name -> $r"; $script:fail++ } }
    catch { Write-Bad "$name -> $($_.Exception.Message)"; $script:fail++ }
}

Check 'PostgreSQL service running' { $s = Get-Service | Where-Object { $_.Name -like 'postgresql*' } | Select-Object -First 1; if ($s -and $s.Status -eq 'Running') { $true } else { "status: $($s.Status)" } }
Check 'Python venv present'        { Test-Path $script:Py }
Check 'Frontend deps installed'    { Test-Path $script:NextBin }
Check 'Django system check' {
    Push-Location $script:BackendDir; $env:DJANGO_SETTINGS_MODULE = 'config.settings.local'
    $o = & $script:Py manage.py check 2>&1 | Out-String; Pop-Location
    if ($LASTEXITCODE -eq 0) { $true } else { $o.Trim() }
}
Check 'DB schema + Prisma ledger compatible' {
    Push-Location $script:BackendDir; $env:DJANGO_SETTINGS_MODULE = 'config.settings.local'
    $o = & $script:Py manage.py check_legacy_schema 2>&1 | Out-String; Pop-Location
    if ($LASTEXITCODE -eq 0) { $true } else { $o.Trim() }
}
Check "Django API health ($($script:ApiUrl)/v1/health)" { $c = Test-Http "$($script:ApiUrl)/v1/health"; if ($c -eq 200) { $true } else { "HTTP $c (is it started? scripts\local-start.ps1)" } }
Check "Next.js login page ($($script:WebUrl)/en/login)" { $c = Test-Http "$($script:WebUrl)/en/login" 60; if ($c -eq 200) { $true } else { "HTTP $c" } }
Check 'Frontend -> backend proxy login + /auth/me' {
    $ws = New-Object Microsoft.PowerShell.Commands.WebRequestSession
    $body = @{ phone = $Phone; password = $Password } | ConvertTo-Json
    $l = Invoke-WebRequest "$($script:WebUrl)/api/auth/login" -Method Post -Body $body -ContentType 'application/json' -WebSession $ws -UseBasicParsing -TimeoutSec 60
    if ($l.StatusCode -ne 200) { return "login HTTP $($l.StatusCode)" }
    $m = Invoke-WebRequest "$($script:WebUrl)/api/backend/auth/me" -WebSession $ws -UseBasicParsing -TimeoutSec 60
    if ($m.StatusCode -eq 200) { $true } else { "me HTTP $($m.StatusCode)" }
}
Check 'Exam catalogue API (student)' {
    $ws = New-Object Microsoft.PowerShell.Commands.WebRequestSession
    $null = Invoke-WebRequest "$($script:WebUrl)/api/auth/login" -Method Post -Body (@{ phone = $Phone; password = $Password } | ConvertTo-Json) -ContentType 'application/json' -WebSession $ws -UseBasicParsing -TimeoutSec 60
    $r = Invoke-RestMethod "$($script:WebUrl)/api/backend/mock/exams" -WebSession $ws -TimeoutSec 60
    if ($r.success -and @($r.data).Count -ge 1) { $true } else { 'no exams returned (run: manage.py seed_cbt_multilevel_exam)' }
}
Write-Info "Free RAM: $(Get-FreeRamMb) MB"
if ($fail) { Write-Host "`n$fail check(s) FAILED" -ForegroundColor Red; exit 1 }
Write-Host "`nAll checks PASSED" -ForegroundColor Green
