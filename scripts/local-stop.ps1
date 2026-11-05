<#
.SYNOPSIS  Stop only the processes started by scripts/local-start.ps1.
.DESCRIPTION
  Reads .local\*.pid, verifies each PID still belongs to this project's command line, and stops
  that process tree. PostgreSQL and any unrelated Python/Node processes are never touched.
#>
$ErrorActionPreference = 'Continue'
. (Join-Path $PSScriptRoot 'local-common.ps1')

foreach ($svc in @(@{ n = 'next'; t = 'next' }, @{ n = 'django'; t = 'runserver' })) {
    $procId = Get-OwnedPid $svc.n $svc.t
    if ($procId) {
        & taskkill.exe /PID $procId /T /F | Out-Null
        Write-Ok "Stopped $($svc.n) (PID $procId, with children)"
    } else {
        Write-Info "$($svc.n): not running (or PID no longer belongs to this project)"
    }
    Remove-Item (Get-PidFile $svc.n) -ErrorAction SilentlyContinue
}
Write-Info "PostgreSQL service left running (shared with other projects)."
