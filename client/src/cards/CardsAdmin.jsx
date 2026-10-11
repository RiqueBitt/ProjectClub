import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import UserAvatar from '../components/UserAvatar.jsx';
import { CardView, CardArt, ELEMENTS, RARITIES, RARITY_ORDER, ABILITIES, Icon, UI } from './CardView.jsx';
import { cardsAdmin, errMsg } from './api';
import BotPortrait from './BotPortrait.jsx';
import { Bracket as TournamentBracket } from './Tournaments.jsx';
import { BoardThumb, BOARD_THEMES, THEME_KEYS } from './BoardScene.jsx';
import '../styles/cards.css';

// Painel da Staff → Jogo de Cartas. Tudo que dá pra mudar no jogo sem código:
// cartas, pacotes, regras/economia, jogadores, trocas e partidas.

function Msg({ err, ok }) {
  if (err) return <p className="tcg-error">{err}</p>;
  if (ok) return <p className="tcg-ok">{ok}</p>;
  return null;
}
function Field({ label, hint, children, wide }) {
  return (
    <label className={`tca-field${wide ? ' is-wide' : ''}`}>
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
const toFd = (obj, file) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    fd.append(k, v === null ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v)));
  }
  if (file) fd.append('image', file);
  return fd;
};

// ---------------- Cartas ----------------
const EMPTY_CARD = { name: '', slug: '', kind: 'UNIT', collection: 'Origens', rarity: 'COMUM', element: 'FOGO', cost: 1, attack: 1, health: 1, ability: 'NONE', abilityValue: 0, description: '', flavor: '', enabled: true, imageUrl: null };

