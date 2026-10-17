// Editor de permissões de canal/categoria no estilo do Discord:
// banner de sincronização com a categoria, "Canal privado", e
// "Permissões avançadas" (lista de cargos/membros à esquerda e as
// permissões em três estados — negar / herdar / permitir — à direita),
// com barra de "alterações não salvas".
import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../../store/useStore';
import {
  listChannelOverwrites, setChannelOverwrite, deleteChannelOverwrite, syncChannelOverwrites,
  listCategoryOverwrites, setCategoryOverwrite, deleteCategoryOverwrite,
} from '../../api/endpoints';
import { overwriteGroups, overwriteToState, stateToLists, hasBit } from '../../utils/permissionCatalog';
import UserAvatar from '../UserAvatar.jsx';
import UiIcon from '../UiIcon.jsx';
import { Switch, TriState, PermissionList, SearchBox, SaveBar, RoleDot } from './PermUI.jsx';

const API = {
  channel: { list: listChannelOverwrites, set: setChannelOverwrite, del: deleteChannelOverwrite },
  category: { list: listCategoryOverwrites, set: setCategoryOverwrite, del: deleteCategoryOverwrite },
};
const keyOf = (type, id) => `${type}:${id}`;
const sameState = (a = {}, b = {}) => {
  const ka = Object.keys(a); const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => a[k] === b[k]);
};

