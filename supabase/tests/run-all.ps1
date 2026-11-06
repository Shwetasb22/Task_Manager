param(
  [string]$DatabaseUrl = $env:DATABASE_URL
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($DatabaseUrl)) {
  Write-Error 'Provide -DatabaseUrl or set DATABASE_URL.'
  exit 2
}

$psqlCommand = Get-Command psql -ErrorAction SilentlyContinue
if (-not $psqlCommand) {
  Write-Error 'psql was not found on PATH. Install PostgreSQL client tools and retry.'
  exit 2
}

$preferredOrder = @(
  'signup_role.sql',
  'task_closure.sql',
  'manager_update_allowlist.sql',
  'rls_access.sql',
  'proof_storage_delete.sql',
  'owner_proof_remove.sql',
  'add_issue.sql',
  'platform_manager_creation.sql',
  'owner_access.sql',
  'closed_owner_edits.sql'
)
$testDirectory = $PSScriptRoot
$allTests = @(Get-ChildItem -LiteralPath $testDirectory -Filter '*.sql' -File)
$testsByName = @{}
foreach ($testFile in $allTests) {
  $testsByName[$testFile.Name] = $testFile
}

$orderedTests = @()
foreach ($testName in $preferredOrder) {
  if ($testsByName.ContainsKey($testName)) {
    $orderedTests += $testsByName[$testName]
    $testsByName.Remove($testName)
  }
}
$orderedTests += @($testsByName.Values | Sort-Object Name)

if ($orderedTests.Count -eq 0) {
  Write-Error "No SQL tests found in $testDirectory."
  exit 2
}

$passed = @()
$failedTest = $null
foreach ($testFile in $orderedTests) {
  Write-Host "Running $($testFile.Name)..."
  & $psqlCommand.Source $DatabaseUrl -v ON_ERROR_STOP=1 -f $testFile.FullName
  if ($LASTEXITCODE -ne 0) {
    $failedTest = $testFile.Name
    break
  }
  $passed += $testFile.Name
}

if ($failedTest) {
  Write-Host "SQL test summary: $($passed.Count) passed; 1 failed; $($orderedTests.Count - $passed.Count - 1) not run."
  Write-Host "Failed: $failedTest"
  exit 1
}

Write-Host "SQL test summary: $($passed.Count) passed; 0 failed."
exit 0
