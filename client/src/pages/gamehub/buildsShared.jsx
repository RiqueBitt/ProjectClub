import { useEffect, useMemo, useState } from 'react';
import Modal from '../../components/Modal.jsx';
import { getGameData, getLolChampion } from '../../api/gameHub';
import { GameCover, Ico } from './shared.jsx';

// Builds do Game Hub: jogos, dados (LoL e Deadlock vêm do servidor, que
// busca nas fontes públicas), índices e o seletor de ícones.

export const BUILD_GAMES = [
  { id: 'lol', name: 'League of Legends', short: 'LoL' },
  { id: 'deadlock', name: 'Deadlock', short: 'Deadlock', steamAppId: 1422450 },
  { id: 'darktide', name: 'Warhammer 40,000: Darktide', short: 'Darktide', steamAppId: 1361210 },
  { id: 'outro', name: 'Outros jogos', short: 'Outros' },
];
export const gameMeta = (id) => BUILD_GAMES.find((g) => g.id === id) || BUILD_GAMES[3];

export const LOL_ROLES = [
  { id: 'top', name: 'Topo' }, { id: 'jungle', name: 'Selva' }, { id: 'mid', name: 'Meio' },
  { id: 'adc', name: 'Atirador' }, { id: 'support', name: 'Suporte' },
];
export const DARKTIDE_CLASSES = [
  { id: 'veteran', name: 'Veterano', glyph: 'VET' },
  { id: 'zealot', name: 'Zelote', glyph: 'ZEL' },
  { id: 'psyker', name: 'Psíquico', glyph: 'PSI' },
  { id: 'ogryn', name: 'Ogryn', glyph: 'OGR' },
  { id: 'arbitrator', name: 'Arbitrador', glyph: 'ARB' },
  { id: 'hivescum', name: 'Escória da Colmeia', glyph: 'ESC' },
];
export const DL_SLOTS = [
  { id: 'weapon', name: 'Arma' }, { id: 'vitality', name: 'Vitalidade' }, { id: 'spirit', name: 'Espírito' },
];

const dataCache = new Map();
const champCache = new Map();

export function useGameData(game) {
  const needs = game === 'lol' || game === 'deadlock';
  const [state, setState] = useState(() => ({ data: dataCache.get(game) || null, loading: needs && !dataCache.has(game), error: null }));
  useEffect(() => {
    if (!needs) { setState({ data: null, loading: false, error: null }); return undefined; }
    if (dataCache.has(game)) { setState({ data: dataCache.get(game), loading: false, error: null }); return undefined; }
    let alive = true;
    setState({ data: null, loading: true, error: null });
    getGameData(game).then((d) => { dataCache.set(game, d); if (alive) setState({ data: d, loading: false, error: null }); })
      .catch((error) => { if (alive) setState({ data: null, loading: false, error }); });
    return () => { alive = false; };
  }, [game, needs]);
  return state;
}

export function useLolChampion(id) {
  const [c, setC] = useState(() => champCache.get(id) || null);
  useEffect(() => {
    if (!id) { setC(null); return undefined; }
    if (champCache.has(id)) { setC(champCache.get(id)); return undefined; }
    let alive = true;
    getLolChampion(id).then((d) => { champCache.set(id, d); if (alive) setC(d); }).catch(() => { if (alive) setC(null); });
    return () => { alive = false; };
  }, [id]);
  return c;
}

// Índices por id pra mostrar a build salva.
export function useIndex(game, data) {
  return useMemo(() => {
    if (!data) return null;
    if (game === 'lol') {
      const runes = new Map(); const trees = new Map();
      for (const t of data.runes || []) { trees.set(t.id, t); for (const slot of t.slots) for (const r of slot) runes.set(r.id, r); }
      return {
        champ: new Map(data.champions.map((c) => [c.id, c])), item: new Map(data.items.map((i) => [String(i.id), i])),
        spell: new Map(data.spells.map((s) => [s.id, s])), rune: runes, tree: trees,
      };
    }
    if (game === 'deadlock') return { hero: new Map(data.heroes.map((h) => [h.id, h])), item: new Map(data.items.map((i) => [i.id, i])) };
    return null;
  }, [game, data]);
}

