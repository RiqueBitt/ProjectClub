import { useRef, useState } from 'react';
import Modal from '../Modal.jsx';
import { useStore } from '../../store/useStore';
import { getCommunity, createRole, updateRole, deleteRole, reorderRoles, uploadRoleIcon } from '../../api/endpoints';
import { PERMISSIONS, PERMISSION_LABELS } from '../../utils/permissions';
import { isGradientColor, gradientStops, makeGradient } from '../../utils/roleColor';
import { debounce } from '../../utils/debounce';

const GROUPS = [
  { label: 'GERAL', keys: ['ADMINISTRATOR', 'MANAGE_COMMUNITY', 'MANAGE_ROLES', 'MANAGE_CHANNELS', 'MANAGE_EMOJIS', 'KICK_MEMBERS', 'BAN_MEMBERS', 'MODERATE_MEMBERS', 'CHANGE_NICKNAME', 'MANAGE_NICKNAMES', 'VIEW_AUDIT_LOG'] },
  { label: 'TEXTO', keys: ['VIEW_CHANNEL', 'SEND_MESSAGES', 'MANAGE_MESSAGES', 'MENTION_EVERYONE', 'ATTACH_FILES', 'ADD_REACTIONS', 'USE_EXTERNAL_EMOJIS', 'CREATE_POLLS', 'CREATE_TOPICS', 'MANAGE_TOPICS'] },
  { label: 'VOZ', keys: ['CONNECT', 'SPEAK', 'VIDEO', 'MUTE_MEMBERS', 'DEAFEN_MEMBERS', 'MOVE_MEMBERS', 'USE_SOUNDBOARD'] },
];