function CardEditor({ initial, collections, onSaved, onCancel }) {
  const [f, setF] = useState({ ...EMPTY_CARD, ...initial });
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(initial?.imageUrl || null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  useEffect(() => () => { if (preview?.startsWith('blob:')) URL.revokeObjectURL(preview); }, [preview]);
  const save = async () => {
    setBusy(true); setErr('');
    try {
      const body = { ...f, removeImage: !preview && initial?.imageUrl ? 'true' : undefined };
      delete body.imageUrl; delete body.id; delete body.stats; delete body.power; delete body.quantity; delete body.level;
      const r = initial?.id ? await cardsAdmin.updateCard(initial.id, toFd(body, file)) : await cardsAdmin.createCard(toFd(body, file));
      onSaved(r.card);
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  const ab = ABILITIES[f.ability];
  const previewCard = { ...f, cost: Number(f.cost), attack: Number(f.attack), health: Number(f.health), abilityValue: Number(f.abilityValue), imageUrl: preview };
  return (
    <div className="tca-editor">
      <div className="tca-preview"><CardView card={previewCard} size="lg" /><small className="tcg-dim">Pré-visualização ao vivo</small></div>
      <div className="tca-form">
        <div className="tca-grid">
          <Field label="Nome"><input value={f.name} maxLength={60} onChange={set('name')} /></Field>
          <Field label="Identificador" hint="Gerado do nome se ficar vazio."><input value={f.slug} maxLength={60} onChange={set('slug')} placeholder="ex: fenix-rubra" /></Field>
          <Field label="Coleção">
            <input value={f.collection} maxLength={40} onChange={set('collection')} list="tca-collections" />
            <datalist id="tca-collections">{collections.map((c) => <option key={c} value={c} />)}</datalist>
          </Field>
          <Field label="Tipo">
            <select value={f.kind || 'UNIT'} onChange={(e) => { const kind = e.target.value; setF((x) => ({ ...x, kind, ability: kind === 'SPELL' ? (ABILITIES[x.ability]?.spell ? x.ability : 'FEITICO_DANO') : (ABILITIES[x.ability]?.spell ? 'NONE' : x.ability) })); }}>
              <option value="UNIT">Unidade</option><option value="SPELL">Feitiço / Equipamento</option>
            </select>
          </Field>
          <Field label="Raridade"><select value={f.rarity} onChange={set('rarity')}>{RARITY_ORDER.map((r) => <option key={r} value={r}>{RARITIES[r].label}</option>)}</select></Field>
          <Field label="Elemento"><select value={f.element} onChange={set('element')}>{Object.entries(ELEMENTS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></Field>
          <Field label="Custo (energia)"><input type="number" min="0" max="10" value={f.cost} onChange={set('cost')} /></Field>
          {f.kind !== 'SPELL' && <Field label="Ataque"><input type="number" min="0" max="30" value={f.attack} onChange={set('attack')} /></Field>}
          {f.kind !== 'SPELL' && <Field label="Vida"><input type="number" min="1" max="40" value={f.health} onChange={set('health')} /></Field>}
          <Field label="Habilidade" hint={ab?.desc?.replace(/\{v\}/g, f.abilityValue) || 'Sem habilidade especial.'}>
            <select value={f.ability} onChange={set('ability')}>{Object.entries(ABILITIES).filter(([k, v]) => (f.kind === 'SPELL' ? v.spell : !v.spell || k === 'NONE')).map(([k, v]) => <option key={k} value={k}>{v.label || 'Nenhuma'}</option>)}</select>
          </Field>
          {ab?.desc?.includes('{v}') && <Field label="Valor da habilidade"><input type="number" min="0" max="20" value={f.abilityValue} onChange={set('abilityValue')} /></Field>}
          <Field label="Descrição" wide><textarea rows={2} maxLength={600} value={f.description || ''} onChange={set('description')} /></Field>
          <Field label="Frase (texto de ambientação)" wide><input maxLength={300} value={f.flavor || ''} onChange={set('flavor')} /></Field>
          <Field label="Imagem" hint="PNG/JPG/WebP/GIF. Sem imagem, a arte é gerada automaticamente." wide>
            <span className="tca-file">
              <input type="file" accept="image/*" onChange={(e) => { const x = e.target.files?.[0]; if (x) { setFile(x); setPreview(URL.createObjectURL(x)); } }} />
              {preview && <button type="button" className="tcg-btn ghost" onClick={() => { setFile(null); setPreview(null); }}>Remover imagem</button>}
            </span>
          </Field>
          <label className="tcg-check"><input type="checkbox" checked={!!f.enabled} onChange={set('enabled')} />Carta ativa (aparece em pacotes, coleções e partidas)</label>
        </div>
        <Msg err={err} />
        <div className="tca-actions">
          <button type="button" className="tcg-btn ghost" onClick={onCancel}>Cancelar</button>
          <button type="button" className="tcg-btn primary" disabled={busy || !f.name.trim()} onClick={save}>{busy ? 'Salvando…' : initial?.id ? 'Salvar carta' : 'Criar carta'}</button>
        </div>
      </div>
    </div>
  );
}

export function CardsAdminCards() {
  const [data, setData] = useState(null);
  const [editing, setEditing] = useState(null);
  const [q, setQ] = useState('');
  const [rar, setRar] = useState('');
  const [el, setEl] = useState('');
  const [msg, setMsg] = useState({});
  const [grid, setGrid] = useState(false);
  const fileRef = useRef(null);
  const load = () => cardsAdmin.cards().then(setData).catch((e) => setMsg({ err: errMsg(e) }));
  useEffect(() => { load(); }, []);
  const download = (name, text, type) => {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a'); a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const exportAs = async (fmt) => {
    try {
      const d = await cardsAdmin.exportCards();
      if (fmt === 'json') download('cartas.json', JSON.stringify(d.cards, null, 2), 'application/json');
      else {
        const esc = (v) => { const t = v === null || v === undefined ? '' : String(v); return /[",\n;]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
        download('cartas.csv', [d.fields.join(','), ...d.cards.map((c) => d.fields.map((f) => esc(c[f])).join(','))].join('\n'), 'text/csv');
      }
    } catch (e) { setMsg({ err: errMsg(e) }); }
  };
  const parseCsv = (text) => {
    const rows = []; let row = []; let cur = ''; let q = false;
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      if (q) { if (ch === '"' && text[i + 1] === '"') { cur += '"'; i += 1; } else if (ch === '"') q = false; else cur += ch; }
      else if (ch === '"') q = true;
      else if (ch === ',' || ch === ';') { row.push(cur); cur = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i += 1; row.push(cur); rows.push(row); row = []; cur = ''; }
      else cur += ch;
    }
    if (cur || row.length) { row.push(cur); rows.push(row); }
    const [head, ...body] = rows.filter((r) => r.some((x) => x.trim()));
    return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), r[i]])));
  };
  const importFile = async (file) => {
    if (!file) return;
    try {
      const text = await file.text();
      const cards = file.name.toLowerCase().endsWith('.csv') ? parseCsv(text) : JSON.parse(text);
      if (!Array.isArray(cards)) throw new Error('Arquivo inválido.');
      if (!window.confirm(`Importar ${cards.length} carta(s)? Cartas com o mesmo identificador serão atualizadas.`)) return;
      const r = await cardsAdmin.importCards(cards);
      setMsg({ ok: `${r.created} criada(s), ${r.updated} atualizada(s).${r.errors.length ? ` ${r.errors.length} linha(s) ignorada(s).` : ''}` });
      load();
    } catch (e) { setMsg({ err: e?.response ? errMsg(e) : `Não foi possível ler o arquivo: ${e.message}` }); }
    if (fileRef.current) fileRef.current.value = '';
  };
  const collections = useMemo(() => [...new Set((data?.cards || []).map((c) => c.collection))], [data]);
  const toggle = async (c) => {
    try { await cardsAdmin.updateCard(c.id, toFd({ enabled: !c.enabled })); load(); } catch (e) { setMsg({ err: errMsg(e) }); }
  };
  const remove = async (c) => {
    if (!window.confirm(`Excluir "${c.name}"?`)) return;
    try { await cardsAdmin.deleteCard(c.id); setMsg({ ok: 'Carta excluída.' }); load(); } catch (e) {
      if (e?.response?.status === 409 && window.confirm(`${errMsg(e)}\n\nExcluir mesmo assim? As cópias somem das coleções dos jogadores.`)) {
        try { await cardsAdmin.deleteCard(c.id, true); setMsg({ ok: 'Carta excluída.' }); load(); } catch (e2) { setMsg({ err: errMsg(e2) }); }
      } else if (e?.response?.status !== 409) setMsg({ err: errMsg(e) });
    }
  };
  if (editing) return <CardEditor initial={editing === 'new' ? null : editing} collections={collections} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); setMsg({ ok: 'Carta salva.' }); load(); }} />;
  const t = q.trim().toLowerCase();
  const list = (data?.cards || []).filter((c) => (!rar || c.rarity === rar) && (!el || c.element === el) && (!t || `${c.name} ${c.collection}`.toLowerCase().includes(t)));
  return (
    <div className="tca">
      <div className="tca-bar">
        <label className="tcg-search"><Icon d={UI.search} size={15} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar carta ou coleção" /></label>
        <select className="tcg-select" value={rar} onChange={(e) => setRar(e.target.value)}><option value="">Todas as raridades</option>{RARITY_ORDER.map((r) => <option key={r} value={r}>{RARITIES[r].label}</option>)}</select>
        <select className="tcg-select" value={el} onChange={(e) => setEl(e.target.value)}><option value="">Todos os elementos</option>{Object.entries(ELEMENTS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
        <span className="tcgb-spacer" />
        <div className="tcg-seg" role="group" aria-label="Exibição"><button type="button" className={!grid ? 'on' : ''} onClick={() => setGrid(false)}>Lista</button><button type="button" className={grid ? 'on' : ''} onClick={() => setGrid(true)}>Cartas</button></div>
        <button type="button" className="tcg-btn ghost" onClick={() => exportAs('csv')}>Exportar CSV</button>
        <button type="button" className="tcg-btn ghost" onClick={() => exportAs('json')}>Exportar JSON</button>
        <button type="button" className="tcg-btn ghost" onClick={() => fileRef.current?.click()}>Importar</button>
        <input ref={fileRef} type="file" accept=".csv,.json,application/json,text/csv" hidden onChange={(e) => importFile(e.target.files?.[0])} />
        <button type="button" className="tcg-btn primary" onClick={() => setEditing('new')}><Icon d={UI.plus} />Nova carta</button>
      </div>
      <Msg {...msg} />
      <p className="tcg-dim">{data ? `${data.cards.length} cartas · ${data.cards.filter((c) => c.enabled).length} ativas` : 'Carregando…'}</p>
      {grid ? (
        <div className="tcg-grid is-compact">
          {list.map((c) => <CardView key={c.id} card={c} size="xs" dim={!c.enabled} onClick={() => setEditing(c)} badge={<span className="tcgd-use">{c.stats.owners} jog.</span>} />)}
        </div>
      ) : (
      <div className="tca-table">
        {list.map((c) => (
          <div key={c.id} className={`tca-row${c.enabled ? '' : ' is-off'}`} style={{ '--rar': RARITIES[c.rarity]?.color }}>
            <span className="tca-thumb"><CardArt card={c} /></span>
            <span className="tca-main"><b data-no-translate>{c.name}</b><small>{c.kind === 'SPELL' ? 'Feitiço · ' : ''}{RARITIES[c.rarity]?.label} · {ELEMENTS[c.element]?.label} · {c.collection}</small></span>
            <span className="tca-stats" title="Custo / Ataque / Vida"><i>{c.cost}</i>{c.kind === 'SPELL' ? '—' : `${c.attack}/${c.health}`}</span>
            <span className="tca-ab">{ABILITIES[c.ability]?.label || '—'}{ABILITIES[c.ability]?.desc?.includes('{v}') ? ` ${c.abilityValue}` : ''}</span>
            <span className="tca-pow" title="Força">F{c.power}</span>
            <span className="tca-owners" title="Jogadores que têm / cópias no total">{c.stats.owners} jog. · {c.stats.copies} cóp.</span>
            <button type="button" className={`tca-toggle${c.enabled ? ' on' : ''}`} onClick={() => toggle(c)} aria-label={c.enabled ? 'Desativar' : 'Ativar'} title={c.enabled ? 'Ativa' : 'Desativada'}><i /></button>
            <button type="button" className="tcg-btn ghost" onClick={() => setEditing(c)}>Editar</button>
            <button type="button" className="tcg-icon-btn" onClick={() => remove(c)} aria-label="Excluir"><Icon d={UI.close} size={14} /></button>
          </div>
        ))}
        {data && !list.length && <p className="tcg-empty">Nenhuma carta encontrada.</p>}
      </div>
      )}
    </div>
  );
}

// ---------------- Pacotes ----------------
const EMPTY_PACK = { name: '', description: '', color: '#7c5cff', priceCoins: 150, priceGems: '', cardsPerPack: 5, dailyLimit: '', guaranteed: '', poolMode: 'ALL', poolCollection: '', poolCardIds: [], active: true, sort: 0, weights: { COMUM: 60, INCOMUM: 28, RARA: 9, EPICA: 2.5, LENDARIA: 0.45, MITICA: 0.05 } };

function PackEditor({ initial, cards, onSaved, onCancel }) {
  const [f, setF] = useState(() => ({ ...EMPTY_PACK, ...initial, priceCoins: initial?.priceCoins ?? (initial ? '' : 150), priceGems: initial?.priceGems ?? '', dailyLimit: initial?.dailyLimit ?? '', guaranteed: initial?.guaranteed || '', poolCollection: initial?.poolCollection || '' }));
  const [file, setFile] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [sim, setSim] = useState(null);
  const [cq, setCq] = useState('');
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const total = RARITY_ORDER.reduce((s, r) => s + (Number(f.weights[r]) || 0), 0) || 1;
  const collections = [...new Set(cards.map((c) => c.collection))];
  const pool = new Set(f.poolCardIds);
  const save = async () => {
    setBusy(true); setErr('');
    try {
      const body = { discountPercent: f.discountPercent === '' || f.discountPercent == null ? null : f.discountPercent, offerEndsAt: f.offerEndsAt ? new Date(f.offerEndsAt).toISOString() : null, name: f.name, description: f.description, color: f.color, priceCoins: f.priceCoins === '' ? null : f.priceCoins, priceGems: f.priceGems === '' ? null : f.priceGems, cardsPerPack: f.cardsPerPack, dailyLimit: f.dailyLimit === '' ? null : f.dailyLimit, guaranteed: f.guaranteed || null, poolMode: f.poolMode, poolCollection: f.poolCollection || null, poolCardIds: f.poolCardIds, active: f.active, sort: f.sort, weights: f.weights };
      const r = initial?.id ? await cardsAdmin.updatePack(initial.id, toFd(body, file)) : await cardsAdmin.createPack(toFd(body, file));
      onSaved(r.pack);
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <div className="tca-form">
      <div className="tca-grid">
        <Field label="Nome"><input value={f.name} maxLength={60} onChange={set('name')} /></Field>
        <Field label="Cor"><input type="color" value={f.color} onChange={set('color')} /></Field>
        <Field label="Cartas por pacote"><input type="number" min="1" max="15" value={f.cardsPerPack} onChange={set('cardsPerPack')} /></Field>
        <Field label="Preço em moedas" hint="Vazio = não vende em moedas."><input type="number" min="0" value={f.priceCoins} onChange={set('priceCoins')} /></Field>
        <Field label="Preço em gemas" hint="Vazio = não vende em gemas."><input type="number" min="0" value={f.priceGems} onChange={set('priceGems')} /></Field>
        <Field label="Limite por dia (por jogador)" hint="Vazio = sem limite."><input type="number" min="1" value={f.dailyLimit} onChange={set('dailyLimit')} /></Field>
        <Field label="Raridade mínima garantida" hint="Pelo menos 1 carta dessa raridade ou melhor.">
          <select value={f.guaranteed} onChange={set('guaranteed')}><option value="">Sem garantia</option>{RARITY_ORDER.map((r) => <option key={r} value={r}>{RARITIES[r].label}</option>)}</select>
        </Field>
        <Field label="Ordem na loja"><input type="number" value={f.sort} onChange={set('sort')} /></Field>
        <Field label="Desconto (%)" hint="Vazio = sem desconto. A oferta do dia também dá desconto automático."><input type="number" min="0" max="90" value={f.discountPercent ?? ''} onChange={set('discountPercent')} /></Field>
        <Field label="Oferta termina em" hint="Vazio = sem prazo."><input type="datetime-local" value={f.offerEndsAt ? String(f.offerEndsAt).slice(0, 16) : ''} onChange={set('offerEndsAt')} /></Field>
        <Field label="Descrição" wide><textarea rows={2} maxLength={400} value={f.description || ''} onChange={set('description')} /></Field>
        <Field label="Imagem do pacote (opcional)" wide><input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] || null)} /></Field>
      </div>
      <h4 className="tca-h4">Chances por raridade (por carta)</h4>
      <div className="tca-weights">
        {RARITY_ORDER.map((r) => (
          <label key={r} style={{ '--c': RARITIES[r].color }}>
            <span>{RARITIES[r].label}</span>
            <input type="number" min="0" step="0.01" value={f.weights[r] ?? 0} onChange={(e) => setF((x) => ({ ...x, weights: { ...x.weights, [r]: e.target.value } }))} />
            <em>{(((Number(f.weights[r]) || 0) / total) * 100).toFixed(2)}%</em>
          </label>
        ))}
      </div>
      <h4 className="tca-h4">Quais cartas podem sair</h4>
      <div className="tcg-chips">
        {[['ALL', 'Todas as cartas ativas'], ['COLLECTION', 'Uma coleção'], ['LIST', 'Lista escolhida']].map(([k, l]) => <button key={k} type="button" className={f.poolMode === k ? 'on' : ''} onClick={() => setF((x) => ({ ...x, poolMode: k }))}>{l}</button>)}
      </div>
      {f.poolMode === 'COLLECTION' && (
        <Field label="Coleção"><select value={f.poolCollection} onChange={set('poolCollection')}><option value="">Escolha…</option>{collections.map((c) => <option key={c} value={c}>{c}</option>)}</select></Field>
      )}
      {f.poolMode === 'LIST' && (
        <div className="tca-pool">
          <label className="tcg-search"><Icon d={UI.search} size={14} /><input value={cq} onChange={(e) => setCq(e.target.value)} placeholder="Filtrar cartas" /></label>
          <small className="tcg-dim">{pool.size} selecionadas</small>
          <div className="tca-pool-list">
            {cards.filter((c) => !cq || c.name.toLowerCase().includes(cq.toLowerCase())).map((c) => (
              <label key={c.id} className="tcg-check" style={{ borderLeft: `3px solid ${RARITIES[c.rarity]?.color}`, paddingLeft: 6 }}>
                <input type="checkbox" checked={pool.has(c.id)} onChange={(e) => setF((x) => ({ ...x, poolCardIds: e.target.checked ? [...x.poolCardIds, c.id] : x.poolCardIds.filter((id) => id !== c.id) }))} />
                {c.name} <small className="tcg-dim">({RARITIES[c.rarity]?.label})</small>
              </label>
            ))}
          </div>
        </div>
      )}
      <label className="tcg-check" style={{ marginTop: 10 }}><input type="checkbox" checked={!!f.active} onChange={set('active')} />Pacote à venda</label>
      {initial?.id && (
        <div className="tca-sim">
          <button type="button" className="tcg-btn" onClick={() => cardsAdmin.simulatePack(initial.id, 500).then(setSim).catch((e) => setErr(errMsg(e)))}>Simular 500 aberturas</button>
          {sim && <span className="tcg-dim">{sim.cards} cartas de {sim.pool} possíveis: {RARITY_ORDER.filter((r) => sim.byRarity[r]).map((r) => `${RARITIES[r].label} ${((sim.byRarity[r] / sim.cards) * 100).toFixed(1)}%`).join(' · ')}</span>}
          <small className="tcg-dim">A simulação usa a versão salva do pacote.</small>
        </div>
      )}
      <Msg err={err} />
      <div className="tca-actions">
        <button type="button" className="tcg-btn ghost" onClick={onCancel}>Cancelar</button>
        <button type="button" className="tcg-btn primary" disabled={busy || !f.name.trim()} onClick={save}>{busy ? 'Salvando…' : initial?.id ? 'Salvar pacote' : 'Criar pacote'}</button>
      </div>
    </div>
  );
}

