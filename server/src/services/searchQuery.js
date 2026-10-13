// Sintaxe da busca de mensagens (pura, sem banco):
//   texto livre  de:@nome | from:   tem:arquivo|imagem|link|video | has:
//   antes:AAAA-MM-DD | before:   depois: | after:   em:#canal | in:
//   fixada: | pinned:  (fixada:nao pra só não-fixadas)
function parseSearchQuery(raw) {
  const out = { text: '', from: null, has: new Set(), before: null, after: null, in: null, pinned: null };
  const rest = [];
  const tokens = String(raw || '').slice(0, 300).match(/(?:[^\s"]+|"[^"]*")+/g) || [];
  for (const tok of tokens) {
    const m = tok.match(/^(from|has|before|after|in|pinned|de|tem|antes|depois|em|fixada|fixado)(?::(.*))?$/i);
    if (!m || (m[2] === undefined && !/^(pinned|fixada|fixado)$/i.test(m[1]))) { rest.push(tok.replace(/^"|"$/g, '')); continue; }
    const key = { de: 'from', tem: 'has', antes: 'before', depois: 'after', em: 'in', fixada: 'pinned', fixado: 'pinned' }[m[1].toLowerCase()] || m[1].toLowerCase();
    const val = (m[2] || '').replace(/^"|"$/g, '');
    if (key === 'in') out.in = val.replace(/^#/, '').slice(0, 64) || null;
    else if (key === 'pinned') out.pinned = !/^(n[aã]o|false|0)$/i.test(val);
    else if (key === 'from') out.from = val.replace(/^@/, '').slice(0, 64);
    else if (key === 'has') {
      const v = { arquivo: 'file', imagem: 'image', video: 'video', vídeo: 'video' }[val.toLowerCase()] || val.toLowerCase();
      if (['file', 'image', 'link', 'video'].includes(v)) out.has.add(v);
    } else {
      const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(val) ? `${val}T00:00:00` : val);
      if (!Number.isNaN(d.getTime())) out[key] = d;
    }
  }
  out.text = rest.join(' ').trim();
  return out;
}

module.exports = { parseSearchQuery };
