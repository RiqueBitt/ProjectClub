import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { createBuild, getBuild, updateBuild } from '../../api/gameHub';
import { HubPage } from './GameHubShell.jsx';
import { EmptyState, GamePicker, Ico, errText } from './shared.jsx';
import {
  BUILD_GAMES, DARKTIDE_CLASSES, DL_SLOTS, Icon, IconPickerModal, LOL_ROLES, gameMeta, useGameData, useIndex, useLolChampion,
} from './buildsShared.jsx';

// Game Hub → criar / editar build (/jogos/builds/nova?jogo=lol e
// /jogos/builds/:id/editar). Cada jogo tem o seu formulário; o servidor
// confere tudo de novo antes de salvar.

const EMPTY = {
  lol: { champion: '', role: '', primaryTree: null, keystone: null, secondaryTree: null, spells: [], start: [], core: [], situational: [], skills: '' },
  deadlock: { hero: null, early: [], mid: [], late: [], abilityOrder: [] },
  darktide: { klass: '', melee: '', ranged: '', blessings: '', talents: '', curios: ['', '', ''] },
  outro: { character: '', items: [''], abilities: '' },
};

function Field({ label, children, hint }) {
  return (
    <div className="gh-ed-field">
      <span className="gh-field-label">{label}</span>
      {children}
      {hint && <small className="gh-hint">{hint}</small>}
    </div>
  );
}

// Fileira de ícones escolhidos + botão de adicionar (clique tira).
function SlotRow({ ids, index, max, onAdd, onRemove, slotOf = false, label }) {
  return (
    <div className="gh-slotrow" aria-label={label}>
      {ids.map((id, i) => {
        const it = index?.item.get(slotOf ? Number(id) : String(id));
        return (
          <button key={`${id}-${i}`} type="button" className="gh-slot" onClick={() => onRemove(i)} title={`Tirar ${it?.name || id}`}>
            <Icon src={it?.img} name={it?.name || String(id)} size={44} slot={slotOf ? it?.slot : undefined} />
            <span className="gh-slot-x"><Ico name="close" size={10} /></span>
          </button>
        );
      })}
      {ids.length < max && <button type="button" className="gh-slot is-add" onClick={onAdd} aria-label={`Adicionar em ${label}`}><Ico name="plus" size={20} /></button>}
    </div>
  );
}

