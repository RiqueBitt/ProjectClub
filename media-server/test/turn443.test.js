// TURN na 443 (opt-in): confere os arquivos de configuração preparados —
// sem Docker aqui, então é checagem estática (o build da imagem valida o
// módulo: `caddy list-modules | grep layer4`).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

test('Caddyfile.turn443: SNI do TURN vai pro coturn antes do tls e importa o site normal', () => {
  const c = read('Caddyfile.turn443');
  const lw = c.indexOf('listener_wrappers');
  const l4 = c.indexOf('layer4', lw);
  const sni = c.indexOf('@turn tls sni {$TURN_DOMAIN}', l4);
  const proxy = c.indexOf('proxy 127.0.0.1:5349', sni);
  const tls = c.indexOf('\n\t\t\ttls\n', proxy);
  assert.ok(lw > 0 && l4 > lw && sni > l4 && proxy > sni && tls > proxy, 'ordem: layer4 (SNI → coturn) e depois tls');
  assert.match(c, /servers :443 \{/);
  assert.match(c, /import \/etc\/caddy\/Caddyfile\.base/);
  assert.match(c, /\{\$TURN_DOMAIN\} \{[\s\S]*disable_tlsalpn_challenge/);
  // Chaves balanceadas (erro bobo de edição).
  assert.equal((c.match(/\{/g) || []).length - (c.match(/\{\$/g) || []).length, (c.match(/\}/g) || []).length - (c.match(/\{\$[A-Z_]+\}/g) || []).length);
});

test('override do compose: imagem caddy-l4 e os dois Caddyfiles', () => {
  const y = read('docker-compose.turn443.yml');
  assert.match(y, /build: \.\/caddy-l4/);
  assert.match(y, /\.\/Caddyfile\.turn443:\/etc\/caddy\/Caddyfile:ro/);
  assert.match(y, /\.\/Caddyfile:\/etc\/caddy\/Caddyfile\.base:ro/);
  const d = read('caddy-l4/Dockerfile');
  assert.match(d, /ARG CADDY_VERSION=2\.\d+\.\d+/);
  assert.match(d, /CADDY_L4_VERSION=v\d+\.\d+\.\d+/);
  assert.match(d, /xcaddy build "v\$\{CADDY_VERSION\}" --with "github\.com\/mholt\/caddy-l4@\$\{CADDY_L4_VERSION\}"/);
  // O compose padrão continua com o Caddy oficial (sem TURN_443 nada muda).
  assert.match(read('docker-compose.yml'), /image: caddy:2\n/);
});

test('vm-voz-robusta.sh: sintaxe e opt-in TURN_443', () => {
  execFileSync('bash', ['-n', path.join(root, 'scripts/vm-voz-robusta.sh')]);
  const s = read('scripts/vm-voz-robusta.sh');
  assert.match(s, /TURN_443="\$\{TURN_443:-\}"/);
  assert.match(s, /\*\.sslip\.io\|\*\.nip\.io\) TURN_DOMAIN="turn-\$DOMAIN"/);
  assert.match(s, /set_env COMPOSE_FILE docker-compose\.yml:docker-compose\.turn443\.yml/);
  assert.match(s, /del_env COMPOSE_FILE/);
});
