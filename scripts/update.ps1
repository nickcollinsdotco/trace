<#
.SYNOPSIS
    Update the installed TRACE to the latest main: pull, build, close the
    running app, and launch the new installer.

.DESCRIPTION
    Everyday use, from the trace folder:

        pnpm update-app -Check    see what an update would bring; changes nothing
        pnpm update-app           update, asking before the build and before
                                  closing TRACE

    It works on the repository it lives in, whichever folder it is run from.

    The order is deliberate. It shows what is about to happen before doing
    anything slow, and everything that can fail slowly - the pull, the
    install, a build that takes minutes - happens while the old TRACE keeps
    running, so a failed update leaves a working app behind. TRACE is only
    closed once there is a fresh installer to replace it with.

    Kept to plain ASCII: Windows PowerShell 5.1 reads a UTF-8 script without
    a byte-order mark as the local code page, and a single typographic quote
    becomes a parse error on someone else's machine.

.PARAMETER Check
    Preview only: fetch from GitHub and show what an update would pull and
    build. Nothing is pulled, built, installed or closed.

.PARAMETER Yes
    Do not ask before building or before closing TRACE. Only safe when no
    meeting is recording.

.EXAMPLE
    pnpm update-app -Check
    pnpm update-app
    pnpm update-app -Yes
#>
[CmdletBinding()]
param(
    [switch]$Check,
    [switch]$Yes
)

$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $PSScriptRoot
# Forward slashes: Windows accepts them, and they keep the script testable
# under PowerShell 7 on Linux, which is where CI and the tests run.
$bundle = Join-Path $repo 'src-tauri/target/release/bundle/nsis'
$steps = 7

function Write-Step([int]$n, [string]$text) {
    Write-Host ''
    Write-Host "[$n/$steps] $text" -ForegroundColor Cyan
}

function Stop-Update([string]$message) {
    Write-Host ''
    Write-Host "Update stopped: $message" -ForegroundColor Red
    Write-Host 'Nothing was installed. The TRACE you have is unchanged.' -ForegroundColor Red
    exit 1
}

# Native commands do not throw on failure in Windows PowerShell; they set
# $LASTEXITCODE. Every external step goes through here so none is missed.
function Invoke-Checked([string]$what, [scriptblock]$command) {
    & $command
    if ($LASTEXITCODE -ne 0) {
        Stop-Update "$what failed (exit code $LASTEXITCODE). The output above says why."
    }
}

# The installed version, as Windows' list of installed programs records it -
# the same place Settings > Apps reads. $null when TRACE is not installed, or
# off Windows.
function Get-InstalledVersion {
    $keys = @(
        'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
        'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
        'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
    )
    foreach ($key in $keys) {
        if (-not (Test-Path $key)) { continue }
        $entry = Get-ChildItem $key -ErrorAction SilentlyContinue |
            ForEach-Object { Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue } |
            Where-Object { $_.DisplayName -eq 'TRACE' } |
            Select-Object -First 1
        if ($entry) { return $entry.DisplayVersion }
    }
    return $null
}

function Confirm-Step([string]$question) {
    if ($Yes) { return $true }
    $answer = Read-Host "$question [y/N]"
    return $answer -match '^(y|yes)$'
}

foreach ($tool in 'git', 'pnpm') {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
        Stop-Update "'$tool' is not on PATH. Open a new terminal, or install it."
    }
}

# --- 1. Nothing uncommitted --------------------------------------------------

Write-Step 1 'Checking for uncommitted changes'
# Tracked files only. Untracked files survive a checkout and a pull, and a
# stray untracked file is common enough that refusing over one would make
# this script more annoying than useful.
$dirty = git -C $repo status --porcelain --untracked-files=no
if ($LASTEXITCODE -ne 0) {
    Stop-Update "$repo is not a git repository."
}
if ($dirty -and -not $Check) {
    Write-Host ($dirty -join "`n")
    Stop-Update 'there are uncommitted changes (listed above). Commit them, or set them aside with "git stash", then run this again.'
}
if ($dirty) {
    Write-Host 'Some; listed below.'
} else {
    Write-Host 'None.'
}

# --- 2. What an update would bring -------------------------------------------

Write-Step 2 'Checking GitHub for changes'
Invoke-Checked 'Fetching from GitHub (check your connection)' { git -C $repo fetch origin main }

$branch = git -C $repo rev-parse --abbrev-ref HEAD
# Compared against local main, which is what the update pulls into. A clone
# without a local main yet takes everything on origin/main.
$hasMain = git -C $repo rev-parse --verify --quiet main
$range = if ($hasMain) { 'main..origin/main' } else { 'origin/main' }
$incoming = @(git -C $repo log --oneline --no-decorate $range)
$unpushed = if ($hasMain) { [int](git -C $repo rev-list --count origin/main..main) } else { 0 }

$available = ((git -C $repo show origin/main:src-tauri/tauri.conf.json) -join "`n" | ConvertFrom-Json).version
$installed = Get-InstalledVersion

