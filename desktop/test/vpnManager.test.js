// VPN do app de PC: filtro da configuração (o openvpn roda como administrador),
// ordem das opções, leitura do estado e o script elevado do Windows.
const test = require('node:test');
const assert = require('node:assert');
const v = require('../vpnManager');

const VPNGATE = [
  '###############################', '# OpenVPN 2.0 Sample Configuration File', '',
  'dev tun', 'proto tcp', "# You have to specify as 'remote <HOSTNAME> <PORT>'.",
  'remote 67.10.84.82 1543', 'cipher AES-128-CBC', 'data-ciphers AES-128-CBC', 'auth SHA1',
  'resolv-retry infinite', 'nobind', 'persist-key', 'persist-tun', 'client', 'verb 3',
  '<ca>', '-----BEGIN CERTIFICATE-----', 'MIIabc', '-----END CERTIFICATE-----', '</ca>',
  '<cert>', 'x', '</cert>', '<key>', 'y', '</key>',
].join('\r\n');

test('mantém a configuração do VPN Gate (cliente, servidor e certificados)', () => {
  const { config, remote } = v.sanitizeConfig(VPNGATE);
  assert.deepEqual(remote, { host: '67.10.84.82', port: 1543 });
  for (const l of ['client', 'dev tun', 'proto tcp', 'remote 67.10.84.82 1543', 'cipher AES-128-CBC', '<ca>', '</ca>', 'MIIabc', '<key>', '</key>']) assert.ok(config.split('\n').includes(l), l);
  assert.ok(!config.includes('#'));
});

test('tira scripts, plugins e qualquer coisa que rode programa como administrador', () => {
  const evil = `${VPNGATE}\nscript-security 2\nup C:\\\\evil.bat\ndown /tmp/x.sh\nplugin evil.dll\nroute-up "calc.exe"\nlog C:\\\\Windows\\\\x\nmanagement 0.0.0.0 7505\nconfig other.ovpn\ndev-node "abc"\ncd C:\\\\`;
  const { config } = v.sanitizeConfig(evil);
  for (const bad of ['script-security', 'up ', 'down ', 'plugin', 'route-up', 'log ', 'management', 'config ', 'dev-node', '\ncd ']) assert.ok(!config.includes(bad), bad);
});

test('recusa bloco desconhecido, configuração sem servidor e incompleta', () => {
  assert.throws(() => v.sanitizeConfig(`${VPNGATE}\n<connection>\nremote 1.1.1.1 1\n</connection>`), /bloco/);
  assert.throws(() => v.sanitizeConfig('client\ndev tun\n'), /sem servidor/);
  assert.throws(() => v.sanitizeConfig('client\nremote 1.2.3.4 1194\n<ca>\nabc'), /incompleta/);
  assert.throws(() => v.sanitizeConfig(''), /inválida/);
});

test('só o primeiro servidor vale e o dev precisa ser tun', () => {
  const { config, remote } = v.sanitizeConfig('client\ndev tap0\nremote a.b 1\nremote c.d 2\n');
  assert.equal(remote.host, 'a.b');
  assert.ok(!config.includes('remote c.d'));
  assert.ok(!config.includes('dev tap0'));
});

test('--script-security 1 vem depois do --config (vale por cima do arquivo)', () => {
  const a = v.openvpnArgs({ cfgPath: 'c.ovpn', port: 5000, pwPath: 'p', logPath: 'l', platform: 'win32' });
  assert.ok(a.indexOf('--script-security') > a.indexOf('--config'));
  assert.equal(a[a.indexOf('--script-security') + 1], '1');
  assert.ok(a.includes('--management-signal') && a.includes('--block-outside-dns'));
  assert.deepEqual(a.slice(a.indexOf('--management'), a.indexOf('--management') + 4), ['--management', '127.0.0.1', '5000', 'p']);
  assert.ok(!v.openvpnArgs({ cfgPath: 'c', port: 1, pwPath: 'p', logPath: 'l', platform: 'linux' }).includes('--block-outside-dns'));
});

test('lê o estado da interface de gerenciamento', () => {
  assert.deepEqual(v.parseState('>STATE:1730000000,CONNECTED,SUCCESS,10.211.1.30,67.10.84.82,1543,,'), {
    at: 1730000000000, state: 'CONNECTED', detail: 'SUCCESS', localIp: '10.211.1.30', remoteIp: '67.10.84.82',
  });
  assert.equal(v.parseState('>BYTECOUNT:1,2'), null);
});

test('script elevado: confere o hash, instala o MSI embutido e escapa caminhos com apóstrofo', () => {
  const s = v.elevatedScript({ srcPath: "C:\\Users\\D'Ávila\\vpn\\servidor.ovpn", sha256: 'ab'.repeat(32), msiPath: 'C:\\Program Files\\Project Club\\resources\\openvpn\\OpenVPN.msi', port: 5050, password: 'senha' });
  assert.match(s, /ReadAllBytes\('C:\\Users\\D''Ávila\\vpn\\servidor\.ovpn'\)/);
  assert.match(s, /if \(\$hash -ne 'abab/);
  assert.match(s, new RegExp(`ADDLOCAL=${v.WIN_FEATURES.replace(/\./g, '\\.')}`));
  assert.match(s, /--script-security 1/);
  assert.match(s, /icacls/);
  const args = v.windowsLaunchArgs(s);
  const encoded = args[args.length - 1].match(/'-EncodedCommand','([^']+)'/)[1];
  assert.equal(Buffer.from(encoded, 'base64').toString('utf16le'), s);
  assert.match(args[args.length - 1], /-Verb RunAs/);
});
