<#
.SYNOPSIS
  Ensures the GitHub Actions runner Windows services survive a VM reboot.

.DESCRIPTION
  Idempotent. For every actions.runner.* service it sets the start type to
  Automatic (Delayed) and configures service failure recovery (restart after
  one, one and one minute; failure counter reset after one day). Each service is
  handled in its own try/catch so one broken service cannot abort the others.
  Exits 1 only when -Strict is set and a service could not be fixed or verified.
#>
[CmdletBinding()]
param(
  [string]$ServiceFilter = 'actions.runner.*',
  [switch]$Strict
)

$ErrorActionPreference = 'Continue'
$failures = New-Object System.Collections.Generic.List[string]

function Write-EnsureWarning {
  param([string]$Message)
  $script:failures.Add($Message) | Out-Null
  Write-Host "::warning::windows-runner-ensure-services: $Message"
}

$services = @(Get-Service -Name $ServiceFilter -ErrorAction SilentlyContinue)
if ($services.Count -eq 0) {
  Write-EnsureWarning "no services match '$ServiceFilter'"
}

foreach ($service in $services) {
  $name = $service.Name
  try {
    & sc.exe config $name start= delayed-auto | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "sc.exe config exited $LASTEXITCODE" }
    & sc.exe failure $name reset= 86400 actions= restart/60000/restart/60000/restart/60000 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "sc.exe failure exited $LASTEXITCODE" }
    $qc = (& sc.exe qc $name) -join "`n"
    if ($qc -notmatch 'DELAYED') { throw 'start type is not AUTO_START (DELAYED) after config' }
    Write-Host "windows-runner-ensure-services: $name is Automatic (Delayed) with restart recovery"
  } catch {
    Write-EnsureWarning "$name could not be ensured: $($_.Exception.Message)"
  }
}

if ($Strict -and $failures.Count -gt 0) { exit 1 }
exit 0