export function CardsAdminPacks() {
  const [packs, setPacks] = useState(null);
  const [cards, setCards] = useState([]);
  const [editing, setEditing] = useState(null);
  const [msg, setMsg] = useState({});
  const load = () => cardsAdmin.packs().then((d) => setPacks(d.packs)).catch((e) => setMsg({ err: errMsg(e) }));
  useEffect(() => { load(); cardsAdmin.cards().then((d) => setCards(d.cards)).catch(() => {}); }, []);
  if (editing) return <PackEditor initial={editing === 'new' ? null : editing} cards={cards} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); setMsg({ ok: 'Pacote salvo.' }); load(); }} />;
  return (
    <div className="tca">
      <div className="tca-bar"><span className="tcg-dim">Pacotes vendidos na aba "Pacotes" da Arena.</span><span className="tcgb-spacer" /><button type="button" className="tcg-btn primary" onClick={() => setEditing('new')}><Icon d={UI.plus} />Novo pacote</button></div>
      <Msg {...msg} />
      <div className="tca-table">
        {packs?.map((p) => (
          <div key={p.id} className={`tca-row${p.active ? '' : ' is-off'}`} style={{ '--rar': p.color }}>
            <span className="tca-thumb" style={{ background: p.color, display: 'grid', placeItems: 'center', color: '#fff' }}>{p.imageUrl ? <img src={p.imageUrl} alt="" /> : <Icon d={UI.pack} size={20} />}</span>
            <span className="tca-main"><b data-no-translate>{p.name}</b><small>{p.cardsPerPack} cartas · {p.poolMode === 'ALL' ? 'todas' : p.poolMode === 'COLLECTION' ? `coleção ${p.poolCollection}` : `${p.poolCardIds.length} escolhidas`}{p.guaranteed ? ` · garantia ${RARITIES[p.guaranteed]?.label}` : ''}</small></span>
            <span className="tca-stats">{p.priceCoins != null ? `${p.priceCoins} moedas` : ''}{p.priceCoins != null && p.priceGems != null ? ' · ' : ''}{p.priceGems != null ? `${p.priceGems} gemas` : ''}</span>
            <span className="tca-owners">{p.sold} abertos{p.dailyLimit ? ` · ${p.dailyLimit}/dia` : ''}</span>
            <button type="button" className={`tca-toggle${p.active ? ' on' : ''}`} onClick={() => cardsAdmin.updatePack(p.id, toFd({ active: !p.active })).then(load)} aria-label={p.active ? 'Tirar da loja' : 'Colocar na loja'}><i /></button>
            <button type="button" className="tcg-btn ghost" onClick={() => setEditing(p)}>Editar</button>
            <button type="button" className="tcg-icon-btn" onClick={() => { if (window.confirm(`Excluir "${p.name}"?`)) cardsAdmin.deletePack(p.id).then(load).catch((e) => setMsg({ err: errMsg(e) })); }} aria-label="Excluir"><Icon d={UI.close} size={14} /></button>
          </div>
        ))}
        {packs === null && <p className="tcg-empty">Carregando…</p>}
        {packs?.length === 0 && <p className="tcg-empty">Nenhum pacote. Crie o primeiro!</p>}
      </div>
    </div>
  );
}

