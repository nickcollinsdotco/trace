# Run the release diagnostic in its own process, with a second hard deadline.
# Input paths stay in the caller's local JSON. Outputs contain no audio or text.
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Config,
    [Parameter(Mandatory)][string]$OutputDirectory,
    [Parameter(Mandatory)][ValidatePattern('^[a-zA-Z0-9-]+$')][string]$RunLabel
)
$ErrorActionPreference = 'Stop'
$configPath = (Resolve-Path -LiteralPath $Config).Path
$settings = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
if ($settings.timeout_secs -lt 11 -or $settings.timeout_secs -gt 180) {
    throw 'timeout_secs must be between 11 and 180'
}
$binary = Join-Path $PSScriptRoot '../src-tauri/target/release/examples/resource_contention.exe'
if (-not (Test-Path -LiteralPath $binary)) { throw 'Build the release example first' }
[void](New-Item -ItemType Directory -Path $OutputDirectory -Force)
$outputRoot = (Resolve-Path -LiteralPath $OutputDirectory).Path
$prefix = Join-Path $outputRoot $RunLabel
foreach ($suffix in @('.jsonl', '.stderr.txt', '.process.csv', '.status.json')) {
    if (Test-Path -LiteralPath "$prefix$suffix") { throw 'Use a fresh run label; preserve prior evidence' }
}
$process = Start-Process -FilePath $binary -ArgumentList @('"' + $configPath + '"') `
    -WindowStyle Hidden -PassThru -RedirectStandardOutput "$prefix.jsonl" -RedirectStandardError "$prefix.stderr.txt"
$watch = [Diagnostics.Stopwatch]::StartNew()
$samples = [Collections.Generic.List[object]]::new()
$timedOut = $false
try {
    while (-not $process.HasExited) {
        $process.Refresh()
        if ($watch.Elapsed.TotalSeconds -gt ($settings.timeout_secs + 5)) {
            $timedOut = $true
            $process.Kill()
            break
        }
        try {
            $samples.Add([pscustomobject]@{
                elapsed_s = $watch.Elapsed.TotalSeconds
                threads = $process.Threads.Count
                cpu_ms = $process.TotalProcessorTime.TotalMilliseconds
                working_set_bytes = $process.WorkingSet64
                peak_working_set_bytes = $process.PeakWorkingSet64
                private_bytes = $process.PrivateMemorySize64
            })
        } catch [System.InvalidOperationException] {
            # Exiting between the liveness check and a property read is normal.
        }
        Start-Sleep -Milliseconds 500
    }
    $process.WaitForExit()
} finally {
    # Ctrl+C also stops only the process this invocation created.
    if (-not $process.HasExited) { $process.Kill(); $process.WaitForExit() }
    $samples | Export-Csv -LiteralPath "$prefix.process.csv" -NoTypeInformation
    [pscustomobject]@{ exit_code = $process.ExitCode; external_timeout = $timedOut } |
        ConvertTo-Json | Set-Content -LiteralPath "$prefix.status.json"
}
if ($timedOut -or $process.ExitCode -ne 0) {
    throw "Diagnostic stopped (exit $($process.ExitCode)); inspect $prefix.status.json and stderr"
}
Write-Output "$prefix.jsonl"