// Editor de cargos da comunidade — refeito pra comunidade única (o
// original vinha do EmberCord multi-servidor e dependia de um objeto
// "server" que não existe mais aqui, além de um sistema de "impulsos"
// que também foi removido; esta versão usa o store global e as rotas
// reais de /community/roles).
export default function RoleManagerModal({ onClose }) {
  const roles = useStore((s) => s.roles);
  const setCommunityStructure = useStore((s) => s.setCommunityStructure);
  const [selectedId, setSelectedId] = useState(roles?.[0]?.id || null);
  const [dragId, setDragId] = useState(null);

  const sortedRoles = [...(roles || [])].sort((a, b) => b.position - a.position);
  const selected = sortedRoles.find((r) => r.id === selectedId) || sortedRoles[0];
  const selectedPerms = selected ? BigInt(selected.permissions || '0') : 0n;

  const refresh = async () => {
    const data = await getCommunity();
    setCommunityStructure({ roles: data.roles });
  };

  const addRole = async () => {
    const { role } = await createRole({ name: 'novo cargo' });
    await refresh();
    setSelectedId(role.id);
  };

  const patchRole = async (patch) => {
    if (!selected || (selected.isDefault && patch.name)) delete patch.name;
    await updateRole(selected.id, patch);
    await refresh();
  };

  const debouncedPatchColor = useRef(
    debounce((roleId, patch) => { updateRole(roleId, patch).then(refresh); }, 300),
  ).current;

  const togglePermission = (key) => {
    const bit = PERMISSIONS[key];
    if (!bit) return;
    const has = (selectedPerms & bit) !== 0n;
    const next = has ? selectedPerms & ~bit : selectedPerms | bit;
    updateRole(selected.id, { permissionsBits: next.toString() }).then(refresh);
  };

  const removeRole = async () => {
    if (!confirm(`Excluir o cargo "${selected.name}"?`)) return;
    await deleteRole(selected.id);
    setSelectedId(null);
    await refresh();
  };

  const uploadIcon = async (e) => {
    const file = e.target.files[0];
    if (!file || !selected) return;
    await uploadRoleIcon(selected.id, file);
    await refresh();
  };

  const onDrop = async (targetId) => {
    if (!dragId || dragId === targetId) return;
    const nonDefault = sortedRoles.filter((r) => !r.isDefault);
    const from = nonDefault.findIndex((r) => r.id === dragId);
    const to = nonDefault.findIndex((r) => r.id === targetId);
    if (from < 0 || to < 0) return;
    const reordered = [...nonDefault];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved);
    await reorderRoles(reordered.map((r) => r.id));
    setDragId(null);
    await refresh();
  };

  return (
    <Modal title="Cargos da comunidade" onClose={onClose} width="840px">
      <div className="role-manager">
        <div className="role-list-col">
          <button className="btn-secondary" onClick={addRole}>+ Criar cargo</button>
          <ul className="role-list">
            {sortedRoles.map((r) => (
              <li
                key={r.id}
                draggable={!r.isDefault}
                onDragStart={() => setDragId(r.id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => onDrop(r.id)}
                className={`role-list-item ${selected?.id === r.id ? 'active' : ''}`}
                onClick={() => setSelectedId(r.id)}
              >
                <span className="role-dot" style={{ background: r.color }} />
                {r.icon && (r.icon.startsWith('/') ? <img src={r.icon} alt="" className="role-icon-preview" /> : <span>{r.icon}</span>)}
                <span className="truncate">{r.isDefault ? '@todos' : r.name}</span>
              </li>
            ))}
          </ul>
        </div>

        {selected && (
          <div className="role-edit-col">
            <label>
              NOME DO CARGO
              <input
                defaultValue={selected.isDefault ? '@todos' : selected.name}
                disabled={selected.isDefault}
                onBlur={(e) => patchRole({ name: e.target.value })}
                key={selected.id}
              />
            </label>
            <div className="role-color-row">
              <div className="role-color-pickers">
                {isGradientColor(selected.color) ? (
                  <>
                    <label>
                      COR (INÍCIO)
                      <input
                        type="color"
                        defaultValue={gradientStops(selected.color)[0]}
                        onChange={(e) => debouncedPatchColor(selected.id, { color: makeGradient(e.target.value, gradientStops(selected.color)[1]) })}
                        key={`cg1-${selected.id}`}
                      />
                    </label>
                    <label>
                      COR (FIM)
                      <input
                        type="color"
                        defaultValue={gradientStops(selected.color)[1]}
                        onChange={(e) => debouncedPatchColor(selected.id, { color: makeGradient(gradientStops(selected.color)[0], e.target.value) })}
                        key={`cg2-${selected.id}`}
                      />
                    </label>
                  </>
                ) : (
                  <label>
                    COR
                    <input type="color" defaultValue={selected.color || '#99AAB5'} onChange={(e) => debouncedPatchColor(selected.id, { color: e.target.value })} key={`c-${selected.id}`} />
                  </label>
                )}
                <label className="checkbox-row role-gradient-toggle">
                  <input
                    type="checkbox"
                    checked={isGradientColor(selected.color)}
                    onChange={(e) => {
                      const [a, b] = gradientStops(selected.color);
                      patchRole({ color: e.target.checked ? makeGradient(a, b) : a });
                    }}
                    key={`gt-${selected.id}`}
                  />
                  Degradê
                </label>
              </div>
              <div className="role-icon-pickers">
                <label>
                  ÍCONE (emoji)
                  <input defaultValue={selected.icon?.startsWith('/') ? '' : (selected.icon || '')} maxLength={4} onBlur={(e) => patchRole({ icon: e.target.value })} key={`i-${selected.id}`} />
                </label>
                <label className="btn-secondary role-icon-upload">
                  {selected.icon?.startsWith('/') ? <img src={selected.icon} alt="" className="role-icon-preview" /> : 'Enviar PNG'}
                  <input type="file" accept="image/png,image/gif,image/webp" hidden onChange={uploadIcon} key={`u-${selected.id}`} />
                </label>
              </div>
            </div>
            <label className="checkbox-row">
              <input type="checkbox" defaultChecked={selected.hoist} onChange={(e) => patchRole({ hoist: e.target.checked })} key={`h-${selected.id}`} />
              Exibir separadamente na lista de membros
            </label>
            <label className="checkbox-row">
              <input type="checkbox" defaultChecked={selected.mentionable} onChange={(e) => patchRole({ mentionable: e.target.checked })} key={`m-${selected.id}`} />
              Permitir menção a este cargo
            </label>

            <h3>Permissões</h3>
            {GROUPS.map((g) => (
              <div key={g.label} className="permission-group">
                <div className="permission-group-label">{g.label}</div>
                {g.keys.filter((key) => PERMISSIONS[key] !== undefined).map((key) => (
                  <label key={key} className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={(selectedPerms & PERMISSIONS[key]) !== 0n}
                      onChange={() => togglePermission(key)}
                    />
                    {PERMISSION_LABELS[key]}
                  </label>
                ))}
              </div>
            ))}

            {!selected.isDefault && (
              <button className="btn-danger" onClick={removeRole}>Excluir cargo</button>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
