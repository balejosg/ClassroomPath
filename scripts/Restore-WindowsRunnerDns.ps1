param(
  [string[]]$DnsServers = @('1.1.1.1', '8.8.8.8'),
  [string[]]$ConnectivityHosts = @('github.com', 'pipelines.actions.githubusercontent.com'),
  [bool]$RequireConnectivity = $true
)

$ErrorActionPreference = 'Continue'

$resolvedDnsServers = @($DnsServers | ForEach-Object { $_.Trim() } | Where-Object { $_ } | Select-Object -Unique)
if (-not $resolvedDnsServers) {
  throw 'At least one DNS server must be configured'
}

Write-Host "Restoring Windows runner DNS servers: $($resolvedDnsServers -join ', ')"

Get-NetFirewallRule -DisplayName 'OpenPath-*' -ErrorAction SilentlyContinue |
  Remove-NetFirewallRule -ErrorAction SilentlyContinue

$activeAdapters = @(Get-NetAdapter -ErrorAction SilentlyContinue |
  Where-Object { $_.Status -eq 'Up' -and $_.InterfaceDescription -notlike '*Loopback*' })

foreach ($adapter in $activeAdapters) {
  Set-DnsClientServerAddress -InterfaceIndex $adapter.ifIndex -ServerAddresses $resolvedDnsServers -ErrorAction SilentlyContinue
}

if (-not $activeAdapters) {
  Set-DnsClientServerAddress -InterfaceAlias 'Ethernet' -ServerAddresses $resolvedDnsServers -ErrorAction SilentlyContinue
}

Clear-DnsClientCache -ErrorAction SilentlyContinue

$resolvedConnectivityHosts = @($ConnectivityHosts |
  ForEach-Object { $_.Trim() } |
  Where-Object { $_ } |
  Select-Object -Unique)

foreach ($connectivityHost in $resolvedConnectivityHosts) {
  $probe = Test-NetConnection $connectivityHost -Port 443 -WarningAction SilentlyContinue
  if (-not $probe.NameResolutionSucceeded -or -not $probe.TcpTestSucceeded) {
    $message = "GitHub connectivity check failed after DNS restore for $connectivityHost. NameResolution=$($probe.NameResolutionSucceeded) Tcp443=$($probe.TcpTestSucceeded)"
    if ($RequireConnectivity) {
      throw $message
    }
    Write-Warning $message
  }
}