// ---------------- Regras e economia ----------------
const RULE_FIELDS = [
  ['rules', 'startHp', 'Vida inicial do herói'], ['rules', 'deckSize', 'Cartas por baralho'], ['rules', 'maxCopies', 'Cópias máx. por carta'],
  ['rules', 'maxCopiesLegendary', 'Cópias máx. (Lendária/Mítica)'], ['rules', 'startHand', 'Cartas na mão inicial'], ['rules', 'maxHand', 'Limite da mão'],
  ['rules', 'maxEnergy', 'Energia máxima'], ['rules', 'boardSize', 'Unidades no campo'], ['rules', 'turnSeconds', 'Segundos por turno (PvP)'],
  ['rules', 'elementBonus', 'Bônus de dano por elemento'], ['rules', 'maxTimeouts', 'Turnos perdidos até perder (PvP)'], ['rules', 'levelCap', 'Nível máximo das cartas'],
];
const REWARD_FIELDS = [
  ['rewards', 'FACIL', 'Vitória contra bot Fácil'], ['rewards', 'MEDIO', 'Vitória contra bot Médio'], ['rewards', 'DIFICIL', 'Vitória contra bot Difícil'],
  ['rewards', 'LENDARIO', 'Vitória contra bot Lendário'], ['rewards', 'pveLoss', 'Derrota contra bot'], ['rewards', 'pvpWin', 'Vitória PvP'],
  ['rewards', 'pvpLoss', 'Derrota PvP'], ['rewards', 'dailyRewardedMatches', 'Partidas com recompensa por dia'], ['rewards', 'pvpRewardsPerOpponentPerDay', 'Recompensas PvP contra o mesmo oponente (24h)'],
  ['rewards', 'minTurnsForReward', 'Turnos mínimos para ganhar moedas'], ['rewards', 'streakBonus', 'Bônus por vitória seguida'], ['rewards', 'streakBonusMax', 'Bônus máximo de sequência'],
];
const ECON_FIELDS = [
  ['economy', 'tradeMaxCoins', 'Moedas máx. por troca'], ['economy', 'maxOpenTrades', 'Trocas abertas por jogador'], ['economy', 'starterCards', 'Cartas no pacote inicial'],
  ['economy', 'foilChance', 'Chance de carta brilhante (%)'], ['economy', 'foilSellMultiplier', 'Multiplicador de venda da brilhante'], ['economy', 'marketTax', 'Taxa do mercado (%)'],
  ['economy', 'maxListings', 'Anúncios no mercado por jogador'], ['economy', 'dailyDealPercent', 'Desconto da oferta do dia (%)'], ['season', 'minGames', 'Partidas mínimas na temporada p/ prêmio'],
  ['extras', 'brawlCoins', 'Briga da semana: moedas (1ª vitória)'], ['extras', 'brawlGems', 'Briga da semana: gemas (1ª vitória)'], ['extras', 'tutorialCoins', 'Moedas por concluir o tutorial'],
  ['extras', 'chestEvery', 'Baú: a cada quantas vitórias no dia'], ['extras', 'chestCoins', 'Baú: moedas'], ['extras', 'chestCards', 'Baú: cartas'],
  ['extras', 'passXpWin', 'Passe: XP por vitória'], ['extras', 'passXpLoss', 'Passe: XP por derrota'], ['extras', 'passXpMission', 'Passe: XP por missão'], ['extras', 'passXpPack', 'Passe: XP por pacote'],
  ['extras', 'passXpPerLevel', 'Passe: XP por nível'], ['extras', 'passLevels', 'Passe: número de níveis'], ['extras', 'goldenChance', 'Chance de carta dourada (por mil)'],
  ['extras', 'draftFee', 'Draft: entrada (moedas)'], ['extras', 'bossHp', 'Chefe semanal: vida total'], ['extras', 'bossCoins', 'Chefe semanal: moedas por participante'], ['extras', 'bossGems', 'Chefe semanal: gemas por participante'],
];
const DIV_LABELS = { BRONZE: 'Bronze', PRATA: 'Prata', OURO: 'Ouro', PLATINA: 'Platina', DIAMANTE: 'Diamante', LENDARIO: 'Lendário' };
const ENABLE_LABELS = { pve: 'Partidas contra bots', pvp: 'Partidas PvP', trades: 'Trocas entre jogadores', packs: 'Loja de pacotes', sell: 'Venda de cartas repetidas', market: 'Mercado entre jogadores' };

export function CardsAdminSettings() {
  const [s, setS] = useState(null);
  const [msg, setMsg] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { cardsAdmin.settings().then((d) => setS(d.settings)).catch((e) => setMsg({ err: errMsg(e) })); }, []);
  if (!s) return msg.err ? <Msg {...msg} /> : <p className="tcg-empty">Carregando…</p>;
  const setNum = (sec, k) => (e) => setS((x) => ({ ...x, [sec]: { ...x[sec], [k]: e.target.value } }));
  const fields = (list) => list.map(([sec, k, label]) => <Field key={k} label={label}><input type="number" min="0" value={s[sec][k]} onChange={setNum(sec, k)} /></Field>);
  const save = async () => {
    setBusy(true); setMsg({});
    try { const r = await cardsAdmin.saveSettings(s); setS(r.settings); setMsg({ ok: 'Configurações salvas — valem para as próximas partidas.' }); } catch (e) { setMsg({ err: errMsg(e) }); } finally { setBusy(false); }
  };
  return (
    <div className="tca">
      <h4 className="tca-h4">Sistemas</h4>
      <div className="tca-grid">
        {Object.entries(ENABLE_LABELS).map(([k, l]) => <label key={k} className="tcg-check"><input type="checkbox" checked={!!s.enabled[k]} onChange={(e) => setS((x) => ({ ...x, enabled: { ...x.enabled, [k]: e.target.checked } }))} />{l}</label>)}
      </div>
      <h4 className="tca-h4">Regras da batalha</h4>
      <div className="tca-grid">{fields(RULE_FIELDS)}</div>
      <h4 className="tca-h4">Recompensas (moedas)</h4>
      <p className="tcg-dim">Desistir antes dos turnos mínimos, passar do limite diário ou repetir vitórias contra o mesmo jogador não dá moedas (proteção contra farm).</p>
      <div className="tca-grid">{fields(REWARD_FIELDS)}</div>
      <h4 className="tca-h4">Economia</h4>
      <div className="tca-grid">{fields(ECON_FIELDS)}</div>
      <h4 className="tca-h4">Valor de venda (por cópia repetida)</h4>
      <div className="tca-grid">
        {RARITY_ORDER.map((r) => <Field key={r} label={RARITIES[r].label}><input type="number" min="0" value={s.economy.sellValues[r]} onChange={(e) => setS((x) => ({ ...x, economy: { ...x.economy, sellValues: { ...x.economy.sellValues, [r]: e.target.value } } }))} /></Field>)}
      </div>
      <h4 className="tca-h4">Prêmios do fim da temporada (mensal)</h4>
      <div className="tca-levels" style={{ gridTemplateColumns: '80px repeat(6, minmax(60px, 1fr))', maxWidth: 760 }}>
        <span />{Object.keys(DIV_LABELS).map((k) => <b key={k}>{DIV_LABELS[k]}</b>)}
        {['rewards', 'gems'].map((kind) => (
          <Fragment key={kind}><span>{kind === 'rewards' ? 'Moedas' : 'Gemas'}</span>{Object.keys(DIV_LABELS).map((k) => <input key={`${kind}-${k}`} type="number" min="0" value={s.season[kind][k]} onChange={(e) => setS((x) => ({ ...x, season: { ...x.season, [kind]: { ...x.season[kind], [k]: e.target.value } } }))} />)}</Fragment>
        ))}
      </div>
      <h4 className="tca-h4">Evolução de cartas</h4>
      <div className="tca-levels">
        <span />{s.economy.levelUpCopies.map((_, i) => <b key={i}>Nv {i + 1}→{i + 2}</b>)}
        <span>Cópias</span>{s.economy.levelUpCopies.map((v, i) => <input key={i} type="number" min="0" value={v} onChange={(e) => setS((x) => { const a = [...x.economy.levelUpCopies]; a[i] = e.target.value; return { ...x, economy: { ...x.economy, levelUpCopies: a } }; })} />)}
        <span>Moedas</span>{s.economy.levelUpCoins.map((v, i) => <input key={i} type="number" min="0" value={v} onChange={(e) => setS((x) => { const a = [...x.economy.levelUpCoins]; a[i] = e.target.value; return { ...x, economy: { ...x.economy, levelUpCoins: a } }; })} />)}
      </div>
      <Msg {...msg} />
      <div className="tca-actions"><button type="button" className="tcg-btn primary" disabled={busy} onClick={save}>{busy ? 'Salvando…' : 'Salvar configurações'}</button></div>
    </div>
  );
}

