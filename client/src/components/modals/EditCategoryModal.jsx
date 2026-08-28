import { useEffect, useState } from 'react';
import Modal from '../Modal.jsx';
import {
  updateCategory, deleteCategory, listCategoryOverwrites, setCategoryOverwrite, deleteCategoryOverwrite,
} from '../../api/endpoints';
import { PERMISSION_LABELS } from '../../utils/permissions';
import personIcon from '../../assets/icons/person.png';
import selectedIcon from '../../assets/icons/selected.png';

const OVERWRITE_KEYS = ['VIEW_CHANNEL', 'SEND_MESSAGES', 'MANAGE_MESSAGES', 'MENTION_EVERYONE', 'ATTACH_FILES', 'ADD_REACTIONS', 'CONNECT', 'SPEAK', 'VIDEO'];

// Same shape/behavior as EditChannelModal.jsx's permissions section — see
// its comments for the tri-state (neutral/allow/deny) rationale. Any
// channel inside this category that doesn't define its own overwrite for a
// given role/member inherits whatever is set here (see
// server/src/services/permissions.js's applyOverwrites: category layer is
// applied first, then the channel's own overwrites on top of it).
export default function EditCategoryModal({ server, category, onClose, onDeleted }) {
  const [name, setName] = useState(category.name);
  const [overwrites, setOverwrites] = useState([]);
  const [newTargetType, setNewTargetType] = useState('ROLE');
  const [newTargetId, setNewTargetId] = useState('');
  const [newPerms, setNewPerms] = useState({});

  const loadOverwrites = async () => {
    const { overwrites } = await listCategoryOverwrites(server.id, category.id);
    setOverwrites(overwrites);
  };

  useEffect(() => { loadOverwrites(); }, [category.id]);

  const save = async () => {
    await updateCategory(server.id, category.id, name);
    onClose();
  };

  const remove = async () => {
    if (!confirm('Excluir esta categoria? Os canais dentro dela não serão excluídos.')) return;
    await deleteCategory(server.id, category.id);
    onDeleted?.();
    onClose();
  };

  const removeOverwrite = async (id) => {
    await deleteCategoryOverwrite(server.id, category.id, id);
    loadOverwrites();
  };

  const editOverwrite = (o) => {
    setNewTargetType(o.targetType);
    setNewTargetId(o.targetId);
    const perms = {};
    OVERWRITE_KEYS.forEach((key) => {
      if (permHasKey(o.allow, key)) perms[key] = 'allow';
      else if (permHasKey(o.deny, key)) perms[key] = 'deny';
    });
    setNewPerms(perms);
  };

  const addOverwrite = async () => {
    if (!newTargetId) return;
    const allow = Object.keys(newPerms).filter((k) => newPerms[k] === 'allow');
    const deny = Object.keys(newPerms).filter((k) => newPerms[k] === 'deny');
    await setCategoryOverwrite(server.id, category.id, { targetType: newTargetType, targetId: newTargetId, allow, deny });
    setNewTargetId('');
    setNewPerms({});
    loadOverwrites();
  };

  const cyclePerm = (key) => {
    setNewPerms((prev) => {
      const cur = prev[key];
      const next = { ...prev };
      if (!cur) next[key] = 'allow';
      else if (cur === 'allow') next[key] = 'deny';
      else delete next[key];
      return next;
    });
  };

  const targetLabel = (targetType, targetId) => {
    if (targetType === 'ROLE') return server.roles.find((r) => r.id === targetId)?.name || targetId;
    return server.members.find((m) => m.user.id === targetId)?.user.displayName || targetId;
  };

  return (
    <Modal title={`Editar categoria — ${category.name}`} onClose={onClose} width="640px">
      <div className="settings-grid">
        <label>
          NOME DA CATEGORIA
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <button className="btn-primary" onClick={save}>Salvar alterações</button>

        <hr />
        <h3>Permissões de cargos e membros</h3>
        <p className="dim">
          Todo canal dentro desta categoria que não tiver permissões próprias herda as
          definidas aqui automaticamente.
        </p>
        {overwrites.length > 0 && (
          <ul className="settings-member-list channel-overwrite-list">
            {overwrites.map((o) => (
              <li key={o.id} className="channel-overwrite-row">
                <button type="button" className="channel-overwrite-target" onClick={() => editOverwrite(o)}>
                  {o.targetType === 'ROLE' ? '🏷️' : <img className="ui-icon-sm" src={personIcon} alt="" />} {targetLabel(o.targetType, o.targetId)}
                </button>
                <span className="channel-overwrite-summary">
                  {permKeys(o.allow).map((k) => <span key={`a-${k}`} className="perm-pill allow" title={PERMISSION_LABELS[k]}>{PERMISSION_LABELS[k]}</span>)}
                  {permKeys(o.deny).map((k) => <span key={`d-${k}`} className="perm-pill deny" title={PERMISSION_LABELS[k]}>{PERMISSION_LABELS[k]}</span>)}
                </span>
                <button className="btn-link danger" onClick={() => removeOverwrite(o.id)}>Remover</button>
              </li>
            ))}
          </ul>
        )}
        <div className="settings-member-roles">
          <select value={newTargetType} onChange={(e) => { setNewTargetType(e.target.value); setNewTargetId(''); }}>
            <option value="ROLE">Cargo</option>
            <option value="MEMBER">Membro</option>
          </select>
          <select value={newTargetId} onChange={(e) => setNewTargetId(e.target.value)}>
            <option value="">Selecione...</option>
            {newTargetType === 'ROLE'
              ? server.roles.filter((r) => !r.isDefault).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)
              : server.members.map((m) => <option key={m.user.id} value={m.user.id}>{m.user.displayName}</option>)}
          </select>
          <button className="btn-secondary" onClick={addOverwrite}>Salvar permissão</button>
        </div>
        <div className="permission-group tri-state">
          {OVERWRITE_KEYS.map((key) => (
            <button
              type="button"
              key={key}
              className={`perm-toggle ${newPerms[key] || 'neutral'}`}
              onClick={() => cyclePerm(key)}
              title="Clique para alternar: neutro → permitir → negar"
            >
              {newPerms[key] === 'allow' ? <img className="ui-icon-sm" src={selectedIcon} alt="" /> : newPerms[key] === 'deny' ? '🚫' : '·'} {PERMISSION_LABELS[key]}
            </button>
          ))}
        </div>

        <hr />
        <button className="btn-danger" onClick={remove}>Excluir categoria</button>
      </div>
    </Modal>
  );
}

