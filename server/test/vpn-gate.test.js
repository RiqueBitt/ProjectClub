// VPN do app de PC: leitura da lista do VPN Gate.
const test = require('node:test');
const assert = require('node:assert');
const { _test: t } = require('../src/services/vpnGate');

const cfg = (proto = 'udp') => Buffer.from(`client\ndev tun\nproto ${proto}\nremote 1.2.3.4 1194\ncipher AES-128-CBC\n<ca>\nx\n</ca>\n`).toString('base64');
const row = (host, ip, cc, name, speed, ping, b64 = cfg()) => [host, ip, '100', ping, speed, name, cc, '3', '86400000', '10', '1', '2weeks', 'Op', '', b64].join(',');
const CSV = [
  '*vpn_servers',
  '#HostName,IP,Score,Ping,Speed,CountryLong,CountryShort,NumVpnSessions,Uptime,TotalUsers,TotalTraffic,LogType,Operator,Message,OpenVPN_ConfigData_Base64',
  row('jp1', '10.0.0.1', 'JP', 'Japan', '900000000', '20'),
  row('us1', '10.0.0.2', 'US', 'United States', '100000000', '30', cfg('tcp')),
  row('us2', '10.0.0.3', 'US', 'United States', '300000000', '40'),
  row('hr1', '10.0.0.4', 'HR', 'Croatia (LOCAL Name: Hrvatska)', '50000000', '50'),
  row('bad', 'nope', 'XX', 'Bad', '1', '1'),
  row('noremote', '10.0.0.5', 'KR', 'Korea', '1', '1', Buffer.from('client\n').toString('base64')),
  '*',
].join('\r\n');

test('lê os servidores válidos e ignora linhas ruins', () => {
  const list = t.parseCsv(CSV);
  assert.equal(list.length, 4);
  const us = list.find((s) => s.id.startsWith('us1'));
  assert.equal(us.proto, 'tcp');
  assert.equal(us.speedMbps, 100);
  assert.match(us.config, /remote 1\.2\.3\.4 1194/);
  assert.equal(list.find((s) => s.country === 'HR').countryName, 'Croatia');
});

test('lista pública: EUA primeiro, o mais rápido antes, e sem a configuração', () => {
  const pub = t.publicList(t.parseCsv(CSV));
  assert.deepEqual(pub.map((s) => s.country), ['US', 'US', 'HR', 'JP']);
  assert.equal(pub[0].speedMbps, 300);
  assert.ok(pub.every((s) => !('config' in s) && !('score' in s)));
});
