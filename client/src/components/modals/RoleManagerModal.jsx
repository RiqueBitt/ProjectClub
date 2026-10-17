// Gerenciador de cargos no estilo do Discord: lista à esquerda (busca,
// arrastar para reordenar, contagem de membros) e, à direita, as abas
// Exibição / Permissões / Gerenciar membros, com barra de "alterações não
// salvas". Segue a hierarquia: quem não é administrador só mexe nos cargos
// abaixo do seu cargo mais alto (o servidor também confere isso).
import { useMemo, useState } from 'react';
import Modal from '../Modal.jsx';
import { useStore } from '../../store/useStore';
import { useAuth } from '../../context/AuthContext.jsx';
import {
  createRole, updateRole, deleteRole, duplicateRole, reorderRoles, uploadRoleIcon, assignRole, unassignRole,
} from '../../api/endpoints';
import { PERMISSIONS, getMyCommunityPermissions } from '../../utils/permissions';
import { ROLE_GROUPS, bits, hasBit } from '../../utils/permissionCatalog';
import { isGradientColor, gradientStops, makeGradient } from '../../utils/roleColor';
import UserAvatar from '../UserAvatar.jsx';
import { Switch, PermissionList, SearchBox, SaveBar, RoleDot } from '../permissions/PermUI.jsx';

const SWATCHES = [
  '#1abc9c', '#2ecc71', '#3498db', '#9b59b6', '#e91e63', '#f1c40f', '#e67e22', '#e74c3c', '#95a5a6', '#607d8b',
  '#11806a', '#1f8b4c', '#206694', '#71368a', '#ad1457', '#c27c0e', '#a84300', '#992d22', '#979c9f', '#546e7a',
];
const DEFAULT_COLOR = '#99AAB5';

const draftOf = (r) => (r ? { name: r.name, color: r.color || DEFAULT_COLOR, hoist: !!r.hoist, mentionable: !!r.mentionable, permissions: String(r.permissions || '0') } : null);
const sameDraft = (a, b) => !!a && !!b && a.name === b.name && a.color === b.color && a.hoist === b.hoist && a.mentionable === b.mentionable && a.permissions === b.permissions;
const errMsg = (err, fallback) => err?.response?.data?.error || fallback;