// Ícone quadrado (item, campeão, runa…) com nome no title.
export function Icon({ src, name, size = 40, className = '', round = false, slot }) {
  const [bad, setBad] = useState(false);
  return (
    <span className={`gh-icon${round ? ' is-round' : ''}${slot ? ` dl-${slot}` : ''} ${className}`} style={{ '--s': `${size}px` }} title={name}>
      {src && !bad ? <img src={src} alt={name || ''} loading="lazy" decoding="async" onError={() => setBad(true)} /> : <span className="gh-icon-txt">{(name || '?').slice(0, 2)}</span>}
    </span>
  );
}

// Retrato da build: campeão/herói, classe do Darktide ou capa do jogo.
export function BuildPortrait({ build, index, size = 56 }) {
  if (build.game === 'lol') {
    const c = index?.champ.get(build.hero);
    return <Icon src={c?.img} name={c?.name || build.heroName || build.hero} size={size} />;
  }
  if (build.game === 'deadlock') {
    const h = index?.hero.get(Number(build.hero));
    return <Icon src={h?.img} name={h?.name || build.heroName} size={size} />;
  }
  if (build.game === 'darktide') {
    const k = DARKTIDE_CLASSES.find((c) => c.id === build.hero);
    return <span className={`gh-icon gh-klass k-${build.hero}`} style={{ '--s': `${size}px` }} title={k?.name}>{k?.glyph || '?'}</span>;
  }
  return <span className="gh-icon gh-icon-cover" style={{ '--s': `${size}px` }}><GameCover appId={build.gameInfo?.steamAppId} name="" /></span>;
}

// Seletor genérico: busca + filtros + grade de ícones.
export function IconPickerModal({ title, items, onPick, onClose, filters = [], picked = [], max = null, size = 46, footer = null }) {
  const [q, setQ] = useState('');
  const [f, setF] = useState(filters[0]?.id || null);
  const fold = (t) => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const list = useMemo(() => {
    const term = fold(q.trim());
    const flt = filters.find((x) => x.id === f);
    return items.filter((it) => (!flt?.test || flt.test(it)) && (!term || fold(it.name).includes(term)));
  }, [items, q, f, filters]);
  const pickedSet = new Set(picked.map(String));
  const full = max != null && picked.length >= max;
  return (
    <Modal title={title} onClose={onClose} width="720px" className="gh-picker-modal">
      <div className="gh-picker">
        <div className="gh-picker-tools">
          <label className="gh-search">
            <Ico name="search" size={16} />
            <span className="sr-only">Buscar</span>
            <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }} placeholder="Buscar pelo nome" autoFocus />
          </label>
          {filters.length > 1 && (
            <div className="gh-chips">
              {filters.map((x) => <button key={x.id} type="button" className={`gh-chip${f === x.id ? ' on' : ''}`} onClick={() => setF(x.id)}>{x.label}</button>)}
            </div>
          )}
        </div>
        <div className="gh-picker-grid" style={{ '--s': `${size}px` }}>
          {list.map((it) => {
            const on = pickedSet.has(String(it.id));
            return (
              <button key={it.id} type="button" className={`gh-pick${on ? ' on' : ''}`} disabled={!on && full} onClick={() => onPick(it)} title={it.hint ? `${it.name} · ${it.hint}` : it.name}>
                <Icon src={it.img} name={it.name} size={size} slot={it.slot} />
                <span className="gh-pick-name">{it.name}</span>
                {it.hint && <small className="gh-pick-hint">{it.hint}</small>}
              </button>
            );
          })}
          {list.length === 0 && <p className="gh-hint">Nada com esse nome.</p>}
        </div>
        {footer}
      </div>
    </Modal>
  );
}
