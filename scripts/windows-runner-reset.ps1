<#
.SYNOPSIS
  Resets the persistent Windows canary runner to a clean state.

.DESCRIPTION
  Shared by windows-production-bootstrap-canary.yml and
  production-client-update-canary.yml. Every sub-step is isolated in its own
  try/catch so one hung or half-removed component (for example the Acrylic
  uninstaller or a half-deleted AcrylicDNSProxySvc) cannot abort the whole
  reset. After cleanup the script verifies that no OpenPath residue remains.
  An unrecoverable residue is an INFRA failure, never a product failure: the
  script writes failure_class=infra to GITHUB_OUTPUT, prints the marker
  OPENPATH_RUNNER_RESET_INFRA_FAILURE and exits 1.
#>
[CmdletBinding()]
param(
  [string]$OpenPathRoot = 'C:\OpenPath',
  [int]$UninstallTimeoutSeconds = 180,
  [int]$AcrylicUninstallTimeoutSeconds = 60
)

$ErrorActionPreference = 'Continue'
$script:Warnings = New-Object System.Collections.Generic.List[string]
$script:InfraMarker = 'OPENPATH_RUNNER_RESET_INFRA_FAILURE'

function Write-ResetWarning {
  param([string]$Message)
  $script:Warnings.Add($Message) | Out-Null
  Write-Host "::warning::windows-runner-reset: $Message"
}

function Invoke-ResetStep {
  param(
    [Parameter(Mandatory)][string]$Name,
    [Parameter(Mandatory)][scriptblock]$Action
  )
  Write-Host "windows-runner-reset: step '$Name'"
  try {
    & $Action
  } catch {
    Write-ResetWarning "step '$Name' failed: $($_.Exception.Message)"
  }
}

function Invoke-ProcessWithTimeout {
  param(
    [Parameter(Mandatory)][string]$FilePath,
    [string[]]$ArgumentList = @(),
    [Parameter(Mandatory)][int]$TimeoutSeconds
  )
  $startArgs = @{ FilePath = $FilePath; PassThru = $true; WindowStyle = 'Hidden' }
  if ($ArgumentList.Count -gt 0) { $startArgs.ArgumentList = $ArgumentList }
  $process = Start-Process @startArgs
  if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
    Write-ResetWarning "$FilePath exceeded ${TimeoutSeconds}s; killing process tree $($process.Id)"
    & taskkill.exe /T /F /PID $process.Id 2>&1 | Out-Null
    try { $process.Kill() } catch { }
    return $false
  }
  return $true
}

function Remove-ServiceTolerant {
  param([Parameter(Mandatory)][string]$Name)
  $service = Get-Service -Name $Name -ErrorAction SilentlyContinue
  if (-not $service) { return }
  try {
    Stop-Service -Name $Name -Force -ErrorAction Stop
  } catch {
    # e.g. "Cannot open AcrylicDNSProxySvc service": service is half removed.
    Write-ResetWarning "Stop-Service $Name failed: $($_.Exception.Message)"
  }
  & sc.exe delete $Name 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) {
    # 1060 = does not exist, 1072 = already marked for deletion: both acceptable.
    if (@(1060, 1072) -notcontains $LASTEXITCODE) {
      Write-ResetWarning "sc.exe delete $Name exited with $LASTEXITCODE"
    }
  }
}