Write-Host ''
Write-Host ("  Installed   " + $(if ($installed) { $installed } else { 'not found' }))
Write-Host "  Available   $available (main on GitHub)"
if ($incoming.Count -eq 0) {
    Write-Host '  Incoming    nothing new since your last update'
} else {
    Write-Host "  Incoming    $($incoming.Count) commit$(if ($incoming.Count -ne 1) { 's' }):"
    foreach ($line in $incoming) { Write-Host "                $line" }
}
if ($branch -ne 'main') {
    Write-Host "  Note        you are on '$branch'; the update switches to main." -ForegroundColor Yellow
}
if ($unpushed -gt 0) {
    Write-Host "  Note        local main has $unpushed commit(s) not on GitHub; the pull will stop if main has also moved." -ForegroundColor Yellow
}
if ($dirty) {
    Write-Host '  Note        uncommitted changes would stop the update:' -ForegroundColor Yellow
    foreach ($line in $dirty) { Write-Host "                $line" -ForegroundColor Yellow }
}

$current = $incoming.Count -eq 0 -and $installed -eq $available
if ($current) {
    Write-Host ''
    Write-Host "You are up to date. Updating now would rebuild and reinstall $available." -ForegroundColor Green
}

if ($Check) {
    Write-Host ''
    Write-Host 'Preview only: nothing was pulled, built, installed or closed.'
    if (-not $current) { Write-Host 'Run "pnpm update-app" to update.' }
    exit 0
}

Write-Host ''
Write-Host "This will pull main, install dependencies and build TRACE $available."
Write-Host 'The build takes several minutes; TRACE stays usable meanwhile, and you'
Write-Host 'will be asked again before it is closed.'
if (-not (Confirm-Step 'Build now?')) {
    Write-Host ''
    Write-Host 'Nothing was changed.'
    exit 0
}

# --- 3. Latest main ----------------------------------------------------------

Write-Step 3 'Updating to the latest main'
Invoke-Checked 'Switching to main' { git -C $repo checkout main }
# --ff-only: if local main has commits of its own, a merge here would invent
# a commit nobody asked for. Better to stop and say so.
Invoke-Checked 'git pull (check your connection, or whether local main has diverged)' {
    git -C $repo pull --ff-only origin main
}
$version = (Get-Content (Join-Path $repo 'src-tauri/tauri.conf.json') -Raw | ConvertFrom-Json).version

# --- 4. Dependencies ---------------------------------------------------------

Write-Step 4 'Installing dependencies'
Invoke-Checked 'pnpm install' { pnpm --dir $repo install }

# --- 5. Build ----------------------------------------------------------------

Write-Step 5 "Building TRACE $version (several minutes; TRACE stays usable meanwhile)"
$buildStarted = Get-Date
Invoke-Checked 'The build' { pnpm --dir $repo tauri build }

# Newest installer, and it must be from this build. A stale one from an
# earlier run would install the old version while saying the update worked.
$installer = Get-ChildItem -Path $bundle -Filter '*-setup.exe' -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
if (-not $installer -or $installer.LastWriteTime -lt $buildStarted) {
    Stop-Update "the build finished but wrote no new installer to $bundle."
}
Write-Host "Built $($installer.Name)."

# --- 6. Close the running TRACE ----------------------------------------------

Write-Step 6 'Closing TRACE'
# By name, which also finds a TRACE with no window: minimised to the tray, or
# hidden. Development builds run from inside this repository and are left
# alone - closing the window you are testing in would be a surprise.
$running = @(Get-Process -Name 'TRACE' -ErrorAction SilentlyContinue | Where-Object {
    -not ($_.Path -and $_.Path.StartsWith($repo, [System.StringComparison]::OrdinalIgnoreCase))
})

if ($running.Count -eq 0) {
    Write-Host 'TRACE is not running.'
} else {
    if (-not $Yes) {
        Write-Host 'TRACE is running. If a meeting is recording, stop it in TRACE first:' -ForegroundColor Yellow
        Write-Host 'closing the app mid-meeting ends the recording there (what was captured' -ForegroundColor Yellow
        Write-Host 'is offered for recovery next time TRACE opens).' -ForegroundColor Yellow
    }
    if (-not (Confirm-Step 'Close TRACE and install the update now?')) {
        Write-Host ''
        Write-Host "Left TRACE running. The installer is ready whenever you are:"
        Write-Host "  $($installer.FullName)"
        Write-Host 'or run "pnpm open-installers".'
        exit 0
    }

    foreach ($process in $running) {
        # Ask first, as clicking the close button would, and force only if it
        # is still there after a grace period. One with no window to ask - in
        # the tray, or hidden - is stopped straight away.
        if ($process.CloseMainWindow()) {
            if (-not $process.WaitForExit(10000)) {
                Stop-Process -Id $process.Id -Force
            }
        } else {
            Stop-Process -Id $process.Id -Force
        }
    }
    Write-Host 'TRACE closed.'
}

# --- 7. Install --------------------------------------------------------------

Write-Step 7 "Launching $($installer.Name)"
Start-Process -FilePath $installer.FullName
Write-Host ''
Write-Host "The installer is open. Finish it, and TRACE $version starts from there." -ForegroundColor Green
Write-Host 'The version is shown at the bottom right of the app and on the About page.'
