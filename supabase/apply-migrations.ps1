<#
Applies the database updates in supabase\migrations that this database has not had yet, in order,
and records each one in opl_admin.schema_migrations (a schema the app's API cannot see).
Same as apply-migrations.sh, for Windows. Needs psql (PostgreSQL client tools) on PATH.

  $env:DATABASE_URL = 'postgresql://...'      Supabase → Project Settings → Database → Connection string
  .\supabase\apply-migrations.ps1                  apply what is missing
  .\supabase\apply-migrations.ps1 -DryRun          only list what would run
  .\supabase\apply-migrations.ps1 -Baseline 0014   first use on a database where 0001-0014 were already
                                                   run by hand in the SQL Editor: records them without running them
#>
param(
  [string]$DatabaseUrl = $env:DATABASE_URL,
  [switch]$DryRun,
  [string]$Baseline = ''
)
$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($DatabaseUrl)) { Write-Host 'Set DATABASE_URL (Supabase → Project Settings → Database → Connection string).'; exit 2 }
$psql = (Get-Command psql -ErrorAction SilentlyContinue)
if (-not $psql) { Write-Host 'psql was not found on PATH. Install the PostgreSQL client tools and retry.'; exit 2 }
$psql = $psql.Source

function Sql([string]$text, [switch]$Rows) {
  $tmp = [IO.Path]::GetTempFileName()
  try {
    [IO.File]::WriteAllText($tmp, "set client_min_messages = warning;`n$text", (New-Object Text.UTF8Encoding($false)))
    if ($Rows) { $out = & $psql $DatabaseUrl -X -q -At -v ON_ERROR_STOP=1 -f $tmp }
    else { & $psql $DatabaseUrl -X -q -v ON_ERROR_STOP=1 -f $tmp | Out-Null }
    if ($LASTEXITCODE -ne 0) { throw "psql failed ($LASTEXITCODE)" }
    return $out
  } finally { Remove-Item $tmp -ErrorAction SilentlyContinue }
}

Sql @'
create schema if not exists opl_admin;
revoke all on schema opl_admin from public;
create table if not exists opl_admin.schema_migrations (
  name text primary key,
  checksum text not null,
  applied_at timestamptz not null default now()
);
'@

$applied = @{}
foreach ($line in @(Sql "select name || ' ' || checksum from opl_admin.schema_migrations" -Rows)) {
  if ($line -match '^(\S+) (\S+)$') { $applied[$Matches[1]] = $Matches[2] }
}

$pending = 0
foreach ($f in Get-ChildItem -Path (Join-Path $PSScriptRoot 'migrations') -Filter '*.sql' | Where-Object { $_.Name -match '^\d+_' } | Sort-Object Name) {
  $name = $f.BaseName
  $num = [int]($name -split '_')[0]
  # Same checksum as `md5sum` in apply-migrations.sh, so both scripts can be used on one database.
  $sum = (Get-FileHash -Algorithm MD5 -Path $f.FullName).Hash.ToLower()
  if ($applied.ContainsKey($name)) {
    if ($applied[$name] -ne $sum) { Write-Host "note: $name changed since it was applied (not run again)" }
    continue
  }
  if ($Baseline -and $num -le [int]$Baseline) {
    Write-Host "recorded as already applied: $name"
    if (-not $DryRun) { Sql "insert into opl_admin.schema_migrations (name, checksum) values ('$name', '$sum');" }
    continue
  }
  $pending++
  if ($DryRun) { Write-Host "would apply: $name"; continue }
  Write-Host "applying: $name"
  $body = [IO.File]::ReadAllText($f.FullName)
  try { Sql "$body`ninsert into opl_admin.schema_migrations (name, checksum) values ('$name', '$sum');" }
  catch { Write-Host "FAILED: $name. Fix the cause and run this again; it starts from $name." -ForegroundColor Red; exit 1 }
}
if ($pending -eq 0) { Write-Host 'The database is up to date.' }
exit 0