const BIT_INDEX = {
  VIEW_CHANNEL: 0, SEND_MESSAGES: 1, MANAGE_MESSAGES: 2, MANAGE_CHANNELS: 3, MANAGE_ROLES: 4,
  MANAGE_SERVER: 5, KICK_MEMBERS: 6, BAN_MEMBERS: 7, CREATE_INVITE: 8, CHANGE_NICKNAME: 9,
  MENTION_EVERYONE: 10, ATTACH_FILES: 11, ADD_REACTIONS: 12, CONNECT: 13, SPEAK: 14, VIDEO: 15,
  MUTE_MEMBERS: 16, DEAFEN_MEMBERS: 17, MOVE_MEMBERS: 18, ADMINISTRATOR: 19, MODERATE_MEMBERS: 20,
  MANAGE_EMOJIS: 21, MANAGE_INVITES: 22, USE_EXTERNAL_EMOJIS: 23, CREATE_POLLS: 24, CREATE_TOPICS: 25,
};

function permHasKey(bitsString, key) {
  try { return (BigInt(bitsString || '0') & (1n << BigInt(BIT_INDEX[key]))) !== 0n; } catch { return false; }
}

function permKeys(bitsString) {
  return OVERWRITE_KEYS.filter((k) => permHasKey(bitsString, k));
}
