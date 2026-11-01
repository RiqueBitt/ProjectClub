# Baixa o OpenVPN oficial pra ir DENTRO do instalador do Project Club (VPN do
# app — ver vpnManager.js) e confere a assinatura digital da OpenVPN Inc.
# Uso (CI, Windows): pwsh desktop/scripts/fetch-openvpn.ps1
$ErrorActionPreference = 'Stop'
$Version = '2.6.23-I002'
$Name = "OpenVPN-$Version-amd64.msi"
$Dest = Join-Path $PSScriptRoot '..\vendor\openvpn'
New-Item -ItemType Directory -Force -Path $Dest | Out-Null
$Out = Join-Path $Dest 'OpenVPN.msi'
$ok = $false
foreach ($base in @('https://swupdate.openvpn.net/community/releases', 'https://swupdate.openvpn.org/community/releases', 'https://build.openvpn.net/downloads/releases')) {
  for ($i = 1; $i -le 3 -and -not $ok; $i++) {
    try {
      Invoke-WebRequest -Uri "$base/$Name" -OutFile $Out -UseBasicParsing -TimeoutSec 120
      if ((Get-Item $Out).Length -gt 1MB) { $ok = $true } else { Start-Sleep -Seconds (5 * $i) }
    } catch { Write-Host "falhou ($base, tentativa $i): $($_.Exception.Message)"; Start-Sleep -Seconds (5 * $i) }
  }
  if ($ok) { break }
}
if (-not $ok) { throw "Não deu para baixar $Name" }
$sig = Get-AuthenticodeSignature $Out
Write-Host "assinatura: $($sig.Status) — $($sig.SignerCertificate.Subject)"
if ($sig.Status -ne 'Valid' -or $sig.SignerCertificate.Subject -notmatch 'OpenVPN') { throw "Assinatura do OpenVPN inválida: $($sig.Status) $($sig.SignerCertificate.Subject)" }
Write-Host "SHA256: $((Get-FileHash $Out -Algorithm SHA256).Hash)"
@"
O Project Club inclui o OpenVPN Community $Version (https://openvpn.net), um programa
separado distribuído sob a licença GPL versão 2. Código-fonte:
https://github.com/OpenVPN/openvpn e https://github.com/OpenVPN/openvpn-build
"@ | Set-Content -Path (Join-Path $Dest 'LICENSE.txt') -Encoding UTF8