export default function RoleManagerModal({ onClose }) {
  const { user } = useAuth();
  const roles = useStore((s) => s.roles);
  const members = useStore((s) => s.members);
  const upsertRole = useStore((s) => s.upsertRole);
  const removeRoleFromStore = useStore((s) => s.removeRole);
  const setMembers = useStore((s) => s.setMembers);

  const sorted = useMemo(() => [...(roles || [])].sort((a, b) => (a.isDefault ? 1 : b.isDefault ? -1 : b.position - a.position)), [roles]);
  const [selectedId, setSelectedId] = useState(() => sorted.find((r) => !r.isDefault)?.id || sorted[0]?.id || null);
  const [tab, setTab] = useState('display');
  const [listQuery, setListQuery] = useState('');
  const [permSearch, setPermSearch] = useState('');
  const [memberQuery, setMemberQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [addQuery, setAddQuery] = useState('');
  const [addPicked, setAddPicked] = useState([]);
  const [draft, setDraft] = useState(null);
  const [draftFor, setDraftFor] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [dragId, setDragId] = useState(null);
  const [mobilePane, setMobilePane] = useState('list');

  const selected = sorted.find((r) => r.id === selectedId) || sorted[0];
  // Rascunho do cargo aberto (recomeça ao trocar de cargo).
  const base = draftOf(selected);
  const cur = draftFor === selected?.id && draft ? draft : base;
  const dirty = !!selected && draftFor === selected.id && !!draft && !sameDraft(draft, base);
  const edit = (patch) => { setError(''); setDraft({ ...cur, ...patch }); setDraftFor(selected.id); };

  // Hierarquia (espelha getRoleCeiling no servidor).
  const myPerms = getMyCommunityPermissions(roles, members, user?.id, user?.platformRole);
  const isAdmin = user?.platformRole === 'ADMIN' || hasBit(myPerms, 'ADMINISTRATOR');
  const myRoleIds = members.find((m) => m.user.id === user?.id)?.roleIds || [];
  const ceiling = isAdmin ? Infinity : Math.max(0, ...roles.filter((r) => !r.isDefault && myRoleIds.includes(r.id)).map((r) => r.position));
  const canEdit = (r) => !!r && (r.isDefault || r.position < ceiling);
  const editable = canEdit(selected);
  const canGrant = (k) => isAdmin || hasBit(myPerms, k);

  const memberCount = (r) => (r.isDefault ? members.length : members.filter((m) => m.roleIds?.includes(r.id)).length);

  const guardSwitch = () => {
    if (dirty) { setError('Salve ou redefina as alterações antes de trocar de cargo.'); return false; }
    return true;
  };
  const select = (id) => {
    if (id === selected?.id) { setMobilePane('edit'); return; }
    if (!guardSwitch()) return;
    const r = sorted.find((x) => x.id === id);
    setSelectedId(id); setDraft(null); setDraftFor(null); setError(''); setAdding(false);
    if (r?.isDefault && tab === 'display') setTab('perms');
    setMobilePane('edit');
  };

  const addRole = async () => {
    if (!guardSwitch()) return;
    try {
      const { role } = await createRole({ name: 'novo cargo' });
      upsertRole(role);
      setSelectedId(role.id); setDraft(null); setDraftFor(null); setTab('display'); setMobilePane('edit');
    } catch (err) { setError(errMsg(err, 'Não foi possível criar o cargo.')); }
  };

  const save = async () => {
    if (!dirty) return;
    const payload = {};
    if (!selected.isDefault && cur.name.trim() !== selected.name) payload.name = cur.name.trim();
    if (cur.color !== selected.color) payload.color = cur.color;
    if (cur.hoist !== !!selected.hoist) payload.hoist = cur.hoist;
    if (cur.mentionable !== !!selected.mentionable) payload.mentionable = cur.mentionable;
    if (cur.permissions !== String(selected.permissions || '0')) payload.permissionsBits = cur.permissions;
    if (payload.name === '') { setError('O cargo precisa de um nome.'); return; }
    setSaving(true); setError('');
    try {
      const { role } = await updateRole(selected.id, payload);
      upsertRole(role);
      setDraft(null); setDraftFor(null);
    } catch (err) { setError(errMsg(err, 'Não foi possível salvar o cargo.')); } finally { setSaving(false); }
  };
  const reset = () => { setDraft(null); setDraftFor(null); setError(''); };

  const togglePerm = (key, on) => {
    const bit = PERMISSIONS[key];
    const b = bits(cur.permissions);
    edit({ permissions: (on ? b | bit : b & ~bit).toString() });
  };

  const remove = async () => {
    if (!confirm(`Excluir o cargo "${selected.name}"? Isso não pode ser desfeito.`)) return;
    try {
      await deleteRole(selected.id);
      removeRoleFromStore(selected.id);
      setSelectedId(sorted.find((r) => r.id !== selected.id && !r.isDefault)?.id || null);
      setDraft(null); setDraftFor(null); setMobilePane('list');
    } catch (err) { setError(errMsg(err, 'Não foi possível excluir o cargo.')); }
  };

  // "Duplicar cargo": cópia com tudo igual (cor, ícone, exibição, menção e
  // permissões), logo abaixo do original. O servidor confere hierarquia e
  // permissões de novo; aqui o botão só some quando já se sabe que não dá.
  const [duplicating, setDuplicating] = useState(false);
  const canDuplicate = !!selected && !selected.isDefault && editable
    && (isAdmin || (bits(selected.permissions) & ~bits(myPerms)) === 0n);
  const duplicate = async () => {
    if (duplicating || !guardSwitch()) return;
    setDuplicating(true); setError('');
    try {
      const { role } = await duplicateRole(selected.id);
      // Mesmo deslocamento que o servidor fez: do original pra cima, +1.
      useStore.getState().roles
        .filter((r) => !r.isDefault && r.id !== role.id && r.position >= role.position)
        .forEach((r) => upsertRole({ ...r, position: r.position + 1 }));
      upsertRole(role);
      setSelectedId(role.id); setDraft(null); setDraftFor(null); setTab('display'); setMobilePane('edit');
    } catch (err) { setError(errMsg(err, 'Não foi possível duplicar o cargo.')); } finally { setDuplicating(false); }
  };

  const uploadIcon = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try { const { role } = await uploadRoleIcon(selected.id, file); upsertRole(role); } catch (err) { setError(errMsg(err, 'Não foi possível enviar o ícone.')); }
  };
  const setEmojiIcon = async (icon) => {
    try { const { role } = await updateRole(selected.id, { icon }); upsertRole(role); } catch (err) { setError(errMsg(err, 'Não foi possível mudar o ícone.')); }
  };

  const onDrop = async (targetId) => {
    const id = dragId; setDragId(null);
    if (!id || id === targetId) return;
    const list = sorted.filter((r) => !r.isDefault);
    const from = list.findIndex((r) => r.id === id);
    const to = list.findIndex((r) => r.id === targetId);
    if (from < 0 || to < 0) return;
    const next = [...list];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    const before = list;
    next.forEach((r, i) => upsertRole({ ...r, position: next.length - i }));
    try { await reorderRoles(next.map((r) => r.id)); } catch (err) {
      before.forEach((r) => upsertRole(r));
      setError(errMsg(err, 'Não foi possível reordenar.'));
    }
  };

  // Membros do cargo
  const setMemberRole = async (userId, add) => {
    try {
      if (add) await assignRole(userId, selected.id); else await unassignRole(userId, selected.id);
      setMembers(useStore.getState().members.map((m) => (m.user.id !== userId ? m : {
        ...m, roleIds: add ? [...new Set([...(m.roleIds || []), selected.id])] : (m.roleIds || []).filter((x) => x !== selected.id),
      })));
    } catch (err) { setError(errMsg(err, 'Não foi possível alterar os membros do cargo.')); }
  };
  const confirmAdd = async () => {
    for (const id of addPicked) await setMemberRole(id, true); // eslint-disable-line no-await-in-loop
    setAdding(false); setAddPicked([]); setAddQuery('');
  };

  const closeModal = () => { if (dirty && !confirm('Você tem alterações não salvas. Sair mesmo assim?')) return; onClose(); };

  const visibleRoles = sorted.filter((r) => !listQuery || (r.isDefault ? '@todos' : r.name).toLowerCase().includes(listQuery.toLowerCase()));
  const nameOf = (m) => m.user.displayName || m.user.username || 'Membro';
  const match = (m, q) => !q || `${m.user.displayName || ''} ${m.user.username || ''}`.toLowerCase().includes(q.toLowerCase());
  const roleMembers = selected && !selected.isDefault ? members.filter((m) => m.roleIds?.includes(selected.id)) : [];

  const tabs = selected?.isDefault
    ? [['perms', 'Permissões']]
    : [['display', 'Exibição'], ['perms', 'Permissões'], ['members', `Gerenciar membros (${roleMembers.length})`]];
  const activeTab = tabs.some(([k]) => k === tab) ? tab : tabs[0][0];
  const gradient = isGradientColor(cur?.color);

  return (
    <Modal title="Cargos" onClose={closeModal} width="980px" className="pm-modal">
      <div className={`pm-roles pane-${mobilePane}`}>
        <aside className="pm-roles-list">
          <div className="pm-roles-list-head">
            <SearchBox value={listQuery} onChange={setListQuery} placeholder="Buscar cargos" />
            <button type="button" className="pm-icon-btn" onClick={addRole} title="Criar cargo" aria-label="Criar cargo">＋</button>
          </div>
          <p className="pm-hint small">Arraste para reordenar. Membros usam a cor do cargo mais alto.</p>
          <ul>
            {visibleRoles.map((r) => {
              const locked = !canEdit(r);
              return (
                <li
                  key={r.id}
                  draggable={!r.isDefault && !locked && !listQuery}
                  onDragStart={() => setDragId(r.id)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => onDrop(r.id)}
                  className={dragId === r.id ? 'dragging' : ''}
                >
                  <button type="button" className={`pm-target ${selected?.id === r.id ? 'active' : ''}`} onClick={() => select(r.id)}>
                    {!r.isDefault && !locked && <span className="pm-grip" aria-hidden>⋮⋮</span>}
                    <RoleDot color={isGradientColor(r.color) ? gradientStops(r.color)[0] : r.color} />
                    {r.icon && (r.icon.startsWith('/') ? <img src={r.icon} alt="" className="pm-role-icon" /> : <span className="pm-role-icon">{r.icon}</span>)}
                    <span className="pm-truncate">{r.isDefault ? '@todos' : r.name}</span>
                    {locked && <span title="Acima do seu cargo mais alto" aria-label="Bloqueado">🔒</span>}
                    <span className="pm-count" title="Membros">👤 {memberCount(r)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        {selected && (
          <section className="pm-roles-edit">
            <div className="pm-roles-edit-head">
              <button type="button" className="pm-back" onClick={() => { if (guardSwitch()) setMobilePane('list'); }}>‹ Cargos</button>
              <h3>EDITAR CARGO — {selected.isDefault ? '@TODOS' : (cur.name || '').toUpperCase()}</h3>
            </div>
            {!editable && <div className="pm-sync">🔒 Este cargo está no nível do seu cargo mais alto ou acima — só dá para ver.</div>}
            <nav className="pm-tabs">
              {tabs.map(([k, l]) => <button type="button" key={k} className={activeTab === k ? 'active' : ''} onClick={() => setTab(k)}>{l}</button>)}
            </nav>

            {activeTab === 'display' && (
              <div className="pm-pane">
                <label className="pm-field">
                  <span>NOME DO CARGO <b className="pm-req">*</b></span>
                  <input value={cur.name} maxLength={100} disabled={!editable} onChange={(e) => edit({ name: e.target.value })} />
                </label>

                <div className="pm-field">
                  <span>COR DO CARGO</span>
                  <p className="pm-row-desc">Os membros usam a cor do cargo mais alto que tiverem.</p>
                  <div className="pm-colors">
                    <button type="button" className={`pm-swatch big ${cur.color === DEFAULT_COLOR ? 'active' : ''}`} style={{ background: DEFAULT_COLOR }} onClick={() => edit({ color: DEFAULT_COLOR })} disabled={!editable} title="Padrão" />
                    <label className={`pm-swatch big custom ${!SWATCHES.includes(cur.color) && cur.color !== DEFAULT_COLOR && !gradient ? 'active' : ''}`} style={{ background: gradient ? cur.color : (SWATCHES.includes(cur.color) ? undefined : cur.color) }} title="Cor personalizada">
                      <input type="color" disabled={!editable} value={gradient ? gradientStops(cur.color)[0] : cur.color} onChange={(e) => edit({ color: gradient ? makeGradient(e.target.value, gradientStops(cur.color)[1]) : e.target.value })} />
                      <span>✎</span>
                    </label>
                    <div className="pm-swatch-grid">
                      {SWATCHES.map((c) => <button type="button" key={c} className={`pm-swatch ${cur.color === c ? 'active' : ''}`} style={{ background: c }} onClick={() => edit({ color: c })} disabled={!editable} aria-label={c} />)}
                    </div>
                  </div>
                  <div className="pm-row-head pm-gap">
                    <span className="pm-row-name">Degradê</span>
                    <Switch checked={gradient} disabled={!editable} label="Degradê" onChange={(on) => {
                      const [a, b] = gradientStops(cur.color);
                      edit({ color: on ? makeGradient(a, b) : a });
                    }} />
                  </div>
                  {gradient && (
                    <div className="pm-gradient">
                      <label>Início <input type="color" disabled={!editable} value={gradientStops(cur.color)[0]} onChange={(e) => edit({ color: makeGradient(e.target.value, gradientStops(cur.color)[1]) })} /></label>
                      <label>Fim <input type="color" disabled={!editable} value={gradientStops(cur.color)[1]} onChange={(e) => edit({ color: makeGradient(gradientStops(cur.color)[0], e.target.value) })} /></label>
                    </div>
                  )}
                  <div className="pm-preview">
                    <UserAvatar user={user} size={32} noDecoration />
                    <span className="pm-preview-name" style={gradient ? { backgroundImage: cur.color, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' } : { color: cur.color }}>{user?.displayName || user?.username}</span>
                    {selected.icon && (selected.icon.startsWith('/') ? <img src={selected.icon} alt="" className="pm-role-icon" /> : <span>{selected.icon}</span>)}
                    <span className="pm-dim">prévia</span>
                  </div>
                </div>

                <div className="pm-field">
                  <span>ÍCONE DO CARGO</span>
                  <p className="pm-row-desc">Um emoji ou uma imagem (PNG, GIF ou WebP). Aparece ao lado do nome do membro. Salva na hora.</p>
                  <div className="pm-icon-row">
                    <div className="pm-icon-box">{selected.icon ? (selected.icon.startsWith('/') ? <img src={selected.icon} alt="" /> : <span>{selected.icon}</span>) : <span className="pm-dim">—</span>}</div>
                    <input className="pm-emoji-in" key={`e-${selected.id}-${selected.icon}`} defaultValue={selected.icon?.startsWith('/') ? '' : (selected.icon || '')} maxLength={8} placeholder="emoji" disabled={!editable} onBlur={(e) => { if (e.target.value !== (selected.icon?.startsWith('/') ? '' : (selected.icon || ''))) setEmojiIcon(e.target.value); }} />
                    <label className={`btn-secondary ${!editable ? 'disabled' : ''}`}>
                      Enviar imagem
                      <input type="file" accept="image/png,image/gif,image/webp" hidden disabled={!editable} onChange={uploadIcon} />
                    </label>
                    {selected.icon && editable && <button type="button" className="btn-link danger" onClick={() => setEmojiIcon('')}>Remover ícone</button>}
                  </div>
                </div>

                <div className="pm-card">
                  <div className="pm-row-head">
                    <span className="pm-row-name">Exibir membros com este cargo separadamente dos membros online</span>
                    <Switch checked={cur.hoist} disabled={!editable} onChange={(v) => edit({ hoist: v })} label="Exibir separadamente" />
                  </div>
                </div>
                <div className="pm-card">
                  <div className="pm-row-head">
                    <span className="pm-row-name">Permitir que qualquer um @mencione este cargo</span>
                    <Switch checked={cur.mentionable} disabled={!editable} onChange={(v) => edit({ mentionable: v })} label="Permitir menção" />
                  </div>
                  <p className="pm-row-desc">Quem tem a permissão “Mencionar @everyone, @here e todos os cargos” sempre pode mencionar este cargo.</p>
                </div>

                {editable && (
                  <div className="pm-role-actions">
                    {canDuplicate && (
                      <button type="button" className="btn-secondary" onClick={duplicate} disabled={duplicating} title="Cria uma cópia com a mesma cor, ícone e permissões, logo abaixo deste cargo">
                        {duplicating ? 'Duplicando…' : 'Duplicar cargo'}
                      </button>
                    )}
                    <button type="button" className="btn-danger" onClick={remove}>Excluir cargo</button>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'perms' && (
              <div className="pm-pane">
                <div className="pm-perm-tools">
                  <SearchBox value={permSearch} onChange={setPermSearch} />
                  <button type="button" className="btn-link" disabled={!editable || bits(cur.permissions) === 0n} onClick={() => edit({ permissions: '0' })}>Limpar permissões</button>
                </div>
                {selected.isDefault && <p className="pm-hint">Estas são as permissões padrão de <b>todos</b> os membros da comunidade.</p>}
                <PermissionList
                  groups={ROLE_GROUPS}
                  search={permSearch}
                  renderControl={(k) => (
                    <Switch
                      checked={hasBit(cur.permissions, k)}
                      disabled={!editable || (!hasBit(cur.permissions, k) && !canGrant(k))}
                      onChange={(on) => togglePerm(k, on)}
                      label={k}
                    />
                  )}
                  warnFor={(k) => (!canGrant(k) && !hasBit(cur.permissions, k) ? 'Você não pode dar uma permissão que você mesmo não tem.' : null)}
                />
              </div>
            )}

            {activeTab === 'members' && (
              <div className="pm-pane">
                <div className="pm-perm-tools">
                  <SearchBox value={memberQuery} onChange={setMemberQuery} placeholder="Buscar membros" />
                  {editable && <button type="button" className="pm-btn-brand" onClick={() => setAdding(true)}>Adicionar membros</button>}
                </div>
                {adding && (
                  <div className="pm-add">
                    <SearchBox value={addQuery} onChange={setAddQuery} placeholder="Buscar membros para adicionar" />
                    <div className="pm-add-list">
                      {members.filter((m) => !m.roleIds?.includes(selected.id) && match(m, addQuery)).slice(0, 50).map((m) => (
                        <label key={m.user.id} className="pm-member">
                          <input type="checkbox" checked={addPicked.includes(m.user.id)} onChange={(e) => setAddPicked((p) => (e.target.checked ? [...p, m.user.id] : p.filter((x) => x !== m.user.id)))} />
                          <UserAvatar user={m.user} size={28} noDecoration />
                          <span>{nameOf(m)}</span>
                          {m.user.username && <span className="pm-dim">@{m.user.username}</span>}
                        </label>
                      ))}
                    </div>
                    <div className="pm-add-actions">
                      <button type="button" className="btn-link" onClick={() => { setAdding(false); setAddPicked([]); }}>Cancelar</button>
                      <button type="button" className="pm-btn-brand" disabled={!addPicked.length} onClick={confirmAdd}>Adicionar {addPicked.length || ''}</button>
                    </div>
                  </div>
                )}
                {roleMembers.length === 0 && !adding && <p className="pm-empty">Nenhum membro tem este cargo ainda.</p>}
                <ul className="pm-members">
                  {roleMembers.filter((m) => match(m, memberQuery)).map((m) => (
                    <li key={m.user.id} className="pm-member">
                      <UserAvatar user={m.user} size={28} noDecoration />
                      <span>{nameOf(m)}</span>
                      {m.user.username && <span className="pm-dim">@{m.user.username}</span>}
                      {editable && <button type="button" className="pm-icon-btn small" title="Remover membro" aria-label={`Remover ${nameOf(m)}`} onClick={() => setMemberRole(m.user.id, false)}>✕</button>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}
      </div>
      <SaveBar show={dirty} saving={saving} error={error} onReset={reset} onSave={save} />
      {!dirty && error && (
        <div className="pm-savebar error"><span>{error}</span><button type="button" className="btn-link" onClick={() => setError('')}>OK</button></div>
      )}
    </Modal>
  );
}
