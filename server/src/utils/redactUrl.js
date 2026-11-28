// Tira segredos da URL antes de ela ir pra um log (stdout da Shard Cloud,
// ErrorLog do painel). Vários fluxos levam segredo na query: o `code`/`state`
// do login com Google/Discord e do Spotify, a chave da API do Nexus de quem
// usa (?key=), tokens… O log "combined" do morgan gravava tudo isso.
const SECRET_PARAM = /^(code|state|key|apikey|api_key|token|access_token|refresh_token|id_token|password|pass|secret|sig|signature|auth|authorization|session|otp|ticket)$/i;

function redactUrl(raw) {
  const url = String(raw || '');
  const q = url.indexOf('?');
  if (q < 0) return url;
  const hashAt = url.indexOf('#', q);
  const query = url.slice(q + 1, hashAt < 0 ? undefined : hashAt);
  const parts = query.split('&').map((pair) => {
    if (!pair) return pair;
    const eq = pair.indexOf('=');
    const name = eq < 0 ? pair : pair.slice(0, eq);
    let decoded = name;
    try { decoded = decodeURIComponent(name.replace(/\+/g, ' ')); } catch { /* nome estranho: usa cru */ }
    return eq >= 0 && SECRET_PARAM.test(decoded) ? `${name}=[oculto]` : pair;
  });
  return `${url.slice(0, q)}?${parts.join('&')}`;
}

module.exports = { redactUrl, SECRET_PARAM };
