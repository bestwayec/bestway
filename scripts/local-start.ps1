<#
.SYNOPSIS  Start the local BESTWAY stack (Django API + Next.js dev server) on loopback ports.
.DESCRIPTION
  Low-RAM mode: only PostgreSQL (existing Windows service), Django and Next.js are started.
  Redis, assessment workers, Telegram bot and AI/STT integrations stay disabled.
  Safe to run repeatedly: already-running project processes are reused, and a port held by a
  foreign process is reported instead of being killed.
.PARAMETER SkipFrontend  Start only the Django API.
.PARAMETER NoWarmup      Do not pre-compile the main Next.js routes after start-up.
#>
param([switch]$SkipFrontend, [switch]$NoWarmup)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'local-common.ps1')
New-Item -ItemType Directory -Force $script:StateDir | Out-Null

# ---- 1. prerequisites -------------------------------------------------------------------------
$missing = @()
if (-not (Test-Path $script:Py))                                     { $missing += "Python venv missing: cd backend-django; python -m venv .venv; .venv\Scripts\pip install -r requirements\dev.txt" }
if (-not (Test-Path (Join-Path $script:BackendDir '.env')))          { $missing += "backend-django\.env missing (copy .env.example, set DATABASE_URL to a *_local database, DJANGO_SECRET_KEY, JWT_SECRET)" }
if (-not $SkipFrontend) {
    if (-not (Test-Path $script:NextBin))                            { $missing += "Frontend dependencies missing: cd frontend; npm ci" }
    if (-not (Test-Path (Join-Path $script:FrontDir '.env.local')))  { $missing += "frontend\.env.local missing (API_URL=$($script:ApiUrl)/v1)" }
    if (-not (Get-Command node -ErrorAction SilentlyContinue))       { $missing += "Node.js not found in PATH" }
}
$pgSvc = Get-Service | Where-Object { $_.Name -like 'postgresql*' } | Select-Object -First 1
if (-not $pgSvc)                          { $missing += "No PostgreSQL Windows service found" }
elseif ($pgSvc.Status -ne 'Running')      { $missing += "PostgreSQL service '$($pgSvc.Name)' is $($pgSvc.Status). Start it (admin): Start-Service $($pgSvc.Name)" }
if ($missing) { $missing | ForEach-Object { Write-Bad $_ }; exit 1 }
Write-Ok "Prerequisites present; PostgreSQL service '$($pgSvc.Name)' running; free RAM $(Get-FreeRamMb) MB"

# ---- 2. database/schema gate (read-only) -----------------------------------------------------
Push-Location $script:BackendDir
try {
    $env:DJANGO_SETTINGS_MODULE = 'config.settings.local'
    $out = & $script:Py manage.py check_legacy_schema 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) {
        Write-Bad "Database/schema check failed:`n$out"
        Write-Info "Fresh database? Apply schema: cd backend; npx prisma migrate deploy ; cd ..\backend-django ; .venv\Scripts\python manage.py migrate ; .venv\Scripts\python manage.py seed_local_dev"
        exit 1
    }
    Write-Ok ($out.Trim())
} finally { Pop-Location }

# ---- 3. Django API ---------------------------------------------------------------------------
$apiPid = Get-OwnedPid 'django' 'runserver'
if ($apiPid) { Write-Ok "Django already running (PID $apiPid)" }
else {
    $owner = Get-PortOwner $script:ApiPort
    if ($owner) { Write-Bad "Port $($script:ApiPort) is used by PID $owner (not started by this project). Not touching it."; exit 1 }
    $newPid = Start-Detached ([ordered]@{ DJANGO_SETTINGS_MODULE = 'config.settings.local' }) $script:Py `
        "manage.py runserver 127.0.0.1:$($script:ApiPort) --noreload" $script:BackendDir `
        (Join-Path $script:StateDir 'django.out.log') (Join-Path $script:StateDir 'django.err.log')
    $newPid | Set-Content (Get-PidFile 'django') -Encoding ascii
    if (-not (Wait-Http "$($script:ApiUrl)/v1/health" @(200) 60)) { Write-Bad "Django did not become healthy; see .local\django.err.log"; exit 1 }
    Write-Ok "Django started (PID $newPid)"
}

# ---- 4. Next.js ------------------------------------------------------------------------------
if (-not $SkipFrontend) {
    $webPid = Get-OwnedPid 'next' 'next'
    if ($webPid) { Write-Ok "Next.js already running (PID $webPid)" }
    else {
        $owner = Get-PortOwner $script:WebPort
        if ($owner) { Write-Bad "Port $($script:WebPort) is used by PID $owner (not started by this project). Not touching it."; exit 1 }
        $node = (Get-Command node).Source
        $newPid = Start-Detached ([ordered]@{
                API_URL                = "$($script:ApiUrl)/v1"
                NODE_OPTIONS           = '--max-old-space-size=1536'   # cap the dev server heap on a 4 GB machine
                NEXT_TELEMETRY_DISABLED = '1'
            }) $node "`"$($script:NextBin)`" dev -p $($script:WebPort) -H 127.0.0.1" $script:FrontDir `
            (Join-Path $script:StateDir 'next.out.log') (Join-Path $script:StateDir 'next.err.log')
        $newPid | Set-Content (Get-PidFile 'next') -Encoding ascii
        Write-Info "Next.js starting (PID $newPid); first page compile can take 30-60 s on 4 GB RAM..."
        if (-not (Wait-Http "$($script:WebUrl)/en/login" @(200, 307) 240)) { Write-Bad "Next.js did not respond; see .local\next.err.log"; exit 1 }
        Write-Ok "Next.js started (PID $newPid)"
    }
    if (-not $NoWarmup) {
        # Cold compiles can stall the dev server past the proxy's 8 s upstream timeout, so touch the main routes once.
        foreach ($path in '/en/login', '/en', '/en/dashboard', '/en/mock') {
            try { Invoke-WebRequest "$($script:WebUrl)$path" -UseBasicParsing -TimeoutSec 240 -MaximumRedirection 5 | Out-Null } catch { }
        }
        Write-Ok "Main routes pre-compiled"
    }
}

Write-Host ""
Write-Host "BESTWAY local is up:" -ForegroundColor Green
if (-not $SkipFrontend) { Write-Host "  Website   : $($script:WebUrl)/en/login   (default locale: $($script:WebUrl)/login)" }
Write-Host "  API       : $($script:ApiUrl)/v1/health"
Write-Host "  Django UI : $($script:ApiUrl)/admin/"
Write-Host "  Accounts  : synthetic users from 'manage.py seed_local_dev' (phone numbers/password are in backend-django\apps\core\management\commands\seed_local_dev.py)"
Write-Host "  Logs      : $($script:StateDir)"
Write-Host "  Stop with : powershell -File scripts\local-stop.ps1"