export default function OverwriteEditor({ kind, targetId, channelType, category, isPrivate, onPrivateChange, myPerms, onDirtyChange }) {
  const roles = useStore((s) => s.roles);
  const members = useStore((s) => s.members);
  const api = API[kind];
  const everyone = roles.find((r) => r.isDefault);

  const [overwrites, setOverwrites] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [drafts, setDrafts] = useState({}); // key -> state
  const [added, setAdded] = useState([]); // [{type,id}] ainda sem sobrescrita salva
  const [removed, setRemoved] = useState([]); // keys pra apagar ao salvar
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState('');
  const [picker, setPicker] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [mobilePane, setMobilePane] = useState('list');
  const pickerRef = useRef(null);

  const load = async () => {
    const { overwrites: list } = await api.list(targetId);
    setOverwrites(list || []);
    setLoaded(true);
  };
  useEffect(() => { setLoaded(false); load(); }, [kind, targetId]);

  useEffect(() => {
    if (!picker) return undefined;
    const close = (e) => { if (pickerRef.current && !pickerRef.current.contains(e.target)) setPicker(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [picker]);

  const saved = useMemo(() => {
    const m = {};
    for (const o of overwrites) m[keyOf(o.targetType, o.targetId)] = { o, state: overwriteToState(o) };
    return m;
  }, [overwrites]);

  // Lista da esquerda: @todos sempre + cargos (por posição) + membros.
  const entries = useMemo(() => {
    const keys = new Set([...Object.keys(saved), ...added.map((a) => keyOf(a.type, a.id))]);
    removed.forEach((k) => keys.delete(k));
    const list = [];
    if (everyone) list.push({ type: 'ROLE', id: everyone.id });
    for (const k of keys) {
      const [type, id] = k.split(':');
      if (everyone && id === everyone.id) continue;
      list.push({ type, id });
    }
    const pos = (e) => (e.type === 'ROLE' ? (roles.find((r) => r.id === e.id)?.position ?? -1) : -2);
    return list.sort((a, b) => (a.id === everyone?.id ? 1 : b.id === everyone?.id ? -1 : pos(b) - pos(a)));
  }, [saved, added, removed, everyone, roles]);

  useEffect(() => {
    if (!selected || !entries.some((e) => keyOf(e.type, e.id) === selected)) {
      setSelected(entries[0] ? keyOf(entries[0].type, entries[0].id) : null);
    }
  }, [entries, selected]);

  const stateFor = (k) => drafts[k] ?? saved[k]?.state ?? {};
  const dirtyKeys = useMemo(() => {
    const ks = new Set(removed.filter((k) => saved[k]));
    for (const [k, st] of Object.entries(drafts)) if (!sameState(st, saved[k]?.state)) ks.add(k);
    return [...ks];
  }, [drafts, saved, removed]);
  const dirty = dirtyKeys.length > 0;
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty]);

  const label = (e) => {
    if (e.type === 'ROLE') {
      const r = roles.find((x) => x.id === e.id);
      return r ? (r.isDefault ? '@todos' : r.name) : 'Cargo excluído';
    }
    const m = members.find((x) => x.user.id === e.id);
    return m?.user.displayName || m?.user.username || 'Membro';
  };

  const setPerm = (key, value) => {
    if (!selected) return;
    setError('');
    setDrafts((d) => {
      const cur = { ...(d[selected] ?? saved[selected]?.state ?? {}) };
      if (value) cur[key] = value; else delete cur[key];
      return { ...d, [selected]: cur };
    });
  };

  const clearSelected = () => setDrafts((d) => ({ ...d, [selected]: {} }));

  const addTarget = (type, id) => {
    const k = keyOf(type, id);
    setRemoved((r) => r.filter((x) => x !== k));
    if (!saved[k]) setAdded((a) => (a.some((x) => keyOf(x.type, x.id) === k) ? a : [...a, { type, id }]));
    setSelected(k);
    setPicker(false);
    setPickerQuery('');
    setMobilePane('perms');
  };

  const removeTarget = (k) => {
    setAdded((a) => a.filter((x) => keyOf(x.type, x.id) !== k));
    setDrafts((d) => { const n = { ...d }; delete n[k]; return n; });
    if (saved[k]) setRemoved((r) => [...r, k]);
    setSelected(null);
  };

  const reset = () => { setDrafts({}); setAdded([]); setRemoved([]); setError(''); };

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      for (const k of dirtyKeys) {
        const [targetType, tid] = k.split(':');
        const st = removed.includes(k) ? {} : stateFor(k);
        const { allow, deny } = stateToLists(st);
        if (!allow.length && !deny.length) {
          if (saved[k]) await api.del(targetId, saved[k].o.id);
        } else {
          await api.set(targetId, { targetType, targetId: tid, allow, deny });
        }
      }
      await load();
      setDrafts({}); setAdded([]); setRemoved([]);
    } catch (err) {
      setError(err.response?.data?.error || 'Não foi possível salvar as permissões.');
    } finally {
      setSaving(false);
    }
  };

  const syncNow = async () => {
    if (!confirm(`Sincronizar com a categoria "${category?.name}"? As permissões próprias deste canal serão apagadas e ele passa a seguir só as da categoria.`)) return;
    setSyncing(true);
    try { await syncChannelOverwrites(targetId); reset(); await load(); } finally { setSyncing(false); }
  };

  // Opções do "+": cargos e membros que ainda não estão na lista.
  const inList = new Set(entries.map((e) => keyOf(e.type, e.id)));
  const q = pickerQuery.trim().toLowerCase();
  const roleOptions = [...roles].filter((r) => !r.isDefault && !inList.has(keyOf('ROLE', r.id)) && (!q || r.name.toLowerCase().includes(q)))
    .sort((a, b) => b.position - a.position);
  const memberOptions = members.filter((m) => !inList.has(keyOf('MEMBER', m.user.id))
    && (!q || `${m.user.displayName || ''} ${m.user.username || ''}`.toLowerCase().includes(q))).slice(0, 30);

  const selectedEntry = entries.find((e) => keyOf(e.type, e.id) === selected);
  const selState = selected ? stateFor(selected) : {};
  const groups = overwriteGroups(kind, channelType);
  const isAdmin = myPerms === undefined || hasBit(myPerms, 'ADMINISTRATOR');
  const canGrant = (k) => isAdmin || hasBit(myPerms, k);
  const synced = kind === 'channel' && category && loaded && overwrites.length === 0 && !dirty;

  return (
    <div className="pm-ow">
      {kind === 'channel' && category && loaded && (
        <div className={`pm-sync ${synced ? 'ok' : ''}`}>
          {synced ? (
            <span><b>🔗 Permissões sincronizadas</b> com a categoria <b>{category.name}</b>.</span>
          ) : (
            <>
              <span><b>As permissões não estão sincronizadas</b> com a categoria <b>{category.name}</b>. As deste canal valem por cima das da categoria.</span>
              <button type="button" className="pm-btn-brand" onClick={syncNow} disabled={syncing}>{syncing ? 'Sincronizando...' : 'Sincronizar agora'}</button>
            </>
          )}
        </div>
      )}
      {kind === 'category' && (
        <p className="pm-hint">As permissões da categoria valem para todos os canais dentro dela. Um canal pode ter permissões próprias por cima destas.</p>
      )}

      {kind === 'channel' && onPrivateChange && (
        <div className="pm-card">
          <div className="pm-row-head">
            <span className="pm-row-name"><UiIcon name="lock" size={14} /> Canal privado</span>
            <Switch checked={isPrivate} onChange={onPrivateChange} label="Canal privado" />
          </div>
          <p className="pm-row-desc">Só membros e cargos adicionados abaixo (com “Ver canais” permitido) e administradores vão poder ver este canal.</p>
        </div>
      )}

      <h3 className="pm-title">Permissões avançadas</h3>
      <div className={`pm-ow-grid pane-${mobilePane}`}>
        <aside className="pm-ow-targets">
          <div className="pm-ow-targets-head" ref={pickerRef}>
            <span>CARGOS/MEMBROS</span>
            <button type="button" className="pm-icon-btn" onClick={() => setPicker((p) => !p)} title="Adicionar cargo ou membro" aria-label="Adicionar cargo ou membro">＋</button>
            {picker && (
              <div className="pm-picker">
                <input autoFocus value={pickerQuery} onChange={(e) => setPickerQuery(e.target.value)} placeholder="Cargos ou membros" />
                <div className="pm-picker-list">
                  {roleOptions.length > 0 && <div className="pm-picker-label">CARGOS</div>}
                  {roleOptions.map((r) => (
                    <button type="button" key={r.id} onClick={() => addTarget('ROLE', r.id)}><RoleDot color={r.color} /> {r.name}</button>
                  ))}
                  {memberOptions.length > 0 && <div className="pm-picker-label">MEMBROS</div>}
                  {memberOptions.map((m) => (
                    <button type="button" key={m.user.id} onClick={() => addTarget('MEMBER', m.user.id)}>
                      <UserAvatar user={m.user} size={20} noDecoration /> {m.user.displayName || m.user.username}
                      {m.user.username && <span className="pm-dim">@{m.user.username}</span>}
                    </button>
                  ))}
                  {!roleOptions.length && !memberOptions.length && <p className="pm-empty">Nada encontrado.</p>}
                </div>
              </div>
            )}
          </div>
          <ul>
            {entries.map((e) => {
              const k = keyOf(e.type, e.id);
              const role = e.type === 'ROLE' ? roles.find((r) => r.id === e.id) : null;
              const member = e.type === 'MEMBER' ? members.find((m) => m.user.id === e.id) : null;
              return (
                <li key={k}>
                  <button type="button" className={`pm-target ${selected === k ? 'active' : ''}`} onClick={() => { setSelected(k); setMobilePane('perms'); }}>
                    {member ? <UserAvatar user={member.user} size={20} noDecoration /> : <RoleDot color={role?.color} />}
                    <span className="pm-truncate">{label(e)}</span>
                    {dirtyKeys.includes(k) && <span className="pm-dirty-dot" title="Alterado" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        <div className="pm-ow-perms">
          {selectedEntry && (
            <>
              <div className="pm-ow-perms-head">
                <button type="button" className="pm-back" onClick={() => setMobilePane('list')}>‹ Voltar</button>
                <span className="pm-ow-who">{label(selectedEntry)}</span>
                <button type="button" className="btn-link" onClick={clearSelected} disabled={!Object.keys(selState).length}>Limpar</button>
                {selectedEntry.id !== everyone?.id && (
                  <button type="button" className="btn-link danger" onClick={() => removeTarget(selected)}>Remover</button>
                )}
              </div>
              <SearchBox value={search} onChange={setSearch} />
              <PermissionList
                groups={groups}
                search={search}
                renderControl={(k) => (
                  <TriState
                    value={selState[k] || null}
                    onChange={(v) => { if (v === 'allow' && !canGrant(k)) return; setPerm(k, v); }}
                  />
                )}
                warnFor={(k) => (!canGrant(k) ? 'Você só pode permitir o que você mesmo pode fazer.' : null)}
              />
            </>
          )}
        </div>
      </div>
      <SaveBar show={dirty} saving={saving} error={error} onReset={reset} onSave={save} />
    </div>
  );
}
