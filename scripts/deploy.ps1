<#
Safe update for a Windows server (PowerShell 5.1 or 7). Same steps as scripts/deploy.sh:
builds the new version in its own folder while the old one keeps serving, tries it on a spare port,
switches with `pm2 reload` (no downtime), and switches straight back if /api/health fails afterwards.

Folder layout under -Base (default C:\opl-tracker):
  repo.git\             a copy of the git repository (only when deploying from git)
  releases\<time>-<id>  one folder per version; the last 3 are kept for rollback
  shared\.env.local     the settings, copied into every release (edit here, then deploy again)
  shared\state\         files that must survive updates (sent-today stamps, backups)
  current               link (junction) to the release that is running

Examples (from an elevated or normal PowerShell; pm2 and node must be on PATH):
  powershell -ExecutionPolicy Bypass -File scripts\deploy.ps1 -From C:\Users\me\Downloads\opl_tracker
  powershell -ExecutionPolicy Bypass -File scripts\deploy.ps1 -Repo https://github.com/ORG/opl_tracker.git
  powershell -ExecutionPolicy Bypass -File scripts\deploy.ps1                (later updates from git)
  powershell -ExecutionPolicy Bypass -File scripts\deploy.ps1 -Rollback
A test server beside the real one: -Base C:\opl-test -Port 3100 -Prefix opl-test
(with its own shared\.env.local pointing at the test Supabase project).
#>
param(
  [string]$Base = 'C:\opl-tracker',
  [string]$Repo = '',
  [string]$Ref = '',
  [string]$From = '',
  [int]$Port = 0,
  [string]$Prefix = '',
  [int]$TrialPort = 0,
  [switch]$Rollback,
  [switch]$SkipTests
)
$ErrorActionPreference = 'Stop'
$OnWindows = ($PSVersionTable.PSEdition -eq 'Desktop') -or $IsWindows

function Say([string]$m) { Write-Host ''; Write-Host "==> $m" }
function Die([string]$m) { Write-Host ''; Write-Host "DEPLOY FAILED: $m" -ForegroundColor Red; throw 'deploy-failed' }
function Exe([string]$name) { if ($OnWindows -and $name -in @('npm', 'pm2')) { "$name.cmd" } else { $name } }

