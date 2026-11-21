// Atualização automática de mods (Fase 7): regras puras do site.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeSettings, gameAutoEnabled, markModsPageOpen, isModsPageOpen, shouldStartRound,
  autoUpdatableItems, itemDisplayName, summarizeRound, autoUpdateBridge, INITIAL_DELAY_MS, INTERVAL_MS,
} from '../src/pages/mods/autoUpdatePolicy.js';

test('configuração: desligada por padrão; jogo desligado individualmente', () => {
  assert.deepEqual(normalizeSettings(undefined), { enabled: false, games: {} });
  assert.equal(gameAutoEnabled({ enabled: true, games: {} }, 892970), true);
  assert.equal(gameAutoEnabled({ enabled: true, games: { 892970: false } }, 892970), false);
  assert.equal(gameAutoEnabled({ enabled: true, games: { 892970: false } }, '892970'), false);
  assert.equal(gameAutoEnabled({ enabled: false, games: { 1: true } }, 1), false);
});

test('rodada: só com a opção ligada, sem outra rodada, tela de Mods fechada e com internet', () => {
  const on = { enabled: true };
  assert.deepEqual(shouldStartRound({ settings: on }), { ok: true, reason: 'ok' });
  assert.equal(shouldStartRound({ settings: {} }).reason, 'disabled');
  assert.equal(shouldStartRound({ settings: on, busy: true }).reason, 'busy');
  assert.equal(shouldStartRound({ settings: on, pageOpen: true }).reason, 'mods-page-open');
  assert.equal(shouldStartRound({ settings: on, online: false }).reason, 'offline');
});

test('tela de Mods aberta: contador com limpeza idempotente', () => {
  assert.equal(isModsPageOpen(), false);
  const a = markModsPageOpen();
  const b = markModsPageOpen();
  assert.equal(isModsPageOpen(), true);
  a(); a();
  assert.equal(isModsPageOpen(), true);
  b();
  assert.equal(isModsPageOpen(), false);
});

test('itens: só fontes suportadas, com atualização e sem exigir login', () => {
  const rows = [
    { source: 'modio', name: 'A', update: { updateAvailable: true } },
    { source: 'nexus', name: 'B', update: { updateAvailable: true, needsAccount: true } },
    { source: 'thunderstore', name: 'C', update: { updateAvailable: false } },
    { source: 'local', name: 'D', update: { updateAvailable: true } },
    null,
  ];
  assert.deepEqual(autoUpdatableItems(rows).map((r) => r.name), ['A']);
  assert.equal(itemDisplayName({ update: { name: 'Nome novo' }, name: 'pasta' }), 'Nome novo');
  assert.equal(itemDisplayName({ key: 'chave' }), 'chave');
});

test('resumo: atualizados, falhas e pulados', () => {
  assert.deepEqual(summarizeRound([
    { status: 'updated', name: 'A' }, { status: 'failed', name: 'B' }, { status: 'skipped', name: 'C' }, { status: 'updated', name: 'D' },
  ]), { updated: ['A', 'D'], failed: 1, skipped: 1 });
  assert.deepEqual(summarizeRound(), { updated: [], failed: 0, skipped: 0 });
});

test('fora do app de PC não existe ponte; intervalos sensatos', () => {
  assert.equal(autoUpdateBridge(), null);
  assert.ok(INITIAL_DELAY_MS >= 60_000);
  assert.ok(INTERVAL_MS >= 15 * 60_000);
});