// ---------------- Jogadores ----------------
function PlayerDetail({ userId, onBack }) {
  const [d, setD] = useState(null);
  const [cards, setCards] = useState([]);
  const [msg, setMsg] = useState({});
  const [grant, setGrant] = useState({ cardId: '', qty: 1, level: '' });
  const load = () => cardsAdmin.player(userId).then(setD).catch((e) => setMsg({ err: errMsg(e) }));
  useEffect(() => { load(); cardsAdmin.cards().then((x) => setCards(x.cards)).catch(() => {}); }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps
  const upd = async (body, ok) => { try { await cardsAdmin.updatePlayer(userId, body); setMsg({ ok }); load(); } catch (e) { setMsg({ err: errMsg(e) }); } };
  if (!d) return <><button type="button" className="tcg-btn ghost" onClick={onBack}><Icon d={UI.back} />Voltar</button><Msg {...msg} /></>;
  const p = d.player;
  return (
    <div className="tca">
      <div className="tca-bar">
        <button type="button" className="tcg-btn ghost" onClick={onBack}><Icon d={UI.back} />Voltar</button>
        <UserAvatar user={d.user} size={36} />
        <span className="tca-main"><b data-no-translate>{d.user.displayName}</b><small>@{d.user.username} · {d.user.coins} moedas · {d.user.gems} gemas</small></span>
      </div>
      <Msg {...msg} />
      <div className="tcg-showcase-stats">
        <span>Bots: <b>{p.wins}V/{p.losses}D</b></span><span>PvP: <b>{p.pvpWins}V/{p.pvpLosses}D</b></span><span>Rating <b>{p.rating}</b></span>
        <span>Pacotes <b>{p.packsOpened}</b></span><span>Moedas ganhas <b>{p.coinsEarned}</b></span><span>Pacote inicial: <b>{p.starterClaimed ? 'pego' : 'disponível'}</b></span>
        {p.banned && <span style={{ color: '#ff6b7a' }}><b>BLOQUEADO</b></span>}
      </div>
      <div className="tca-actions" style={{ justifyContent: 'flex-start' }}>
        <button type="button" className="tcg-btn" onClick={() => upd({ banned: !p.banned }, p.banned ? 'Jogador desbloqueado.' : 'Jogador bloqueado no jogo.')}>{p.banned ? 'Desbloquear' : 'Bloquear no jogo'}</button>
        <button type="button" className="tcg-btn" onClick={() => { if (window.confirm('Zerar vitórias, derrotas e rating?')) upd({ resetStats: true }, 'Estatísticas zeradas.'); }}>Zerar estatísticas</button>
        <button type="button" className="tcg-btn" onClick={() => upd({ resetStarter: true }, 'Pacote inicial liberado de novo.')}>Liberar pacote inicial</button>
        <button type="button" className="tcg-btn danger" onClick={() => { if (window.confirm('Apagar TODA a coleção deste jogador? Não dá para desfazer.')) upd({ wipeCollection: true }, 'Coleção apagada.'); }}>Apagar coleção</button>
      </div>
      <h4 className="tca-h4">Dar ou tirar cartas</h4>
      <div className="tca-bar">
        <select className="tcg-select" value={grant.cardId} onChange={(e) => setGrant((g) => ({ ...g, cardId: e.target.value }))}>
          <option value="">Escolha a carta…</option>
          {cards.map((c) => <option key={c.id} value={c.id}>{c.name} ({RARITIES[c.rarity]?.label})</option>)}
        </select>
        <input className="tca-num" type="number" value={grant.qty} onChange={(e) => setGrant((g) => ({ ...g, qty: e.target.value }))} title="Quantidade (negativo tira)" />
        <input className="tca-num" type="number" min="1" max="10" placeholder="Nível" value={grant.level} onChange={(e) => setGrant((g) => ({ ...g, level: e.target.value }))} />
        <button type="button" className="tcg-btn primary" disabled={!grant.cardId} onClick={async () => {
          try { await cardsAdmin.grant(userId, { cardId: grant.cardId, qty: Number(grant.qty), ...(grant.level ? { level: Number(grant.level) } : {}) }); setMsg({ ok: 'Coleção atualizada.' }); load(); } catch (e) { setMsg({ err: errMsg(e) }); }
        }}>Aplicar</button>
      </div>
      <h4 className="tca-h4">Coleção ({d.cards.length} cartas diferentes)</h4>
      <div className="tcg-grid is-compact">{d.cards.map((c) => <CardView key={c.id} card={c} size="sm" showQty quantity={c.quantity} />)}</div>
      <h4 className="tca-h4">Últimas partidas</h4>
      <div className="tca-table">
        {d.matches.map((m) => (
          <div key={m.id} className="tca-row"><span className="tca-main"><b>{m.mode === 'PVP' ? 'PvP' : `Bot ${m.difficulty}`}</b><small>{new Date(m.createdAt).toLocaleString('pt-BR')} · {m.status}{m.endReason ? ` · ${m.endReason}` : ''}</small></span><span className="tca-owners">{m.winnerId === userId ? 'Venceu' : m.winnerId ? 'Perdeu' : '—'} · +{m.p1Id === userId ? m.reward1 : m.reward2}</span></div>
        ))}
      </div>
    </div>
  );
}

export function CardsAdminPlayers() {
  const [q, setQ] = useState('');
  const [list, setList] = useState(null);
  const [open, setOpen] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    const t = setTimeout(() => cardsAdmin.players(q.trim()).then((d) => setList(d.players)).catch((e) => setErr(errMsg(e))), 250);
    return () => clearTimeout(t);
  }, [q]);
  if (open) return <PlayerDetail userId={open} onBack={() => setOpen(null)} />;
  return (
    <div className="tca">
      <div className="tca-bar"><label className="tcg-search"><Icon d={UI.search} size={15} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nome, @usuário ou ID" /></label><span className="tcg-dim">{q ? 'Resultados da busca' : 'Jogadores ativos recentemente'}</span></div>
      <Msg err={err} />
      <div className="tca-table">
        {list?.map(({ user, player, cards }) => (
          <div key={user.id} className="tca-row">
            <UserAvatar user={user} size={32} />
            <span className="tca-main"><b data-no-translate>{user.displayName}</b><small>@{user.username}</small></span>
            <span className="tca-owners">{cards} cartas · {player ? `${player.wins + player.pvpWins} vitórias · rating ${player.rating}` : 'nunca jogou'}{player?.banned ? ' · BLOQUEADO' : ''}</span>
            <button type="button" className="tcg-btn ghost" onClick={() => setOpen(user.id)}>Gerenciar</button>
          </div>
        ))}
        {list?.length === 0 && <p className="tcg-empty">Ninguém encontrado.</p>}
      </div>
    </div>
  );
}

// ---------------- Trocas e partidas ----------------
const STATUSES = { PENDING: 'Pendentes', ACCEPTED: 'Aceitas', DECLINED: 'Recusadas', CANCELLED: 'Canceladas', FAILED: 'Falharam' };
export function CardsAdminTrades() {
  const [status, setStatus] = useState('PENDING');
  const [list, setList] = useState(null);
  const [msg, setMsg] = useState({});
  const load = () => cardsAdmin.trades(status).then((d) => setList(d.trades)).catch((e) => setMsg({ err: errMsg(e) }));
  useEffect(() => { setList(null); load(); }, [status]); // eslint-disable-line react-hooks/exhaustive-deps
  const items = (arr, coins) => [...arr.map((i) => `${i.qty}x ${i.name}`), ...(coins ? [`${coins} moedas`] : [])].join(', ') || 'nada';
  return (
    <div className="tca">
      <div className="tcg-chips">{Object.entries(STATUSES).map(([k, l]) => <button key={k} type="button" className={status === k ? 'on' : ''} onClick={() => setStatus(k)}>{l}</button>)}</div>
      <Msg {...msg} />
      <div className="tca-table">
        {list?.map((t) => (
          <div key={t.id} className="tca-row">
            <span className="tca-main"><b data-no-translate>{t.from?.displayName} → {t.to?.displayName}</b><small>{new Date(t.createdAt).toLocaleString('pt-BR')}</small></span>
            <span className="tca-trade"><small>Oferece:</small> {items(t.offer, t.offerCoins)}<br /><small>Pede:</small> {items(t.request, t.requestCoins)}</span>
            {t.status === 'PENDING' && <button type="button" className="tcg-btn ghost danger" onClick={() => cardsAdmin.cancelTrade(t.id).then(() => { setMsg({ ok: 'Troca cancelada.' }); load(); }).catch((e) => setMsg({ err: errMsg(e) }))}>Cancelar</button>}
          </div>
        ))}
        {list === null && <p className="tcg-empty">Carregando…</p>}
        {list?.length === 0 && <p className="tcg-empty">Nenhuma troca.</p>}
      </div>
    </div>
  );
}