# Runs a command line with its output in a log file (or hidden); returns the exit code.
# (Native programs writing to stderr would stop PowerShell 5.1 with 'Stop', so they go through the shell.)
function Run([string]$line, [string]$log = '') {
  $target = if ($log) { "`"$log`"" } elseif ($OnWindows) { 'NUL' } else { '/dev/null' }
  if ($OnWindows) { cmd /c "$line > $target 2>&1" } else { /bin/sh -c "$line > $target 2>&1" }
  return $LASTEXITCODE
}
function Q([string]$p) { "`"$p`"" }

New-Item -ItemType Directory -Force -Path $Base | Out-Null
$Base = (Resolve-Path $Base).Path
$cfgFile = Join-Path $Base 'deploy.env'
if (Test-Path $cfgFile) {
  foreach ($l in Get-Content $cfgFile) {
    if ($l -match '^\s*(REPO|REF|PORT|PREFIX)\s*=\s*(.*?)\s*$') {
      switch ($Matches[1]) {
        'REPO' { if (-not $Repo) { $Repo = $Matches[2] } }
        'REF' { if (-not $Ref) { $Ref = $Matches[2] } }
        'PORT' { if (-not $Port) { $Port = [int]$Matches[2] } }
        'PREFIX' { if (-not $Prefix) { $Prefix = $Matches[2] } }
      }
    }
  }
}
if (-not $Ref) { $Ref = 'main' }
if (-not $Port) { $Port = 3000 }
if (-not $Prefix) { $Prefix = 'opl' }
if (-not $TrialPort) { $TrialPort = $Port + 999 }
$Pm2 = if ($env:PM2) { $env:PM2 } else { Exe 'pm2' }
$App = "$Prefix-tracker"
$Releases = Join-Path $Base 'releases'
$Shared = Join-Path $Base 'shared'
$State = Join-Path $Shared 'state'
$Current = Join-Path $Base 'current'
New-Item -ItemType Directory -Force -Path $Releases, $State | Out-Null

function Health([int]$p, [string]$want = '', [int]$need = 1) {
  $ok = 0; $body = 'none'
  for ($i = 0; $i -lt 60; $i++) {
    try {
      $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 -Uri "http://127.0.0.1:$p/api/health"
      $body = $r.Content
    } catch {
      $body = $_.Exception.Message
      try { $body = (New-Object IO.StreamReader($_.Exception.Response.GetResponseStream())).ReadToEnd() } catch { }
      if ($_.ErrorDetails -and $_.ErrorDetails.Message) { $body = $_.ErrorDetails.Message }
    }
    if ($body -match '"ok":true' -and (-not $want -or $body -match ('"release":"' + [regex]::Escape($want) + '"'))) {
      $ok++; if ($ok -ge $need) { Write-Host "    $body"; return $true }
    } else { $ok = 0 }
    Start-Sleep -Seconds 1
  }
  Write-Host "    last answer: $body"; return $false
}

function LinkTarget() {
  if (-not (Test-Path $Current)) { return '' }
  $t = @((Get-Item $Current -Force).Target)[0]
  if (-not $t) { return '' }
  if (-not [IO.Path]::IsPathRooted($t)) { $t = Join-Path $Base $t }
  return (Resolve-Path $t).Path.TrimEnd('\', '/')
}

# Points "current" at a release (a junction on Windows: no admin rights needed).
function SwitchTo([string]$rel) {
  if (Test-Path $Current) {
    if ($OnWindows) { cmd /c "rmdir `"$Current`"" | Out-Null } else { [IO.File]::Delete($Current) }
  }
  if ($OnWindows) { New-Item -ItemType Junction -Path $Current -Target $rel | Out-Null }
  else { New-Item -ItemType SymbolicLink -Path $Current -Target $rel | Out-Null }
}

function Pm2Apply() {
  $env:OPL_APP_DIR = $Current; $env:OPL_STATE_DIR = $State; $env:OPL_PORT = "$Port"; $env:OPL_PREFIX = $Prefix
  $eco = Q (Join-Path $Current 'ecosystem.config.js')
  if ((Run "$Pm2 describe $App") -eq 0) { $code = Run "$Pm2 reload $eco --update-env" }
  else { $code = Run "$Pm2 start $eco" }
  Run "$Pm2 save" | Out-Null
  return ($code -eq 0)
}

function GoodReleases() {
  @(Get-ChildItem -Path $Releases -Directory | Where-Object { $_.Name -notmatch '\.(failed|rolled-back)$' } | Sort-Object Name | ForEach-Object { $_.FullName })
}

$Lock = Join-Path $Base '.deploy.lock'
try { New-Item -ItemType Directory -Path $Lock -ErrorAction Stop | Out-Null }
catch { Write-Host "DEPLOY FAILED: another deploy is running (or crashed): remove $Lock if not" -ForegroundColor Red; exit 1 }

$trial = $null
$Rel = ''
$exitCode = 0
try {
  $Prev = LinkTarget

  if ($Rollback) {
    if (-not $Prev) { Die 'nothing is deployed yet' }
    $target = ''
    foreach ($d in GoodReleases) { if ($d -eq $Prev) { break }; $target = $d }
    if (-not $target) { Die 'there is no older release to go back to' }
    Say "Rolling back from $(Split-Path $Prev -Leaf) to $(Split-Path $target -Leaf)"
    SwitchTo $target; Pm2Apply | Out-Null
    if (-not (Health $Port (Split-Path $target -Leaf) 3)) { Die "the old release does not answer either; check: pm2 logs $App" }
    Rename-Item -Path $Prev -NewName ((Split-Path $Prev -Leaf) + '.rolled-back')
    Say "Now running $(Split-Path $target -Leaf)"
    return
  }

  # ── 1. Get the code ──
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  if ($From) {
    if (-not (Test-Path (Join-Path $From 'package.json'))) { Die "$From is not the app folder (no package.json)" }
    $From = (Resolve-Path $From).Path
    $Rel = Join-Path $Releases "$stamp-folder"
    Say "Copying $From"
    New-Item -ItemType Directory -Path $Rel | Out-Null
    $skip = @('node_modules', '.next', '.env.local', '.git')
    Get-ChildItem -Path $From -Force | Where-Object { $skip -notcontains $_.Name } | ForEach-Object {
      Copy-Item -Path $_.FullName -Destination $Rel -Recurse -Force
    }
  } else {
    $git = Join-Path $Base 'repo.git'
    if (-not (Test-Path $git)) {
      if (-not $Repo) { Die 'first deploy: give -Repo URL (or -From FOLDER)' }
      Say "Cloning $Repo"
      if ((Run "git clone --bare -q $(Q $Repo) $(Q $git)") -ne 0) { Die "could not clone $Repo" }
    }
    if ($Repo) { Run "git -C $(Q $git) remote set-url origin $(Q $Repo)" | Out-Null }
    Say "Fetching $Ref"
    if ((Run "git -C $(Q $git) fetch -q origin +refs/heads/*:refs/heads/* --prune") -ne 0) { Die 'git fetch failed' }
    $sha = (git -C $git rev-parse --verify "$Ref^{commit}" 2>$null)
    if (-not $sha) { Die "no branch or commit called $Ref" }
    $id = (git -C $git rev-parse --short $sha)
    $Rel = Join-Path $Releases "$stamp-$id"
    New-Item -ItemType Directory -Path $Rel | Out-Null
    $zip = "$Rel.zip"
    if ((Run "git -C $(Q $git) archive --format=zip -o $(Q $zip) $sha") -ne 0) { Die 'git archive failed' }
    Expand-Archive -Path $zip -DestinationPath $Rel -Force
    Remove-Item $zip
  }
  $Name = Split-Path $Rel -Leaf
  Set-Content -Path (Join-Path $Rel 'RELEASE') -Value $Name -Encoding ASCII

  $sharedEnv = Join-Path $Shared '.env.local'
  if (Test-Path $sharedEnv) { Copy-Item $sharedEnv (Join-Path $Rel '.env.local') }
  elseif ($Prev -and (Test-Path (Join-Path $Prev '.env.local'))) {
    Copy-Item (Join-Path $Prev '.env.local') $sharedEnv; Copy-Item $sharedEnv (Join-Path $Rel '.env.local')
  } else { Write-Host "    No $sharedEnv : the app will run in demo mode (browser-only data)." }

  # Before the switch the site is untouched; a failed release is kept as <name>.failed for a look.
  function Fail([string]$m) {
    if ($script:trial) { Stop-Process -Id $script:trial.Id -Force -ErrorAction SilentlyContinue; $script:trial = $null }
    Set-Location $Base
    Rename-Item -Path $Rel -NewName "$Name.failed"
    Write-Host "    The site was not touched. Logs are in $Rel.failed"
    Die $m
  }

  # ── 2. Install and build (the running site is untouched) ──
  Set-Location $Rel
  $npm = Exe 'npm'
  $sameLock = $Prev -and (Test-Path (Join-Path $Prev 'node_modules')) -and
    ((Get-FileHash (Join-Path $Prev 'package-lock.json')).Hash -eq (Get-FileHash (Join-Path $Rel 'package-lock.json')).Hash)
  if ($sameLock) {
    Say 'Packages unchanged: copying them from the running release'
    if ($OnWindows) {
      robocopy (Join-Path $Prev 'node_modules') (Join-Path $Rel 'node_modules') /E /SL /MT:16 /NFL /NDL /NJH /NJS /NP | Out-Null
      if ($LASTEXITCODE -ge 8) { Fail 'copying node_modules failed' }
    } elseif ((Run "cp -a $(Q (Join-Path $Prev 'node_modules')) $(Q (Join-Path $Rel 'node_modules'))") -ne 0) { Fail 'copying node_modules failed' }
  } else {
    Say 'Installing packages (npm ci)'
    if ((Run "$npm ci --no-audit --no-fund --loglevel=error" (Join-Path $Rel 'install.log')) -ne 0) { Get-Content (Join-Path $Rel 'install.log') -Tail 30; Fail 'npm ci failed (install.log)' }
  }
  if (-not $SkipTests) {
    Say 'Running the unit tests'
    if ((Run "$npm test --silent" (Join-Path $Rel 'test.log')) -ne 0) { Get-Content (Join-Path $Rel 'test.log') -Tail 30; Fail 'unit tests failed (test.log)' }
  }
  Say 'Building'
  if ((Run "$npm run build" (Join-Path $Rel 'build.log')) -ne 0) { Get-Content (Join-Path $Rel 'build.log') -Tail 30; Fail 'build failed (build.log)' }

  # ── 3. Try it on a spare port ──
  Say "Trying the new version on port $TrialPort"
  $script:trial = Start-Process -FilePath 'node' -ArgumentList @('node_modules/next/dist/bin/next', 'start', '-p', "$TrialPort") `
    -WorkingDirectory $Rel -RedirectStandardOutput (Join-Path $Rel 'trial.log') -RedirectStandardError (Join-Path $Rel 'trial.err.log') -PassThru -NoNewWindow
  if (-not (Health $TrialPort $Name 1)) { Get-Content (Join-Path $Rel 'trial.log') -Tail 20; Fail "the new version did not pass its health check on port $TrialPort" }
  Stop-Process -Id $script:trial.Id -Force -ErrorAction SilentlyContinue; $script:trial = $null

  # ── 4. Switch with no downtime, and switch back if it goes wrong ──
  Say "Switching to $Name"
  SwitchTo $Rel
  if (-not ((Pm2Apply) -and (Health $Port $Name 3))) {
    if ($Prev) {
      Say "The new version is not healthy on port ${Port}: switching back to $(Split-Path $Prev -Leaf)"
      SwitchTo $Prev; Pm2Apply | Out-Null; Health $Port (Split-Path $Prev -Leaf) 1 | Out-Null
      Set-Location $Base; Rename-Item -Path $Rel -NewName "$Name.failed"
    }
    Die "the new version did not pass the health check after the switch (see: pm2 logs $App)"
  }

  # ── 5. Keep the last 3 releases (and the last 2 failed or rolled-back ones, for a look) ──
  Set-Location $Base
  $good = GoodReleases
  for ($i = 0; $i -lt $good.Count - 3; $i++) {
    if ($good[$i] -ne $Rel -and $good[$i] -ne $Prev) { Remove-Item -Recurse -Force $good[$i] }
  }
  $bad = @(Get-ChildItem -Path $Releases -Directory | Where-Object { $_.Name -match '\.(failed|rolled-back)$' } | Sort-Object Name)
  for ($i = 0; $i -lt $bad.Count - 2; $i++) { Remove-Item -Recurse -Force $bad[$i].FullName }
  Say "Done: $Name is live on port $Port. Go back with: scripts\deploy.ps1 -Base $Base -Rollback"
} catch {
  if ($_.Exception.Message -ne 'deploy-failed') { Write-Host "DEPLOY FAILED: $($_.Exception.Message)" -ForegroundColor Red }
  $exitCode = 1
} finally {
  if ($trial) { Stop-Process -Id $trial.Id -Force -ErrorAction SilentlyContinue }
  Set-Location $Base
  Remove-Item -Force $Lock -ErrorAction SilentlyContinue
}
exit $exitCode
