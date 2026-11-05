'use strict';
// Mensagens da EPF no telefone espião do Club Penguin. A staff escreve no
// painel; ficam salvas em pc-epf.json e quem está online recebe na hora.
const fs = require('fs');
const path = require('path');

const MASCOTS = [
  { id: 18, name: 'O Diretor' }, { id: 25, name: 'Gary' }, { id: 16, name: 'Rookie' }, { id: 15, name: 'Dot' },
  { id: 17, name: 'Jet Pack Guy' }, { id: 28, name: 'PH' }, { id: 1, name: 'Rockhopper' }, { id: 2, name: 'Tia Ártica' },
  { id: 3, name: 'Cadence' }, { id: 9, name: 'Sensei' }, { id: 10, name: 'Herbert' }, { id: 19, name: 'Klutzy' },
  { id: 14, name: 'Protobot' }, { id: 11, name: 'Robô 1' }, { id: 12, name: 'Robô 2' }, { id: 13, name: 'Robô 3' },
];
const MASCOT_IDS = MASCOTS.map((m) => m.id);
const file = () => path.join(process.env.WADDLE_DATA_DIR || path.join(__dirname, '..', '..', '..', 'data', 'waddle'), 'pc-epf.json');
const lib = () => require('../../../waddle/dist/server/game-logic/epf-com.js');

let instance = null;

function readFile() {
  try {
    const data = JSON.parse(fs.readFileSync(file(), 'utf8'));
    if (Array.isArray(data?.messages)) lib().setComMessages(data.messages);
  } catch { /* primeira vez: mensagens padrão */ }
}

function save() {
  const tmp = file() + '.tmp';
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify({ messages: lib().getComMessages() }, null, 1));
    fs.renameSync(tmp, file());
  } catch (err) { console.warn('[epf] não salvou:', err?.message || err); }
}

function attach(w) {
  instance = w;
  readFile();
}

function list() {
  return lib().getComMessages().map((m, i) => ({ index: i, ...m })).reverse();
}

/** Nova mensagem: salva e manda pra todo mundo online (aparece no telefone). */
function add(text, mascot = 18) {
  const message = lib().cleanComText(text);
  if (!message) throw Object.assign(new Error('Escreva a mensagem.'), { status: 400 });
  const m = { message, time: Math.floor(Date.now() / 1000), mascot: MASCOT_IDS.includes(Number(mascot)) ? Number(mascot) : 18 };
  lib().setComMessages([...lib().getComMessages(), m]);
  save();
  let sent = 0;
  try {
    const w = instance;
    for (const p of w?.world.getAllPlayersInfo() || []) {
      const live = w.world.getOnline(Number(p.id ?? p.penguinId));
      if (!live) continue;
      try { w.world.notify(live, 'epfsm', lib().comString(m)); sent += 1; } catch { /* saindo */ }
    }
  } catch { /* jogo desligado */ }
  return { ok: true, sent, messages: list() };
}

function remove(time, message) {
  const before = lib().getComMessages();
  const next = before.filter((m) => !(m.time === Number(time) && m.message === String(message)));
  if (next.length === before.length) throw Object.assign(new Error('Mensagem não encontrada.'), { status: 404 });
  lib().setComMessages(next);
  save();
  return { ok: true, messages: list() };
}

module.exports = { attach, list, add, remove, MASCOTS };