const MSTATUS = { ACTIVE: 'Em andamento', PENDING: 'Desafios', FINISHED: 'Terminadas', CANCELLED: 'Canceladas' };
export function CardsAdminMatches() {
  const [status, setStatus] = useState('ACTIVE');
  const [d, setD] = useState(null);
  const [msg, setMsg] = useState({});
  const load = () => cardsAdmin.matches(status).then(setD).catch((e) => setMsg({ err: errMsg(e) }));
  useEffect(() => { setD(null); load(); }, [status]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="tca">
      {d && <div className="tcg-showcase-stats"><span>Partidas terminadas <b>{d.stats.finished}</b></span><span>Em andamento <b>{d.stats.active}</b></span><span>Pacotes abertos hoje <b>{d.stats.packsToday}</b></span></div>}
      <div className="tcg-chips">{Object.entries(MSTATUS).map(([k, l]) => <button key={k} type="button" className={status === k ? 'on' : ''} onClick={() => setStatus(k)}>{l}</button>)}</div>
      <Msg {...msg} />
      <div className="tca-table">
        {d?.matches.map((m) => (
          <div key={m.id} className="tca-row">
            <span className="tca-main"><b data-no-translate>{m.p1?.displayName} vs {m.mode === 'PVP' ? m.p2?.displayName : `Bot (${m.difficulty})`}</b><small>{new Date(m.createdAt).toLocaleString('pt-BR')}{m.endReason ? ` · ${m.endReason}` : ''}</small></span>
            <span className="tca-owners">{m.winnerId ? (m.winnerId === m.p1Id ? `Venceu ${m.p1?.displayName}` : m.winnerId === 'BOT' ? 'Venceu o bot' : `Venceu ${m.p2?.displayName}`) : '—'} · moedas {m.reward1}/{m.reward2}</span>
            {['ACTIVE', 'PENDING'].includes(m.status) && <button type="button" className="tcg-btn ghost danger" onClick={() => { if (window.confirm('Cancelar esta partida? Ninguém recebe recompensa.')) cardsAdmin.cancelMatch(m.id).then(() => { setMsg({ ok: 'Partida cancelada.' }); load(); }).catch((e) => setMsg({ err: errMsg(e) })); }}>Cancelar</button>}
          </div>
        ))}
        {d === null && <p className="tcg-empty">Carregando…</p>}
        {d?.matches.length === 0 && <p className="tcg-empty">Nenhuma partida.</p>}
      </div>
    </div>
  );
}

// ---------------- Estatísticas (equilíbrio) ----------------
export function CardsAdminStats() {
  const [days, setDays] = useState(14);
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [sort, setSort] = useState('played');
  useEffect(() => { setD(null); cardsAdmin.stats(days).then(setD).catch((e) => setErr(errMsg(e))); }, [days]);
  if (err) return <Msg err={err} />;
  if (!d) return <p className="tcg-empty">Carregando…</p>;
  const sum = (k) => d.daily.reduce((s, x) => s + x[k], 0);
  const maxBar = Math.max(1, ...d.daily.map((x) => Math.max(x.coinsSpent, x.coinsRewarded)));
  const cards = [...d.cards].sort((a, b) => (sort === 'winRate' ? b.winRate - a.winRate : sort === 'low' ? a.winRate - b.winRate : b.played - a.played));
  return (
    <div className="tca">
      <div className="tca-bar">
        <div className="tcg-chips">{[7, 14, 30].map((n) => <button key={n} type="button" className={days === n ? 'on' : ''} onClick={() => setDays(n)}>{n} dias</button>)}</div>
      </div>
      <div className="tca-kpis">
        <div><b>{d.players}</b><span>jogadores</span></div>
        <div><b>{sum('matches')}</b><span>partidas ({sum('pvp')} PvP)</span></div>
        <div><b>{sum('packs')}</b><span>pacotes abertos</span></div>
        <div><b>{sum('coinsSpent').toLocaleString('pt-BR')}</b><span>moedas gastas em pacotes</span></div>
        <div><b>{sum('coinsRewarded').toLocaleString('pt-BR')}</b><span>moedas pagas em partidas</span></div>
        <div><b>{sum('marketVolume').toLocaleString('pt-BR')}</b><span>moedas no mercado</span></div>
        <div><b>{d.totalFoils}</b><span>brilhantes ({d.totalCopies} cópias no total)</span></div>
      </div>
      <h4 className="tca-h4">Moedas por dia <small className="tcg-dim">roxo = gastas em pacotes · amarelo = pagas em partidas</small></h4>
      <div className="tca-chart" role="img" aria-label="Moedas gastas e pagas por dia">
        {d.daily.map((x) => (
          <div key={x.day} className="tca-chart-col" title={`${x.day}: gastas ${x.coinsSpent}, pagas ${x.coinsRewarded}, ${x.matches} partidas`}>
            <span style={{ height: `${(x.coinsSpent / maxBar) * 100}%` }} className="is-spent" />
            <span style={{ height: `${(x.coinsRewarded / maxBar) * 100}%` }} className="is-paid" />
            <small>{x.day.slice(8)}</small>
          </div>
        ))}
        {!d.daily.length && <p className="tcg-empty">Sem dados no período.</p>}
      </div>
      <h4 className="tca-h4">Vitória dos jogadores contra cada bot</h4>
      <div className="tca-kpis">
        {Object.entries(d.botWinRate).map(([k, v]) => <div key={k}><b>{v.games ? Math.round((v.playerWins / v.games) * 100) : 0}%</b><span>{k} ({v.games} partidas)</span></div>)}
      </div>
      <h4 className="tca-h4">Cartas — uso e taxa de vitória</h4>
      <p className="tcg-dim">Cartas com taxa de vitória muito alta e muito usadas podem estar fortes demais; muito baixa, fracas demais.</p>
      <div className="tcg-chips"><button type="button" className={sort === 'played' ? 'on' : ''} onClick={() => setSort('played')}>Mais usadas</button><button type="button" className={sort === 'winRate' ? 'on' : ''} onClick={() => setSort('winRate')}>Maior vitória</button><button type="button" className={sort === 'low' ? 'on' : ''} onClick={() => setSort('low')}>Menor vitória</button></div>
      <div className="tca-table">
        {cards.slice(0, 60).map((c) => (
          <div key={c.id} className="tca-row" style={{ '--rar': RARITIES[c.rarity]?.color }}>
            <span className="tca-main"><b data-no-translate>{c.name}</b><small>{RARITIES[c.rarity]?.label} · {ELEMENTS[c.element]?.label}{c.kind === 'SPELL' ? ' · Feitiço' : ''}</small></span>
            <span className="tca-owners">{c.played} partidas</span>
            <span className="tca-winbar"><i style={{ width: `${c.winRate}%`, background: c.winRate > 62 ? '#f23f43' : c.winRate < 38 ? '#3b8bff' : '#4cc76b' }} /><b>{c.winRate}%</b></span>
          </div>
        ))}
        {!cards.length && <p className="tcg-empty">Ainda não há partidas suficientes.</p>}
      </div>
    </div>
  );
}

