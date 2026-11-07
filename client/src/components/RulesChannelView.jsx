import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { updateChannel } from '../api/endpoints';
import { useStore } from '../store/useStore';
import { getMyCommunityPermissions, hasPermission } from '../utils/permissions';
import { renderRichContent } from '../utils/richTextRender.jsx';
import rulesIcon from '../assets/icons/rules.png';

// Um canal RULES tem exatamente uma coisa dentro: o texto das regras
// (Channel.rulesContent) — não é um fluxo de mensagens. Somente leitura
// pra membros comuns; quem tem MANAGE_CHANNELS ganha um botão "Editar".
export default function RulesChannelView({ channel }) {
  const { user } = useAuth();
  const roles = useStore((s) => s.roles);
  const members = useStore((s) => s.members);
  const upsertChannel = useStore((s) => s.upsertChannel);
  const [editing, setEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState(channel.rulesTitle || '');
  const [draft, setDraft] = useState(channel.rulesContent || '');
  const [saving, setSaving] = useState(false);

  useEffect(() => { setDraft(channel.rulesContent || ''); setTitleDraft(channel.rulesTitle || ''); }, [channel.rulesContent, channel.rulesTitle]);

  const myPerms = getMyCommunityPermissions(roles, members, user.id, user.platformRole);
  const canEdit = hasPermission(myPerms, 'MANAGE_CHANNELS');
  const displayTitle = channel.rulesTitle || 'Regras da comunidade';

  const save = async () => {
    setSaving(true);
    try {
      const { channel: updated } = await updateChannel(channel.id, { rulesContent: draft, rulesTitle: titleDraft || null });
      upsertChannel(updated);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rules-channel-view">
      <div className="rules-channel-header">
        {editing ? (
          <input
            className="rules-title-input" value={titleDraft} maxLength={100}
            placeholder="Regras da comunidade"
            onChange={(e) => setTitleDraft(e.target.value)}
          />
        ) : (
          <h2><img className="ui-icon-lg" src={rulesIcon} alt="" /> {displayTitle}</h2>
        )}
        {canEdit && !editing && <button className="btn-secondary" onClick={() => setEditing(true)}>Editar regras</button>}
      </div>

      {editing ? (
        <div className="rules-editor">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={16}
            placeholder="1. Seja respeitoso com todos os membros.&#10;2. Sem spam ou divulgação não autorizada.&#10;3. ..."
          />
          <div className="modal-actions">
            <button className="btn-link" onClick={() => { setDraft(channel.rulesContent || ''); setTitleDraft(channel.rulesTitle || ''); setEditing(false); }}>Cancelar</button>
            <button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Salvando...' : 'Salvar regras'}</button>
          </div>
        </div>
      ) : channel.rulesContent ? (
        <div className="rules-content">{renderRichContent(channel.rulesContent)}</div>
      ) : (
        <div className="empty-hint">
          {canEdit ? 'Ainda não há regras definidas — clique em "Editar regras" para escrever as primeiras.' : 'A comunidade ainda não definiu regras.'}
        </div>
      )}
    </div>
  );
}
