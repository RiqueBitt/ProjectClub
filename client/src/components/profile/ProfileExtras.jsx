import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Modal from '../Modal.jsx';
import { Ico } from '../PagesKit.jsx';
import { PfCard } from '../modals/profileParts.jsx';
import { GameCapsule } from '../games/GameLibraryParts.jsx';
import { getProfileExtras, saveProfileWidgets, saveUserNote, toggleWishlistItem } from '../../api/endpoints';
import { getGameLibrary, searchGames } from '../../api/games';
import { shopFontFamily } from '../../utils/shopFont';
import { PROFILE_STYLES } from '../../utils/profileStyle';
import { useStore } from '../../store/useStore';
import '../../styles/profile-extras.css';

// Extras do perfil completo (igual ao Discord): Mural (widgets de jogos),
// Lista de desejos, Atividade dos últimos 30 dias, insígnias de
// estatística e Nota pessoal. Dados de GET /users/:id/extras.

export function useProfileExtras(userId) {
  const [extras, setExtras] = useState(null);
  const load = useCallback(() => {
    if (!userId) return;
    getProfileExtras(userId).then(setExtras).catch(() => setExtras({ failed: true }));
  }, [userId]);
  useEffect(() => { setExtras(null); load(); }, [load]);
  return [extras, setExtras, load];
}

const WIDGET_META = {
  favorite: { title: 'Jogo favorito', icon: 'heart', hint: 'Escolha 1 jogo' },
  rotation: { title: 'Jogos em rotação', icon: 'bolt', hint: 'Até 5 jogos' },
  liked: { title: 'Jogos que eu gosto', icon: 'star', hint: 'Até 20 jogos' },
  want: { title: 'Quero jogar', icon: 'bag', hint: 'Até 20 jogos' },
};
const ALL_WIDGETS = ['favorite', 'rotation', 'liked', 'want'];
const fmtHours = (s) => {
  const h = s / 3600;
  if (h >= 1) return `${h >= 10 ? Math.round(h) : h.toFixed(1).replace('.', ',')} h`;
  return `${Math.max(1, Math.round(s / 60))} min`;
};
const agoText = (day) => {
  const d = Math.max(0, Math.round((Date.now() - new Date(`${day}T12:00:00`).getTime()) / 86400000));
  if (d === 0) return 'hoje';
  if (d === 1) return 'ontem';
  if (d < 7) return `${d} dias atrás`;
  const w = Math.round(d / 7);
  return `${w} ${w === 1 ? 'semana' : 'semanas'} atrás`;
};

function Chips({ items, tone }) {
  if (!items?.length) return null;
  return <span className="pxw-chips">{items.map((t) => <span key={t} className={`pxw-chip ${tone || ''}`}>{t}</span>)}</span>;
}

