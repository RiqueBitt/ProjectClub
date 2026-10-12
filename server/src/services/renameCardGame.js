// "Arena de Cartas" virou "Guerra das Cartas". Os textos novos já saem do
// código, mas missões, conquistas e fases da campanha criadas antes ficaram
// salvas no banco com o nome antigo: troca só esses trechos exatos (não mexe
// em progresso, recompensas nem em nada que a staff escreveu de outro jeito).
// Pode rodar várias vezes — sem nada para trocar, não faz nada.
const prisma = require('../config/prisma');

const PAIRS = [
  ['na Arena de Cartas', 'na Guerra das Cartas'],
  ['da Arena de Cartas', 'da Guerra das Cartas'],
  ['Arena de Cartas', 'Guerra das Cartas'],
  ['Rei da Arena', 'Rei da Guerra'],
  ['Lenda da Arena', 'Lenda da Guerra'],
  ['lenda da Arena', 'lenda da Guerra das Cartas'],
];
const fix = (s) => (typeof s === 'string' ? PAIRS.reduce((t, [a, b]) => t.split(a).join(b), s) : s);
const has = (s) => typeof s === 'string' && PAIRS.some(([a]) => s.includes(a));

async function renameIn(model, fields) {
  const where = { OR: fields.flatMap((f) => PAIRS.map(([a]) => ({ [f]: { contains: a } }))) };
  const rows = await prisma[model].findMany({ where, select: { id: true, ...Object.fromEntries(fields.map((f) => [f, true])) } });
  let n = 0;
  for (const r of rows) {
    const data = {};
    for (const f of fields) if (has(r[f])) data[f] = fix(r[f]);
    if (Object.keys(data).length) { await prisma[model].update({ where: { id: r.id }, data }); n++; }
  }
  return n;
}

async function renameCardGame() {
  try {
    const n = (await renameIn('mission', ['title', 'description']))
      + (await renameIn('achievement', ['name', 'description']))
      + (await renameIn('cardCampaignStage', ['story']));
    if (n) console.log(`[cartas] nome atualizado para "Guerra das Cartas" em ${n} registro(s).`);
  } catch (e) {
    console.error('[cartas] não consegui atualizar o nome antigo:', e?.message);
  }
}

module.exports = { renameCardGame, fix };
