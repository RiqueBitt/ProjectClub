import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api/client';
import UserAvatar from '../UserAvatar.jsx';
import '../../styles/staff-tools.css';
import '../../styles/staff-game.css';

// Painel da equipe → Jogo (Club Penguin): busca de pinguins e edição de
// moedas, assinatura, itens, móveis, iglus, puffles e carimbos.
// Rotas: /api/staff-game (server/src/routes/staffGame.js).

const fmt = (n) => Number(n || 0).toLocaleString('pt-BR');
const SECTIONS = [
  ['resumo', 'Resumo'], ['itens', 'Itens'], ['moveis', 'Móveis'], ['iglus', 'Iglus'], ['puffles', 'Puffles'], ['carimbos', 'Carimbos'],
];
const ITEM_TYPES = [[0, 'Todos'], [1, 'Cores'], [2, 'Cabeça'], [3, 'Rosto'], [4, 'Pescoço'], [5, 'Corpo'], [6, 'Mão'], [7, 'Pés'], [8, 'Pins'], [9, 'Fundos'], [10, 'Prêmios']];

function useDebounced(value, ms) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

export default function GameAdmin() {
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 300);
  const [list, setList] = useState({ penguins: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [catalog, setCatalog] = useState(null);
  const [selected, setSelected] = useState(null); // id
  const [penguin, setPenguin] = useState(null);
  const [section, setSection] = useState('resumo');
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const editorRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { const { data } = await api.get('/staff-game/penguins', { params: { q: dq } }); setList(data); setError(''); } catch (err) { setError(err?.response?.data?.error || 'Não deu pra listar os pinguins.'); } finally { setLoading(false); }
  }, [dq]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.get('/staff-game/catalog').then(({ data }) => setCatalog(data)).catch(() => {}); }, []);

  const open = useCallback(async (id) => {
    setSelected(id); setPenguin(null); setSection('resumo');
    // celular: lista e ficha ficam empilhadas — leva a pessoa até a ficha
    window.requestAnimationFrame(() => editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    try { const { data } = await api.get(`/staff-game/penguins/${id}`); setPenguin(data); } catch (err) { setError(err?.response?.data?.error || 'Não deu pra abrir o pinguim.'); }
  }, []);

  const notify = (msg, kind = 'ok') => { setToast({ msg, kind }); window.clearTimeout(notify.t); notify.t = window.setTimeout(() => setToast(null), 3500); };

  const apply = useCallback(async (ops) => {
    if (!selected || busy) return;
    setBusy(true);
    try {
      const { data } = await api.patch(`/staff-game/penguins/${selected}`, ops);
      setPenguin(data.penguin);
      notify(data.changes.length ? data.changes.join(' · ') : 'Nada mudou.');
      load();
    } catch (err) { notify(err?.response?.data?.error || 'A alteração falhou.', 'bad'); } finally { setBusy(false); }
  }, [selected, busy, load]);

  const kick = useCallback(async () => {
    if (!selected) return;
    try { const { data } = await api.post(`/staff-game/penguins/${selected}/kick`); notify(data.ok ? 'Jogador desconectado.' : 'Esse pinguim não está conectado.'); setTimeout(() => open(selected), 800); } catch { notify('Não deu pra desconectar.', 'bad'); }
  }, [selected, open]);

  return (
    <div className={`stu stg${selected ? ' has-selected' : ''}`}>
      <PartiesPanel notify={notify} />
      <EpfPanel notify={notify} />
      <div className="stg-layout">
        <aside className="stg-list">
          <label className="stu-search">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" /><path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Pinguim, @usuário ou ID" aria-label="Buscar pinguim" />
            {loading && <span className="stu-spinner" aria-hidden="true" />}
          </label>
          <div className="stg-list-meta">{fmt(list.total)} pinguim{list.total === 1 ? '' : 's'}{dq ? ` para "${dq}"` : ''}</div>
          {error && <div className="sth-error-banner">{error}</div>}
          <ul className="stu-results">
            {list.penguins.map((p) => (
              <li key={p.id}>
                <button type="button" className={`stu-row${selected === p.id ? ' is-selected' : ''}`} onClick={() => open(p.id)}>
                  <span className="stg-pengu" style={{ '--c': colorHex(p.color) }} aria-hidden="true">{p.online && <i className="stg-online" />}</span>
                  <span className="stu-row-main">
                    <span className="stu-row-name">{p.name} {p.mascot && <span className="stu-flag stu-flag-role">mascote</span>}</span>
                    <span className="stu-row-sub">{p.user ? `@${p.user.username}` : 'sem conta'} · #{p.id} · 🪙 {fmt(p.coins)}{p.member ? ' · assinante' : ''}</span>
                  </span>
                  {p.online && <span className="stu-flag stg-flag-on">online</span>}
                </button>
              </li>
            ))}
            {!loading && list.penguins.length === 0 && <li className="sth-empty"><strong>Nenhum pinguim</strong><span>Tente outro nome ou @usuário.</span></li>}
          </ul>
        </aside>

        <section className="stg-editor" ref={editorRef}>
          {selected && <button type="button" className="stg-back" onClick={() => { setSelected(null); setPenguin(null); }}>← Voltar à lista</button>}
          {!selected && (
            <div className="sth-empty stg-empty-big">
              <span className="sth-empty-icon"><PenguinGlyph /></span>
              <strong>Escolha um pinguim</strong>
              <span>Moedas, assinatura, itens, móveis, iglus, puffles e carimbos — tudo editável aqui, mesmo com o jogador online.</span>
            </div>
          )}
          {selected && !penguin && <div className="sth-empty"><span className="stu-spinner" /> Abrindo…</div>}
          {penguin && catalog && (
            <>
              <header className="stg-head">
                <span className="stg-pengu lg" style={{ '--c': colorHex(penguin.color) }} aria-hidden="true">{penguin.online && <i className="stg-online" />}</span>
                <div className="stu-drawer-title">
                  <strong>{penguin.name} <span className="stg-id">#{penguin.id}</span></strong>
                  <span>
                    {penguin.user ? <><UserAvatar user={penguin.user} size={16} /> {penguin.user.displayName} (@{penguin.user.username})</> : 'Sem conta ligada (mascote)'}
                    {' · '}{penguin.online ? <b className="stu-conn on">conectado agora</b> : 'offline'}
                  </span>
                </div>
                <div className="stg-head-actions">
                  <button type="button" className="sth-btn" onClick={() => open(selected)} disabled={busy}>Atualizar</button>
                  <button type="button" className="sth-btn danger" onClick={kick} disabled={!penguin.online}>Desconectar</button>
                </div>
              </header>
              <nav className="stg-tabs" aria-label="Seções">
                {SECTIONS.map(([k, label]) => (
                  <button key={k} type="button" className={`stg-tab${section === k ? ' active' : ''}`} onClick={() => setSection(k)}>
                    {label}
                    <span className="stg-tab-count">{k === 'itens' ? penguin.inventory.length : k === 'moveis' ? Object.values(penguin.furnitureOwned).reduce((n, v) => n + v, 0) : k === 'iglus' ? penguin.iglooTypes.length : k === 'puffles' ? penguin.puffleList.length : k === 'carimbos' ? penguin.stampList.length : ''}</span>
                  </button>
                ))}
              </nav>
              {penguin.online && <p className="stg-note">O jogador está online: moedas, itens, móveis e carimbos novos aparecem pra ele na hora. Remoções e assinatura valem ao entrar de novo — use "Desconectar" se quiser forçar.</p>}
              <div className="stg-body">
                {section === 'resumo' && <SummarySection p={penguin} apply={apply} busy={busy} />}
                {section === 'itens' && <ItemsSection p={penguin} catalog={catalog} apply={apply} busy={busy} />}
                {section === 'moveis' && <FurnitureSection p={penguin} catalog={catalog} apply={apply} busy={busy} />}
                {section === 'iglus' && <IglooSection p={penguin} catalog={catalog} apply={apply} busy={busy} />}
                {section === 'puffles' && <PufflesSection p={penguin} catalog={catalog} apply={apply} busy={busy} />}
                {section === 'carimbos' && <StampsSection p={penguin} catalog={catalog} apply={apply} busy={busy} />}
              </div>
            </>
          )}
        </section>
      </div>
      {toast && <div className={`stg-toast ${toast.kind}`} role="status">{toast.msg}</div>}
    </div>
  );
}

