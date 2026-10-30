$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'OwnedRuntime.ps1')
function Assert($condition, $message) { if (-not $condition) { throw $message } }
$root = Split-Path $PSScriptRoot -Parent
$temp = Join-Path ([IO.Path]::GetTempPath()) ('devtrack-owned-test-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $temp | Out-Null
$node = (Get-Command node).Source
$sentinel = $null; $runtime = $null; $other = $null
try {
    $fixture = Join-Path $temp 'fixture.cjs'
    $marker = Join-Path $temp 'pids.json'
    [IO.File]::WriteAllText($fixture, 'const cp=require("child_process"),fs=require("fs"); const child=cp.spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"}); fs.writeFileSync(process.argv[2],JSON.stringify([process.pid,child.pid])); setInterval(()=>{},1000);')
    $sentinel = Start-Process -FilePath $node -ArgumentList '-e','"setInterval(()=>{},1000)"' -WindowStyle Hidden -PassThru
    $name = 'Local\DevTrack-test-' + [guid]::NewGuid()
    Assert (-not [DevTrack.OwnedRuntime]::Stop($name)) 'Missing job must be a no-op'
    $runtime = [DevTrack.OwnedRuntime]::new($name)
    $duplicateRejected = $false
    try { $duplicate = [DevTrack.OwnedRuntime]::new($name); $duplicate.Dispose() } catch { $duplicateRejected = $true }
    Assert $duplicateRejected 'Concurrent launcher must be rejected'
    $runtime.Start($node, ('"{0}" "{1}"' -f $fixture,$marker), $root)
    for ($attempt=0; $attempt -lt 100 -and -not (Test-Path $marker); $attempt++) { Start-Sleep -Milliseconds 100 }
    Assert (Test-Path $marker) 'Owned parent and child must start'
    $ownedIds = Get-Content -Raw $marker | ConvertFrom-Json
    foreach ($ownedId in $ownedIds) { Assert ($null -ne (Get-Process -Id $ownedId -ErrorAction SilentlyContinue)) 'Owned fixture must be alive' }
    Assert ($runtime.IsActive()) 'Runtime must report active consumers'
    $otherName = $name + '-other-checkout'
    $other = [DevTrack.OwnedRuntime]::new($otherName)
    $other.Start($node, '-e "setInterval(()=>{},1000)"', $root)
    Assert ([DevTrack.OwnedRuntime]::Stop($name)) 'Owned stop must succeed'
    for ($attempt=0; $attempt -lt 100; $attempt++) {
        $alive = @($ownedIds | Where-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue })
        if ($alive.Count -eq 0) { break }; Start-Sleep -Milliseconds 100
    }
    Assert ($alive.Count -eq 0) 'Owned descendants must exit'
    Assert (-not $runtime.IsActive()) 'External stop must release the starter wait loop'
    Assert (-not $sentinel.HasExited) 'Unrelated Node sentinel must survive'
    Assert ([DevTrack.OwnedRuntime]::Stop($otherName)) 'Other checkout job must remain accessible'
    Assert ([DevTrack.OwnedRuntime]::Stop($name)) 'Repeated stop must be safe'
    $runtime.Dispose(); $runtime = $null
    Assert (-not [DevTrack.OwnedRuntime]::Stop($name)) 'Disposed metadata cannot target a reused PID'
    $invalid = [DevTrack.OwnedRuntime]::new($name)
    try {
        $failed = $false
        try { $invalid.Start((Join-Path $temp 'missing.exe'), '', $root) } catch { $failed = $true }
        Assert $failed 'Failed launch must report failure'
    } finally { $invalid.Dispose() }
    Assert (-not [DevTrack.OwnedRuntime]::Stop($name)) 'Failed startup must release ownership'
    $closeMarker = Join-Path $temp 'close-pids.json'
    $closing = [DevTrack.OwnedRuntime]::new($name)
    try {
        $closing.Start($node, ('"{0}" "{1}"' -f $fixture,$closeMarker), $root)
        for ($attempt=0; $attempt -lt 100 -and -not (Test-Path $closeMarker); $attempt++) { Start-Sleep -Milliseconds 100 }
        Assert (Test-Path $closeMarker) 'Close fixture must start'
        $closeIds = Get-Content -Raw $closeMarker | ConvertFrom-Json
    } finally { $closing.Dispose() }
    for ($attempt=0; $attempt -lt 100; $attempt++) {
        $alive = @($closeIds | Where-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue })
        if ($alive.Count -eq 0) { break }; Start-Sleep -Milliseconds 100
    }
    Assert ($alive.Count -eq 0) 'Closing launcher ownership must kill descendants'
    Assert ((Get-DevTrackJobName $root) -ne (Get-DevTrackJobName $temp)) 'Checkouts need distinct identities'
    foreach ($file in @('start-dev.ps1','scripts/OwnedRuntime.ps1')) {
        $tokens=$null; $parseErrors=$null
        [Management.Automation.Language.Parser]::ParseFile((Join-Path $root $file),[ref]$tokens,[ref]$parseErrors) | Out-Null
        Assert ($parseErrors.Count -eq 0) "$file must parse"
    }
    Assert (-not ((Get-Content -Raw (Join-Path $root 'start-dev.ps1')) -match 'taskkill|Start-Process')) 'Starter must use owned launches exclusively'
    Write-Output 'PASS: owned parent/child stop, unrelated Node survival, checkout isolation, repeated/missing stop, duplicate launch, failed startup, no persisted PID targeting, and PowerShell parsing.'
} finally {
    if ($runtime) { $runtime.Dispose() }; if ($other) { $other.Dispose() }
    if ($sentinel) { if (-not $sentinel.HasExited) { $sentinel.Kill(); $sentinel.WaitForExit() }; $sentinel.Dispose() }
    # Only this invocation owns the freshly generated temporary directory.
    if ((Split-Path $temp -Leaf) -notlike 'devtrack-owned-test-*') { throw 'Unexpected fixture path' }
    Remove-Item -LiteralPath $temp -Recurse -Force
}
