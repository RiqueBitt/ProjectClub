import { useRef, useState } from 'react';
import Modal from '../Modal.jsx';
import { useStore } from '../../store/useStore';
import { createRole, updateRole, deleteRole, reorderRoles, uploadRoleIcon } from '../../api/endpoints';
import { PERMISSIONS, PERMISSION_LABELS } from '../../utils/permissions';
import { isGradientColor, gradientStops, makeGradient } from '../../utils/roleColor';
import { debounce } from '../../utils/debounce';

const GROUPS = [
  { label: 'GERAL', keys: ['ADMINISTRATOR', 'MANAGE_COMMUNITY', 'MANAGE_ROLES', 'MANAGE_CHANNELS', 'MANAGE_EMOJIS', 'MANAGE_STICKERS', 'MANAGE_CLAN_ICONS', 'KICK_MEMBERS', 'BAN_MEMBERS', 'MODERATE_MEMBERS', 'CHANGE_NICKNAME', 'MANAGE_NICKNAMES', 'VIEW_AUDIT_LOG'] },
  { label: 'TEXTO', keys: ['VIEW_CHANNEL', 'SEND_MESSAGES', 'MANAGE_MESSAGES', 'MENTION_EVERYONE', 'ATTACH_FILES', 'ADD_REACTIONS', 'USE_EXTERNAL_EMOJIS', 'CREATE_POLLS', 'CREATE_TOPICS', 'MANAGE_TOPICS'] },
  { label: 'VOZ', keys: ['CONNECT', 'SPEAK', 'VIDEO', 'MUTE_MEMBERS', 'DEAFEN_MEMBERS', 'MOVE_MEMBERS', 'USE_SOUNDBOARD'] },
];

// Editor de cargos da comunidade — refeito pra comunidade única (o
// original vinha do EmberCord multi-servidor e dependia de um objeto
// "server" que não existe mais aqui, além de um sistema de "impulsos"
// que também foi removido; esta versão usa o store global e as rotas
// reais de /community/roles).
//
// BUG CORRIGIDO ("editar/criar cargo tem delay"): a versão anterior, a
// cada mudança (até marcar uma única permissão), fazia DUAS chamadas de
// rede em sequência — salvar a mudança, DEPOIS buscar a comunidade
// INTEIRA de novo (categorias+canais+membros+cargos) só pra atualizar a
// tela. Pior: o aviso de socket que já chega quando o servidor confirma
// a mudança TAMBÉM disparava essa mesma busca pesada por conta própria
// (ver SocketContext.jsx) — ou seja, cada clique podia estar
// recarregando tudo duas vezes. Agora usa o cargo que a própria resposta
// da API já devolve pronto (upsertRole no estado local), sem buscar
// nada a mais — a tela responde na hora.
export default function RoleManagerModal({ onClose }) {
  const roles = useStore((s) => s.roles);
  const upsertRole = useStore((s) => s.upsertRole);
  const removeRoleFromStore = useStore((s) => s.removeRole);
  const [selectedId, setSelectedId] = useState(roles?.[0]?.id || null);
  const [dragId, setDragId] = useState(null);
  const [savingField, setSavingField] = useState(null);

  const sortedRoles = [...(roles || [])].sort((a, b) => b.position - a.position);
  const selected = sortedRoles.find((r) => r.id === selectedId) || sortedRoles[0];
  const selectedPerms = selected ? BigInt(selected.permissions || '0') : 0n;

  const addRole = async () => {
    const { role } = await createRole({ name: 'novo cargo' });
    upsertRole(role);
    setSelectedId(role.id);
  };

  // Aplica a mudança de verdade — chama a API e, assim que a resposta
  // chega (já com o cargo pronto), atualiza só ESSE cargo no estado
  // local. field é só pra mostrar "Salvando..." no campo certo enquanto
  // isso roda.
  const patchRole = async (patch, field) => {
    if (!selected || (selected.isDefault && patch.name)) delete patch.name;
    if (field) setSavingField(field);
    try {
      const { role } = await updateRole(selected.id, patch);
      upsertRole(role);
    } finally {
      if (field) setSavingField((f) => (f === field ? null : f));
    }
  };

  const debouncedPatchColor = useRef(
    debounce((roleId, patch) => { updateRole(roleId, patch).then(({ role }) => upsertRole(role)); }, 300),
  ).current;

  const togglePermission = (key) => {
    const bit = PERMISSIONS[key];
    if (!bit) return;
    const has = (selectedPerms & bit) !== 0n;
    const next = has ? selectedPerms & ~bit : selectedPerms | bit;
    updateRole(selected.id, { permissionsBits: next.toString() }).then(({ role }) => upsertRole(role));
  };

  const removeRole = async () => {
    if (!confirm(`Excluir o cargo "${selected.name}"?`)) return;
    await deleteRole(selected.id);
    removeRoleFromStore(selected.id);
    setSelectedId(null);
  };

  const uploadIcon = async (e) => {
    const file = e.target.files[0];
    if (!file || !selected) return;
    setSavingField('icon');
    try {
      const { role } = await uploadRoleIcon(selected.id, file);
      upsertRole(role);
    } finally {
      setSavingField((f) => (f === 'icon' ? null : f));
    }
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
    // Reordenar afeta a posição de VÁRIOS cargos de uma vez — o
    // servidor só devolve a nova ordem de IDs (ver role:reorder no
    // socket), então aqui sim vale reconstruir a posição de cada um
    // localmente, na hora, em vez de esperar um recarregamento.
    reordered.forEach((r, i) => upsertRole({ ...r, position: reordered.length - i }));
    setDragId(null);
    await reorderRoles(reordered.map((r) => r.id));
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
                onBlur={(e) => patchRole({ name: e.target.value }, 'name')}
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
              {/* Item pedido: "melhore, tá meio confuso" — emoji e PNG
                  são DUAS formas alternativas do MESMO ícone (só uma
                  vale por vez, escolher uma substitui a outra), mas
                  antes ficavam lado a lado sem deixar isso claro. Agora
                  tem um rótulo "ou" entre eles, e uma prévia clara de
                  qual dos dois está valendo agora. */}
              <div className="role-icon-pickers">
                <span className="role-icon-pickers-label">ÍCONE DO CARGO</span>
                <div className="role-icon-pickers-row">
                  <input
                    defaultValue={selected.icon?.startsWith('/') ? '' : (selected.icon || '')}
                    maxLength={4}
                    placeholder="emoji"
                    onBlur={(e) => patchRole({ icon: e.target.value }, 'icon')}
                    key={`i-${selected.id}`}
                  />
                  <span className="role-icon-or">ou</span>
                  <label className="btn-secondary role-icon-upload">
                    {selected.icon?.startsWith('/') ? <img src={selected.icon} alt="" className="role-icon-preview" /> : 'Enviar imagem'}
                    <input type="file" accept="image/png,image/gif,image/webp" hidden onChange={uploadIcon} key={`u-${selected.id}`} />
                  </label>
                  {/* Item pedido: "adicione poder remover o ícone do
                      cargo PNG" — antes só dava pra ENVIAR uma imagem
                      nova (que substituía a anterior), sem nenhum jeito
                      de voltar a não ter ícone nenhum. */}
                  {selected.icon?.startsWith('/') && (
                    <button
                      type="button"
                      className="role-icon-remove"
                      title="Remover ícone"
                      onClick={() => patchRole({ icon: '' }, 'icon')}
                    >
                      ✕
                    </button>
                  )}
                </div>
                {savingField === 'icon' && <span className="role-field-saving">Salvando...</span>}
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