// ---------- festas 2013-2017 ----------

const fmtDay = (mmdd) => { const [m, d] = String(mmdd || '').split('-'); return d && m ? `${d}/${m}` : '—'; };

// Festas de 2013-2017 (server/src/services/waddle/parties.js): as do Club
// Penguin entram sozinhas no rodízio de anos do calendário; as de outras
// marcas da Disney só rodam quando alguém da equipe liga aqui.
// Mensagens da EPF: aparecem no telefone espião de todo mundo (na hora pra
// quem está online).
function EpfPanel({ notify }) {
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [mascot, setMascot] = useState(18);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { api.get('/staff-game/epf').then(({ data: d }) => setData(d)).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);
  if (!data) return null;
  const nameOf = (id) => data.mascots.find((m) => m.id === id)?.name || `#${id}`;

  const send = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    try {
      const { data: d } = await api.post('/staff-game/epf', { message: text, mascot });
      setData((old) => ({ ...old, messages: d.messages }));
      setText('');
      notify(`Mensagem enviada${d.sent ? ` · ${d.sent} agente(s) online receberam` : ''}`);
    } catch (err) { notify(err?.response?.data?.error || 'Não deu pra enviar.', 'bad'); } finally { setBusy(false); }
  };
  const remove = async (m) => {
    if (!window.confirm('Apagar esta mensagem do telefone?')) return;
    try {
      const { data: d } = await api.delete('/staff-game/epf', { data: { time: m.time, message: m.message } });
      setData((old) => ({ ...old, messages: d.messages }));
    } catch (err) { notify(err?.response?.data?.error || 'Não deu pra apagar.', 'bad'); }
  };
  const last = data.messages[0];
  return (
    <section className={`stg-parties stg-epf${open ? ' is-open' : ''}`} aria-label="Mensagens da EPF">
      <button type="button" className="stg-parties-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="stg-parties-icon" aria-hidden="true">📱</span>
        <span className="stg-parties-title">
          <strong>Mensagens da EPF</strong>
          <span>{last ? <>Última: <b>{nameOf(last.mascot)}</b> — {last.message}</> : 'Nenhuma mensagem no telefone espião'}</span>
        </span>
        <span className="stg-parties-caret" aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="stg-parties-body">
          <p className="stg-note">Aparecem no telefone espião dos agentes (ícone de mensagens). As 10 mais novas ficam visíveis; quem está online recebe na hora.</p>
          <form className="stg-epf-form" onSubmit={send}>
            <select value={mascot} onChange={(e) => setMascot(Number(e.target.value))} aria-label="Quem assina">
              {data.mascots.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <input value={text} onChange={(e) => setText(e.target.value)} maxLength={300} placeholder="Ex.: Agentes, atividade estranha na Mina. Investiguem!" aria-label="Mensagem" />
            <button type="submit" className="sth-btn" disabled={busy || !text.trim()}>Enviar</button>
          </form>
          <ul className="stg-epf-list">
            {data.messages.map((m) => (
              <li key={`${m.time}-${m.message}`} className="stg-party">
                <span className="stg-party-main">
                  <span className="stg-party-name">{nameOf(m.mascot)}</span>
                  <span className="stg-party-sub">{m.message}</span>
                  <span className="stg-party-sub">{new Date(m.time * 1000).toLocaleString('pt-BR')}</span>
                </span>
                <button type="button" className="sth-btn danger" onClick={() => remove(m)}>Apagar</button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function PartiesPanel({ notify }) {
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('todas');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { api.get('/staff-game/parties').then(({ data: d }) => setData(d)).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);

  const setActive = async (slug, label) => {
    const msg = slug ? `Ligar "${label}" agora? Quem está na ilha reconecta sozinho já com a festa.` : 'Desligar a festa e voltar ao calendário normal? Quem está na ilha reconecta sozinho.';
    if (!window.confirm(msg)) return;
    setBusy(true);
    try {
      const { data: d } = await api.post('/staff-game/parties/active', { slug });
      notify(slug ? `Festa ligada: ${label}${d.kicked ? ` · ${d.kicked} jogador(es) reconectando` : ''}` : 'Calendário normal de volta.');
      load();
    } catch (err) { notify(err?.response?.data?.error || 'Não deu pra trocar a festa.', 'bad'); } finally { setBusy(false); }
  };

  const groups = useMemo(() => {
    const out = new Map();
    for (const p of data?.parties || []) {
      if (filter === 'cp' && p.licensed) continue;
      if (filter === 'marcas' && !p.licensed) continue;
      if (!out.has(p.year)) out.set(p.year, []);
      out.get(p.year).push(p);
    }
    return [...out.entries()];
  }, [data, filter]);

  if (!data) return null;
  const active = data.active;
  const filesNote = data.files?.state === 'downloading' ? 'Baixando os arquivos das festas no servidor…' : data.files?.state === 'error' ? `Arquivos das festas indisponíveis (${data.files.error}).` : null;
  return (
    <section className={`stg-parties${open ? ' is-open' : ''}`} aria-label="Festas da ilha">
      <button type="button" className="stg-parties-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="stg-parties-icon" aria-hidden="true">🎉</span>
        <span className="stg-parties-title">
          <strong>Festas da ilha</strong>
          <span>
            {active ? <>Agora: <b>{active.label}</b> · {active.source === 'staff' ? 'ligada pela equipe' : 'rodízio do calendário'}</> : `Agora: calendário normal (festas de ${data.rotationYear} este mês)`}
          </span>
        </span>
        <span className="stg-parties-caret" aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="stg-parties-body">
          <p className="stg-note">As festas do Club Penguin de 2013 a 2017 entram sozinhas no calendário (cada mês usa um ano diferente). As de outras marcas da Disney (Star Wars, Frozen, Marvel…) só rodam quando alguém liga aqui. Ao trocar, quem está na ilha reconecta já com a festa nova.</p>
          {filesNote && <div className="sth-error-banner">{filesNote}</div>}
          <div className="stg-parties-bar">
            <div className="stg-chips" role="tablist" aria-label="Filtrar festas">
              {[['todas', 'Todas'], ['cp', 'Do Club Penguin'], ['marcas', 'Outras marcas']].map(([k, label]) => (
                <button key={k} type="button" role="tab" aria-selected={filter === k} className={`stg-chip${filter === k ? ' active' : ''}`} onClick={() => setFilter(k)}>{label}</button>
              ))}
            </div>
            {data.manual && <button type="button" className="sth-btn" disabled={busy} onClick={() => setActive(null)}>Voltar ao calendário</button>}
          </div>
          {groups.map(([year, parties]) => (
            <div key={year} className="stg-parties-year">
              <h4>{year}</h4>
              <ul>
                {parties.map((p) => {
                  const isOn = (active?.slugs || []).includes(p.slug);
                  return (
                    <li key={p.slug} className={`stg-party${isOn ? ' is-on' : ''}`}>
                      <span className="stg-party-main">
                        <span className="stg-party-name">{p.label}{p.licensed && <span className="stu-flag stg-flag-brand">outra marca</span>}{isOn && <span className="stu-flag stg-flag-on">na ilha</span>}</span>
                        <span className="stg-party-sub">{fmtDay(p.start)} a {fmtDay(p.end)} · {p.rooms} sala{p.rooms === 1 ? '' : 's'}{!p.ready ? (p.rooms ? ' · arquivos pendentes' : ' · sem salas no arquivo') : ''}{!p.licensed ? ' · entra no rodízio' : ' · só pela equipe'}</span>
                      </span>
                      {data.manual === p.slug
                        ? <button type="button" className="sth-btn danger" disabled={busy} onClick={() => setActive(null)}>Desligar</button>
                        : <button type="button" className="sth-btn" disabled={busy || !p.ready} onClick={() => setActive(p.slug, p.label)}>Ligar</button>}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ---------- seções ----------

function SummarySection({ p, apply, busy }) {
  const [coins, setCoins] = useState('');
  const [confirmAll, setConfirmAll] = useState(false);
  const n = Number(coins);
  const valid = coins !== '' && Number.isFinite(n);
  return (
    <div className="stg-grid">
      <div className="stu-block">
        <h3>Moedas</h3>
        <div className="stg-coins">🪙 {fmt(p.coins)}</div>
        <div className="stg-inline">
          <input type="number" value={coins} onChange={(e) => setCoins(e.target.value)} placeholder="quantidade" aria-label="Quantidade de moedas" />
          <button type="button" className="sth-btn primary" disabled={!valid || busy} onClick={() => { apply({ coins: { add: n } }); setCoins(''); }}>Adicionar</button>
          <button type="button" className="sth-btn" disabled={!valid || busy} onClick={() => { apply({ coins: { add: -Math.abs(n) } }); setCoins(''); }}>Tirar</button>
          <button type="button" className="sth-btn" disabled={!valid || busy} onClick={() => { apply({ coins: { set: n } }); setCoins(''); }}>Definir</button>
        </div>
      </div>
      <div className="stu-block">
        <h3>Dar tudo</h3>
        <p className="stg-note">Todas as roupas e itens, todos os móveis (1 de cada), todos os iglus, pisos e locais do jogo, de uma vez.{p.online ? ' O jogador está online: ele é reconectado sozinho em seguida, já com tudo.' : ''}</p>
        {confirmAll ? (
          <div className="stg-inline">
            <button type="button" className="sth-btn primary" disabled={busy} onClick={() => { setConfirmAll(false); apply({ giveAll: true }); }}>Sim, dar tudo</button>
            <button type="button" className="sth-btn" disabled={busy} onClick={() => setConfirmAll(false)}>Cancelar</button>
          </div>
        ) : (
          <button type="button" className="sth-btn primary" disabled={busy} onClick={() => setConfirmAll(true)}>Dar todos os itens do jogo</button>
        )}
      </div>
      <div className="stu-block">
        <h3>Conta do pinguim</h3>
        <label className="stg-switch"><input type="checkbox" checked={p.member} disabled={busy} onChange={(e) => apply({ member: e.target.checked })} /> Assinante (membro)</label>
        <label className="stg-switch"><input type="checkbox" checked={p.agent} disabled={busy} onChange={(e) => apply({ agent: e.target.checked })} /> Agente da EPF</label>
        <dl className="stg-facts">
          <div><dt>Minutos jogados</dt><dd>{fmt(p.minutesPlayed)}</dd></div>
          <div><dt>Ninja</dt><dd>{p.ninja ? 'sim' : 'não'}</dd></div>
          <div><dt>Cartas Card-Jitsu</dt><dd>{fmt(p.cards)}</dd></div>
          <div><dt>Pepitas</dt><dd>{fmt(p.nuggets)}</dd></div>
          <div><dt>Criado em</dt><dd>{p.registrationDate ? new Date(p.registrationDate).toLocaleDateString('pt-BR') : '—'}</dd></div>
          <div><dt>Última gravação</dt><dd>{p.updatedAt ? new Date(p.updatedAt).toLocaleString('pt-BR') : '—'}</dd></div>
        </dl>
      </div>
    </div>
  );
}

function Picker({ placeholder, options, onPick, busy, filters, filterValue, onFilter, renderExtra }) {
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 150);
  const rows = useMemo(() => {
    const term = dq.trim().toLowerCase();
    return options.filter((o) => (!term || o.name.toLowerCase().includes(term) || String(o.id) === term)).slice(0, 60);
  }, [options, dq]);
  return (
    <div className="stg-picker">
      <div className="stg-inline">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
        {filters && (
          <select value={filterValue} onChange={(e) => onFilter(Number(e.target.value))} aria-label="Filtro">
            {filters.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        )}
      </div>
      <ul className="stg-options">
        {rows.map((o) => (
          <li key={o.id}>
            <span className="stg-opt-name">{o.name} <small>#{o.id}{o.typeLabel ? ` · ${o.typeLabel}` : ''}{o.category ? ` · ${o.category}` : ''}{o.member ? ' · membro' : ''}</small></span>
            {renderExtra ? renderExtra(o) : <button type="button" className="sth-btn primary sm" disabled={busy} onClick={() => onPick(o)}>Dar</button>}
          </li>
        ))}
        {rows.length === 0 && <li className="stg-opt-empty">Nada com esse nome.</li>}
      </ul>
    </div>
  );
}

function ItemsSection({ p, catalog, apply, busy }) {
  const [type, setType] = useState(0);
  const byId = useMemo(() => new Map(catalog.items.map((i) => [i.id, i])), [catalog]);
  const owned = p.inventory.map((id) => byId.get(id) || { id, name: `Item ${id}`, typeLabel: '?' });
  const equipped = new Set(Object.values(p.equipped));
  const options = useMemo(() => catalog.items.filter((i) => (!type || i.type === type) && !p.inventory.includes(i.id)), [catalog, type, p.inventory]);
  return (
    <div className="stg-grid">
      <div className="stu-block">
        <h3>Tem ({owned.length})</h3>
        <OwnedList rows={owned} busy={busy} tag={(o) => (equipped.has(o.id) ? 'vestindo' : o.typeLabel)} onRemove={(o) => apply({ items: { remove: [o.id] } })} />
      </div>
      <div className="stu-block">
        <h3>Dar item</h3>
        <Picker placeholder="Nome ou ID do item" options={options} onPick={(o) => apply({ items: { add: [o.id] } })} busy={busy} filters={ITEM_TYPES} filterValue={type} onFilter={setType} />
      </div>
    </div>
  );
}

function FurnitureSection({ p, catalog, apply, busy }) {
  const byId = useMemo(() => new Map(catalog.furniture.map((i) => [i.id, i])), [catalog]);
  const owned = Object.entries(p.furnitureOwned).map(([id, amount]) => ({ ...(byId.get(Number(id)) || { id: Number(id), name: `Móvel ${id}` }), amount }));
  return (
    <div className="stg-grid">
      <div className="stu-block">
        <h3>Tem ({owned.reduce((n, o) => n + o.amount, 0)})</h3>
        <ul className="stg-owned">
          {owned.map((o) => (
            <li key={o.id}>
              <span className="stg-opt-name">{o.name} <small>#{o.id}</small></span>
              <span className="stg-qty">
                <button type="button" className="sth-btn sm" disabled={busy} onClick={() => apply({ furniture: { set: [[o.id, o.amount - 1]] } })}>−</button>
                <b>{o.amount}</b>
                <button type="button" className="sth-btn sm" disabled={busy || o.amount >= 99} onClick={() => apply({ furniture: { set: [[o.id, o.amount + 1]] } })}>+</button>
                <button type="button" className="sth-btn danger sm" disabled={busy} onClick={() => apply({ furniture: { set: [[o.id, 0]] } })}>Tirar</button>
              </span>
            </li>
          ))}
          {owned.length === 0 && <li className="stg-opt-empty">Nenhum móvel.</li>}
        </ul>
      </div>
      <div className="stu-block">
        <h3>Dar móvel</h3>
        <Picker placeholder="Nome ou ID do móvel" options={catalog.furniture} busy={busy} onPick={(o) => apply({ furniture: { set: [[o.id, (p.furnitureOwned[o.id] || 0) + 1]] } })} />
      </div>
    </div>
  );
}

function IglooSection({ p, catalog, apply, busy }) {
  const Toggle = ({ list, ownedIds, keyName, label }) => (
    <div className="stu-block">
      <h3>{label} ({ownedIds.length})</h3>
      <ul className="stg-options stg-toggles">
        {list.map((o) => {
          const has = ownedIds.includes(o.id);
          return (
            <li key={o.id} className={has ? 'is-on' : ''}>
              <span className="stg-opt-name">{o.name} <small>#{o.id}</small></span>
              <button type="button" className={`sth-btn sm${has ? ' danger' : ' primary'}`} disabled={busy} onClick={() => apply({ [keyName]: has ? { remove: [o.id] } : { add: [o.id] } })}>{has ? 'Tirar' : 'Dar'}</button>
            </li>
          );
        })}
      </ul>
    </div>
  );
  return (
    <div className="stg-grid">
      <Toggle list={catalog.igloos} ownedIds={p.iglooTypes} keyName="igloos" label="Iglus" />
      <Toggle list={catalog.floorings} ownedIds={p.iglooFloorings} keyName="floorings" label="Pisos" />
      <Toggle list={catalog.locations} ownedIds={p.iglooLocations} keyName="locations" label="Locais" />
      <div className="stu-block">
        <h3>Layouts salvos ({p.igloos.length})</h3>
        <ul className="stg-owned">
          {p.igloos.map((g) => <li key={g.id}><span className="stg-opt-name">Iglu {g.id} <small>tipo {g.type} · piso {g.flooring} · {(g.furniture || []).length} móveis{g.id === p.igloo ? ' · ativo' : ''}{g.locked ? ' · trancado' : ''}</small></span></li>)}
        </ul>
      </div>
    </div>
  );
}

function PufflesSection({ p, catalog, apply, busy }) {
  const [name, setName] = useState('');
  const [type, setType] = useState(catalog.puffles[0]?.id || 0);
  const byId = useMemo(() => new Map(catalog.puffles.map((i) => [i.id, i])), [catalog]);
  return (
    <div className="stg-grid">
      <div className="stu-block">
        <h3>Puffles ({p.puffleList.length})</h3>
        <ul className="stg-owned">
          {p.puffleList.map((pf) => (
            <li key={pf.id}>
              <span className="stg-opt-name">{pf.name} <small>#{pf.id} · {byId.get(pf.type)?.name || `tipo ${pf.type}`} · 🍖 {pf.food} 😴 {pf.rest} 🛁 {pf.clean}</small></span>
              <button type="button" className="sth-btn danger sm" disabled={busy} onClick={() => apply({ puffles: { remove: [pf.id] } })}>Tirar</button>
            </li>
          ))}
          {p.puffleList.length === 0 && <li className="stg-opt-empty">Nenhum puffle.</li>}
        </ul>
      </div>
      <div className="stu-block">
        <h3>Adotar puffle</h3>
        <div className="stg-inline">
          <input value={name} onChange={(e) => setName(e.target.value.slice(0, 12))} placeholder="Nome (até 12 letras)" aria-label="Nome do puffle" />
          <select value={type} onChange={(e) => setType(Number(e.target.value))} aria-label="Tipo">
            {catalog.puffles.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <button type="button" className="sth-btn primary" disabled={busy || !name.trim()} onClick={() => { apply({ puffles: { add: [{ name: name.trim(), type }] } }); setName(''); }}>Adotar</button>
        </div>
      </div>
    </div>
  );
}

function StampsSection({ p, catalog, apply, busy }) {
  const byId = useMemo(() => new Map(catalog.stamps.map((i) => [i.id, i])), [catalog]);
  const owned = p.stampList.map((id) => byId.get(id) || { id, name: `Carimbo ${id}` });
  const options = useMemo(() => catalog.stamps.filter((s) => !p.stampList.includes(s.id)), [catalog, p.stampList]);
  return (
    <div className="stg-grid">
      <div className="stu-block">
        <h3>Tem ({owned.length})</h3>
        <OwnedList rows={owned} busy={busy} tag={(o) => o.category} onRemove={(o) => apply({ stamps: { remove: [o.id] } })} />
      </div>
      <div className="stu-block">
        <h3>Dar carimbo</h3>
        <Picker placeholder="Nome ou ID do carimbo" options={options} busy={busy} onPick={(o) => apply({ stamps: { add: [o.id] } })} />
      </div>
    </div>
  );
}

function OwnedList({ rows, busy, tag, onRemove }) {
  const [q, setQ] = useState('');
  const term = q.trim().toLowerCase();
  const shown = rows.filter((o) => !term || o.name.toLowerCase().includes(term) || String(o.id) === term).slice(0, 200);
  return (
    <>
      {rows.length > 12 && <div className="stg-inline"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrar…" aria-label="Filtrar" /></div>}
      <ul className="stg-owned">
        {shown.map((o) => (
          <li key={o.id}>
            <span className="stg-opt-name">{o.name} <small>#{o.id}{tag?.(o) ? ` · ${tag(o)}` : ''}</small></span>
            <button type="button" className="sth-btn danger sm" disabled={busy} onClick={() => onRemove(o)}>Tirar</button>
          </li>
        ))}
        {shown.length === 0 && <li className="stg-opt-empty">Nada aqui.</li>}
        {rows.length > shown.length && <li className="stg-opt-empty">… e mais {rows.length - shown.length}. Use o filtro.</li>}
      </ul>
    </>
  );
}

const COLORS = { 1: '#0f69a9', 2: '#2b9e3a', 3: '#ef5fa5', 4: '#2f2f2f', 5: '#d62a2a', 6: '#f58a1f', 7: '#f4d21c', 8: '#7a4a1e', 9: '#8a3fb5', 10: '#e8382f', 11: '#16a0a0', 12: '#e2e2e2', 13: '#8ed1f6', 14: '#c0d16a', 15: '#7e7e7e' };
const colorHex = (c) => COLORS[c] || '#0f69a9';

function PenguinGlyph() {
  return <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3c-3.3 0-5.5 2.6-5.5 6.2 0 2 .4 3.6 1.1 5.1L6 17.5l3 .6c.9 1.1 1.9 1.9 3 1.9s2.1-.8 3-1.9l3-.6-1.6-3.2c.7-1.5 1.1-3.1 1.1-5.1C17.5 5.6 15.3 3 12 3z" /><path d="M10.5 10.5c1 .9 2 .9 3 0" /></svg>;
}
