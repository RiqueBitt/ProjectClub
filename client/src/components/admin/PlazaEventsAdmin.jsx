// Painel da Equipe → Club Penguin → Eventos da Praça: eventos (quests, loja
// com moeda do evento, calendário do advento, Coins for Change), códigos de
// desbloqueio e visitas de mascote com agenda (Pingu, Rockhopper…).
// Servidor: /api/staff-game/events|codes|visits (services/waddle/events.js).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../api/client.js';
import '../../styles/plaza-events-admin.css';

const QUEST_TYPES = [
  ['visit', 'Visitar salas'], ['gather', 'Juntar N pinguins numa sala'], ['wear', 'Vestir um item'],
  ['dance', 'Dançar (com item) nas salas'], ['walk_puffle', 'Passear com o puffle até salas'],
  ['online', 'Ficar X minutos na ilha'], ['mascot', 'Encontrar um mascote'], ['donate', 'Doar moedas (Coins for Change)'],
  ['trivia', 'Trivia (TourBot: pergunta numa sala)'],
  ['emote', 'Emotes (N vezes, ou N pinguins juntos — "sala feliz")'], ['snowball', 'Jogar N bolas de neve'], ['joke', 'Contar N piadas'], ['say', 'Dizer um texto no chat'],
];
const EMOTES = [[1, 'Risada'], [2, 'Sorriso'], [3, 'Língua'], [4, 'Surpreso'], [5, 'Triste'], [6, 'Piscada'], [7, 'Enjoado'], [8, 'Bravo'], [9, 'Sério'], ...Array.from({ length: 21 }, (_, i) => [10 + i, `Emote ${10 + i}`])];
const DIFFICULTIES = [['facil', 'Fácil (50 moedas)'], ['media', 'Média (120)'], ['dificil', 'Difícil (250)'], ['extrema', 'Extrema (500)']];
const PUFFLES = [[0, 'Azul'], [1, 'Rosa'], [2, 'Preto'], [3, 'Verde'], [4, 'Roxo'], [5, 'Vermelho'], [6, 'Amarelo'], [7, 'Branco'], [8, 'Laranja'], [9, 'Marrom'], [10, 'Arco-íris'], [11, 'Dourado']];
const toLocal = (iso) => { if (!iso) return ''; const d = new Date(iso); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const idsText = (arr) => (Array.isArray(arr) ? arr.join(', ') : '');
const parseIds = (text) => String(text || '').split(/[\s,;]+/).map(Number).filter((n) => Number.isInteger(n) && n > 0);

export default function PlazaEventsAdmin({ notify, catalog }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  const [rooms, setRooms] = useState([]);
  const [staff, setStaff] = useState([]);
  const [tab, setTab] = useState('eventos');
  const [editing, setEditing] = useState(null); // evento em edição
  const [code, setCode] = useState(null);
  const [visit, setVisit] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get('/staff-game/events').then(({ data: d }) => setData(d)).catch(() => {});
  }, []);
  useEffect(() => { if (open) { load(); api.get('/staff-game/rooms').then(({ data: r }) => setRooms(r)).catch(() => {}); api.get('/staff-game/staff-accounts').then(({ data: r }) => setStaff(r)).catch(() => {}); } }, [open, load]);

  const run = async (fn, okMsg) => {
    setBusy(true);
    try { const r = await fn(); notify(okMsg); load(); return r; } catch (err) { notify(err?.response?.data?.error || 'Não deu certo.', 'bad'); return null; } finally { setBusy(false); }
  };

  const itemName = useCallback((id) => catalog?.items?.find((i) => i.id === id)?.name || `#${id}`, [catalog]);
  const roomName = useCallback((id) => rooms.find((r) => r.id === id)?.name || `Sala ${id}`, [rooms]);

  return (
    <section className={`stg-parties pea${open ? ' is-open' : ''}`} aria-label="Eventos da Praça">
      <button type="button" className="stg-parties-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="stg-parties-icon" aria-hidden="true">🎯</span>
        <span className="stg-parties-title">
          <strong>Eventos da Praça</strong>
          <span>Quests, moeda do evento, loja, códigos, mascotes com agenda, advento e Coins for Change</span>
        </span>
        <span className="stg-parties-caret" aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
      {open && data && (
        <div className="stg-parties-body">
          <div className="stg-chips" role="tablist">
            {[['eventos', `Eventos (${data.events.length})`], ['codigos', `Códigos (${data.codes.length})`], ['mascotes', `Mascotes (${data.visits.length})`], ['concursos', 'Concursos'], ['jigsaw', 'Jigsaw Jam'], ['archives', 'Archives']].map(([k, label]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} className={`stg-chip${tab === k ? ' active' : ''}`} onClick={() => setTab(k)}>{label}</button>
            ))}
          </div>

          {tab === 'eventos' && !editing && (
            <>
              <p className="stg-note">Um evento liga quests e uma moeda própria por um período. Toda a arte é a do próprio jogo: a loja vende itens originais do Club Penguin pela moeda do evento. "Criar a partir da festa atual" monta um modelo com as salas decoradas de agora ({data.party ? data.party.label : 'sem festa ligada'}).</p>
              <div className="stg-parties-bar">
                <button type="button" className="sth-btn primary" disabled={busy} onClick={async () => { try { const { data: t } = await api.get('/staff-game/events/template'); setEditing(t); } catch { notify('Não deu pra montar o modelo.', 'bad'); } }}>Criar a partir da festa atual</button>
                <button type="button" className="sth-btn" onClick={() => setEditing({ slug: '', name: '', currencyName: 'Fichas', startsAt: new Date().toISOString(), endsAt: new Date(Date.now() + 14 * 86400000).toISOString(), active: true, config: { quests: [], shop: [], shopMax: 0, advent: [], cfc: null, completion: null, pass: null, rotation: null } })}>Evento em branco</button>
              </div>
              <Presets notify={notify} busy={busy} onPick={(t) => setEditing(t)} onCodes={(key) => run(() => api.post(`/staff-game/events/presets/${key}/codes`), 'Códigos do modelo criados.')} />
              <ul className="pea-list">
                {data.events.map((ev) => (
                  <li key={ev.slug} className={`stg-party${ev.running ? ' is-on' : ''}`}>
                    <span className="stg-party-main">
                      <span className="stg-party-name">{ev.name}{ev.running && <span className="stu-flag stg-flag-on">rolando</span>}{!ev.active && <span className="stu-flag">desligado</span>}</span>
                      <span className="stg-party-sub">{new Date(ev.startsAt).toLocaleDateString('pt-BR')} → {new Date(ev.endsAt).toLocaleDateString('pt-BR')} · {ev.config.quests.length} quests · {ev.config.shop.length} na loja · moeda "{ev.currencyName}"{ev.config.advent.length ? ' · advento' : ''}{ev.config.cfc ? ' · Coins for Change' : ''}{ev.config.pass ? ' · passe' : ''}{ev.config.rotation ? ` · rodízio (${ev.config.rotation.quests.length})` : ''}</span>
                    </span>
                    <button type="button" className="sth-btn" onClick={() => setEditing({ ...ev, config: ev.config })}>Editar</button>
                    <button type="button" className="sth-btn danger" disabled={busy} onClick={() => { if (window.confirm(`Apagar o evento "${ev.name}"? Carteiras e progresso dos jogadores também somem.`)) run(() => api.delete(`/staff-game/events/${ev.slug}`), 'Evento apagado.'); }}>Apagar</button>
                  </li>
                ))}
                {!data.events.length && <li className="sth-empty"><strong>Nenhum evento</strong><span>Crie um a partir da festa atual.</span></li>}
              </ul>
            </>
          )}

          {tab === 'eventos' && editing && (
            <EventForm ev={editing} rooms={rooms} catalog={catalog} itemName={itemName} roomName={roomName} busy={busy} onCancel={() => setEditing(null)}
              onSave={async (body) => { const r = await run(() => api.put('/staff-game/events', body), 'Evento salvo.'); if (r) setEditing(null); }} />
          )}

          {tab === 'codigos' && (
            <>
              <p className="stg-note">Códigos valem uma vez por pinguim. Divulgue no Novidades, nas lives e nas visitas dos mascotes. Letras e números, sem espaço.</p>
              <CodeForm code={code} events={data.events} itemName={itemName} busy={busy} onNew={() => setCode({ code: '', label: '', coins: 0, eventCoins: 0, eventSlug: '', items: [], maxUses: '', expiresAt: '', active: true })} onCancel={() => setCode(null)}
                onSave={async (body) => { const r = await run(() => api.put('/staff-game/codes', body), 'Código salvo.'); if (r) setCode(null); }} />
              <ul className="pea-list">
                {data.codes.map((c) => (
                  <li key={c.code} className={`stg-party${c.active ? '' : ' is-off'}`}>
                    <span className="stg-party-main">
                      <span className="stg-party-name"><code>{c.code}</code> {c.label}</span>
                      <span className="stg-party-sub">{c.coins ? `${c.coins} moedas · ` : ''}{c.eventCoins ? `${c.eventCoins} moeda de evento${c.eventSlug ? ` (${c.eventSlug})` : ''} · ` : ''}{JSON.parse(c.items || '[]').length} itens · usado {c.uses}{c.maxUses ? `/${c.maxUses}` : ''} vez(es){c.expiresAt ? ` · até ${new Date(c.expiresAt).toLocaleDateString('pt-BR')}` : ''}{!c.active ? ' · desligado' : ''}</span>
                    </span>
                    <button type="button" className="sth-btn" onClick={() => setCode({ ...c, items: JSON.parse(c.items || '[]'), maxUses: c.maxUses || '', expiresAt: toLocal(c.expiresAt), eventSlug: c.eventSlug || '' })}>Editar</button>
                    <button type="button" className="sth-btn danger" disabled={busy} onClick={() => { if (window.confirm(`Apagar o código ${c.code}?`)) run(() => api.delete(`/staff-game/codes/${c.code}`), 'Código apagado.'); }}>Apagar</button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {tab === 'mascotes' && (
            <>
              <p className="stg-note">Uma visita marca quando e em que sala um mascote aparece. A conta escolhida "veste" o mascote: enquanto o pinguim dela estiver na sala, quem entrar lá recebe o brinde (fundo, itens, moedas) uma vez. O Pingu é o mascote oficial do Project Club.</p>
              <VisitForm visit={visit} rooms={rooms} staff={staff} itemName={itemName} busy={busy} onNew={() => setVisit({ mascotKey: 'pingu', name: 'Pingu', mascotUserId: '', room: 100, surprise: false, startsAt: toLocal(new Date(Date.now() + 3600000).toISOString()), endsAt: toLocal(new Date(Date.now() + 2 * 3600000).toISOString()), backgroundItemId: '', itemIds: [], coins: 0, eventCoins: 0, note: '' })} onCancel={() => setVisit(null)}
                onSave={async (body) => { const r = await run(() => api.put('/staff-game/visits', body), 'Visita salva.'); if (r) setVisit(null); }} />
              <ul className="pea-list">
                {data.visits.map((v) => (
                  <li key={v.id} className="stg-party">
                    <span className="stg-party-main">
                      <span className="stg-party-name">{v.name} <span className="stg-id">({v.mascotKey})</span></span>
                      <span className="stg-party-sub">{v.surprise ? 'surpresa · ' : ''}{roomName(v.room)} · {new Date(v.startsAt).toLocaleString('pt-BR')} → {new Date(v.endsAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} · {v.mascotUserId ? `conta ${staff.find((s) => s.id === v.mascotUserId)?.displayName || '?'}` : 'SEM conta (ninguém recebe brinde)'} · {v.meets} encontro(s){v.backgroundItemId ? ` · fundo ${itemName(v.backgroundItemId)}` : ''}</span>
                    </span>
                    <button type="button" className="sth-btn" onClick={() => setVisit({ ...v, itemIds: JSON.parse(v.itemIds || '[]'), startsAt: toLocal(v.startsAt), endsAt: toLocal(v.endsAt), backgroundItemId: v.backgroundItemId || '', mascotUserId: v.mascotUserId || '' })}>Editar</button>
                    <button type="button" className="sth-btn danger" disabled={busy} onClick={() => { if (window.confirm('Apagar essa visita?')) run(() => api.delete(`/staff-game/visits/${v.id}`), 'Visita apagada.'); }}>Apagar</button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {tab === 'concursos' && <ContestsTab notify={notify} itemName={itemName} />}
          {tab === 'jigsaw' && <JigsawTab notify={notify} itemName={itemName} />}
          {tab === 'archives' && <ArchivesTab notify={notify} rooms={rooms} />}
        </div>
      )}
    </section>
  );
}

// ---------- formulário do evento ----------
function EventForm({ ev, rooms, catalog, itemName, roomName, busy, onSave, onCancel }) {
  const [f, setF] = useState(() => ({ ...ev, startsAt: toLocal(ev.startsAt), endsAt: toLocal(ev.endsAt), config: { quests: ev.config?.quests || [], shop: ev.config?.shop || [], shopMax: ev.config?.shopMax || 0, advent: ev.config?.advent || [], cfc: ev.config?.cfc || null, completion: ev.config?.completion || null, pass: ev.config?.pass || null, rotation: ev.config?.rotation || null } }));
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const setCfg = (k, v) => setF((x) => ({ ...x, config: { ...x.config, [k]: v } }));
  const upd = (list, i, patch) => setCfg(list, f.config[list].map((q, j) => (j === i ? { ...q, ...patch } : q)));
  const del = (list, i) => setCfg(list, f.config[list].filter((_, j) => j !== i));

  return (
    <form className="pea-form" onSubmit={(e) => { e.preventDefault(); onSave({ ...f, startsAt: new Date(f.startsAt).toISOString(), endsAt: new Date(f.endsAt).toISOString() }); }}>
      <div className="pea-grid">
        <label>Identificador (slug)<input value={f.slug} onChange={(e) => set('slug', e.target.value)} placeholder="halloween-2026" required /></label>
        <label>Nome<input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="Festa de Halloween" required /></label>
        <label>Nome da moeda do evento<input value={f.currencyName} onChange={(e) => set('currencyName', e.target.value)} placeholder="Doces" /></label>
        <label>Começa<input type="datetime-local" value={f.startsAt} onChange={(e) => set('startsAt', e.target.value)} required /></label>
        <label>Termina<input type="datetime-local" value={f.endsAt} onChange={(e) => set('endsAt', e.target.value)} required /></label>
        <label className="pea-check"><input type="checkbox" checked={f.active !== false} onChange={(e) => set('active', e.target.checked)} /> Ligado</label>
      </div>

      <h4>Quests ({f.config.quests.length})</h4>
      {f.config.quests.map((q, i) => (
        <QuestCard key={i} q={q} rooms={rooms} catalog={catalog} itemName={itemName} roomName={roomName} currencyName={f.currencyName} onChange={(patch) => upd('quests', i, patch)} onDelete={() => del('quests', i)} />
      ))}
      <button type="button" className="sth-btn" onClick={() => setCfg('quests', [...f.config.quests, { key: `quest${f.config.quests.length + 1}`, title: '', type: 'visit', difficulty: 'facil', rooms: [], reward: { coins: null, eventCoins: 20, items: [] } }])}>+ Quest</button>

      <h4>Rodízio ({f.config.rotation?.quests?.length || 0}) — ex.: pin da semana</h4>
      <p className="stg-note">A cada N dias entra a próxima quest da lista (e volta ao começo no fim). Cada ciclo tem recompensa própria: quem pegou o pin da semana 1 pega o da semana 2. O rodízio não conta pro prêmio final nem pro passe.</p>
      {!f.config.rotation ? <button type="button" className="sth-btn" onClick={() => setCfg('rotation', { everyDays: 7, label: 'Pin da semana', quests: [] })}>Ligar rodízio</button> : (
        <>
          <div className="pea-grid">
            <label>A cada (dias)<input type="number" min="1" max="60" value={f.config.rotation.everyDays || 7} onChange={(e) => setCfg('rotation', { ...f.config.rotation, everyDays: Number(e.target.value) })} /></label>
            <label>Etiqueta<input value={f.config.rotation.label || ''} onChange={(e) => setCfg('rotation', { ...f.config.rotation, label: e.target.value })} placeholder="Pin da semana" /></label>
          </div>
          {(f.config.rotation.quests || []).map((q, i) => (
            <QuestCard key={i} q={q} rooms={rooms} catalog={catalog} itemName={itemName} roomName={roomName} currencyName={f.currencyName} onChange={(patch) => setCfg('rotation', { ...f.config.rotation, quests: f.config.rotation.quests.map((x, j) => (j === i ? { ...x, ...patch } : x)) })} onDelete={() => setCfg('rotation', { ...f.config.rotation, quests: f.config.rotation.quests.filter((_, j) => j !== i) })} />
          ))}
          <div className="stg-parties-bar">
            <button type="button" className="sth-btn" onClick={() => setCfg('rotation', { ...f.config.rotation, quests: [...(f.config.rotation.quests || []), { key: `pin${(f.config.rotation.quests || []).length + 1}`, title: '', type: 'visit', difficulty: 'facil', rooms: [], reward: { coins: 20, eventCoins: 0, items: [] } }] })}>+ Quest no rodízio</button>
            <button type="button" className="sth-btn danger" onClick={() => setCfg('rotation', null)}>Desligar rodízio</button>
          </div>
        </>
      )}

      <h4>Passe da festa (Party Pass)</h4>
      <p className="stg-note">Cada quest concluída soma os pontos da dificuldade (fácil 50, média 120, difícil 250, extrema 500 — ou o campo "pontos" da quest). Os níveis liberam prêmios.</p>
      {!f.config.pass ? <button type="button" className="sth-btn" onClick={() => setCfg('pass', { levels: [{ points: 150, label: 'Nível 1', coins: 100, eventCoins: 0, items: [] }] })}>Ligar passe</button> : (
        <>
          {f.config.pass.levels.map((l, i) => (
            <div key={i} className="pea-card pea-inline">
              <label>Pontos<input type="number" min="1" value={l.points || 0} onChange={(e) => setCfg('pass', { levels: f.config.pass.levels.map((x, j) => (j === i ? { ...x, points: Number(e.target.value) } : x)) })} /></label>
              <label>Nome<input value={l.label || ''} onChange={(e) => setCfg('pass', { levels: f.config.pass.levels.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} /></label>
              <label>Moedas<input type="number" min="0" value={l.coins || 0} onChange={(e) => setCfg('pass', { levels: f.config.pass.levels.map((x, j) => (j === i ? { ...x, coins: Number(e.target.value) } : x)) })} /></label>
              <label>{f.currencyName}<input type="number" min="0" value={l.eventCoins || 0} onChange={(e) => setCfg('pass', { levels: f.config.pass.levels.map((x, j) => (j === i ? { ...x, eventCoins: Number(e.target.value) } : x)) })} /></label>
              <ItemsField value={l.items || []} catalog={catalog} itemName={itemName} onChange={(v) => setCfg('pass', { levels: f.config.pass.levels.map((x, j) => (j === i ? { ...x, items: v } : x)) })} label="Itens" />
              <button type="button" className="sth-btn danger" onClick={() => setCfg('pass', { levels: f.config.pass.levels.filter((_, j) => j !== i) })}>Tirar</button>
            </div>
          ))}
          <div className="stg-parties-bar">
            <button type="button" className="sth-btn" onClick={() => setCfg('pass', { levels: [...f.config.pass.levels, { points: (f.config.pass.levels.at(-1)?.points || 150) + 250, label: `Nível ${f.config.pass.levels.length + 1}`, coins: 0, eventCoins: 0, items: [] }] })}>+ Nível</button>
            <button type="button" className="sth-btn danger" onClick={() => setCfg('pass', null)}>Desligar passe</button>
          </div>
        </>
      )}

      <h4>Prêmio por completar todas as quests</h4>
      <div className="pea-card">
        <div className="pea-grid">
          <label>Nome do prêmio<input value={f.config.completion?.label || ''} onChange={(e) => setCfg('completion', { ...(f.config.completion || {}), label: e.target.value })} placeholder="Fantasia de Dragão" /></label>
          <label>Moedas<input type="number" min="0" value={f.config.completion?.coins || 0} onChange={(e) => setCfg('completion', { ...(f.config.completion || {}), coins: Number(e.target.value) })} /></label>
          <label>{f.currencyName || 'Moeda do evento'}<input type="number" min="0" value={f.config.completion?.eventCoins || 0} onChange={(e) => setCfg('completion', { ...(f.config.completion || {}), eventCoins: Number(e.target.value) })} /></label>
          <ItemsField value={f.config.completion?.items || []} catalog={catalog} itemName={itemName} onChange={(v) => setCfg('completion', { ...(f.config.completion || {}), items: v })} label="Itens (deixe tudo vazio pra não ter prêmio final)" />
        </div>
      </div>

      <h4>Loja do evento ({f.config.shop.length}) — itens por {f.currencyName || 'moeda do evento'}</h4>
      <div className="pea-grid"><label>Máximo de itens diferentes por pinguim (0 = sem limite; o CP Journey usa 3)<input type="number" min="0" max="99" value={f.config.shopMax || 0} onChange={(e) => setCfg('shopMax', Number(e.target.value))} /></label></div>
      {f.config.shop.map((s, i) => (
        <div key={i} className="pea-card">
          <div className="pea-grid">
            <label>Chave<input value={s.key || ''} onChange={(e) => upd('shop', i, { key: e.target.value })} required /></label>
            <label>Nome na loja<input value={s.label || ''} onChange={(e) => upd('shop', i, { label: e.target.value })} required /></label>
            <label>Preço<input type="number" min="0" value={s.price || 0} onChange={(e) => upd('shop', i, { price: Number(e.target.value) })} /></label>
            <label>Vendedor (mascote, opcional)<input value={s.seller || ''} onChange={(e) => upd('shop', i, { seller: e.target.value })} placeholder="Rockhopper" /></label>
            <label>Compras por pinguim<input type="number" min="1" max="99" value={s.limit || 1} onChange={(e) => upd('shop', i, { limit: Number(e.target.value) })} /></label>
            <ItemsField value={s.itemIds || []} catalog={catalog} itemName={itemName} onChange={(v) => upd('shop', i, { itemIds: v })} label="Itens entregues" />
          </div>
          <button type="button" className="sth-btn danger" onClick={() => del('shop', i)}>Tirar da loja</button>
        </div>
      ))}
      <button type="button" className="sth-btn" onClick={() => setCfg('shop', [...f.config.shop, { key: `item${f.config.shop.length + 1}`, label: '', itemIds: [], price: 50 }])}>+ Item na loja</button>

      <h4>Calendário do advento ({f.config.advent.length} dias) — dezembro</h4>
      {f.config.advent.map((a, i) => (
        <div key={i} className="pea-card pea-inline">
          <label>Dia<input type="number" min="1" max="25" value={a.day || 1} onChange={(e) => upd('advent', i, { day: Number(e.target.value) })} /></label>
          <label>Moedas<input type="number" min="0" value={a.coins || 0} onChange={(e) => upd('advent', i, { coins: Number(e.target.value) })} /></label>
          <label>{f.currencyName}<input type="number" min="0" value={a.eventCoins || 0} onChange={(e) => upd('advent', i, { eventCoins: Number(e.target.value) })} /></label>
          <ItemsField value={a.items || []} catalog={catalog} itemName={itemName} onChange={(v) => upd('advent', i, { items: v })} label="Itens" />
          <button type="button" className="sth-btn danger" onClick={() => del('advent', i)}>Tirar</button>
        </div>
      ))}
      <div className="stg-parties-bar">
        <button type="button" className="sth-btn" onClick={() => setCfg('advent', [...f.config.advent, { day: f.config.advent.length + 1, coins: 50, eventCoins: 0, items: [] }])}>+ Dia</button>
        {!f.config.advent.length && <button type="button" className="sth-btn" onClick={() => setCfg('advent', Array.from({ length: 25 }, (_, d) => ({ day: d + 1, coins: d === 24 ? 500 : 50, eventCoins: 0, items: [] })))}>Gerar 25 dias (50 moedas cada, 500 no dia 25)</button>}
      </div>

      <h4>Coins for Change (doações da comunidade)</h4>
      {!f.config.cfc ? <button type="button" className="sth-btn" onClick={() => setCfg('cfc', { goals: [{ amount: 10000, label: 'Meta 1', items: [], coins: 100 }] })}>Ligar Coins for Change</button> : (
        <>
          {f.config.cfc.goals.map((g, i) => (
            <div key={i} className="pea-card pea-inline">
              <label>Meta (moedas)<input type="number" min="1" value={g.amount || 0} onChange={(e) => setCfg('cfc', { goals: f.config.cfc.goals.map((x, j) => (j === i ? { ...x, amount: Number(e.target.value) } : x)) })} /></label>
              <label>Nome<input value={g.label || ''} onChange={(e) => setCfg('cfc', { goals: f.config.cfc.goals.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} /></label>
              <label>Moedas de volta pra quem doou<input type="number" min="0" value={g.coins || 0} onChange={(e) => setCfg('cfc', { goals: f.config.cfc.goals.map((x, j) => (j === i ? { ...x, coins: Number(e.target.value) } : x)) })} /></label>
              <ItemsField value={g.items || []} catalog={catalog} itemName={itemName} onChange={(v) => setCfg('cfc', { goals: f.config.cfc.goals.map((x, j) => (j === i ? { ...x, items: v } : x)) })} label="Itens" />
              <button type="button" className="sth-btn danger" onClick={() => setCfg('cfc', { goals: f.config.cfc.goals.filter((_, j) => j !== i) })}>Tirar</button>
            </div>
          ))}
          <div className="stg-parties-bar">
            <button type="button" className="sth-btn" onClick={() => setCfg('cfc', { goals: [...f.config.cfc.goals, { amount: (f.config.cfc.goals.at(-1)?.amount || 10000) * 2, label: `Meta ${f.config.cfc.goals.length + 1}`, items: [], coins: 0 }] })}>+ Meta</button>
            <button type="button" className="sth-btn danger" onClick={() => setCfg('cfc', null)}>Desligar Coins for Change</button>
          </div>
        </>
      )}

      <div className="stg-parties-bar pea-actions">
        <button type="submit" className="sth-btn primary" disabled={busy}>Salvar evento</button>
        <button type="button" className="sth-btn" onClick={onCancel}>Cancelar</button>
      </div>
    </form>
  );
}

function QuestCard({ q, rooms, catalog, itemName, roomName, currencyName, onChange, onDelete }) {
  const upd = (patch) => onChange(patch);
  const options = Array.isArray(q.options) ? q.options : [];
  return (
    <div className="pea-card">
      <div className="pea-grid">
        <label>Chave<input value={q.key || ''} onChange={(e) => upd({ key: e.target.value })} placeholder="explorar" required /></label>
        <label>Título<input value={q.title || ''} onChange={(e) => upd({ title: e.target.value })} required /></label>
        <label>Tipo<select value={q.type || 'visit'} onChange={(e) => upd({ type: e.target.value })}>{QUEST_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label>Dificuldade<select value={q.difficulty || 'facil'} onChange={(e) => upd({ difficulty: e.target.value })}>{DIFFICULTIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="pea-wide">Descrição<input value={q.desc || ''} onChange={(e) => upd({ desc: e.target.value })} /></label>
        <label className="pea-wide">Dica (rima/pista — esconde o nome da sala na janela do jogo)<input value={q.hint || ''} onChange={(e) => upd({ hint: e.target.value })} placeholder="Onde o carrinho desce sem parar…" /></label>
        {q.type === 'trivia' && <label className="pea-wide">Pergunta<input value={q.question || ''} onChange={(e) => upd({ question: e.target.value })} required /></label>}
        {q.type === 'trivia' && <label className="pea-wide">Opções (separadas por ;)<input value={options.join('; ')} onChange={(e) => upd({ options: e.target.value.split(';').map((o) => o.trim()) })} placeholder="Rockhopper; Pingu; Gary" /></label>}
        {q.type === 'trivia' && <label>Resposta certa<select value={q.answer ?? 0} onChange={(e) => upd({ answer: Number(e.target.value) })}>{options.map((o, i) => <option key={i} value={i}>{o || `opção ${i + 1}`}</option>)}</select></label>}
        {q.type === 'trivia' && <RoomsField value={q.rooms || []} rooms={rooms} roomName={roomName} onChange={(v) => upd({ rooms: v })} label="Sala do TourBot (vazio = responde de qualquer lugar)" />}
        {['emote', 'snowball', 'joke', 'say'].includes(q.type) && <RoomsField value={q.rooms || []} rooms={rooms} roomName={roomName} onChange={(v) => upd({ rooms: v })} label="Salas (vazio = qualquer)" />}
        {['emote', 'snowball', 'joke', 'say'].includes(q.type) && <ItemsField value={q.items || []} catalog={catalog} itemName={itemName} onChange={(v) => upd({ items: v })} label="Vestindo (vazio = qualquer roupa)" />}
        {q.type === 'emote' && <label>Emote<select value={(q.emotes || [])[0] ?? ''} onChange={(e) => upd({ emotes: e.target.value === '' ? [] : [Number(e.target.value)] })}><option value="">qualquer</option>{EMOTES.map(([k, l]) => <option key={k} value={k}>{l} ({k <= 9 ? `E+${k}` : `id ${k}`})</option>)}</select></label>}
        {q.type === 'emote' && <label>Pinguins juntos (0 = conta só os seus)<input type="number" min="0" max="100" value={q.together || 0} onChange={(e) => upd({ together: Number(e.target.value) })} /></label>}
        {['emote', 'snowball', 'joke', 'say'].includes(q.type) && !(q.type === 'emote' && q.together > 1) && <label>Quantas vezes<input type="number" min="1" max="200" value={q.count || 1} onChange={(e) => upd({ count: Number(e.target.value) })} /></label>}
        {q.type === 'say' && <label>Texto que precisa aparecer<input value={q.text || ''} onChange={(e) => upd({ text: e.target.value })} placeholder="feliz natal" /></label>}
        {q.type === 'gather' && <ItemsField value={q.items || []} catalog={catalog} itemName={itemName} onChange={(v) => upd({ items: v })} label="Só conta quem veste (vazio = todo mundo)" />}
        <label className="pea-wide">Abre depois de (chaves de outras quests, separadas por vírgula — cadeia de história)<input value={Array.isArray(q.requires) ? q.requires.join(', ') : (q.requires || '')} onChange={(e) => upd({ requires: e.target.value.split(/[\s,;]+/).filter(Boolean) })} placeholder="pista1, pista2" /></label>
        {q.type === 'dance' && <RoomsField value={q.rooms || []} rooms={rooms} roomName={roomName} onChange={(v) => upd({ rooms: v })} label="Salas pra dançar (vazio = qualquer)" />}
        {q.type === 'dance' && <ItemsField value={q.items || []} catalog={catalog} itemName={itemName} onChange={(v) => upd({ items: v })} label="Dançando com (vazio = qualquer roupa)" />}
        {q.type === 'walk_puffle' && <RoomsField value={q.rooms || []} rooms={rooms} roomName={roomName} onChange={(v) => upd({ rooms: v })} label="Salas pra levar o puffle" />}
        {q.type === 'walk_puffle' && <label>Puffle<select value={(q.puffles || [])[0] ?? ''} onChange={(e) => upd({ puffles: e.target.value === '' ? [] : [Number(e.target.value)] })}><option value="">qualquer</option>{PUFFLES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>}
        {(q.type === 'visit' || q.type === 'gather') && <RoomsField value={q.rooms || []} rooms={rooms} roomName={roomName} onChange={(v) => upd({ rooms: v })} label={q.type === 'visit' ? 'Salas pra visitar' : 'Sala (vazio = qualquer)'} />}
        {q.type === 'gather' && <label>Quantos pinguins<input type="number" min="2" max="200" value={q.count || 5} onChange={(e) => upd({ count: Number(e.target.value) })} /></label>}
        {q.type === 'wear' && <ItemsField value={q.items || []} catalog={catalog} itemName={itemName} onChange={(v) => upd({ items: v })} label="Itens aceitos (vazio = qualquer)" />}
        {q.type === 'online' && <label>Minutos<input type="number" min="1" max="600" value={q.minutes || 10} onChange={(e) => upd({ minutes: Number(e.target.value) })} /></label>}
        {q.type === 'mascot' && <label>Mascote (chave)<input value={q.mascot || 'pingu'} onChange={(e) => upd({ mascot: e.target.value })} /></label>}
        {q.type === 'donate' && <label>Moedas doadas<input type="number" min="1" value={q.count || 100} onChange={(e) => upd({ count: Number(e.target.value) })} /></label>}
        <label>Recompensa: moedas (vazio = padrão da dificuldade)<input type="number" min="0" value={q.reward?.coins ?? ''} onChange={(e) => upd({ reward: { ...(q.reward || {}), coins: e.target.value === '' ? null : Number(e.target.value) } })} /></label>
        <label>Recompensa: {currencyName || 'moeda do evento'}<input type="number" min="0" value={q.reward?.eventCoins || 0} onChange={(e) => upd({ reward: { ...(q.reward || {}), eventCoins: Number(e.target.value) } })} /></label>
        <label>Pontos do passe (vazio = os da dificuldade)<input type="number" min="0" value={q.points ?? ''} onChange={(e) => upd({ points: e.target.value === '' ? null : Number(e.target.value) })} /></label>
        <ItemsField value={q.reward?.items || []} catalog={catalog} itemName={itemName} onChange={(v) => upd({ reward: { ...(q.reward || {}), items: v } })} label="Recompensa: itens" />
      </div>
      <button type="button" className="sth-btn danger" onClick={onDelete}>Tirar quest</button>
    </div>
  );
}

function Presets({ notify, busy, onPick, onCodes }) {
  const [list, setList] = useState(null);
  const [open, setOpen] = useState(false);
  useEffect(() => { if (open && !list) api.get('/staff-game/events/presets').then(({ data }) => setList(data)).catch(() => setList([])); }, [open, list]);
  return (
    <div className="pea-card">
      <button type="button" className="sth-btn" onClick={() => setOpen((o) => !o)}>{open ? '▴' : '▾'} Modelos prontos (Halloween, Natal, Puffles, Dance-A-Thon, Medieval, Feira, Copa, aniversário…)</button>
      {open && (
        <ul className="pea-list">
          {(list || []).map((p) => (
            <li key={p.key} className="stg-party">
              <span className="stg-party-main">
                <span className="stg-party-name">{p.name}</span>
                <span className="stg-party-sub">{p.when} · {p.quests} quests · {p.shop} na loja · moeda "{p.currencyName}"{p.advent ? ' · advento' : ''}{p.cfc ? ' · Coins for Change' : ''}{p.pass ? ' · passe' : ''}{p.rotation ? ' · rodízio' : ''}{p.codes ? ` · ${p.codes} código(s)` : ''}</span>
              </span>
              {p.quests > 0 && <button type="button" className="sth-btn primary" disabled={busy} onClick={async () => { try { const { data } = await api.get(`/staff-game/events/presets/${p.key}`); onPick(data); } catch { notify('Não deu pra carregar o modelo.', 'bad'); } }}>Usar</button>}
              {p.codes > 0 && <button type="button" className="sth-btn" disabled={busy} onClick={() => onCodes(p.key)}>Criar códigos</button>}
            </li>
          ))}
          {list && !list.length && <li className="sth-empty"><span>Sem modelos.</span></li>}
        </ul>
      )}
    </div>
  );
}

function RoomsField({ value, rooms, roomName, onChange, label }) {
  const [pick, setPick] = useState('');
  return (
    <div className="pea-wide pea-tags">
      <span className="pea-label">{label}</span>
      <div className="pea-chips">
        {value.map((id) => <button key={id} type="button" className="stg-chip" onClick={() => onChange(value.filter((x) => x !== id))} title="Tirar">{roomName(id)} ×</button>)}
        <select value={pick} onChange={(e) => { const id = Number(e.target.value); if (id && !value.includes(id)) onChange([...value, id]); setPick(''); }}>
          <option value="">+ sala…</option>
          {rooms.map((r) => <option key={r.id} value={r.id}>{r.name} ({r.id})</option>)}
        </select>
      </div>
    </div>
  );
}

function ItemsField({ value, catalog, itemName, onChange, label }) {
  const [q, setQ] = useState('');
  const results = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t || !catalog?.items) return [];
    return catalog.items.filter((i) => String(i.id) === t || i.name.toLowerCase().includes(t)).slice(0, 8);
  }, [q, catalog]);
  return (
    <div className="pea-wide pea-tags">
      <span className="pea-label">{label}</span>
      <div className="pea-chips">
        {value.map((id) => <button key={id} type="button" className="stg-chip" onClick={() => onChange(value.filter((x) => x !== id))} title="Tirar">{itemName(id)} ×</button>)}
        <span className="pea-search">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="nome ou id do item…" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); const ids = parseIds(q); if (ids.length) { onChange([...new Set([...value, ...ids])]); setQ(''); } } }} />
          {results.length > 0 && (
            <ul className="pea-results">
              {results.map((i) => <li key={i.id}><button type="button" onClick={() => { if (!value.includes(i.id)) onChange([...value, i.id]); setQ(''); }}>{i.name} <small>#{i.id} · {i.typeLabel}{i.member ? ' · assinante' : ''}</small></button></li>)}
            </ul>
          )}
        </span>
      </div>
    </div>
  );
}

function CodeForm({ code, events, itemName, busy, onNew, onCancel, onSave }) {
  const [, force] = useState(0);
  if (!code) return <div className="stg-parties-bar"><button type="button" className="sth-btn primary" onClick={onNew}>Novo código</button></div>;
  // o pai guarda o objeto; aqui só muda no lugar e redesenha
  const set = (k, v) => { code[k] = v; force((n) => n + 1); };
  return (
    <form className="pea-form pea-card" onSubmit={(e) => { e.preventDefault(); onSave({ ...code, maxUses: code.maxUses ? Number(code.maxUses) : null, expiresAt: code.expiresAt ? new Date(code.expiresAt).toISOString() : null, eventSlug: code.eventSlug || null }); }}>
      <div className="pea-grid">
        <label>Código<input value={code.code} onChange={(e) => set('code', e.target.value.toUpperCase())} placeholder="PINGU2026" required /></label>
        <label>Descrição<input value={code.label} onChange={(e) => set('label', e.target.value)} placeholder="Live de sábado" /></label>
        <label>Moedas<input type="number" min="0" value={code.coins} onChange={(e) => set('coins', Number(e.target.value))} /></label>
        <label>Moeda de evento<input type="number" min="0" value={code.eventCoins} onChange={(e) => set('eventCoins', Number(e.target.value))} /></label>
        <label>Evento da moeda<select value={code.eventSlug || ''} onChange={(e) => set('eventSlug', e.target.value)}><option value="">o que estiver rolando</option>{events.map((ev) => <option key={ev.slug} value={ev.slug}>{ev.name}</option>)}</select></label>
        <label>Máximo de usos (vazio = sem limite)<input type="number" min="1" value={code.maxUses} onChange={(e) => set('maxUses', e.target.value)} /></label>
        <label>Vale até<input type="datetime-local" value={code.expiresAt || ''} onChange={(e) => set('expiresAt', e.target.value)} /></label>
        <label className="pea-check"><input type="checkbox" checked={code.active !== false} onChange={(e) => set('active', e.target.checked)} /> Ligado</label>
        <label className="pea-wide">Itens (ids separados por vírgula)<input value={idsText(code.items)} onChange={(e) => set('items', parseIds(e.target.value))} placeholder="413, 1056" /></label>
        {code.items?.length > 0 && <span className="pea-wide pea-label">{code.items.map(itemName).join(' · ')}</span>}
      </div>
      <div className="stg-parties-bar pea-actions">
        <button type="submit" className="sth-btn primary" disabled={busy}>Salvar código</button>
        <button type="button" className="sth-btn" onClick={onCancel}>Cancelar</button>
      </div>
    </form>
  );
}

function VisitForm({ visit, rooms, staff, itemName, busy, onNew, onCancel, onSave }) {
  const [, force] = useState(0);
  if (!visit) return <div className="stg-parties-bar"><button type="button" className="sth-btn primary" onClick={onNew}>Nova visita</button></div>;
  const set = (k, v) => { visit[k] = v; force((n) => n + 1); };
  return (
    <form className="pea-form pea-card" onSubmit={(e) => { e.preventDefault(); onSave({ ...visit, startsAt: new Date(visit.startsAt).toISOString(), endsAt: new Date(visit.endsAt).toISOString(), backgroundItemId: visit.backgroundItemId ? Number(visit.backgroundItemId) : null, mascotUserId: visit.mascotUserId || null }); }}>
      <div className="pea-grid">
        <label>Mascote (chave)<input value={visit.mascotKey} onChange={(e) => set('mascotKey', e.target.value)} placeholder="pingu" required /></label>
        <label>Nome<input value={visit.name} onChange={(e) => set('name', e.target.value)} required /></label>
        <label>Conta que veste o mascote<select value={visit.mascotUserId || ''} onChange={(e) => set('mascotUserId', e.target.value)}><option value="">— escolher —</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.displayName} (@{s.username})</option>)}</select></label>
        <label>Sala<select value={visit.room} onChange={(e) => set('room', Number(e.target.value))}>{rooms.map((r) => <option key={r.id} value={r.id}>{r.name} ({r.id})</option>)}</select></label>
        <label>Começa<input type="datetime-local" value={visit.startsAt} onChange={(e) => set('startsAt', e.target.value)} required /></label>
        <label>Termina<input type="datetime-local" value={visit.endsAt} onChange={(e) => set('endsAt', e.target.value)} required /></label>
        <label>Fundo de brinde (id do item)<input type="number" min="0" value={visit.backgroundItemId} onChange={(e) => set('backgroundItemId', e.target.value)} /></label>
        <label>Moedas<input type="number" min="0" value={visit.coins} onChange={(e) => set('coins', Number(e.target.value))} /></label>
        <label>Moeda de evento<input type="number" min="0" value={visit.eventCoins} onChange={(e) => set('eventCoins', Number(e.target.value))} /></label>
        <label className="pea-wide">Outros itens (ids)<input value={idsText(visit.itemIds)} onChange={(e) => set('itemIds', parseIds(e.target.value))} /></label>
        <label className="pea-wide">Recado pros jogadores<input value={visit.note} onChange={(e) => set('note', e.target.value)} placeholder="O Pingu vai estar na Praça às 20h!" /></label>
        <label className="pea-check"><input type="checkbox" checked={!!visit.surprise} onChange={(e) => set('surprise', e.target.checked)} /> Visita surpresa (só aparece na agenda quando começar)</label>
        {(visit.backgroundItemId || visit.itemIds?.length > 0) && <span className="pea-wide pea-label">{[visit.backgroundItemId ? itemName(Number(visit.backgroundItemId)) : null, ...(visit.itemIds || []).map(itemName)].filter(Boolean).join(' · ')}</span>}
      </div>
      <div className="stg-parties-bar pea-actions">
        <button type="submit" className="sth-btn primary" disabled={busy}>Salvar visita</button>
        <button type="button" className="sth-btn" onClick={onCancel}>Cancelar</button>
      </div>
    </form>
  );
}

// ---------- Concursos (iglu, Mural de Arte…) ----------
const CONTEST_KINDS = [['igloo', 'Concurso de iglu'], ['arte', 'Mural de Arte'], ['fantasia', 'Desfile de fantasias'], ['outro', 'Outro']];
function ContestsTab({ notify, itemName }) {
  const [list, setList] = useState(null);
  const [editing, setEditing] = useState(null);
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api.get('/staff-game/contests').then(({ data }) => setList(data)).catch(() => setList([])), []);
  useEffect(() => { load(); }, [load]);
  const run = async (fn, ok) => { setBusy(true); try { const r = await fn(); notify(ok); load(); if (detail) api.get(`/staff-game/contests/${detail.id}`).then(({ data }) => setDetail(data)).catch(() => {}); return r; } catch (err) { notify(err?.response?.data?.error || 'Não deu certo.', 'bad'); return null; } finally { setBusy(false); } };
  const blank = () => ({ kind: 'igloo', title: '', description: '', theme: '', startsAt: toLocal(new Date().toISOString()), endsAt: toLocal(new Date(Date.now() + 7 * 86400000).toISOString()), votingEndsAt: toLocal(new Date(Date.now() + 10 * 86400000).toISOString()), prizeItems: [], prizeCoins: 1000, maxWinners: 3, active: true });
  const phaseLabel = { soon: 'em breve', open: 'inscrições abertas', voting: 'em votação', ended: 'encerrado', off: 'desligado' };
  return (
    <>
      <p className="stg-note">Modelo dos CPPS: concurso de iglu (CP Rewritten/Journey, com pin só pros vencedores) e Mural de Arte (CP Legacy: arte destacada ganha 5.000 moedas + pin). Quem participa manda uma imagem pela janela Festa do jogo; a comunidade vota uma vez; você escolhe os vencedores e o prêmio cai na hora.</p>
      {!editing && <div className="stg-parties-bar"><button type="button" className="sth-btn primary" onClick={() => setEditing(blank())}>Novo concurso</button></div>}
      {editing && (
        <form className="pea-form pea-card" onSubmit={(e) => { e.preventDefault(); run(() => api.put('/staff-game/contests', { ...editing, startsAt: new Date(editing.startsAt).toISOString(), endsAt: new Date(editing.endsAt).toISOString(), votingEndsAt: new Date(editing.votingEndsAt).toISOString() }), 'Concurso salvo.').then((r) => { if (r) setEditing(null); }); }}>
          <div className="pea-grid">
            <label>Tipo<select value={editing.kind} onChange={(e) => setEditing({ ...editing, kind: e.target.value })}>{CONTEST_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            <label>Título<input value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} required /></label>
            <label>Tema<input value={editing.theme} onChange={(e) => setEditing({ ...editing, theme: e.target.value })} placeholder="Iglu assombrado" /></label>
            <label className="pea-wide">Descrição<input value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} /></label>
            <label>Inscrições abrem<input type="datetime-local" value={editing.startsAt} onChange={(e) => setEditing({ ...editing, startsAt: e.target.value })} required /></label>
            <label>Inscrições fecham<input type="datetime-local" value={editing.endsAt} onChange={(e) => setEditing({ ...editing, endsAt: e.target.value })} required /></label>
            <label>Votação termina<input type="datetime-local" value={editing.votingEndsAt} onChange={(e) => setEditing({ ...editing, votingEndsAt: e.target.value })} required /></label>
            <label>Moedas de prêmio<input type="number" min="0" value={editing.prizeCoins} onChange={(e) => setEditing({ ...editing, prizeCoins: Number(e.target.value) })} /></label>
            <label>Vencedores (máx.)<input type="number" min="1" max="50" value={editing.maxWinners} onChange={(e) => setEditing({ ...editing, maxWinners: Number(e.target.value) })} /></label>
            <label className="pea-check"><input type="checkbox" checked={editing.active !== false} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} /> Ligado</label>
            <label className="pea-wide">Itens de prêmio (ids do jogo; ex.: um pin exclusivo)<input value={idsText(editing.prizeItems)} onChange={(e) => setEditing({ ...editing, prizeItems: parseIds(e.target.value) })} /></label>
            {editing.prizeItems?.length > 0 && <span className="pea-wide pea-label">{editing.prizeItems.map(itemName).join(' · ')}</span>}
          </div>
          <div className="stg-parties-bar pea-actions"><button type="submit" className="sth-btn primary" disabled={busy}>Salvar</button><button type="button" className="sth-btn" onClick={() => setEditing(null)}>Cancelar</button></div>
        </form>
      )}
      <ul className="pea-list">
        {(list || []).map((c) => (
          <li key={c.id} className={`stg-party${c.phase === 'open' || c.phase === 'voting' ? ' is-on' : ''}`}>
            <span className="stg-party-main">
              <span className="stg-party-name">{c.title} <span className="stg-id">({c.kindLabel})</span>{c.phase && <span className="stu-flag">{phaseLabel[c.phase]}</span>}</span>
              <span className="stg-party-sub">{new Date(c.startsAt).toLocaleDateString('pt-BR')} → {new Date(c.endsAt).toLocaleDateString('pt-BR')} · votação até {new Date(c.votingEndsAt).toLocaleDateString('pt-BR')} · {c.entriesCount} participações · {c.votesCount} votos · prêmio {c.prizeCoins} moedas{c.prizeItems.length ? ` + ${c.prizeItems.map(itemName).join(', ')}` : ''}</span>
            </span>
            <button type="button" className="sth-btn" onClick={() => api.get(`/staff-game/contests/${c.id}`).then(({ data }) => setDetail(data)).catch(() => notify('Não deu pra abrir.', 'bad'))}>Participações</button>
            <button type="button" className="sth-btn" onClick={() => setEditing({ ...c, startsAt: toLocal(c.startsAt), endsAt: toLocal(c.endsAt), votingEndsAt: toLocal(c.votingEndsAt) })}>Editar</button>
            <button type="button" className="sth-btn danger" disabled={busy} onClick={() => { if (window.confirm(`Apagar "${c.title}" com as participações?`)) run(() => api.delete(`/staff-game/contests/${c.id}`), 'Concurso apagado.'); }}>Apagar</button>
          </li>
        ))}
        {list && !list.length && <li className="sth-empty"><strong>Nenhum concurso</strong><span>Crie um concurso de iglu pra próxima festa.</span></li>}
      </ul>
      {detail && (
        <div className="pea-card">
          <div className="stg-parties-bar"><strong>{detail.title}: {detail.entries.length} participações</strong><button type="button" className="sth-btn" onClick={() => setDetail(null)}>Fechar</button></div>
          <div className="pea-gallery">
            {detail.entries.map((e) => (
              <div key={e.id} className={`pea-entry${e.winner ? ' is-winner' : ''}${e.hidden ? ' is-hidden' : ''}`}>
                <a href={e.imageUrl} target="_blank" rel="noreferrer"><img src={e.imageUrl} alt="" loading="lazy" /></a>
                <span>{e.user?.displayName || e.userId}{e.caption ? ` — ${e.caption}` : ''}</span>
                <small>{e.votes} votos{e.winner ? ' · 🏆 vencedor' : ''}{e.hidden ? ' · escondida' : ''}</small>
                <span className="stg-parties-bar">
                  {!e.winner && <button type="button" className="sth-btn primary" disabled={busy} onClick={() => { if (window.confirm('Marcar como vencedor e entregar o prêmio agora?')) run(() => api.post(`/staff-game/contests/${detail.id}/winners`, { entryIds: [e.id] }), 'Prêmio entregue!'); }}>Vencedor</button>}
                  <button type="button" className="sth-btn" disabled={busy} onClick={() => run(() => api.post(`/staff-game/contests/entries/${e.id}/hide`, { hidden: !e.hidden }), e.hidden ? 'Participação de volta.' : 'Participação escondida.')}>{e.hidden ? 'Mostrar' : 'Esconder'}</button>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

// ---------- Jigsaw Jam ----------
function JigsawTab({ notify, itemName }) {
  const [data, setData] = useState(null);
  const [cfg, setCfg] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api.get('/staff-game/puzzles').then(({ data: d }) => { setData(d); setCfg((c) => c || d.settings); }).catch(() => setData({ puzzles: [], settings: {} })), []);
  useEffect(() => { load(); }, [load]);
  const run = async (fn, ok) => { setBusy(true); try { await fn(); notify(ok); load(); } catch (err) { notify(err?.response?.data?.error || 'Não deu certo.', 'bad'); } finally { setBusy(false); } };
  if (!data || !cfg) return null;
  const pending = data.puzzles.filter((p) => !p.approved);
  return (
    <>
      <p className="stg-note">Jigsaw Jam (modelo do CP Journey): quebra-cabeças com artes da comunidade. Quem joga manda a arte pela janela Festa → Jigsaw; você aprova aqui. Montar dá moedas (uma vez por arte e modo) e montar todas dá o prêmio de conclusão.</p>
      <form className="pea-form pea-card" onSubmit={(e) => { e.preventDefault(); run(() => api.put('/staff-game/puzzles/settings', cfg), 'Configuração salva.'); }}>
        <div className="pea-grid">
          <label>Moedas no fácil (3×3)<input type="number" min="0" value={cfg.coinsFacil ?? 25} onChange={(e) => setCfg({ ...cfg, coinsFacil: Number(e.target.value) })} /></label>
          <label>Moedas no difícil (5×5)<input type="number" min="0" value={cfg.coinsDificil ?? 60} onChange={(e) => setCfg({ ...cfg, coinsDificil: Number(e.target.value) })} /></label>
          <label>Prêmio final: nome<input value={cfg.completionLabel || ''} onChange={(e) => setCfg({ ...cfg, completionLabel: e.target.value })} /></label>
          <label>Prêmio final: moedas<input type="number" min="0" value={cfg.completionCoins ?? 500} onChange={(e) => setCfg({ ...cfg, completionCoins: Number(e.target.value) })} /></label>
          <label>Prêmio final: itens (ids; ex.: um pin)<input value={idsText(cfg.completionItems)} onChange={(e) => setCfg({ ...cfg, completionItems: parseIds(e.target.value) })} /></label>
          <label>Artes pendentes por pinguim<input type="number" min="1" max="20" value={cfg.maxPending ?? 3} onChange={(e) => setCfg({ ...cfg, maxPending: Number(e.target.value) })} /></label>
          <label className="pea-check"><input type="checkbox" checked={cfg.autoApproveStaff !== false} onChange={(e) => setCfg({ ...cfg, autoApproveStaff: e.target.checked })} /> Artes da equipe entram sem aprovação</label>
          {cfg.completionItems?.length > 0 && <span className="pea-wide pea-label">{cfg.completionItems.map(itemName).join(' · ')}</span>}
        </div>
        <div className="stg-parties-bar pea-actions"><button type="submit" className="sth-btn primary" disabled={busy}>Salvar</button></div>
      </form>
      <h4>Aguardando aprovação ({pending.length})</h4>
      <div className="pea-gallery">
        {data.puzzles.map((p) => (
          <div key={p.id} className={`pea-entry${p.approved ? '' : ' is-pending'}${!p.active ? ' is-hidden' : ''}`}>
            <a href={p.imageUrl} target="_blank" rel="noreferrer"><img src={p.imageUrl} alt="" loading="lazy" /></a>
            <span>{p.title}</span>
            <small>{p.author?.displayName || 'equipe'} · {p.approved ? `${p.solves} montagens` : 'pendente'}{!p.active ? ' · desligado' : ''}</small>
            <span className="stg-parties-bar">
              {!p.approved && <button type="button" className="sth-btn primary" disabled={busy} onClick={() => run(() => api.patch(`/staff-game/puzzles/${p.id}`, { approved: true }), 'Arte aprovada.')}>Aprovar</button>}
              {p.approved && <button type="button" className="sth-btn" disabled={busy} onClick={() => run(() => api.patch(`/staff-game/puzzles/${p.id}`, { active: !p.active }), p.active ? 'Arte desligada.' : 'Arte ligada.')}>{p.active ? 'Desligar' : 'Ligar'}</button>}
              <button type="button" className="sth-btn danger" disabled={busy} onClick={() => { if (window.confirm('Apagar essa arte?')) run(() => api.delete(`/staff-game/puzzles/${p.id}`), 'Arte apagada.'); }}>Apagar</button>
            </span>
          </div>
        ))}
        {!data.puzzles.length && <div className="sth-empty"><strong>Nenhuma arte</strong><span>Mande a primeira pela janela Festa → Jigsaw (as da equipe entram direto).</span></div>}
      </div>
    </>
  );
}

// ---------- Arquivos da Club Penguin Archives ----------
const ASSET_KINDS = [['room', 'Sala (chave da sala → SWF vira a sala)'], ['route', 'Rota do jogo (play/v2/content/…)'], ['music', 'Música (id → SWF/MP3 novo)']];
function ArchivesTab({ notify, rooms }) {
  const [list, setList] = useState(null);
  const [f, setF] = useState({ url: '', kind: 'room', target: 'town', label: '' });
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api.get('/staff-game/assets').then(({ data }) => setList(data)).catch(() => setList([])), []);
  useEffect(() => { load(); }, [load]);
  const run = async (fn, ok) => { setBusy(true); try { await fn(); notify(ok); load(); return true; } catch (err) { notify(err?.response?.data?.error || 'Não deu certo.', 'bad'); return false; } finally { setBusy(false); } };
  return (
    <>
      <p className="stg-note">A <a href="https://archives.clubpenguinwiki.info/wiki/Main_Page" target="_blank" rel="noreferrer">Club Penguin Archives</a> guarda ~58 mil arquivos do jogo original (salas de festas, catálogos, músicas, telas…). Cole o link da página do arquivo (File:…) ou o nome dele: o servidor baixa e liga na ilha por cima da festa atual, na hora. A Archives só pede um link de volta — já está na página da Praça.</p>
      <form className="pea-form pea-card" onSubmit={(e) => { e.preventDefault(); run(() => api.post('/staff-game/assets', f), 'Arquivo baixado e ligado na ilha!').then((ok) => { if (ok) setF({ ...f, url: '', label: '' }); }); }}>
        <div className="pea-grid">
          <label className="pea-wide">Link ou nome do arquivo na Archives<input value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://archives.clubpenguinwiki.info/wiki/File:ArtworkRoomsTown…swf" required /></label>
          <label>Tipo<select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value, target: e.target.value === 'room' ? 'town' : e.target.value === 'music' ? '1' : 'play/v2/content/global/content/map.swf' })}>{ASSET_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          {f.kind === 'room' ? <label>Sala<select value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })}>{rooms.map((r) => <option key={r.key} value={r.key}>{r.name} ({r.key})</option>)}</select></label>
            : <label>{f.kind === 'music' ? 'Id da música' : 'Rota'}<input value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} required /></label>}
          <label>Etiqueta<input value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} placeholder="Centro — Festa de Halloween 2008" /></label>
        </div>
        <div className="stg-parties-bar pea-actions"><button type="submit" className="sth-btn primary" disabled={busy}>{busy ? 'Baixando…' : 'Baixar e ligar'}</button></div>
      </form>
      <ul className="pea-list">
        {(list || []).map((a) => (
          <li key={a.id} className={`stg-party${a.enabled ? ' is-on' : ' is-off'}`}>
            <span className="stg-party-main">
              <span className="stg-party-name">{a.label || a.file.split('/').pop()} <span className="stg-id">({a.kind}: {a.target})</span>{!a.onDisk && <span className="stu-flag">arquivo sumiu</span>}</span>
              <span className="stg-party-sub">{a.source}</span>
            </span>
            <button type="button" className="sth-btn" disabled={busy} onClick={() => run(() => api.patch(`/staff-game/assets/${a.id}`, { enabled: !a.enabled }), a.enabled ? 'Desligado da ilha.' : 'Ligado na ilha.')}>{a.enabled ? 'Desligar' : 'Ligar'}</button>
            <button type="button" className="sth-btn danger" disabled={busy} onClick={() => { if (window.confirm('Apagar esse arquivo da ilha?')) run(() => api.delete(`/staff-game/assets/${a.id}`), 'Arquivo apagado.'); }}>Apagar</button>
          </li>
        ))}
        {list && !list.length && <li className="sth-empty"><strong>Nenhum arquivo da Archives</strong><span>Cole um link acima.</span></li>}
      </ul>
    </>
  );
}
