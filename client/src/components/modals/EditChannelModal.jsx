import { useEffect, useState } from 'react';
import Modal from '../Modal.jsx';
import { useStore } from '../../store/useStore';
import {
  updateChannel, deleteChannel, listChannelOverwrites, setChannelOverwrite, deleteChannelOverwrite,
} from '../../api/endpoints';
import { PERMISSION_LABELS } from '../../utils/permissions';
import personIcon from '../../assets/icons/person.png';
import selectedIcon from '../../assets/icons/selected.png';
import ChannelTypePicker from '../ChannelTypePicker.jsx';

const TYPES = ['TEXT', 'VOICE', 'ANNOUNCEMENT', 'STAGE'];

// Kept in sync with SLOW_MODE_SECONDS_OPTIONS in
// server/src/controllers/channelController.js.
const SLOW_MODE_OPTIONS = [
  { label: 'Desativado', value: '' },
  { label: '5 segundos', value: 5 },
  { label: '10 segundos', value: 10 },
  { label: '15 segundos', value: 15 },
  { label: '30 segundos', value: 30 },
  { label: '1 minuto', value: 60 },
  { label: '2 minutos', value: 120 },
  { label: '5 minutos', value: 300 },
  { label: '10 minutos', value: 600 },
  { label: '15 minutos', value: 900 },
  { label: '30 minutos', value: 1800 },
  { label: '1 hora', value: 3600 },
  { label: '2 horas', value: 7200 },
  { label: '6 horas', value: 21600 },
];

const OVERWRITE_KEYS = ['VIEW_CHANNEL', 'SEND_MESSAGES', 'MANAGE_MESSAGES', 'MENTION_EVERYONE', 'ATTACH_FILES', 'ADD_REACTIONS', 'CONNECT', 'SPEAK', 'VIDEO'];

export default function EditChannelModal({ channel, onClose, onDeleted }) {
  const roles = useStore((s) => s.roles);
  const members = useStore((s) => s.members);
  const [name, setName] = useState(channel.name);
  const [topic, setTopic] = useState(channel.topic || '');
  const [type, setType] = useState(channel.type);
  const [isPrivate, setIsPrivate] = useState(!!channel.isPrivate);
  const [userLimit, setUserLimit] = useState(channel.userLimit ?? '');
  const [slowModeSeconds, setSlowModeSeconds] = useState(channel.slowModeSeconds ?? '');
  const [overwrites, setOverwrites] = useState([]);
  const [newTargetType, setNewTargetType] = useState('ROLE');
  const [newTargetId, setNewTargetId] = useState('');
  // Tri-state per permission: absent = neutral, 'allow', or 'deny' — click
  // cycles through the three, mirrors Discord's own channel permission
  // editor instead of two separate allow/deny checkbox lists.
  const [newPerms, setNewPerms] = useState({});
  const isVoiceLike = type === 'VOICE' || type === 'STAGE';

  const loadOverwrites = async () => {
    const { overwrites } = await listChannelOverwrites(channel.id);
    setOverwrites(overwrites);
  };

  useEffect(() => { loadOverwrites(); }, [channel.id]);

  const save = async () => {
    await updateChannel(channel.id, {
      name, topic, type, isPrivate,
      userLimit: isVoiceLike ? userLimit : undefined,
      slowModeSeconds: !isVoiceLike ? (slowModeSeconds || null) : undefined,
    });
    onClose();
  };

  const remove = async () => {
    if (!confirm('Excluir este canal?')) return;
    await deleteChannel(channel.id);
    onDeleted?.();
    onClose();
  };

  const removeOverwrite = async (id) => {
    await deleteChannelOverwrite(channel.id, id);
    loadOverwrites();
  };

  // Loads an existing overwrite row back into the add/edit form — since
  // setChannelOverwrite upserts by (targetType, targetId), "edit" and "add"
  // are the same call, this just pre-fills it.
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
    await setChannelOverwrite(channel.id, { targetType: newTargetType, targetId: newTargetId, allow, deny });
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
    if (targetType === 'ROLE') return roles.find((r) => r.id === targetId)?.name || targetId;
    return members.find((m) => m.user.id === targetId)?.user.displayName || targetId;
  };

  return (
    <Modal title={`Editar canal — ${channel.name}`} onClose={onClose} width="640px">
      <div className="settings-grid">
        <label>
          NOME DO CANAL
          <input value={name} onChange={(e) => setName(e.target.value.toLowerCase().replace(/\s+/g, '-'))} />
        </label>
        <label>
          DESCRIÇÃO
          <textarea value={topic} onChange={(e) => setTopic(e.target.value.slice(0, 500))} maxLength={500} rows={3} placeholder="Do que se trata este canal?" />
          <span className="dim char-count">{topic.length}/500</span>
        </label>
        <label>
          TIPO
          <ChannelTypePicker types={TYPES} value={type} onChange={setType} />
        </label>
        {isVoiceLike && (
          <label>
            LIMITE DE USUÁRIOS (0 = sem limite)
            <input
              type="number" min="0" max="99" value={userLimit}
              onChange={(e) => setUserLimit(e.target.value)}
              placeholder="Sem limite"
            />
          </label>
        )}
        {!isVoiceLike && (
          <label>
            MODO LENTO
            <select value={slowModeSeconds} onChange={(e) => setSlowModeSeconds(e.target.value)}>
              {SLOW_MODE_OPTIONS.map((o) => <option key={o.label} value={o.value}>{o.label}</option>)}
            </select>
            <span className="dim">Cada pessoa só pode mandar uma mensagem por vez, esperando esse tempo entre uma e outra. Quem tem permissão de gerenciar mensagens não é afetado.</span>
          </label>
        )}
        <label className="checkbox-row">
          <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
          Canal privado (esconde de @everyone — quem precisa de acesso ainda pode ser adicionado abaixo)
        </label>
        <button className="btn-primary" onClick={save}>Salvar alterações</button>

        <hr />
        <h3>Permissões de cargos e membros</h3>
        <p className="dim">
          Um canal sem nenhuma permissão própria herda as permissões da categoria em que está.
          As permissões definidas aqui têm prioridade sobre as da categoria.
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
              ? roles.filter((r) => !r.isDefault).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)
              : members.map((m) => <option key={m.user.id} value={m.user.id}>{m.user.displayName}</option>)}
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
        <button className="btn-danger" onClick={remove}>Excluir canal</button>
      </div>
    </Modal>
  );
}

// allow/deny come back from the API as decimal-string bitfields — reuses
// the exact same bit layout as utils/permissions.js but only needs a plain
// "is this one bit set" check, so it's kept tiny and local instead of
// importing the full permission engine just for this.
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
