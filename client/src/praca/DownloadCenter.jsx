// Centro de Download — dentro do jogo, no visual do Club Penguin.
//
// À esquerda as categorias (Eventos, Essenciais, Ilha, Festas 2013–2017,
// Roupas e itens) com quantos pacotes já vieram; à direita os pacotes da
// categoria escolhida, cada um com barra de progresso, tamanho e lixeira.
// "Baixar tudo" põe na fila tudo o que falta; "Pausar" para e guarda onde
// parou. Com festa na ilha, o pacote do evento é obrigatório: o painel não
// fecha enquanto ele não terminar.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { deletePack, downloadPack, fetchPacks, fmtSize, packStatus } from './downloads.js';
import '../styles/praca-downloads.css';

const ICONS = {
  evento: <path d="M12 2l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 15.5 6.6 18.5l1.2-6L3.3 8.3l6.1-.7z" />,
  base: <><ellipse cx="12" cy="13" rx="6.5" ry="8" /><ellipse cx="12" cy="15" rx="3.8" ry="5" fill="#fff" /><circle cx="10" cy="9.5" r="1.2" fill="#fff" /><circle cx="14" cy="9.5" r="1.2" fill="#fff" /><path d="M10.5 12h3l-1.5 1.6z" fill="#f5a623" /></>,
  games: <path d="M7 8h10a4 4 0 0 1 4 4v1a3 3 0 0 1-5.2 2L14 13h-4l-1.8 2A3 3 0 0 1 3 13v-1a4 4 0 0 1 4-4zm0 2v1.2H5.8v1.6H7V14h1.6v-1.2h1.2v-1.6H8.6V10zm8.5.4a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm2 2a1 1 0 1 0 0 2 1 1 0 0 0 0-2z" />,
  igloo: <path d="M3 18a9 9 0 0 1 18 0zm7 0v-3a2 2 0 0 1 4 0v3zM6 12.5h12M5 15.5h14M9.5 9.5l1 3M14.5 9.5l-1 3" stroke="#fff" strokeWidth="1" />,
  extras: <path d="M4 6h16v12H4zm2 2v8h12V8zm1 1h6v1.5H7zm0 2.5h5V13H7zm7.5-2.5h2.5v3h-2.5z" />,
  icons: <path d="M8 3l-5 3 2 4 2-1v11h10V9l2 1 2-4-5-3a3 3 0 0 1-8 0z" />,
  paper: <path d="M6 3h12a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zm2 3v8h8V6zm0 10v1.5h8V16z" />,
  sprites: <><ellipse cx="12" cy="12" rx="6" ry="8" /><path d="M7 11l-3 3 2 1.5L8 14zm10 0l3 3-2 1.5L16 14z" /><path d="M8.5 13h7v4h-7z" fill="#e02020" /></>,
  party: <path d="M12 2a5 6 0 0 1 5 6c0 3.6-2.8 6.6-5 7-2.2-.4-5-3.4-5-7a5 6 0 0 1 5-6zm-1 13.5h2l-.4 1.5c.6.7 1 1.6.4 2.6-.5.8-.4 1.6.2 2.4h-1.5c-.6-.9-.6-1.9-.1-2.7.4-.6.3-1.2-.2-1.8z" />,
};

function PackIcon({ name }) {
  return (
    <span className="pdc-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">{ICONS[name] || ICONS.extras}</svg>
    </span>
  );
}

const CloudBtn = ({ onClick, label, disabled }) => (
  <button type="button" className="pdc-cloud" onClick={onClick} disabled={disabled} aria-label={label} title={label}>
    <svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M18.5 10.2A6 6 0 0 0 7 8.6 4.5 4.5 0 0 0 7.5 18h10.5a4 4 0 0 0 .5-7.8zM12 17l-4-4h2.8V9.5h2.4V13H16z" /></svg>
  </button>
);

