# Shared helpers for scripts/local-*.ps1 (dot-sourced). Local development only.
Set-StrictMode -Version 2.0

$script:Root       = Split-Path $PSScriptRoot -Parent
$script:StateDir   = Join-Path $script:Root '.local'
$script:BackendDir = Join-Path $script:Root 'backend-django'
$script:FrontDir   = Join-Path $script:Root 'frontend'
$script:Py         = Join-Path $script:BackendDir '.venv\Scripts\python.exe'
$script:NextBin    = Join-Path $script:FrontDir 'node_modules\next\dist\bin\next'

$script:ApiPort = 8100
$script:WebPort = 3300
$script:ApiUrl  = "http://127.0.0.1:$($script:ApiPort)"
$script:WebUrl  = "http://127.0.0.1:$($script:WebPort)"

function Write-Ok($m)   { Write-Host "[ OK ] $m" -ForegroundColor Green }
function Write-Bad($m)  { Write-Host "[FAIL] $m" -ForegroundColor Red }
function Write-Info($m) { Write-Host "[ .. ] $m" -ForegroundColor Cyan }
function Write-Warn2($m){ Write-Host "[WARN] $m" -ForegroundColor Yellow }

function Get-PidFile($name) { Join-Path $script:StateDir "$name.pid" }

# Returns the PID recorded for $name only if that process is alive AND its command line still
# contains $token (guards against PID reuse: we never touch a process that is not ours).
function Get-OwnedPid($name, $token) {
    $f = Get-PidFile $name
    if (-not (Test-Path $f)) { return $null }
    $procId = [int](Get-Content $f -ErrorAction SilentlyContinue | Select-Object -First 1)
    if (-not $procId) { return $null }
    $p = Get-CimInstance Win32_Process -Filter "ProcessId=$procId" -ErrorAction SilentlyContinue
    if ($p -and $p.CommandLine -and $p.CommandLine.Contains($token)) { return $procId }
    return $null
}

# Launch a hidden, fully detached process (no inherited handles, so the caller's pipes can close).
# Environment is passed explicitly via `set` because WMI-created processes do not inherit ours.
# Returns the PID of the cmd.exe wrapper; stopping it with `taskkill /T` removes the whole tree.
function Start-Detached($envPairs, $exe, $arguments, $workDir, $outLog, $errLog) {
    $sets = ($envPairs.GetEnumerator() | ForEach-Object { "set $($_.Key)=$($_.Value)&& " }) -join ''
    $inner = "$sets`"$exe`" $arguments > `"$outLog`" 2> `"$errLog`""
    $r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = "cmd.exe /d /s /c `"$inner`""; CurrentDirectory = $workDir }
    if ($r.ReturnValue -ne 0) { throw "Process creation failed (code $($r.ReturnValue))" }
    return [int]$r.ProcessId
}

function Get-PortOwner($port) {
    $c = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $c) { return $null }
    return $c.OwningProcess
}

function Test-Http($url, $timeoutSec = 10) {
    try { return (Invoke-WebRequest $url -UseBasicParsing -TimeoutSec $timeoutSec -MaximumRedirection 0 -ErrorAction Stop).StatusCode }
    catch {
        if ($_.Exception.Response) { return [int]$_.Exception.Response.StatusCode }
        return 0
    }
}

function Wait-Http($url, $okCodes, $timeoutSec) {
    $deadline = (Get-Date).AddSeconds($timeoutSec)
    while ((Get-Date) -lt $deadline) {
        if ($okCodes -contains (Test-Http $url 15)) { return $true }
        Start-Sleep -Seconds 2
    }
    return $false
}

function Find-Psql {
    $cmd = Get-Command psql.exe -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $hit = Get-ChildItem "$env:ProgramFiles\PostgreSQL\*\bin\psql.exe" -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1
    if ($hit) { return $hit.FullName }
    return $null
}

function Get-FreeRamMb {
    [math]::Round((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1024)
}
