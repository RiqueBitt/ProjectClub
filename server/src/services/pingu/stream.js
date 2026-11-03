// Streaming do Ollama (/api/chat com stream:true) e o "acelerador" das
// edições da mensagem do Pingu. Puro: fetch, relógio e timers injetáveis.
//
// O Ollama manda NDJSON (um JSON por linha): {message:{content:"pedaço"},
// done:false} … e no fim {done:true, done_reason, eval_count, …}.

/**
 * Lê um corpo NDJSON (async iterable de Uint8Array/string) e chama
 * onDelta(pedaço, textoAtéAgora) a cada linha. Devolve { text, doneReason,
 * stats } quando acaba. Linha quebrada no meio de um pedaço é juntada.
 */
async function readNdjson(body, onDelta) {
  const decoder = new TextDecoder();
  let buf = '';
  let text = '';
  let doneReason = null;
  let stats = null;
  const handle = (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let obj;
    try { obj = JSON.parse(trimmed); } catch { return; }
    if (obj.error) throw new Error(`IA: ${obj.error}`);
    const piece = obj.message?.content || '';
    if (piece) {
      text += piece;
      onDelta?.(piece, text);
    }
    if (obj.done) {
      doneReason = obj.done_reason || 'stop';
      stats = {
        promptTokens: obj.prompt_eval_count ?? null,
        promptMs: obj.prompt_eval_duration ? obj.prompt_eval_duration / 1e6 : null,
        evalTokens: obj.eval_count ?? null,
        evalMs: obj.eval_duration ? obj.eval_duration / 1e6 : null,
        totalMs: obj.total_duration ? obj.total_duration / 1e6 : null,
      };
    }
  };
  for await (const chunk of body) {
    buf += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
    let nl = buf.indexOf('\n');
    while (nl >= 0) {
      handle(buf.slice(0, nl));
      buf = buf.slice(nl + 1);
      nl = buf.indexOf('\n');
    }
  }
  buf += decoder.decode();
  if (buf) handle(buf);
  if (doneReason === null) throw Object.assign(new Error('streaming terminou sem "done"'), { code: 'STREAM_CUT', partial: text });
  return { text, doneReason, stats };
}

/**
 * Chama /api/chat com stream:true. deps: { fetch, url, key }. signal cancela.
 * Lança com .code 'STREAM_UNSUPPORTED' se a resposta não for streaming de
 * verdade (aí quem chama cai pro modo normal).
 */
async function streamChat(body, { fetchImpl = fetch, url, key, signal, onDelta }) {
  const res = await fetchImpl(`${url}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({ ...body, stream: true }),
    signal,
  });
  if (!res.ok) throw Object.assign(new Error(`IA respondeu HTTP ${res.status}`), { status: res.status });
  if (!res.body) throw Object.assign(new Error('resposta sem corpo'), { code: 'STREAM_UNSUPPORTED' });
  return readNdjson(res.body, onDelta);
}

/**
 * Acelerador: no máximo uma publicação a cada `intervalMs` (a primeira sai
 * logo depois de `firstMs`). push(texto) guarda o mais recente; a publicação
 * usa sempre o último. finish() cancela o que estava agendado.
 */
function createThrottle({ intervalMs = 500, firstMs = 150, publish, now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout }) {
  let latest = null;
  let lastSent = null;
  let lastAt = 0;
  let timer = null;
  let stopped = false;
  let count = 0;
  const flush = () => {
    timer = null;
    if (stopped || latest === null || latest === lastSent) return;
    lastSent = latest;
    lastAt = now();
    count += 1;
    try { publish(latest); } catch { /* quem publica cuida dos erros */ }
  };
  return {
    push(text) {
      if (stopped) return;
      latest = text;
      if (timer) return;
      const wait = count === 0 ? firstMs : Math.max(0, intervalMs - (now() - lastAt));
      timer = setTimer(flush, wait);
    },
    finish() {
      stopped = true;
      if (timer) { clearTimer(timer); timer = null; }
    },
    get published() { return count; },
  };
}

module.exports = { readNdjson, streamChat, createThrottle };