export default function DownloadCenter({ open, onClose, useCache, baseInstalled, eventInstalled, onEventInstalled, autoStart = false, container = null }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [cat, setCat] = useState(null);
  const [tick, setTick] = useState(0); // força reler o localStorage
  const [running, setRunning] = useState(null); // id em download
  const [live, setLive] = useState({}); // id → {bytes, ratio}
  const [queue, setQueue] = useState([]);
  const [help, setHelp] = useState(false);
  const abortRef = useRef(null);
  const queueRef = useRef([]);
  queueRef.current = queue;

  const load = useCallback(() => {
    setError('');
    fetchPacks().then((d) => { setData(d); setCat((c) => c || (d.packs.some((p) => p.required) ? 'evento' : d.categories[0]?.id)); }).catch((err) => setError(err?.response?.data?.error || 'Não deu pra carregar a lista de downloads.'));
  }, []);
  useEffect(() => { if (open) load(); }, [open, load]);

  const extraDone = useCallback((p) => {
    if (p.id === 'evento') return !!eventInstalled;
    if (['essenciais', 'minigames', 'iglus', 'extras'].includes(p.id)) return !!baseInstalled;
    return false;
  }, [baseInstalled, eventInstalled]);

  const statusOf = useCallback((p) => packStatus(p, extraDone(p)), [extraDone, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const packs = data?.packs || [];
  const required = packs.find((p) => p.required);
  const requiredPending = required && statusOf(required).state !== 'done';

  // fila: um pacote por vez
  const runNext = useCallback(async () => {
    if (abortRef.current) return;
    const nextId = queueRef.current[0];
    if (!nextId) { setRunning(null); return; }
    const pack = packs.find((p) => p.id === nextId);
    if (!pack) { setQueue((q) => q.slice(1)); return; }
    const ac = new AbortController(); abortRef.current = ac;
    setRunning(pack.id);
    try {
      await downloadPack(pack, { useCache, signal: ac.signal, onProgress: (p) => setLive((l) => ({ ...l, [pack.id]: p })) });
      if (pack.id === 'evento') onEventInstalled?.();
      setQueue((q) => q.filter((id) => id !== pack.id));
    } catch (err) {
      if (err?.name !== 'AbortError') {
        setError(`O download de "${pack.name}" falhou (${err?.message || err}). Toque em baixar pra continuar de onde parou.`);
        setQueue([]);
      }
    } finally {
      abortRef.current = null;
      setRunning(null);
      setTick((t) => t + 1);
    }
  }, [packs, useCache, onEventInstalled]);

  useEffect(() => { if (!running && queue.length && !abortRef.current) runNext(); }, [queue, running, runNext]);

  // festa na ilha sem o pacote: já começa sozinho
  useEffect(() => { if (open && autoStart && requiredPending && !queue.includes(required.id)) setQueue((q) => [required.id, ...q]); }, [open, autoStart, requiredPending]); // eslint-disable-line react-hooks/exhaustive-deps

  const enqueue = (ids) => setQueue((q) => [...q, ...ids.filter((id) => !q.includes(id))]);
  const pause = () => { setQueue([]); try { abortRef.current?.abort(); } catch { /* ok */ } };
  const downloadAll = () => {
    const pending = packs.filter((p) => statusOf(p).state !== 'done').map((p) => p.id);
    // o obrigatório primeiro
    pending.sort((a, b) => (a === required?.id ? -1 : b === required?.id ? 1 : 0));
    enqueue(pending);
  };
  const remove = async (p) => {
    if (p.required) return;
    if (!window.confirm(`Apagar "${p.name}" deste aparelho? (${fmtSize(p.bytes)}) Os arquivos voltam a vir da internet quando o jogo precisar.`)) return;
    if (running === p.id) pause();
    await deletePack(p);
    setTick((t) => t + 1);
  };

  // pausa ao fechar a página
  useEffect(() => () => { try { abortRef.current?.abort(); } catch { /* ok */ } }, []);

  const byCat = useMemo(() => {
    const m = new Map();
    for (const c of data?.categories || []) m.set(c.id, []);
    for (const p of packs) { if (!m.has(p.category)) m.set(p.category, []); m.get(p.category).push(p); }
    return m;
  }, [data, packs]);

  if (!open) return null;
  const busy = !!running || queue.length > 0;
  const canClose = !requiredPending;
  const catList = (data?.categories || []).filter((c) => (byCat.get(c.id) || []).length);
  const shown = byCat.get(cat) || [];
  const progressOf = (p) => {
    const st = statusOf(p);
    if (st.state === 'done') return { ratio: 1, bytes: p.bytes, done: true };
    const l = live[p.id];
    if (l && (running === p.id || queue.includes(p.id))) return { ratio: l.ratio, bytes: l.bytes, done: false };
    return { ratio: p.bytes ? st.bytes / p.bytes : 0, bytes: st.bytes, done: false };
  };
  const total = packs.reduce((n, p) => n + p.bytes, 0);
  const have = packs.reduce((n, p) => n + progressOf(p).bytes, 0);

  return createPortal(
    <div className="pdc-backdrop" role="dialog" aria-modal="true" aria-label="Centro de Download">
      <div className="pdc">
        <header className="pdc-head">
          <img src="/praca-ui/download-96.png" alt="" className="pdc-logo" width="40" height="40" />
          <h2>Centro de Download</h2>
          <button type="button" className="pdc-help" onClick={() => setHelp((h) => !h)} aria-expanded={help} aria-label="Como funciona">?</button>
          <span className="pdc-net">{typeof navigator !== 'undefined' && navigator.onLine === false ? 'Sem internet' : (useCache ? 'Fica guardado neste aparelho' : 'Modo simples (cache do navegador)')}</span>
          <button type="button" className="pdc-close" onClick={onClose} disabled={!canClose} aria-label="Fechar" title={canClose ? 'Fechar' : 'Baixe o evento pra entrar na festa'}>✕</button>
          {help && (
            <div className="pdc-tip" role="note">
              <p>1. Baixe só o que quiser, por categoria: o jogo fica mais rápido e funciona melhor com a internet fraca.</p>
              <p>2. A lixeira apaga um pacote deste aparelho (volta a vir da internet quando precisar).</p>
              <p>3. Quando tem festa na ilha, o pacote do evento é obrigatório.</p>
            </div>
          )}
        </header>

        {requiredPending && (
          <div className="pdc-banner">
            <strong>{data?.party || required.name}</strong> está acontecendo na ilha! Baixe o pacote do evento pra entrar na festa.
          </div>
        )}
        {error && <div className="pdc-error" role="alert">{error}</div>}
        {!data && !error && <div className="pdc-loading"><span className="pdc-spin" /> Carregando os pacotes…</div>}

        {data && (
          <div className="pdc-body">
            <nav className="pdc-cats" aria-label="Categorias">
              {catList.map((c) => {
                const list = byCat.get(c.id) || [];
                const done = list.filter((p) => statusOf(p).state === 'done').length;
                const size = list.reduce((n, p) => n + p.bytes, 0);
                const all = done === list.length;
                const isReq = list.some((p) => p.required);
                return (
                  <div key={c.id} className={`pdc-cat${cat === c.id ? ' active' : ''}`}>
                    <button type="button" className="pdc-cat-main" onClick={() => setCat(c.id)}>
                      <span className="pdc-cat-name">{c.name} ({done}/{list.length}){isReq && !all && <span className="pdc-req">obrigatório</span>}</span>
                      <span className="pdc-cat-size">{fmtSize(size)}</span>
                    </button>
                    {all ? <span className="pdc-done">Finalizado</span> : <CloudBtn label={`Baixar ${c.name}`} onClick={() => enqueue(list.filter((p) => statusOf(p).state !== 'done').map((p) => p.id))} />}
                  </div>
                );
              })}
            </nav>

            <div className="pdc-packs">
              {shown.map((p) => {
                const pr = progressOf(p);
                const isRun = running === p.id;
                const queued = !isRun && queue.includes(p.id);
                return (
                  <article key={p.id} className={`pdc-pack${pr.done ? ' is-done' : ''}${isRun ? ' is-run' : ''}`}>
                    {p.required && <span className="pdc-badge">Obrigatório</span>}
                    <PackIcon name={p.icon} />
                    <div className="pdc-pack-main">
                      <h3>{p.name}</h3>
                      <p>{p.desc}</p>
                      <div className="pdc-bar" role="progressbar" aria-valuenow={Math.round(pr.ratio * 100)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${Math.round(pr.ratio * 100)}%` }} /></div>
                    </div>
                    <div className="pdc-pack-side">
                      {!p.required && (pr.done || pr.bytes > 0) && useCache && (
                        <button type="button" className="pdc-trash" onClick={() => remove(p)} aria-label={`Apagar ${p.name}`} title="Apagar deste aparelho">
                          <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M9 3h6l1 2h4v2H4V5h4zm-3 6h12l-1 12H7z" /></svg>
                        </button>
                      )}
                      {pr.done ? <span className="pdc-done">Finalizado</span>
                        : isRun ? <span className="pdc-run">{Math.round(pr.ratio * 100)}%</span>
                          : queued ? <span className="pdc-wait">Na fila</span>
                            : <CloudBtn label={`Baixar ${p.name}`} onClick={() => enqueue([p.id])} />}
                      <span className="pdc-size">{fmtSize(pr.bytes)}/{fmtSize(p.bytes)}</span>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        )}

        <footer className="pdc-foot">
          <button type="button" className="pdc-btn pdc-all" onClick={downloadAll} disabled={!data || packs.every((p) => statusOf(p).state === 'done')}>Baixar tudo</button>
          <button type="button" className="pdc-btn pdc-pause" onClick={pause} disabled={!busy}>Pausar</button>
          <span className="pdc-foot-note">{data ? `${fmtSize(have)} de ${fmtSize(total)} neste aparelho.` : ''} Pra jogar melhor, termine de baixar os pacotes que for usar.</span>
        </footer>
      </div>
    </div>,
    container || document.body,
  );
}