// ---------- LoL ----------
function LolForm({ d, set, data, index }) {
  const [picker, setPicker] = useState(null); // 'champ' | 'start' | 'core' | 'situational'
  const champ = useLolChampion(d.champion);
  const trees = data.runes || [];
  const primary = trees.find((t) => t.id === d.primaryTree);
  const itemFilters = useMemo(() => [
    { id: 'all', label: 'Todos' },
    { id: 'start', label: 'Iniciais', test: (it) => it.gold <= 500 && it.depth <= 1 },
    { id: 'boots', label: 'Botas', test: (it) => it.tags.includes('Boots') },
    { id: 'full', label: 'Completos', test: (it) => it.into === 0 && it.gold >= 2000 },
  ], []);
  const itemOptions = useMemo(() => data.items.map((it) => ({ ...it, hint: `${it.gold} de ouro` })), [data]);
  const groupMax = { start: 4, core: 6, situational: 6 };
  const addItem = (group, it) => set({ [group]: d[group].includes(String(it.id)) ? d[group].filter((x) => x !== String(it.id)) : [...d[group], String(it.id)].slice(0, groupMax[group]) });

  // Ordem de habilidades: clique na habilidade de cada nível, em ordem.
  const setSkill = (level, key) => {
    const arr = d.skills.split('');
    if (level > arr.length) return;
    arr[level] = key;
    set({ skills: arr.join('').slice(0, 18) });
  };

  return (
    <>
      <Field label="CAMPEÃO">
        {d.champion ? (
          <div className="gh-picked">
            <Icon src={index.champ.get(d.champion)?.img} name={d.champion} size={44} />
            <strong>{index.champ.get(d.champion)?.name || d.champion}</strong>
            <button type="button" className="gh-link-btn" onClick={() => setPicker('champ')}>Trocar</button>
          </div>
        ) : <button type="button" className="gh-btn" onClick={() => setPicker('champ')}><Ico name="search" size={15} /> Escolher campeão</button>}
      </Field>
      <Field label="ROTA">
        <div className="gh-chips">
          {LOL_ROLES.map((r) => <button key={r.id} type="button" className={`gh-chip${d.role === r.id ? ' on' : ''}`} onClick={() => set({ role: d.role === r.id ? '' : r.id })}>{r.name}</button>)}
        </div>
      </Field>
      <Field label="RUNAS" hint="Árvore principal com a pedra angular, e a secundária.">
        <div className="gh-runes">
          <div className="gh-rune-trees">
            {trees.map((t) => (
              <button key={t.id} type="button" className={`gh-rune-tree${d.primaryTree === t.id ? ' on' : ''}`} onClick={() => set({ primaryTree: t.id, keystone: null, secondaryTree: d.secondaryTree === t.id ? null : d.secondaryTree })} title={t.name}>
                <Icon src={t.img} name={t.name} size={30} round /><span>{t.name}</span>
              </button>
            ))}
          </div>
          {primary && (
            <div className="gh-keystones">
              {(primary.slots[0] || []).map((r) => (
                <button key={r.id} type="button" className={`gh-keystone${d.keystone === r.id ? ' on' : ''}`} onClick={() => set({ keystone: r.id })} title={r.name}>
                  <Icon src={r.img} name={r.name} size={48} round /><span>{r.name}</span>
                </button>
              ))}
            </div>
          )}
          {primary && (
            <div className="gh-rune-trees is-secondary">
              <span className="gh-hint">Secundária:</span>
              {trees.filter((t) => t.id !== d.primaryTree).map((t) => (
                <button key={t.id} type="button" className={`gh-rune-tree is-sm${d.secondaryTree === t.id ? ' on' : ''}`} onClick={() => set({ secondaryTree: d.secondaryTree === t.id ? null : t.id })} title={t.name}>
                  <Icon src={t.img} name={t.name} size={24} round /><span>{t.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </Field>
      <Field label="FEITIÇOS (2)">
        <div className="gh-spells">
          {data.spells.map((s) => {
            const on = d.spells.includes(s.id);
            return (
              <button key={s.id} type="button" className={`gh-spell${on ? ' on' : ''}`} aria-pressed={on} disabled={!on && d.spells.length >= 2} onClick={() => set({ spells: on ? d.spells.filter((x) => x !== s.id) : [...d.spells, s.id].slice(0, 2) })} title={s.name}>
                <Icon src={s.img} name={s.name} size={38} />
              </button>
            );
          })}
        </div>
      </Field>
      <Field label="ITENS INICIAIS"><SlotRow label="iniciais" ids={d.start} index={index} max={4} onAdd={() => setPicker('start')} onRemove={(i) => set({ start: d.start.filter((_, j) => j !== i) })} /></Field>
      <Field label="ITENS PRINCIPAIS (em ordem)"><SlotRow label="principais" ids={d.core} index={index} max={6} onAdd={() => setPicker('core')} onRemove={(i) => set({ core: d.core.filter((_, j) => j !== i) })} /></Field>
      <Field label="SITUACIONAIS"><SlotRow label="situacionais" ids={d.situational} index={index} max={6} onAdd={() => setPicker('situational')} onRemove={(i) => set({ situational: d.situational.filter((_, j) => j !== i) })} /></Field>
      <Field label="ORDEM DE HABILIDADES" hint={d.champion ? 'Clique na habilidade de cada nível, do 1 ao 18.' : 'Escolha o campeão primeiro.'}>
        {d.champion && (
          <div className="gh-skills is-edit">
            {['Q', 'W', 'E', 'R'].map((k) => {
              const s = champ?.spells?.find((x) => x.key === k);
              return (
                <div key={k} className="gh-skills-row">
                  <span className="gh-skills-key">{s && <Icon src={s.img} name={`${k} — ${s.name}`} size={28} />}<b>{k}</b></span>
                  {Array.from({ length: 18 }, (_, i) => (
                    <button key={i} type="button" className={`gh-skills-cell${d.skills[i] === k ? ' on' : ''}`} disabled={i > d.skills.length} onClick={() => setSkill(i, k)} aria-label={`Nível ${i + 1}: ${k}`}>
                      {d.skills[i] === k ? i + 1 : ''}
                    </button>
                  ))}
                </div>
              );
            })}
            {d.skills && <button type="button" className="gh-link-btn" onClick={() => set({ skills: '' })}>Limpar ordem</button>}
          </div>
        )}
      </Field>

      {picker === 'champ' && (
        <IconPickerModal title="Escolher campeão" items={data.champions.map((c) => ({ ...c, hint: c.title }))} picked={d.champion ? [d.champion] : []} size={56}
          onPick={(c) => { set({ champion: c.id, skills: d.champion === c.id ? d.skills : '' }); setPicker(null); }} onClose={() => setPicker(null)} />
      )}
      {['start', 'core', 'situational'].includes(picker) && (
        <IconPickerModal
          title={{ start: 'Itens iniciais', core: 'Itens principais', situational: 'Itens situacionais' }[picker]}
          items={itemOptions} filters={itemFilters} picked={d[picker]} max={groupMax[picker]}
          onPick={(it) => addItem(picker, it)} onClose={() => setPicker(null)}
          footer={<button type="button" className="btn-primary gh-picker-done" onClick={() => setPicker(null)}>Pronto ({d[picker].length}/{groupMax[picker]})</button>}
        />
      )}
    </>
  );
}

// ---------- Deadlock ----------
function DeadlockForm({ d, set, data, index }) {
  const [picker, setPicker] = useState(null); // 'hero' | 'early' | 'mid' | 'late'
  const hero = index.hero.get(d.hero);
  const filters = useMemo(() => [{ id: 'all', label: 'Todos' }, ...DL_SLOTS.map((s) => ({ id: s.id, label: s.name, test: (it) => it.slot === s.id }))], []);
  const items = useMemo(() => data.items.map((it) => ({ ...it, hint: `${it.cost.toLocaleString('pt-BR')} almas${it.active ? ' · ativo' : ''}` })), [data]);
  const max = { early: 8, mid: 8, late: 10 };
  const toggle = (phase, it) => set({ [phase]: d[phase].includes(it.id) ? d[phase].filter((x) => x !== it.id) : [...d[phase], it.id].slice(0, max[phase]) });
  const orderPick = (slot) => set({ abilityOrder: d.abilityOrder.includes(slot) ? d.abilityOrder.filter((x) => x !== slot) : [...d.abilityOrder, slot].slice(0, 4) });
  return (
    <>
      <Field label="HERÓI">
        {hero ? (
          <div className="gh-picked">
            <Icon src={hero.img} name={hero.name} size={44} />
            <strong>{hero.name}</strong>
            <button type="button" className="gh-link-btn" onClick={() => setPicker('hero')}>Trocar</button>
          </div>
        ) : <button type="button" className="gh-btn" onClick={() => setPicker('hero')}><Ico name="search" size={15} /> Escolher herói</button>}
      </Field>
      {hero && (
        <Field label="PRIORIDADE DAS HABILIDADES" hint="Clique na ordem em que você evolui (1º, 2º…).">
          <div className="gh-dl-abilities">
            {hero.abilities.map((a) => {
              const pos = d.abilityOrder.indexOf(a.slot);
              return (
                <button key={a.slot} type="button" className={`gh-dl-ab${pos >= 0 ? ' on' : ''}`} onClick={() => orderPick(a.slot)} title={a.name}>
                  <Icon src={a.img} name={a.name} size={44} round />
                  {pos >= 0 && <b className="gh-dl-ab-n">{pos + 1}º</b>}
                  <span className="truncate">{a.name}</span>
                </button>
              );
            })}
          </div>
        </Field>
      )}
      {[['early', 'COMEÇO DA PARTIDA'], ['mid', 'MEIO'], ['late', 'FIM']].map(([phase, label]) => (
        <Field key={phase} label={label}>
          <SlotRow label={label.toLowerCase()} ids={d[phase]} index={index} max={max[phase]} slotOf onAdd={() => setPicker(phase)} onRemove={(i) => set({ [phase]: d[phase].filter((_, j) => j !== i) })} />
        </Field>
      ))}
      <p className="gh-legend">{DL_SLOTS.map((s) => <span key={s.id} className={`dl-${s.id}`}><i />{s.name}</span>)}</p>

      {picker === 'hero' && (
        <IconPickerModal title="Escolher herói" items={data.heroes} picked={d.hero ? [d.hero] : []} size={60}
          onPick={(h) => { set({ hero: h.id, abilityOrder: h.id === d.hero ? d.abilityOrder : [] }); setPicker(null); }} onClose={() => setPicker(null)} />
      )}
      {['early', 'mid', 'late'].includes(picker) && (
        <IconPickerModal title={{ early: 'Itens do começo', mid: 'Itens do meio', late: 'Itens do fim' }[picker]} items={items} filters={filters} picked={d[picker]} max={max[picker]}
          onPick={(it) => toggle(picker, it)} onClose={() => setPicker(null)}
          footer={<button type="button" className="btn-primary gh-picker-done" onClick={() => setPicker(null)}>Pronto ({d[picker].length}/{max[picker]})</button>} />
      )}
    </>
  );
}

// ---------- Darktide ----------
function DarktideForm({ d, set }) {
  return (
    <>
      <Field label="CLASSE">
        <div className="gh-klasses">
          {DARKTIDE_CLASSES.map((k) => (
            <button key={k.id} type="button" className={`gh-klass-btn k-${k.id}${d.klass === k.id ? ' on' : ''}`} onClick={() => set({ klass: k.id })}>
              <span className={`gh-icon gh-klass k-${k.id}`} style={{ '--s': '36px' }}>{k.glyph}</span>{k.name}
            </button>
          ))}
        </div>
      </Field>
      <div className="gh-ed-2">
        <label className="gh-ed-field"><span className="gh-field-label">ARMA CORPO A CORPO</span><input value={d.melee} onChange={(e) => set({ melee: e.target.value })} maxLength={80} placeholder="Ex.: Espada de Energia Mk III" /></label>
        <label className="gh-ed-field"><span className="gh-field-label">ARMA DE DISTÂNCIA</span><input value={d.ranged} onChange={(e) => set({ ranged: e.target.value })} maxLength={80} placeholder="Ex.: Fuzil Laser Mk V" /></label>
      </div>
      <label className="gh-ed-field"><span className="gh-field-label">BÊNÇÃOS</span><textarea rows={3} value={d.blessings} onChange={(e) => set({ blessings: e.target.value })} maxLength={400} placeholder="Uma por linha" /></label>
      <label className="gh-ed-field"><span className="gh-field-label">TALENTOS</span><textarea rows={4} value={d.talents} onChange={(e) => set({ talents: e.target.value })} maxLength={800} placeholder="Habilidade, aura, keystone… ou cole o link da árvore" /></label>
      <Field label="CURIOS">
        <div className="gh-ed-3">
          {d.curios.map((c, i) => <input key={i} value={c} onChange={(e) => set({ curios: d.curios.map((x, j) => (j === i ? e.target.value : x)) })} maxLength={80} placeholder={`Curio ${i + 1}`} aria-label={`Curio ${i + 1}`} />)}
        </div>
      </Field>
    </>
  );
}

// ---------- Outro jogo ----------
function OutroForm({ d, set, game, setGame }) {
  return (
    <>
      <GamePicker value={game} onChange={setGame} label="JOGO" />
      <label className="gh-ed-field"><span className="gh-field-label">PERSONAGEM / CLASSE</span><input value={d.character} onChange={(e) => set({ character: e.target.value })} maxLength={80} placeholder="Ex.: Samurai, Paladino, Sniper…" /></label>
      <Field label="ITENS / EQUIPAMENTO">
        <div className="gh-ed-list">
          {d.items.map((it, i) => (
            <div key={i} className="gh-ed-list-row">
              <span className="gh-ed-list-n">{i + 1}</span>
              <input value={it} onChange={(e) => set({ items: d.items.map((x, j) => (j === i ? e.target.value : x)) })} maxLength={60} placeholder="Item" aria-label={`Item ${i + 1}`} />
              {d.items.length > 1 && <button type="button" className="gh-icon-btn" aria-label="Tirar item" onClick={() => set({ items: d.items.filter((_, j) => j !== i) })}><Ico name="close" size={14} /></button>}
            </div>
          ))}
          {d.items.length < 12 && <button type="button" className="gh-link-btn" onClick={() => set({ items: [...d.items, ''] })}><Ico name="plus" size={14} /> Mais um item</button>}
        </div>
      </Field>
      <label className="gh-ed-field"><span className="gh-field-label">HABILIDADES / TALENTOS</span><textarea rows={4} value={d.abilities} onChange={(e) => set({ abilities: e.target.value })} maxLength={800} placeholder="O que evoluir e em que ordem" /></label>
    </>
  );
}

export default function BuildEditor() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const editing = !!id;
  const [game, setGameId] = useState(() => (BUILD_GAMES.some((g) => g.id === params.get('jogo')) ? params.get('jogo') : 'lol'));
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [d, setD] = useState(() => EMPTY[game]);
  const [otherGame, setOtherGame] = useState(null);
  const [loaded, setLoaded] = useState(!editing);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const { data, loading, error: dataError } = useGameData(game);
  const index = useIndex(game, data);

  useEffect(() => {
    if (!editing) return;
    getBuild(id).then((b) => {
      if (!b.mine) { navigate(`/jogos/builds/${id}`, { replace: true }); return; }
      setGameId(b.game); setTitle(b.title); setNotes(b.notes || '');
      setD({ ...EMPTY[b.game], ...b.data, ...(b.game === 'darktide' ? { curios: [...(b.data.curios || []), '', '', ''].slice(0, 3) } : {}), ...(b.game === 'outro' ? { items: b.data.items?.length ? b.data.items : [''] } : {}), ...(b.game === 'lol' ? { role: b.data.role || '', skills: b.data.skills || '' } : {}) });
      if (b.gameInfo) setOtherGame({ name: b.gameInfo.name, steamAppId: b.gameInfo.steamAppId });
      setLoaded(true);
    }).catch(() => { setError('Não achei essa build.'); setLoaded(true); });
  }, [editing, id, navigate]);

  const switchGame = (g) => { if (g === game) return; setGameId(g); setD(EMPTY[g]); setError(''); };
  const set = (patch) => setD((x) => ({ ...x, ...patch }));
  const heroName = game === 'lol' ? index?.champ.get(d.champion)?.name : game === 'deadlock' ? index?.hero.get(d.hero)?.name : null;

  const save = async (e) => {
    e.preventDefault();
    setSaving(true); setError('');
    const body = {
      game, title: title.trim(), notes, heroName,
      ...(game === 'outro' ? { gameName: otherGame?.name, steamAppId: otherGame?.steamAppId } : {}),
      data: game === 'outro' ? { ...d, items: d.items.filter((x) => x.trim()) } : d,
    };
    try {
      const b = editing ? await updateBuild(id, body) : await createBuild(body);
      navigate(`/jogos/builds/${b.id}`, { replace: editing });
    } catch (err) { setError(errText(err, 'Não consegui salvar a build.')); } finally { setSaving(false); }
  };

  const needsData = game === 'lol' || game === 'deadlock';
  return (
    <HubPage className={`gh-editor g-${game}`}>
      <Link to={editing ? `/jogos/builds/${id}` : '/jogos/builds'} className="gh-back"><Ico name="back" size={16} /> {editing ? 'Voltar pra build' : 'Builds'}</Link>
      <h1 className="gh-h1">{editing ? 'Editar build' : 'Nova build'}</h1>
      {!editing && (
        <div className="gh-build-games is-editor" role="tablist" aria-label="Jogo">
          {BUILD_GAMES.map((g) => (
            <button key={g.id} type="button" role="tab" aria-selected={game === g.id} className={`gh-gamechip g-${g.id}${game === g.id ? ' on' : ''}`} onClick={() => switchGame(g.id)}>
              <span className={`gh-gamechip-ico gm-${g.id}`} aria-hidden="true">{g.short.slice(0, 1)}</span>{g.short}
            </button>
          ))}
        </div>
      )}
      {!loaded ? <span className="gh-skel gh-bv-skel" /> : (
        <form className="gh-ed auth-form" onSubmit={save}>
          <label className="gh-ed-field">
            <span className="gh-field-label">NOME DA BUILD</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} placeholder={game === 'lol' ? 'Ex.: Ahri meio — dano explosivo' : 'Ex.: build pra iniciante'} required />
          </label>
          {needsData && loading && <span className="gh-skel gh-ed-skel" />}
          {needsData && dataError && (
            <EmptyState icon="hammer" title={`Os dados de ${gameMeta(game).short} não carregaram`}>Tente de novo daqui a pouco.</EmptyState>
          )}
          {game === 'lol' && data && index && <LolForm d={d} set={set} data={data} index={index} />}
          {game === 'deadlock' && data && index && <DeadlockForm d={d} set={set} data={data} index={index} />}
          {game === 'darktide' && <DarktideForm d={d} set={set} />}
          {game === 'outro' && <OutroForm d={d} set={set} game={otherGame} setGame={setOtherGame} />}
          <label className="gh-ed-field">
            <span className="gh-field-label">COMO JOGAR <span className="gh-opt">(opcional)</span></span>
            <textarea rows={5} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={4000} placeholder="Dicas, combos, quando trocar de item…" />
          </label>
          {error && <div className="auth-error">{error}</div>}
          <div className="gh-ed-save">
            <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Salvando…' : editing ? 'Salvar alterações' : 'Publicar build'}</button>
          </div>
        </form>
      )}
    </HubPage>
  );
}
