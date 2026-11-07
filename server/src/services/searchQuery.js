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
    if (key === 'in') {
      // in:#canal, em:canal, in:<#id> (token de menção de canal) ou in:"nome com espaço"
      const tokenId = val.match(/^<#([A-Za-z0-9_-]{1,40})>$/);
      out.in = tokenId ? `<#${tokenId[1]}>` : (val.replace(/^#/, '').slice(0, 64) || null);
    }
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

// Normaliza nome de canal pra comparar: sem acento, minúsculo, espaços e
// hífens/sublinhados tratados como iguais ("bate-papo" = "Bate Papo").
function normChannelName(v) {
  return String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/^#/, '').replace(/[\s_-]+/g, '-').trim();
}

// Escolhe o canal do filtro in:/em: SÓ entre os canais que a pessoa pode
// ver (`channels` já vem filtrado pela permissão). Preferência: id exato
// (<#id>), nome exato, começa com, contém. Devolve o id ou null.
function resolveChannelFilter(value, channels) {
  if (!value || !Array.isArray(channels) || !channels.length) return null;
  const token = String(value).match(/^<#([A-Za-z0-9_-]{1,40})>$/);
  if (token) return channels.find((c) => c.id === token[1])?.id || null;
  const q = normChannelName(value);
  if (!q) return null;
  const named = channels.map((c) => ({ id: c.id, n: normChannelName(c.name) }));
  return (named.find((c) => c.n === q)
    || named.find((c) => c.n.startsWith(q))
    || named.find((c) => c.n.includes(q)))?.id || null;
}

module.exports = { parseSearchQuery, resolveChannelFilter, normChannelName };