// ---------------- Campanha ----------------
export function CardsAdminCampaign() {
  const [stages, setStages] = useState(null);
  const [cards, setCards] = useState([]);
  const [boards, setBoards] = useState([]);
  const [edit, setEdit] = useState(null);
  const [msg, setMsg] = useState({});
  const load = () => cardsAdmin.campaign().then((d) => setStages(d.stages)).catch((e) => setMsg({ err: errMsg(e) }));
  useEffect(() => { load(); cardsAdmin.cards().then((d) => setCards(d.cards)).catch(() => {}); cardsAdmin.boards().then((d) => setBoards(d.boards)).catch(() => {}); }, []);
  const save = async () => {
    try {
      const body = { ...edit, deckCardIds: edit.deckCardIds || [] };
      if (edit.id) await cardsAdmin.updateStage(edit.id, body); else await cardsAdmin.createStage(body);
      setEdit(null); setMsg({ ok: 'Fase salva.' }); load();
    } catch (e) { setMsg({ err: errMsg(e) }); }
  };
  const move = async (st, dir) => {
    const i = stages.findIndex((x) => x.id === st.id);
    const other = stages[i + dir];
    if (!other) return;
    await cardsAdmin.updateStage(st.id, { position: other.position });
    await cardsAdmin.updateStage(other.id, { position: st.position });
    load();
  };
  if (edit) {
    const set = (k) => (e) => setEdit((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
    const deck = new Set(edit.deckCardIds || []);
    return (
      <div className="tca-form">
        <div className="tca-grid">
          <Field label="Nome da fase"><input value={edit.name || ''} maxLength={60} onChange={set('name')} /></Field>
          <Field label="Nome do bot" hint="O retrato é gerado pelo nome."><input value={edit.botName || ''} maxLength={40} onChange={set('botName')} /></Field>
          <Field label="Dificuldade (IA e nível das cartas)">
            <select value={edit.difficulty || 'MEDIO'} onChange={set('difficulty')}><option value="FACIL">Fácil</option><option value="MEDIO">Médio</option><option value="DIFICIL">Difícil</option><option value="LENDARIO">Lendário</option></select>
          </Field>
          <Field label="Vida do bot"><input type="number" min="5" max="100" value={edit.heroHp ?? 30} onChange={set('heroHp')} /></Field>
          <Field label="Moedas ao vencer (1ª vez)"><input type="number" min="0" value={edit.rewardCoins ?? 0} onChange={set('rewardCoins')} /></Field>
          <Field label="Carta de prêmio (1ª vez)">
            <select value={edit.rewardCardId || ''} onChange={set('rewardCardId')}><option value="">Nenhuma</option>{cards.map((c) => <option key={c.id} value={c.id}>{c.name} ({RARITIES[c.rarity]?.label})</option>)}</select>
          </Field>
          <Field label="Fundo da batalha" hint="Vazio = sorteado entre os fundos ativos.">
            <select value={edit.boardId || ''} onChange={set('boardId')}><option value="">Sorteado</option>{boards.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
          </Field>
          <Field label="História" wide><textarea rows={3} maxLength={2000} value={edit.story || ''} onChange={set('story')} /></Field>
          <label className="tcg-check"><input type="checkbox" checked={edit.enabled !== false} onChange={set('enabled')} />Fase ativa</label>
        </div>
        <h4 className="tca-h4">Baralho do bot (opcional) <small className="tcg-dim">{deck.size} escolhidas — vazio = baralho gerado pela dificuldade</small></h4>
        <div className="tca-pool-list">
          {cards.filter((c) => c.enabled).map((c) => (
            <label key={c.id} className="tcg-check" style={{ borderLeft: `3px solid ${RARITIES[c.rarity]?.color}`, paddingLeft: 6 }}>
              <input type="checkbox" checked={deck.has(c.id)} onChange={(e) => setEdit((x) => ({ ...x, deckCardIds: e.target.checked ? [...(x.deckCardIds || []), c.id] : (x.deckCardIds || []).filter((id) => id !== c.id) }))} />{c.name}
            </label>
          ))}
        </div>
        <Msg {...msg} />
        <div className="tca-actions"><button type="button" className="tcg-btn ghost" onClick={() => setEdit(null)}>Cancelar</button><button type="button" className="tcg-btn primary" disabled={!edit.name} onClick={save}>Salvar fase</button></div>
      </div>
    );
  }
  return (
    <div className="tca">
      <div className="tca-bar"><span className="tcg-dim">Fases jogadas em ordem. O prêmio só é pago na primeira vitória de cada fase.</span><span className="tcgb-spacer" /><button type="button" className="tcg-btn primary" onClick={() => setEdit({ difficulty: 'MEDIO', heroHp: 30, rewardCoins: 100, enabled: true, deckCardIds: [] })}><Icon d={UI.plus} />Nova fase</button></div>
      <Msg {...msg} />
      <div className="tca-table">
        {stages?.map((st, i) => (
          <div key={st.id} className={`tca-row${st.enabled ? '' : ' is-off'}`}>
            <BotPortrait name={st.botName} size={44} />
            <span className="tca-main"><b>{i + 1}. {st.name}</b><small>{st.botName} · {st.difficulty} · {st.heroHp} de vida · {st.rewardCoins} moedas{st.rewardCardId ? ' + carta' : ''}</small></span>
            <button type="button" className="tcg-icon-btn" disabled={i === 0} onClick={() => move(st, -1)} aria-label="Subir"><Icon d={UI.up} size={14} /></button>
            <button type="button" className="tcg-icon-btn" disabled={i === stages.length - 1} onClick={() => move(st, 1)} aria-label="Descer"><Icon d="M12 5v14M5 12l7 7 7-7" size={14} /></button>
            <button type="button" className="tcg-btn ghost" onClick={() => setEdit({ ...st, deckCardIds: (() => { try { return JSON.parse(st.deckCardIds || '[]'); } catch { return []; } })() })}>Editar</button>
            <button type="button" className="tcg-icon-btn" onClick={() => { if (window.confirm(`Excluir a fase "${st.name}"?`)) cardsAdmin.deleteStage(st.id).then(load); }} aria-label="Excluir"><Icon d={UI.close} size={14} /></button>
          </div>
        ))}
        {stages === null && <p className="tcg-empty">Carregando…</p>}
      </div>
    </div>
  );
}

// ---------------- Torneios ----------------
export function CardsAdminTournaments() {
  const [list, setList] = useState(null);
  const [cards, setCards] = useState([]);
  const [form, setForm] = useState(null);
  const [msg, setMsg] = useState({});
  const load = () => cardsAdmin.tournaments().then((d) => setList(d.tournaments)).catch((e) => setMsg({ err: errMsg(e) }));
  useEffect(() => { load(); cardsAdmin.cards().then((d) => setCards(d.cards)).catch(() => {}); }, []);
  const act = async (fn, ok) => { setMsg({}); try { await fn(); setMsg({ ok }); load(); } catch (e) { setMsg({ err: errMsg(e) }); } };
  if (form) {
    const set = (k) => (e) => setForm((x) => ({ ...x, [k]: e.target.value }));
    return (
      <div className="tca-form">
        <div className="tca-grid">
          <Field label="Nome"><input value={form.name || ''} maxLength={80} onChange={set('name')} /></Field>
          <Field label="Vagas"><select value={form.maxPlayers || 8} onChange={set('maxPlayers')}>{[4, 8, 16, 32].map((n) => <option key={n} value={n}>{n} jogadores</option>)}</select></Field>
          <Field label="Início previsto"><input type="datetime-local" value={form.startsAt || ''} onChange={set('startsAt')} /></Field>
          <Field label="Prêmio em moedas"><input type="number" min="0" value={form.prizeCoins ?? 0} onChange={set('prizeCoins')} /></Field>
          <Field label="Prêmio em gemas"><input type="number" min="0" value={form.prizeGems ?? 0} onChange={set('prizeGems')} /></Field>
          <Field label="Carta de prêmio (vem brilhante)"><select value={form.prizeCardId || ''} onChange={set('prizeCardId')}><option value="">Nenhuma</option>{cards.map((c) => <option key={c.id} value={c.id}>{c.name} ({RARITIES[c.rarity]?.label})</option>)}</select></Field>
          <Field label="Descrição / regras" wide><textarea rows={3} maxLength={2000} value={form.description || ''} onChange={set('description')} /></Field>
        </div>
        <Msg {...msg} />
        <div className="tca-actions">
          <button type="button" className="tcg-btn ghost" onClick={() => setForm(null)}>Cancelar</button>
          <button type="button" className="tcg-btn primary" disabled={!form.name} onClick={() => act(async () => {
            const body = { ...form, startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : null };
            if (form.id) await cardsAdmin.updateTournament(form.id, body); else await cardsAdmin.createTournament(body);
            setForm(null);
          }, 'Torneio salvo.')}>Salvar</button>
        </div>
      </div>
    );
  }
  return (
    <div className="tca">
      <div className="tca-bar"><span className="tcg-dim">Crie o torneio, os jogadores se inscrevem na aba Torneios da Arena e você inicia quando quiser. Quem não aparece perde por tempo.</span><span className="tcgb-spacer" /><button type="button" className="tcg-btn primary" onClick={() => setForm({ maxPlayers: 8, prizeCoins: 500 })}><Icon d={UI.plus} />Novo torneio</button></div>
      <Msg {...msg} />
      {list?.map((t) => (
        <div key={t.id} className="tcg-tourn">
          <header>
            <span className="tcg-tourn-icon"><Icon d={UI.trophy} size={22} /></span>
            <div className="tcg-tourn-title"><h3>{t.name}</h3><small>{t.status} · {t.players.length}/{t.maxPlayers} inscritos{t.winner ? ` · campeão ${t.winner.displayName}` : ''}</small></div>
            {t.status === 'OPEN' && <button type="button" className="tcg-btn ghost" onClick={() => setForm({ ...t, prizeCardId: t.prizeCard?.id || '', startsAt: t.startsAt ? new Date(t.startsAt).toISOString().slice(0, 16) : '' })}>Editar</button>}
            {t.status === 'OPEN' && <button type="button" className="tcg-btn primary" disabled={t.players.length < 2} onClick={() => { if (window.confirm(`Iniciar "${t.name}" com ${t.players.length} jogadores?`)) act(() => cardsAdmin.startTournament(t.id), 'Torneio iniciado! As partidas da 1ª rodada foram criadas.'); }}>Iniciar</button>}
            {['OPEN', 'RUNNING'].includes(t.status) && <button type="button" className="tcg-btn ghost danger" onClick={() => { if (window.confirm('Cancelar o torneio? Partidas em andamento serão canceladas.')) act(() => cardsAdmin.cancelTournament(t.id), 'Torneio cancelado.'); }}>Cancelar</button>}
          </header>
          <TournamentBracket rounds={t.rounds} />
        </div>
      ))}
      {list === null && <p className="tcg-empty">Carregando…</p>}
      {list?.length === 0 && <p className="tcg-empty">Nenhum torneio ainda.</p>}
    </div>
  );
}

// ---------------- Fundos de batalha ----------------
const EMPTY_BOARD = { name: '', theme: 'floresta', dim: 35, accent: '#8b6bff', weight: 10, active: true, imageUrl: null, effect: 'NONE' };
export function CardsAdminBoards() {
  const [boards, setBoards] = useState(null);
  const [effects, setEffects] = useState([]);
  const [edit, setEdit] = useState(null);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [msg, setMsg] = useState({});
  const [busy, setBusy] = useState(false);
  const load = () => cardsAdmin.boards().then((d) => { setBoards(d.boards); setEffects(d.effects || []); }).catch((e) => setMsg({ err: errMsg(e) }));
  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (!file) { setPreview(null); return undefined; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const open = (b) => { setFile(null); setMsg({}); setEdit(b ? { ...b } : { ...EMPTY_BOARD }); };
  const save = async () => {
    setBusy(true); setMsg({});
    try {
      const body = { name: edit.name, theme: edit.theme, dim: edit.dim, accent: edit.accent, weight: edit.weight, active: edit.active, effect: edit.effect || 'NONE', removeImage: edit.removeImage ? 'true' : undefined };
      const fd = toFd(body, file);
      if (edit.id) await cardsAdmin.updateBoard(edit.id, fd); else await cardsAdmin.createBoard(fd);
      setEdit(null); setFile(null); setMsg({ ok: 'Fundo salvo. As próximas partidas já usam.' }); load();
    } catch (e) { setMsg({ err: errMsg(e) }); } finally { setBusy(false); }
  };
  const quick = async (b, patch) => {
    try { await cardsAdmin.updateBoard(b.id, toFd(patch)); load(); } catch (e) { setMsg({ err: errMsg(e) }); }
  };

  if (edit) {
    const set = (k) => (e) => setEdit((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
    const shown = { ...edit, imageUrl: preview || (edit.removeImage ? null : edit.imageUrl) };
    return (
      <div className="tca-form tca-board-editor">
        <div className="tca-board-preview">
          <BoardThumb board={shown} className="is-big" />
          <small className="tcg-dim">Pré-visualização ao vivo — a mesa e as cartas ficam por cima do fundo.</small>
        </div>
        <div className="tca-grid">
          <Field label="Nome" hint="Aparece no topo da batalha."><input value={edit.name} maxLength={50} onChange={set('name')} placeholder="ex: Castelo de Gelo" /></Field>
          <Field label="Imagem de fundo" hint="JPG/PNG/WebP, de preferência 1920×1080. Sem imagem, usa a cena do tema base.">
            <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(e) => { setFile(e.target.files?.[0] || null); setEdit((x) => ({ ...x, removeImage: false })); }} />
          </Field>
          {(edit.imageUrl || file) && !edit.removeImage && (
            <button type="button" className="tcg-btn ghost danger" onClick={() => { setFile(null); setEdit((x) => ({ ...x, removeImage: true })); }}>Remover imagem (usar a cena do tema)</button>
          )}
          <Field label="Tema base" hint="Cena ilustrada usada sem imagem e partículas (vaga-lumes, brasas, neve…).">
            <select value={edit.theme} onChange={set('theme')}>{THEME_KEYS.map((k) => <option key={k} value={k}>{BOARD_THEMES[k].label}</option>)}</select>
          </Field>
          <Field label="Efeito da mesa" hint={effects.find((x) => x.key === (edit.effect || 'NONE'))?.desc || 'Partidas nesta mesa seguem as regras normais.'}>
            <select value={edit.effect || 'NONE'} onChange={set('effect')}>{effects.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</select>
          </Field>
          <Field label={`Escurecer fundo: ${edit.dim}%`} hint="Deixa as cartas mais legíveis em imagens claras."><input type="range" min="0" max="85" value={edit.dim} onChange={set('dim')} /></Field>
          <Field label="Cor de destaque" hint="Brilho da mesa e da linha do meio."><input type="color" value={edit.accent} onChange={set('accent')} /></Field>
          <Field label="Frequência" hint="Chance relativa de cair nas partidas (0 = nunca sorteado; ainda dá pra usar na campanha)."><input type="number" min="0" max="100" value={edit.weight} onChange={set('weight')} /></Field>
          <label className="tcg-check"><input type="checkbox" checked={edit.active} onChange={set('active')} />Ativo</label>
        </div>
        <Msg {...msg} />
        <div className="tca-actions">
          <button type="button" className="tcg-btn ghost" onClick={() => setEdit(null)}>Cancelar</button>
          <button type="button" className="tcg-btn primary" disabled={!edit.name || busy} onClick={save}>{busy ? 'Salvando…' : 'Salvar fundo'}</button>
        </div>
      </div>
    );
  }
  return (
    <div className="tca">
      <div className="tca-bar">
        <span className="tcg-dim">Cada partida sorteia um fundo ativo (pela frequência). Fases da campanha podem ter um fundo fixo.</span>
        <span className="tcgb-spacer" />
        <button type="button" className="tcg-btn primary" onClick={() => open(null)}><Icon d={UI.plus} />Novo fundo</button>
      </div>
      <Msg {...msg} />
      <div className="tca-boards">
        {boards?.map((b) => (
          <div key={b.id} className={`tca-board${b.active ? '' : ' is-off'}`}>
            <button type="button" className="tca-board-pic" onClick={() => open(b)} aria-label={`Editar ${b.name}`}><BoardThumb board={b} /></button>
            <div className="tca-board-info">
              <b>{b.name}</b>
              <small>{b.imageUrl ? 'Imagem própria' : `Cena: ${BOARD_THEMES[b.theme]?.label || b.theme}`} · frequência {b.weight} · {b.uses} partida(s)</small>
              {b.effect && b.effect !== 'NONE' && <small className="tca-board-fx">✦ {effects.find((x) => x.key === b.effect)?.label || b.effect}</small>}
            </div>
            <div className="tca-board-actions">
              <label className="tcg-check"><input type="checkbox" checked={b.active} onChange={(e) => quick(b, { active: e.target.checked })} />Ativo</label>
              <button type="button" className="tcg-btn ghost tcg-btn-sm" onClick={() => open(b)}>Editar</button>
              <button type="button" className="tcg-icon-btn" onClick={() => { if (window.confirm(`Excluir o fundo "${b.name}"?`)) cardsAdmin.deleteBoard(b.id).then(load).catch((e) => setMsg({ err: errMsg(e) })); }} aria-label="Excluir"><Icon d={UI.close} size={14} /></button>
            </div>
          </div>
        ))}
        {boards === null && <p className="tcg-empty">Carregando…</p>}
        {boards?.length === 0 && <p className="tcg-empty">Nenhum fundo. As partidas usam as cenas padrão.</p>}
      </div>
    </div>
  );
}