// ---------- Mural ----------
export function MuralCard({ user, extras, isMe, onEdit }) {
  const w = extras?.widgets;
  const order = (w?.order || ALL_WIDGETS).filter((k) => !(w?.hidden || []).includes(k));
  const has = (k) => (k === 'favorite' ? !!w?.favorite : (w?.[k] || []).length > 0);
  const visible = order.filter(has);
  if (!visible.length && !isMe) return null;
  return (
    <PfCard icon="grid" title="Mural" action={isMe && <button type="button" className="pf-link" onClick={onEdit}>Editar mural</button>}>
      {!visible.length ? (
        <div className="pxw-empty">
          <Ico name="grid" size={20} />
          <span>Monte seu mural: jogo favorito, jogos em rotação, os que você gosta e os que quer jogar.</span>
          <button type="button" className="pf-btn" onClick={onEdit}><Ico name="plus" size={14} /> Adicionar widget</button>
        </div>
      ) : (
        <div className="pxw-mural">
          {visible.map((k) => (
            <div key={k} className={`pxw-widget pxw-w-${k}`}>
              <div className="pxw-widget-head"><Ico name={WIDGET_META[k].icon} size={14} /> {WIDGET_META[k].title}</div>
              {k === 'favorite' && (
                <div className="pxw-fav">
                  <GameCapsule game={w.favorite} size="md" />
                  <div className="pxw-fav-body">
                    <strong>{w.favorite.name}</strong>
                    {w.favorite.comment && (
                      <blockquote className="pxw-quote"><small>{user.displayName} diz:</small>{w.favorite.comment}</blockquote>
                    )}
                    <Chips items={w.favorite.tags} />
                  </div>
                </div>
              )}
              {k === 'rotation' && (
                <div className="pxw-rotation">
                  {w.rotation.map((g) => (
                    <div key={g.gameKey} className="pxw-rot">
                      <GameCapsule game={g} size="sm" />
                      <div className="pxw-rot-body">
                        <strong title={g.name}>{g.name}</strong>
                        <span className="pxw-rot-meta">{[g.level, g.feeling].filter(Boolean).join(' · ')}</span>
                        <Chips items={g.tags} tone="accent" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {(k === 'liked' || k === 'want') && <GameStrip games={w[k]} />}
            </div>
          ))}
        </div>
      )}
    </PfCard>
  );
}

function GameStrip({ games }) {
  const [all, setAll] = useState(false);
  const shown = all ? games : games.slice(0, 6);
  return (
    <>
      <div className="pxw-strip">
        {shown.map((g) => (
          <div key={g.gameKey} className="pxw-strip-item" title={g.name}>
            <GameCapsule game={g} size="sm" />
            <span>{g.name}</span>
          </div>
        ))}
      </div>
      {games.length > 6 && <button type="button" className="pf-link pxw-more" onClick={() => setAll(!all)}>{all ? 'Mostrar menos' : `Mostrar mais (${games.length - 6})`}</button>}
    </>
  );
}

// ---------- Atividade (últimos 30 dias) ----------
export function RecentActivityCard({ extras, isMe }) {
  const list = extras?.activity;
  if (!list || (!list.length && !isMe)) return null;
  return (
    <PfCard icon="calendar" title="Atividade recente" count={list.length || null}>
      {!list.length ? (
        <p className="pxw-dim">Os jogos que você jogar nos últimos 30 dias aparecem aqui.</p>
      ) : (
        <ul className="pxa-list">
          {list.map((g) => (
            <li key={g.gameKey} className="pxa-row">
              <GameCapsule game={g} size="sm" />
              <div className="pxa-body">
                <strong>{g.name}</strong>
                <span className="pxa-meta">{fmtHours(g.seconds)} nos últimos 30 dias · {g.days} {g.days === 1 ? 'dia' : 'dias'}</span>
                {g.tag && <span className={`pxa-tag ${g.tag.startsWith('Novo') ? 'new' : 'back'}`}>{g.tag}</span>}
              </div>
              <span className="pxa-when">{agoText(g.lastDay)}</span>
            </li>
          ))}
        </ul>
      )}
    </PfCard>
  );
}

// ---------- Insígnias de estatística ----------
export function StatBadgesCard({ extras }) {
  const stats = extras?.stats;
  if (!stats?.length) return null;
  return (
    <PfCard icon="medal" title="Estatísticas">
      <div className="pxs-grid">
        {stats.map((b) => (
          <div key={b.key} className={`pxs-badge lv${b.level}`} title={b.next != null ? `Próximo nível: ${b.nextName}` : 'Nível máximo!'}>
            <span className="pxs-ico"><Ico name={b.icon} size={18} /><em>{b.level}</em></span>
            <span className="pxs-text">
              <small>{b.label}</small>
              <strong>{b.name}</strong>
              <span>{b.text}</span>
            </span>
          </div>
        ))}
      </div>
    </PfCard>
  );
}

// ---------- Lista de desejos ----------
const KIND_LABEL = { deco: 'Moldura', effect: 'Efeito de perfil', font: 'Fonte do nome', style: 'Estilo de perfil' };
export function WishItemArt({ item }) {
  if (item.kind === 'font') {
    return <span className="pxl-art font" style={{ fontFamily: shopFontFamily({ id: item.id, family: item.data?.family, url: item.data?.url }) }}>Aa</span>;
  }
  if (item.kind === 'style') {
    const key = item.data?.style || '';
    return <span className={`pxl-art style ps-swatch-${key}`}><Ico name="palette" size={22} /><small>{PROFILE_STYLES[key] || ''}</small></span>;
  }
  return item.previewUrl ? <img className="pxl-art img" src={item.previewUrl} alt="" loading="lazy" /> : <span className="pxl-art"><Ico name="gift" size={22} /></span>;
}

export function WishlistCard({ user, extras, isMe, setExtras }) {
  const navigate = useNavigate();
  const list = extras?.wishlist;
  if (list === null || list === undefined) return null; // só amigos veem
  if (!list.length && !isMe) return null;
  const goShop = (q = '') => { useStore.getState().closeProfile?.(); navigate(`/loja${q}`); };
  const remove = async (it) => {
    setExtras((e) => ({ ...e, wishlist: e.wishlist.filter((x) => !(x.kind === it.kind && x.id === it.id)) }));
    toggleWishlistItem(it.kind, it.id, false).catch(() => {});
  };
  return (
    <PfCard
      icon="sparkle" title="Lista de desejos" count={list.length || null}
      action={<span className="pxl-hint"><Ico name="lock" size={12} /> Só amigos veem</span>}
    >
      {!list.length ? (
        <div className="pxw-empty">
          <Ico name="gift" size={20} />
          <span>Marque itens da Loja com o coração pra montar sua lista. Seus amigos podem te presentear.</span>
          <button type="button" className="pf-btn" onClick={() => goShop()}><Ico name="store" size={14} /> Ir pra Loja</button>
        </div>
      ) : (
        <div className="pxl-grid">
          {list.map((it) => (
            <div key={`${it.kind}:${it.id}`} className={`pxl-item${it.available ? '' : ' off'}`}>
              <WishItemArt item={it} />
              <div className="pxl-body">
                <strong title={it.name}>{it.name}</strong>
                <small>{KIND_LABEL[it.kind]}{!it.available ? ' · indisponível' : ''}</small>
              </div>
              {isMe ? (
                <button type="button" className="pxl-btn ghost" title="Tirar da lista" onClick={() => remove(it)}><Ico name="close" size={13} /></button>
              ) : it.available && (
                <button type="button" className="pxl-btn" onClick={() => goShop(`?gift=${it.kind}:${it.id}&to=${user.id}`)}><Ico name="gift" size={13} /> Presentear</button>
              )}
            </div>
          ))}
        </div>
      )}
    </PfCard>
  );
}

// ---------- Nota pessoal ----------
export function NoteCard({ userId, extras }) {
  const [text, setText] = useState(extras?.note || '');
  const [state, setState] = useState('');
  const saved = useRef(extras?.note || '');
  useEffect(() => { setText(extras?.note || ''); saved.current = extras?.note || ''; }, [extras?.note]);
  if (!extras || extras.failed) return null;
  const save = () => {
    if (text.trim() === saved.current) return;
    setState('saving');
    saveUserNote(userId, text.trim()).then((r) => { saved.current = r.note; setState('ok'); setTimeout(() => setState(''), 1500); })
      .catch(() => setState('err'));
  };
  return (
    <PfCard icon="pencil" title="Nota" action={<span className="pxl-hint"><Ico name="eye" size={12} /> Visível só pra você</span>}>
      <textarea
        className="pxn-text" rows={2} maxLength={256} value={text} placeholder="Clique pra adicionar uma nota"
        onChange={(e) => setText(e.target.value)} onBlur={save}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.blur(); } }}
      />
      {state && <small className={`pxn-state ${state}`}>{state === 'saving' ? 'Salvando…' : state === 'ok' ? 'Nota salva' : 'Não deu pra salvar'}</small>}
    </PfCard>
  );
}

// ---------- Editor do Mural ----------
const blankWidgets = () => ({ favorite: null, rotation: [], liked: [], want: [], order: [...ALL_WIDGETS], hidden: [] });
const slim = (g) => ({ gameKey: g.gameKey, name: g.name, ...(g.steamAppId ? { steamAppId: String(g.steamAppId) } : {}), ...(g.iconUrl ? { iconUrl: g.iconUrl } : {}) });

function GamePicker({ chosen, onPick, max, single }) {
  const [library, setLibrary] = useState(null);
  const [q, setQ] = useState('');
  const [remote, setRemote] = useState([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => { getGameLibrary('me').then((d) => setLibrary(d.games || [])).catch(() => setLibrary([])); }, []);
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setRemote([]); return undefined; }
    setLoading(true);
    const t = setTimeout(() => searchGames(term).then((d) => setRemote(d.games || [])).catch(() => setRemote([])).finally(() => setLoading(false)), 350);
    return () => clearTimeout(t);
  }, [q]);
  const chosenKeys = new Set(chosen.map((g) => g.gameKey));
  const term = q.trim().toLowerCase();
  const results = useMemo(() => {
    const map = new Map();
    (library || []).filter((g) => !term || g.name.toLowerCase().includes(term)).forEach((g) => map.set(g.gameKey, g));
    remote.forEach((g) => { if (!map.has(g.gameKey)) map.set(g.gameKey, g); });
    return [...map.values()].slice(0, 30);
  }, [library, remote, term]);
  const full = !single && chosen.length >= max;
  return (
    <div className="pxe-picker">
      <label className="pxe-search">
        <Ico name="search" size={15} />
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder="Busque qualquer jogo ou escolha da sua biblioteca" aria-label="Buscar jogo" />
      </label>
      {!term && <small className="pxe-hint">Sua biblioteca{library?.length ? ` (${library.length})` : ''}:</small>}
      <div className="pxe-results">
        {library === null && <span className="pxw-dim">Carregando…</span>}
        {results.map((g) => {
          const on = chosenKeys.has(g.gameKey);
          return (
            <button key={g.gameKey} type="button" className={`pxe-game${on ? ' on' : ''}`} disabled={!on && full} onClick={() => onPick(slim(g), on)} title={g.name}>
              <GameCapsule game={g} size="sm" />
              <span>{g.name}</span>
              <em><Ico name={on ? 'check' : 'plus'} size={12} /></em>
            </button>
          );
        })}
        {term && !loading && results.length === 0 && <span className="pxw-dim">Nenhum jogo com “{q.trim()}”.</span>}
        {loading && <span className="pxw-dim">Buscando na Steam…</span>}
      </div>
    </div>
  );
}

