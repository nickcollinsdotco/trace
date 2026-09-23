<#
.SYNOPSIS
    Update the installed TRACE to the latest main: pull, build, close the
    running app, and launch the new installer.

.DESCRIPTION
    Runs from anywhere; it works on the repository it lives in.

    The order is deliberate. Everything that can fail slowly - the pull, the
    install, a build that takes minutes - happens while the old TRACE keeps
    running, so a failed update leaves a working app behind. TRACE is only
    closed once there is a fresh installer to replace it with.

    Kept to plain ASCII: Windows PowerShell 5.1 reads a UTF-8 script without
    a byte-order mark as the local code page, and a single typographic quote
    becomes a parse error on someone else's machine.

.PARAMETER Yes
    Close TRACE without asking first. Only safe when no meeting is recording.

.EXAMPLE
    pnpm update-app
    pnpm update-app -Yes
#>
[CmdletBinding()]
param(
    [switch]$Yes
)

$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $PSScriptRoot
# Forward slashes: Windows accepts them, and they keep the script testable
# under PowerShell 7 on Linux, which is where CI and the tests run.
$bundle = Join-Path $repo 'src-tauri/target/release/bundle/nsis'
$steps = 6

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
if ($dirty) {
    Write-Host ($dirty -join "`n")
    Stop-Update 'there are uncommitted changes (listed above). Commit them, or set them aside with "git stash", then run this again.'
}

# --- 2. Latest main ----------------------------------------------------------

Write-Step 2 'Updating to the latest main'
$before = git -C $repo rev-parse --short HEAD
Invoke-Checked 'Switching to main' { git -C $repo checkout main }
# --ff-only: if local main has commits of its own, a merge here would invent
# a commit nobody asked for. Better to stop and say so.
Invoke-Checked 'git pull (check your connection, or whether local main has diverged)' {
    git -C $repo pull --ff-only
}
$after = git -C $repo rev-parse --short HEAD
if ($before -eq $after) {
    Write-Host "Already up to date at $after. Rebuilding anyway."
} else {
    Write-Host "Updated $before -> $after."
}

$version = (Get-Content (Join-Path $repo 'src-tauri/tauri.conf.json') -Raw | ConvertFrom-Json).version

# --- 3. Dependencies ---------------------------------------------------------

Write-Step 3 'Installing dependencies'
Invoke-Checked 'pnpm install' { pnpm --dir $repo install }

# --- 4. Build ----------------------------------------------------------------

Write-Step 4 "Building TRACE $version (several minutes; TRACE stays usable meanwhile)"
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

# --- 5. Close the running TRACE ----------------------------------------------

Write-Step 5 'Closing TRACE'
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
        $answer = Read-Host 'Close TRACE and install the update now? [y/N]'
        if ($answer -notmatch '^(y|yes)$') {
            Write-Host ''
            Write-Host "Left TRACE running. The installer is ready whenever you are:"
            Write-Host "  $($installer.FullName)"
            Write-Host 'or run "pnpm open-installers".'
            exit 0
        }
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

# --- 6. Install --------------------------------------------------------------

Write-Step 6 "Launching $($installer.Name)"
Start-Process -FilePath $installer.FullName
Write-Host ''
Write-Host "The installer is open. Finish it, and TRACE $version starts from there." -ForegroundColor Green
Write-Host 'The version is shown at the bottom right of the app and on the About page.'