Invoke-ResetStep 'openpath-uninstall' {
  $uninstallPath = Join-Path $OpenPathRoot 'Uninstall-OpenPath.ps1'
  if (Test-Path $uninstallPath) {
    $ok = Invoke-ProcessWithTimeout -FilePath 'powershell.exe' -TimeoutSeconds $UninstallTimeoutSeconds `
      -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $uninstallPath)
    if (-not $ok) { Write-ResetWarning 'Uninstall-OpenPath.ps1 timed out; continuing with manual cleanup' }
  }
}

Invoke-ResetStep 'scheduled-tasks' {
  Get-ScheduledTask -TaskName 'OpenPath-*' -ErrorAction SilentlyContinue |
    Unregister-ScheduledTask -Confirm:$false -ErrorAction SilentlyContinue
}

Invoke-ResetStep 'firewall-rules' {
  Get-NetFirewallRule -DisplayName 'OpenPath-*' -ErrorAction SilentlyContinue |
    Remove-NetFirewallRule -ErrorAction SilentlyContinue
}

Invoke-ResetStep 'acrylic-service' {
  Remove-ServiceTolerant -Name 'AcrylicDNSProxySvc'
}

foreach ($acrylicPath in @(
    (Join-Path ${env:ProgramFiles(x86)} 'Acrylic DNS Proxy'),
    (Join-Path ${env:ProgramFiles} 'Acrylic DNS Proxy')
  )) {
  Invoke-ResetStep "acrylic-uninstall:$acrylicPath" {
    $acrylicServicePath = Join-Path $acrylicPath 'AcrylicService.exe'
    if (Test-Path $acrylicServicePath) {
      $ok = Invoke-ProcessWithTimeout -FilePath $acrylicServicePath -ArgumentList @('/UNINSTALL') `
        -TimeoutSeconds $AcrylicUninstallTimeoutSeconds
      if (-not $ok) { Write-ResetWarning "Acrylic uninstaller hung at $acrylicServicePath; killed" }
    }
  }
  Invoke-ResetStep "acrylic-service-recheck:$acrylicPath" {
    Remove-ServiceTolerant -Name 'AcrylicDNSProxySvc'
  }
  Invoke-ResetStep "acrylic-remove:$acrylicPath" {
    Remove-Item -LiteralPath $acrylicPath -Recurse -Force -ErrorAction SilentlyContinue
  }
}

Invoke-ResetStep 'firefox-policies' {
  foreach ($policyPath in @(
      (Join-Path ${env:ProgramFiles} 'Mozilla Firefox\distribution\policies.json'),
      (Join-Path ${env:ProgramFiles(x86)} 'Mozilla Firefox\distribution\policies.json')
    )) {
    Remove-Item -LiteralPath $policyPath -Force -ErrorAction SilentlyContinue
  }
}

Invoke-ResetStep 'applocker-residual' {
  # When the OpenPath AppControl owner module is gone, a leftover AppLocker
  # policy can never be removed by OpenPath itself ("AppControl owner module is
  # unavailable"). Clear it with an empty policy.
  $appControlModule = Get-ChildItem -Path $OpenPathRoot -Recurse -Filter 'AppControl*.psm1' -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if ($appControlModule) { return }
  $effective = $null
  try { $effective = Get-AppLockerPolicy -Effective -Xml -ErrorAction Stop } catch { }
  if ($effective -and $effective -match '<RuleCollection\s') {
    $emptyPolicyPath = Join-Path ([System.IO.Path]::GetTempPath()) 'openpath-empty-applocker-policy.xml'
    Set-Content -LiteralPath $emptyPolicyPath -Value '<AppLockerPolicy Version="1" />' -Encoding UTF8
    try {
      Set-AppLockerPolicy -XmlPolicy $emptyPolicyPath -ErrorAction Stop
      Write-Host 'windows-runner-reset: cleared residual AppLocker policy'
    } finally {
      Remove-Item -LiteralPath $emptyPolicyPath -Force -ErrorAction SilentlyContinue
    }
  }
}

Invoke-ResetStep 'openpath-root' {
  Remove-Item -LiteralPath $OpenPathRoot -Recurse -Force -ErrorAction SilentlyContinue
}

# Verification: anything left behind is an infrastructure problem.
$residue = New-Object System.Collections.Generic.List[string]
if (Test-Path $OpenPathRoot) { $residue.Add("$OpenPathRoot still exists") | Out-Null }
$leftoverService = Get-Service -Name 'AcrylicDNSProxySvc' -ErrorAction SilentlyContinue
if ($leftoverService -and $leftoverService.Status -ne 'Stopped') {
  $residue.Add("AcrylicDNSProxySvc still present (status $($leftoverService.Status))") | Out-Null
}
if (@(Get-ScheduledTask -TaskName 'OpenPath-*' -ErrorAction SilentlyContinue).Count -gt 0) {
  $residue.Add('OpenPath-* scheduled tasks still registered') | Out-Null
}

if ($residue.Count -gt 0) {
  $message = "$script:InfraMarker failure_class=infra: " + ($residue -join '; ')
  Write-Host "::error::$message"
  if ($env:GITHUB_OUTPUT) {
    Add-Content -LiteralPath $env:GITHUB_OUTPUT -Value 'failure_class=infra'
    Add-Content -LiteralPath $env:GITHUB_OUTPUT -Value 'reset_infra_failure=true'
  }
  exit 1
}

Write-Host "windows-runner-reset: clean ($($script:Warnings.Count) tolerated warning(s))"
exit 0
