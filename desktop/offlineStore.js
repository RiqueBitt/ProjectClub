// Modo offline do app de computador — o que fica guardado em disco pra o
// app continuar útil sem internet ou sem o servidor do Project Club:
//
//   <userData>/offline/
//     conta.json              quem estava logado por último (nome, @, avatar)
//     praca/<userId>.json     cópia do pinguim da Praça (TODOS os itens por
//                             id, roupas vestidas, iglu, puffles, carimbos,
//                             saldo de moedas) — o site manda ao entrar no
//                             jogo e a cada 5 minutos (praca/offlineSync.js)
//     vpn/servidores.json     últimas configurações de VPN usadas (a lista
//                             vem do servidor; sem ele, reconecta nessas)
//
// Puro (sem Electron): recebe a pasta base no construtor — testável com
// `node --test`. Toda gravação é atômica (arquivo temporário + rename),
// então uma queda de energia no meio nunca deixa um JSON pela metade.
const fs = require('fs');
const path = require('path');

const SNAPSHOT_FORMAT = 'projectclub-praca-offline';
const MAX_VPN_CONFIGS = 8;
const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024;

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

const isId = (v) => Number.isInteger(v) && v > 0;
const str = (v, max = 120) => (typeof v === 'string' ? v.slice(0, max) : '');

/** Valida a cópia do pinguim que o site manda (nunca confia no formato cegamente). */
function validateSnapshot(snap) {
  if (!snap || typeof snap !== 'object') return 'cópia vazia';
  if (snap.format !== SNAPSHOT_FORMAT) return 'formato desconhecido';
  if (!snap.user || !isId(snap.user.id)) return 'sem a conta';
  if (!snap.penguin || !isId(snap.penguin.id) || !snap.penguin.data || typeof snap.penguin.data !== 'object') return 'sem o pinguim';
  const p = snap.penguin.data;
  if (typeof p.name !== 'string' || !Array.isArray(p.inventory)) return 'pinguim incompleto';
  if (JSON.stringify(snap).length > MAX_SNAPSHOT_BYTES) return 'cópia grande demais';
  return null;
}

function createOfflineStore(baseDir) {
  const dir = path.join(baseDir, 'offline');
  const accountFile = path.join(dir, 'conta.json');
  const pracaDir = path.join(dir, 'praca');
  const vpnFile = path.join(dir, 'vpn', 'servidores.json');

  const snapshotFile = (userId) => path.join(pracaDir, `${Number(userId)}.json`);

  return {
    dir,
    pracaDir,
    pracaFile: snapshotFile,

    // ---- conta ----
    setAccount(account) {
      if (!account || !isId(account.id)) return null;
      const saved = {
        id: account.id,
        username: str(account.username, 60),
        displayName: str(account.displayName, 120) || str(account.username, 60),
        avatarUrl: /^https?:\/\//.test(String(account.avatarUrl || '')) ? str(account.avatarUrl, 500) : null,
        seenAt: new Date().toISOString(),
      };
      writeJsonAtomic(accountFile, saved);
      return saved;
    },
    getAccount() {
      const a = readJson(accountFile);
      return a && isId(a.id) ? a : null;
    },

    // ---- Praça (pinguim) ----
    savePraca(snapshot) {
      const problem = validateSnapshot(snapshot);
      if (problem) return { ok: false, error: problem };
      const file = snapshotFile(snapshot.user.id);
      writeJsonAtomic(file, snapshot);
      return { ok: true, file, savedAt: snapshot.savedAt || new Date().toISOString(), items: snapshot.penguin.data.inventory.length, coins: Number(snapshot.penguin.data.coins) || 0 };
    },
    getPraca(userId) {
      if (!isId(Number(userId))) return null;
      const snap = readJson(snapshotFile(userId));
      return snap && !validateSnapshot(snap) ? snap : null;
    },
    /** Resumo pra tela offline (sem o JSON inteiro do pinguim). */
    pracaSummary(userId) {
      const snap = this.getPraca(userId);
      if (!snap) return null;
      const p = snap.penguin.data;
      return {
        savedAt: snap.savedAt,
        penguinId: snap.penguin.id,
        name: p.name,
        color: p.color,
        coins: Number(p.coins) || 0,
        items: Array.isArray(p.inventory) ? p.inventory.length : 0,
        puffles: Array.isArray(p.puffles) ? p.puffles.length : 0,
        stamps: Array.isArray(p.stamps) ? p.stamps.length : 0,
        member: !!p.is_member,
        game: snap.game || null,
      };
    },

    // ---- VPN ----
    rememberVpn(server, configText) {
      if (!configText || typeof configText !== 'string') return;
      const id = str(server?.id, 80) || `srv-${Date.now()}`;
      const list = (readJson(vpnFile, []) || []).filter((s) => s && s.id !== id);
      list.unshift({ id, country: str(server?.country, 8) || null, countryName: str(server?.countryName, 80) || null, config: configText.slice(0, 64 * 1024), usedAt: new Date().toISOString() });
      writeJsonAtomic(vpnFile, list.slice(0, MAX_VPN_CONFIGS));
    },
    listVpn() {
      return (readJson(vpnFile, []) || []).filter((s) => s && typeof s.config === 'string').map(({ config, ...rest }) => rest);
    },
    vpnConfig(id) {
      return (readJson(vpnFile, []) || []).find((s) => s && s.id === id) || null;
    },
  };
}

module.exports = { createOfflineStore, validateSnapshot, SNAPSHOT_FORMAT };
