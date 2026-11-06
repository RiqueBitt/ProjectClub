// Jigsaw Jam (modelo do CP Journey) — aba da janela "Festa" dentro do jogo.
// Quebra-cabeças com artes da comunidade: escolhe a arte, o modo (3×3 fácil
// ou 5×5 difícil), e troca as peças de lugar clicando em duas. Resolver dá
// moedas (uma vez por arte e modo); resolver todas dá o prêmio de conclusão.
// Qualquer pinguim pode mandar uma arte (a equipe aprova).
// Servidor: /api/plaza/puzzles (services/waddle/puzzles.js).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client.js';

const BOARD = 240;

function shuffled(n) {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  // nunca começa resolvido
  if (a.every((v, i) => v === i)) [a[0], a[1]] = [a[1], a[0]];
  return a;
}

export default function Jigsaw({ busy, call, rewardText, say }) {
  const [data, setData] = useState(null);
  const [puzzle, setPuzzle] = useState(null);
  const [mode, setMode] = useState('facil');
  const [order, setOrder] = useState([]);
  const [pick, setPick] = useState(null);
  const [startedAt, setStartedAt] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [solved, setSolved] = useState(false);
  const [moves, setMoves] = useState(0);
  const fileRef = useRef(null);
  const [title, setTitle] = useState('');
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    try { const { data: d } = await api.get('/plaza/puzzles'); setData(d); } catch { setData({ puzzles: [], modes: {}, completion: null, mine: [] }); }
  }, []);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!startedAt || solved) return undefined;
    const t = setInterval(() => setSeconds(Math.floor((Date.now() - startedAt) / 1000)), 500);
    return () => clearInterval(t);
  }, [startedAt, solved]);

  const size = data?.modes?.[mode]?.size || (mode === 'dificil' ? 5 : 3);
  const start = (p, m = mode) => {
    const n = (data?.modes?.[m]?.size || (m === 'dificil' ? 5 : 3)) ** 2;
    setPuzzle(p); setMode(m); setOrder(shuffled(n)); setPick(null); setSolved(false); setMoves(0); setStartedAt(Date.now()); setSeconds(0);
  };

  const tap = (i) => {
    if (solved) return;
    if (pick === null) { setPick(i); return; }
    if (pick === i) { setPick(null); return; }
    const next = order.slice(); [next[pick], next[i]] = [next[i], next[pick]];
    setOrder(next); setPick(null); setMoves((m) => m + 1);
    if (next.every((v, idx) => v === idx)) {
      setSolved(true);
      const secs = Math.floor((Date.now() - startedAt) / 1000);
      Promise.resolve(call(`jig-${puzzle.id}`, () => api.post(`/plaza/puzzles/${puzzle.id}/solve`, { mode, seconds: secs }), (r) => (r.repeat ? 'Montado de novo! (a recompensa é só na primeira vez)' : `Montou em ${secs}s: ${rewardText(r)}!`))).then(load);
    }
  };

  const submitArt = async (e) => {
    e.preventDefault();
    const f = fileRef.current?.files?.[0];
    if (!f) { say('Escolha uma imagem.', 'error'); return; }
    setSending(true);
    try {
      const fd = new FormData(); fd.append('image', f); fd.append('title', title);
      const { data: r } = await api.post('/plaza/puzzles', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      say(r.approved ? 'Arte publicada no Jigsaw Jam!' : 'Arte enviada! A equipe aprova em breve.');
      setTitle(''); if (fileRef.current) fileRef.current.value = '';
      load();
    } catch (err) { say(err?.response?.data?.error || 'Não deu pra enviar.', 'error'); }
    finally { setSending(false); }
  };

  const tiles = useMemo(() => order.map((src, idx) => {
    const cell = BOARD / size;
    const sx = (src % size) * cell; const sy = Math.floor(src / size) * cell;
    return { idx, src, style: { width: cell, height: cell, backgroundImage: `url("${puzzle?.imageUrl}")`, backgroundSize: `${BOARD}px ${BOARD}px`, backgroundPosition: `-${sx}px -${sy}px` } };
  }), [order, size, puzzle]);

  if (!data) return <div className="cpjb-empty"><span>Carregando o Jigsaw Jam…</span></div>;

  if (puzzle) {
    return (
      <div className="cpf-block cpf-jig">
        <div className="cpf-jig-head">
          <b>{puzzle.title}</b>
          <span>{mode === 'dificil' ? 'Difícil 5×5' : 'Fácil 3×3'} · {seconds}s · {moves} trocas</span>
          <button type="button" className="cpjb-mini" onClick={() => { setPuzzle(null); setStartedAt(0); }} title="Voltar">←</button>
        </div>
        <div className="cpf-jig-wrap">
          <div className={`cpf-jig-board${solved ? ' is-solved' : ''}`} style={{ width: BOARD, height: BOARD, gridTemplateColumns: `repeat(${size}, 1fr)` }}>
            {tiles.map((t) => (
              <button key={t.idx} type="button" className={`cpf-jig-tile${pick === t.idx ? ' is-pick' : ''}${solved ? ' is-ok' : ''}`} style={t.style} onClick={() => tap(t.idx)} aria-label={`Peça ${t.idx + 1}`} />
            ))}
          </div>
          <div className="cpf-jig-side">
            <img src={puzzle.imageUrl} alt="" className="cpf-jig-preview" />
            <small>Clique numa peça e depois em outra pra trocar de lugar.</small>
            {solved && <b className="cpf-jig-done">Montado! 🎉</b>}
            <button type="button" className="cpjb-pill is-small" onClick={() => start(puzzle, mode)}>Embaralhar</button>
          </div>
        </div>
      </div>
    );
  }

  const c = data.completion;
  return (
    <div className="cpf-block">
      {c && (
        <div className={`cpf-quest cpf-final${c.claimed ? ' is-claimed' : c.allDone ? ' is-done' : ''}`}>
          <span className="cpf-q-main">
            <b>🧩 {c.label}</b>
            <small>Monte todas as artes ({c.solved}/{c.total}) · {rewardText(c)}</small>
            <span className="cpf-prog"><i style={{ width: `${Math.round((c.solved / Math.max(1, c.total)) * 100)}%` }} /></span>
          </span>
          {c.claimed ? <span className="cpf-ok">★</span> : c.allDone ? <button type="button" className="cpjb-pill is-yellow is-small" disabled={busy === 'jigfinal'} onClick={() => Promise.resolve(call('jigfinal', () => api.post('/plaza/puzzles/completion/claim'), (r) => `Prêmio do Jigsaw Jam: ${rewardText(r)}!`)).then(load)}>Pegar</button> : null}
        </div>
      )}
      <div className="cpf-jig-modes">
        <span>Modo:</span>
        {Object.entries(data.modes || {}).map(([k, m]) => (
          <button key={k} type="button" className={`cpjb-pill is-small${mode === k ? ' is-green' : ''}`} onClick={() => setMode(k)}>{k === 'dificil' ? 'Difícil' : 'Fácil'} {m.size}×{m.size} · {m.coins} moedas</button>
        ))}
      </div>
      {!data.puzzles.length && <div className="cpjb-empty"><span>Ainda não tem artes aprovadas. Mande a sua!</span></div>}
      <div className="cpf-jig-grid">
        {data.puzzles.map((p) => (
          <button key={p.id} type="button" className={`cpf-jig-card${p[mode] ? ' is-done' : ''}`} onClick={() => start(p)} title={p.title}>
            <img src={p.imageUrl} alt="" loading="lazy" />
            <span>{p.title}</span>
            {(p.facil || p.dificil) && <em>{p.facil && p.dificil ? '✓✓' : '✓'}</em>}
          </button>
        ))}
      </div>
      <form className="cpjb-search cpf-code cpf-jig-send" onSubmit={submitArt}>
        <span className="cpjb-field"><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Nome da sua arte" maxLength={80} onKeyDown={(e) => { if (e.key !== 'Escape') e.stopPropagation(); }} /></span>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" aria-label="Imagem da arte" />
        <button type="submit" className="cpjb-pill is-green" disabled={sending}>Mandar arte</button>
        {data.mine?.length > 0 && <p className="cpjb-hint">Suas artes: {data.mine.map((m) => `${m.title} (${m.approved ? `${m.solves} montagens` : 'aguardando'})`).join(' · ')}</p>}
      </form>
    </div>
  );
}