function TagToggles({ options, value, max, onChange }) {
  return (
    <div className="pxe-tags">
      {options.map((t) => {
        const on = value.includes(t);
        return (
          <button key={t} type="button" className={`pxe-tag${on ? ' on' : ''}`} disabled={!on && value.length >= max}
            onClick={() => onChange(on ? value.filter((x) => x !== t) : [...value, t])}
          >{t}</button>
        );
      })}
    </div>
  );
}

export function MuralEditorModal({ extras, onClose, onSaved }) {
  const opts = extras?.options || { levels: [], feelings: [], tags: [], limits: { liked: 20, rotation: 5, want: 20 } };
  const [w, setW] = useState(() => ({ ...blankWidgets(), ...(extras?.widgets || {}) }));
  const [tab, setTab] = useState('favorite');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (patch) => setW((x) => ({ ...x, ...patch }));

  const toggleIn = (key) => (g, on) => set({ [key]: on ? w[key].filter((x) => x.gameKey !== g.gameKey) : [...w[key], key === 'rotation' ? { ...g, level: null, feeling: null, tags: [] } : g] });
  const patchRot = (gameKey, patch) => set({ rotation: w.rotation.map((g) => (g.gameKey === gameKey ? { ...g, ...patch } : g)) });
  const move = (key, dir) => {
    const order = [...w.order];
    const i = order.indexOf(key);
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    set({ order });
  };

  const save = async () => {
    setSaving(true); setError('');
    try {
      const r = await saveProfileWidgets(w);
      onSaved?.(r.widgets);
      onClose();
    } catch (e) {
      setError(e?.response?.data?.error || 'Não deu pra salvar o mural.');
    } finally { setSaving(false); }
  };

  const TABS = [...ALL_WIDGETS.map((k) => ({ id: k, label: WIDGET_META[k].title, icon: WIDGET_META[k].icon })), { id: 'order', label: 'Organizar', icon: 'sliders' }];
  const count = (k) => (k === 'favorite' ? (w.favorite ? 1 : 0) : k === 'order' ? null : w[k].length);

  return (
    <Modal title="Editar mural" onClose={onClose} width="760px" className="pxe-modal">
      <div className="pxe-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
            <Ico name={t.icon} size={14} /> {t.label}{count(t.id) ? <em>{count(t.id)}</em> : null}
          </button>
        ))}
      </div>

      {tab === 'favorite' && (
        <section className="pxe-panel">
          {w.favorite ? (
            <div className="pxe-fav">
              <GameCapsule game={w.favorite} size="md" />
              <div className="pxe-fav-body">
                <div className="pxe-row"><strong>{w.favorite.name}</strong><button type="button" className="pf-link" onClick={() => set({ favorite: null })}>Trocar jogo</button></div>
                <label className="pxe-label">Seu comentário <small>{(w.favorite.comment || '').length}/190</small></label>
                <textarea rows={3} maxLength={190} value={w.favorite.comment || ''} placeholder="Mostre a todos por que este é o seu favorito"
                  onKeyDown={(e) => e.stopPropagation()} onChange={(e) => set({ favorite: { ...w.favorite, comment: e.target.value } })}
                />
                <label className="pxe-label">Tags <small>até 5</small></label>
                <TagToggles options={opts.tags} value={w.favorite.tags || []} max={5} onChange={(tags) => set({ favorite: { ...w.favorite, tags } })} />
              </div>
            </div>
          ) : (
            <GamePicker chosen={[]} single onPick={(g) => set({ favorite: { ...g, comment: '', tags: [] } })} max={1} />
          )}
        </section>
      )}

      {tab === 'rotation' && (
        <section className="pxe-panel">
          {w.rotation.length > 0 && (
            <div className="pxe-rots">
              {w.rotation.map((g) => (
                <div key={g.gameKey} className="pxe-rot">
                  <GameCapsule game={g} size="sm" />
                  <div className="pxe-rot-body">
                    <div className="pxe-row"><strong>{g.name}</strong><button type="button" className="pf-link" onClick={() => toggleIn('rotation')(g, true)}>Remover</button></div>
                    <div className="pxe-selects">
                      <select value={g.level || ''} onChange={(e) => patchRot(g.gameKey, { level: e.target.value || null })} aria-label="Nível">
                        <option value="">Nível…</option>
                        {opts.levels.map((l) => <option key={l} value={l}>{l}</option>)}
                      </select>
                      <select value={g.feeling || ''} onChange={(e) => patchRot(g.gameKey, { feeling: e.target.value || null })} aria-label="Como está">
                        <option value="">Como está sendo…</option>
                        {opts.feelings.map((l) => <option key={l} value={l}>{l}</option>)}
                      </select>
                    </div>
                    <TagToggles options={opts.tags} value={g.tags || []} max={3} onChange={(tags) => patchRot(g.gameKey, { tags })} />
                  </div>
                </div>
              ))}
            </div>
          )}
          <GamePicker chosen={w.rotation} max={opts.limits.rotation} onPick={toggleIn('rotation')} />
        </section>
      )}

      {(tab === 'liked' || tab === 'want') && (
        <section className="pxe-panel">
          <div className="pxe-row"><span className="pxw-dim">{w[tab].length}/{opts.limits[tab]} escolhidos</span>{w[tab].length > 0 && <button type="button" className="pf-link" onClick={() => set({ [tab]: [] })}>Limpar</button>}</div>
          <GamePicker chosen={w[tab]} max={opts.limits[tab]} onPick={toggleIn(tab)} />
        </section>
      )}

      {tab === 'order' && (
        <section className="pxe-panel">
          <p className="pxw-dim">Escolha a ordem dos widgets no seu perfil e esconda os que não quiser mostrar.</p>
          <ul className="pxe-order">
            {w.order.map((k, i) => {
              const hidden = w.hidden.includes(k);
              return (
                <li key={k} className={hidden ? 'off' : ''}>
                  <Ico name={WIDGET_META[k].icon} size={15} />
                  <span>{WIDGET_META[k].title}</span>
                  <small>{count(k) || 0}</small>
                  <button type="button" disabled={i === 0} onClick={() => move(k, -1)} aria-label="Subir"><Ico name="up" size={14} /></button>
                  <button type="button" disabled={i === w.order.length - 1} onClick={() => move(k, 1)} aria-label="Descer"><Ico name="down" size={14} /></button>
                  <button type="button" className="pxe-eye" onClick={() => set({ hidden: hidden ? w.hidden.filter((x) => x !== k) : [...w.hidden, k] })}>
                    {hidden ? 'Mostrar' : 'Esconder'}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {error && <div className="pfe-error" role="alert">{error}</div>}
      <div className="modal-actions">
        <button type="button" className="btn-link" onClick={onClose}>Cancelar</button>
        <button type="button" className="btn-primary" disabled={saving} onClick={save}>{saving ? 'Salvando…' : 'Salvar mural'}</button>
      </div>
    </Modal>
  );
}
