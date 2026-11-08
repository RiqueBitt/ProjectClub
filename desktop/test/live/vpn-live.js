// Teste AO VIVO da VPN (não roda no `npm test`): usa o vpnManager de verdade
// pra conectar num servidor do VPN Gate e confere se o IP público mudou.
//   Linux (root):  node test/live/vpn-live.js
//   Windows (CI):  node test/live/vpn-live.js C:\caminho\OpenVPN.msi
// País: VPN_COUNTRY=US (padrão), tenta até 4 servidores.
const os = require('os');
const fs = require('fs');
const path = require('path');
const vpn = require('../../vpnManager');

const COUNTRY = process.env.VPN_COUNTRY || 'US';
const TRIES = 4;

async function publicIp() {
  for (const u of ['https://api.ipify.org', 'https://ifconfig.me/ip', 'https://icanhazip.com']) {
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(10_000) });
      if (r.ok) return (await r.text()).trim();
    } catch { /* tenta o próximo */ }
  }
  return null;
}

async function servers() {
  const r = await fetch('https://www.vpngate.net/api/iphone/', { signal: AbortSignal.timeout(20_000) });
  const rows = (await r.text()).split(/\r?\n/).filter((l) => l && !l.startsWith('*') && !l.startsWith('#')).map((l) => l.split(',')).filter((f) => f.length >= 15);
  const pick = rows.filter((f) => f[6] === COUNTRY).sort((a, b) => Number(b[4]) - Number(a[4]));
  return (pick.length ? pick : rows.sort((a, b) => Number(b[4]) - Number(a[4]))).slice(0, TRIES)
    .map((f) => ({ id: f[0], country: f[6], countryName: f[5], ip: f[1], config: Buffer.from(f[14], 'base64').toString('utf8') }));
}

const waitFor = (pred, ms) => new Promise((resolve) => {
  const t0 = Date.now();
  const tick = () => { const st = vpn.getState(); if (pred(st)) return resolve(st); if (Date.now() - t0 > ms) return resolve(st); setTimeout(tick, 500); };
  tick();
});

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-vpn-'));
  vpn.configure({ dir, msiPath: process.argv[2] || null, linuxElevate: 'none', onState: (st) => console.log(`[estado] ${st.status}${st.error ? ` — ${st.error}` : ''}${st.ip ? ` (${st.ip})` : ''}`) });
  const before = await publicIp();
  console.log(`IP antes: ${before}`);
  const list = await servers();
  console.log(`servidores para testar: ${list.map((s) => `${s.country} ${s.ip}`).join(', ')}`);
  for (const s of list) {
    console.log(`\n== conectando em ${s.countryName} (${s.ip})`);
    await vpn.connect(s.config, s);
    const st = await waitFor((x) => x.status !== 'connecting', 240_000);
    if (st.status !== 'connected') {
      console.log(`não conectou: ${st.status} ${st.error || ''}`);
      const log = path.join(process.platform === 'win32' ? path.join(process.env.ProgramData, 'ProjectClub', 'vpn') : dir, 'openvpn.log');
      try { console.log(fs.readFileSync(log, 'utf8').split('\n').slice(-15).join('\n')); } catch { /* sem log */ }
      await vpn.disconnect();
      continue;
    }
    await new Promise((r) => setTimeout(r, 3000));
    const during = await publicIp();
    console.log(`IP com a VPN: ${during} (servidor ${s.ip})`);
    await vpn.disconnect();
    const after = await waitFor((x) => x.status === 'off', 15_000);
    await new Promise((r) => setTimeout(r, 2000));
    const back = await publicIp();
    console.log(`depois de desligar: estado ${after.status}, IP ${back}`);
    const ok = during && during !== before && back === before;
    console.log(ok ? '\nRESULTADO: OK — a VPN mudou o IP e desligou certinho' : '\nRESULTADO: FALHOU — o IP não mudou ou não voltou');
    process.exit(ok ? 0 : 1);
  }
  console.log('\nRESULTADO: FALHOU — nenhum servidor conectou');
  process.exit(1);
})().catch((err) => { console.error(err); process.exit(1); });
