<#
.SYNOPSIS
  Append one prediction-test call to predictions.json, regenerate predictions.js, commit and push (GitHub Pages picks it up in ~1-2 min).
.EXAMPLE
  tools\predict.ps1 -Side sell -Px 4120.2 -Stop 4144 -Target 4079 -Hours 8 -Conf 2 -Off -4.15 -Why "41% retrace into the breakdown shelf"
  tools\predict.ps1 -Side flat -Px 4120 -Band 8 -Hours 3 -Conf 3 -Off -4.15 -Why "afternoon chop"
  tools\predict.ps1 -Side sell -Px 4120 -Entry 4135 -Stop 4146 -Target 4079 -Hours 8 -Conf 3 -Off -4.15 -Why "limit sell at 61.8%"
.NOTES
  -Px  = XAUUSD (TradeLocker scale) price when the call is made; -Off = the scanner's spot-minus-PAXG offset at that moment.
  The timestamp is always "now" — calls cannot be backdated.
#>
param(
  [Parameter(Mandatory)][ValidateSet('buy', 'sell', 'flat')][string]$Side,
  [Parameter(Mandatory)][double]$Px,
  [double]$Entry,
  [double]$Stop,
  [double]$Target,
  [double]$Band,
  [double]$Hours = 4,
  [ValidateRange(1, 5)][int]$Conf = 3,
  [Parameter(Mandatory)][string]$Why,
  [Parameter(Mandatory)][double]$Off,
  [switch]$NoPush
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$jsonPath = Join-Path $root 'predictions.json'
$list = @()
if (Test-Path $jsonPath) { $raw = Get-Content $jsonPath -Raw; if ($raw -and $raw.Trim()) { $list = @(ConvertFrom-Json $raw) | Where-Object { $_ -and $_.id } } }
$list = @($list)

$tz = [TimeZoneInfo]::FindSystemTimeZoneById('Central Standard Time')
$ct = [TimeZoneInfo]::ConvertTime((Get-Date), $tz)
$offs = if ($tz.IsDaylightSavingTime($ct)) { '-05:00' } else { '-06:00' }
$id = 'p{0:d3}' -f ($list.Count + 1)
$p = [ordered]@{ id = $id; t = $ct.ToString('yyyy-MM-ddTHH:mm:ss') + $offs; made = $ct.ToString('ddd MMM d, h:mm tt') + ' CT'; side = $Side; px = $Px; off = $Off; hours = $Hours; conf = $Conf; why = $Why }
if ($Side -eq 'flat') {
  if (-not $Band) { throw 'FLAT needs -Band (dollars either side)' }
  $p.band = $Band
} else {
  if (-not $Stop -or -not $Target) { throw 'BUY/SELL need -Stop and -Target' }
  $p.entry = if ($Entry) { $Entry } else { $Px }
  if (($Side -eq 'buy' -and ($Stop -ge $p.entry -or $Target -le $p.entry)) -or ($Side -eq 'sell' -and ($Stop -le $p.entry -or $Target -ge $p.entry))) { throw 'stop/target are on the wrong side of the entry' }
  $p.stop = $Stop; $p.target = $Target
}
$list += [pscustomobject]$p
$json = ConvertTo-Json -InputObject @($list) -Depth 5
Set-Content -Path $jsonPath -Value $json -Encoding UTF8
Set-Content -Path (Join-Path $root 'predictions.js') -Value ("window.PREDICTIONS = " + $json + ";") -Encoding UTF8

$desc = if ($Side -eq 'flat') { "FLAT $Px +/- $Band for ${Hours}h" } else { "$($Side.ToUpper()) $($p.entry) stop $Stop target $Target for ${Hours}h" }
git -C $root add predictions.json predictions.js 2>&1 | Out-Null
git -C $root commit -q -m "Prediction ${id}: $desc (conf $Conf/5)" -m "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>" 2>&1 | Out-Null
if (-not $NoPush) { git -C $root push -q 2>&1 | Out-Null }
Write-Output "$id $desc (conf $Conf/5) at $($p.made)"
