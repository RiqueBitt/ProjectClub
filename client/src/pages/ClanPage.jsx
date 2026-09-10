import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useVoice } from '../context/VoiceContext.jsx';
import { useStore } from '../store/useStore';
import {
  getMyClan, updateClan, leaveClan, transferClanOwnership, setClanMemberRole, kickClanMember,
  respondClanJoinRequest, createClanTag, deleteClanTag, setMyClanTag,
  listClanMessages, sendClanMessage, deleteClanMessage, listClanIcons,
} from '../api/endpoints';
import { proxyImage } from '../utils/imageProxy';
import ClanIcon from '../components/ClanIcon.jsx';
import { usePromptDialog } from '../utils/usePromptDialog.jsx';
import { formatTimeOnly } from '../utils/formatTime';

const ROLE_LABEL = { OWNER: 'Dono', SUB_OWNER: 'Sub-Dono', ADMIN: 'Admin', MODERATOR: 'Moderador', MEMBER: 'Membro' };
const ROLE_ORDER = ['OWNER', 'SUB_OWNER', 'ADMIN', 'MODERATOR', 'MEMBER'];
const TABS = [
  { key: 'chat', label: '💬 Chat' },
  { key: 'members', label: '👥 Membros' },
  { key: 'tags', label: '🏷️ Tags' },
  { key: 'settings', label: '⚙️ Configurações' },
];

// Item pedido: "Dentro do clan, o usuário deverá visualizar uma área
// de gerenciamento de acordo com seu cargo... usuários comuns devem
// visualizar apenas as funções permitidas pelo cargo Membro." — as
// abas de gestão (Membros com ações, Tags criar/editar, Configurações)
// mostram só o que o cargo da pessoa permite; todo mundo vê o chat e
// a lista de membros, só não vê botão de ação que não pode usar.
export default function ClanPage() {
  const navigate = useNavigate();
  const { user, setUser } = useAuth();
  const voice = useVoice();
  const myClan = useStore((s) => s.myClan);
  const myClanRole = useStore((s) => s.myClanRole);
  const myClanCapabilities = useStore((s) => s.myClanCapabilities);
  const myClanPendingRequests = useStore((s) => s.myClanPendingRequests);
  const setMyClan = useStore((s) => s.setMyClan);
  const { confirmAsync, DialogElement } = usePromptDialog();
  const [tab, setTab] = useState('chat');
  const [messages, setMessages] = useState([]);
  const [content, setContent] = useState('');
  const [icons, setIcons] = useState([]);
  const [settingsForm, setSettingsForm] = useState(null);
  const [newTag, setNewTag] = useState('');
  const [tagError, setTagError] = useState('');
  const messagesEndRef = useRef(null);
  const inVoice = voice.call?.channelId === `clan:${myClan?.id}`;

  const refreshMyClan = () => getMyClan().then((d) => setMyClan(d));

  useEffect(() => {
    if (!myClan) { navigate('/clans'); return; }
    listClanMessages(myClan.id).then((d) => setMessages(d.messages));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myClan?.id]);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ block: 'end' }); }, [messages.length]);

  useEffect(() => {
    if (!myClan) return;
    setSettingsForm({ name: myClan.name, description: myClan.description || '', isPublic: myClan.isPublic, iconId: myClan.icon?.id || '', iconColor: myClan.iconColor });
    if (myClanCapabilities.EDIT_CLAN) listClanIcons().then((d) => setIcons(d.icons)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myClan?.id]);

  if (!myClan || !settingsForm) return null;

  const sendMsg = async (e) => {
    e.preventDefault();
    const trimmed = content.trim();
    if (!trimmed) return;
    setContent('');
    try {
      const { message } = await sendClanMessage(myClan.id, trimmed);
      setMessages((m) => [...m, message]);
    } catch (err) {
      useStore.getState().pushNotice(err?.response?.data?.error || 'Não foi possível enviar a mensagem.');
    }
  };

  const removeMsg = async (msg) => {
    if (!(await confirmAsync('Apagar esta mensagem?'))) return;
    await deleteClanMessage(myClan.id, msg.id).catch(() => {});
    setMessages((m) => m.filter((x) => x.id !== msg.id));
  };

  const toggleVoice = () => {
    if (inVoice) voice.leaveChannel();
    else voice.joinChannel(null, `clan:${myClan.id}`, myClan.name, 'VOICE');
  };

  const onLeaveClan = async () => {
    if (!(await confirmAsync(myClanRole === 'OWNER' ? 'Sair do clã? Se houver outros membros, você precisa transferir a propriedade primeiro.' : 'Sair do clã?'))) return;
    try {
      await leaveClan();
      setMyClan({ clan: null });
      navigate('/clans');
    } catch (err) {
      useStore.getState().pushNotice(err?.response?.data?.error || 'Não foi possível sair do clã.');
    }
  };

  const onChangeRole = async (member, role) => {
    try {
      await setClanMemberRole(myClan.id, member.id, role);
      await refreshMyClan();
    } catch (err) {
      useStore.getState().pushNotice(err?.response?.data?.error || 'Não foi possível mudar o cargo.');
    }
  };

  const onKick = async (member) => {
    if (!(await confirmAsync(`Expulsar ${member.displayName} do clã?`))) return;
    try {
      await kickClanMember(myClan.id, member.id);
      await refreshMyClan();
    } catch (err) {
      useStore.getState().pushNotice(err?.response?.data?.error || 'Não foi possível expulsar esse membro.');
    }
  };

  const onTransfer = async (member) => {
    if (!(await confirmAsync(`Transferir a propriedade do clã pra ${member.displayName}? Você vira Sub-Dono.`))) return;
    try {
      await transferClanOwnership(myClan.id, member.id);
      await refreshMyClan();
    } catch (err) {
      useStore.getState().pushNotice(err?.response?.data?.error || 'Não foi possível transferir a propriedade.');
    }
  };

  const onRespondRequest = async (request, approve) => {
    try {
      await respondClanJoinRequest(myClan.id, request.id, approve);
      await refreshMyClan();
    } catch (err) {
      useStore.getState().pushNotice(err?.response?.data?.error || 'Não foi possível responder à solicitação.');
    }
  };

  const onCreateTag = async () => {
    setTagError('');
    try {
      await createClanTag(myClan.id, newTag);
      setNewTag('');
      await refreshMyClan();
    } catch (err) {
      setTagError(err?.response?.data?.error || 'Não foi possível criar a tag.');
    }
  };

  const onDeleteTag = async (tag) => {
    if (!(await confirmAsync(`Excluir a tag "${tag.tag}"?`))) return;
    await deleteClanTag(myClan.id, tag.id).catch(() => {});
    await refreshMyClan();
  };

  const onPickMyTag = async (tagId) => {
    try {
      const { clanTagId, clanTag } = await setMyClanTag(tagId || null);
      // BUG CORRIGIDO ("clico em mostrar tag, não acontece nada"): a
      // chamada em si já funcionava, mas nada na tela refletia isso
      // depois — o checkbox lê user.clanTagId direto do estado da
      // sessão (AuthContext), que precisa ser atualizado manualmente
      // aqui; ele não se atualiza sozinho só porque uma chamada de
      // API qualquer teve sucesso em algum lugar da tela.
      setUser({ ...user, clanTagId, clanTag });
    } catch (err) {
      useStore.getState().pushNotice(err?.response?.data?.error || 'Não foi possível atualizar sua tag.');
    }
  };

  const onSaveSettings = async () => {
    try {
      await updateClan(myClan.id, {
        name: settingsForm.name.trim(), description: settingsForm.description.trim() || null,
        isPublic: settingsForm.isPublic, iconId: settingsForm.iconId || null, iconColor: settingsForm.iconColor,
      });
      await refreshMyClan();
      useStore.getState().pushNotice('Clã atualizado.');
    } catch (err) {
      useStore.getState().pushNotice(err?.response?.data?.error || 'Não foi possível salvar.');
    }
  };

  // Cargos que a pessoa atual pode atribuir — mesma regra do backend
  // (nunca no seu próprio nível ou acima), refletida aqui só pra não
  // mostrar opção que o servidor rejeitaria de qualquer forma.
  const myLevel = ROLE_ORDER.indexOf(myClanRole);
  const assignableRoles = ROLE_ORDER.filter((r) => r !== 'OWNER' && ROLE_ORDER.indexOf(r) > myLevel);

  return (
    <div className="clan-page">
      {DialogElement}
      <div className="clan-page-header">
        <button className="btn-secondary clan-back-btn" onClick={() => navigate('/clans')}>← Clãs</button>
        <div className="clan-icon-preview clan-page-icon">
          <ClanIcon icon={myClan.icon} color={myClan.iconColor} />
        </div>
        <div>
          <h1>{myClan.name}</h1>
          <div className="dim">{ROLE_LABEL[myClanRole]} · {myClan.memberCount} membro{myClan.memberCount === 1 ? '' : 's'}</div>
        </div>
        <button className={`btn-secondary clan-voice-btn ${inVoice ? 'active' : ''}`} onClick={toggleVoice}>
          {inVoice ? '🔇 Sair da voz' : '🎙️ Entrar na voz'}
        </button>
      </div>

      <div className="clan-tabs">
        {/* Item pedido: "não mostre as tags pros usuários ainda" —
            a aba inteira só aparece pra quem já tem permissão de
            gerenciar tags (dono/sub-dono/admin), escondida de
            membros comuns enquanto a funcionalidade não é ativada
            de vez pra todo mundo (ver CLAN_TAGS_ENABLED). */}
        {TABS.filter((t) => t.key !== 'tags' || myClanCapabilities.MANAGE_TAGS).map((t) => (
          <button key={t.key} className={`clan-tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
            {t.key === 'members' && myClanPendingRequests?.length > 0 && <span className="clan-tab-badge">{myClanPendingRequests.length}</span>}
          </button>
        ))}
      </div>

      {tab === 'chat' && (
        <div className="clan-chat">
          <div className="clan-chat-messages">
            {messages.map((m) => (
              <div key={m.id} className="clan-chat-message">
                <img className="clan-chat-avatar" src={proxyImage(m.author.avatarUrl)} alt="" />
                <div className="clan-chat-message-body">
                  <div className="clan-chat-message-head">
                    <span className="clan-chat-author">{m.author.displayName}</span>
                    <span className="dim clan-chat-time">{formatTimeOnly(m.createdAt)}</span>
                  </div>
                  <div>{m.content}</div>
                </div>
                {(m.authorId === user.id || (myClanCapabilities.MODERATE_CLAN_CHAT && ROLE_ORDER.indexOf(myClanRole) < ROLE_ORDER.indexOf(m.author.clanRole))) && (
                  <button className="clan-chat-delete-btn" title="Apagar" onClick={() => removeMsg(m)}>×</button>
                )}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
          <form className="clan-chat-form" onSubmit={sendMsg}>
            <input value={content} onChange={(e) => setContent(e.target.value)} placeholder={`Conversar em ${myClan.name}`} maxLength={2000} />
            <button type="submit" className="btn-primary">Enviar</button>
          </form>
        </div>
      )}

      {tab === 'members' && (
        <div className="clan-members-tab">
          {myClanCapabilities.MANAGE_JOIN_REQUESTS && myClanPendingRequests?.length > 0 && (
            <div className="clan-requests-section">
              <div className="permission-group-label">SOLICITAÇÕES PENDENTES</div>
              {myClanPendingRequests.map((r) => (
                <div key={r.id} className="clan-member-row">
                  <img className="clan-chat-avatar" src={proxyImage(r.user.avatarUrl)} alt="" />
                  <span className="clan-member-name">{r.user.displayName}</span>
                  <div className="clan-member-actions">
                    <button className="btn-primary" onClick={() => onRespondRequest(r, true)}>Aceitar</button>
                    <button className="btn-secondary" onClick={() => onRespondRequest(r, false)}>Recusar</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="permission-group-label">MEMBROS</div>
          {myClan.members.sort((a, b) => ROLE_ORDER.indexOf(a.clanRole) - ROLE_ORDER.indexOf(b.clanRole)).map((m) => (
            <div key={m.id} className="clan-member-row">
              <img className="clan-chat-avatar" src={proxyImage(m.avatarUrl)} alt="" />
              <span className="clan-member-name">{m.displayName}</span>
              <span className={`clan-role-badge clan-role-${m.clanRole?.toLowerCase()}`}>{ROLE_LABEL[m.clanRole]}</span>
              {m.id !== user.id && m.clanRole !== 'OWNER' && (
                <div className="clan-member-actions">
                  {myClanCapabilities.MANAGE_ROLES && assignableRoles.length > 0 && ROLE_ORDER.indexOf(myClanRole) < ROLE_ORDER.indexOf(m.clanRole) && (
                    <select value={m.clanRole} onChange={(e) => onChangeRole(m, e.target.value)}>
                      {[...assignableRoles, m.clanRole].filter((v, i, arr) => arr.indexOf(v) === i).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                    </select>
                  )}
                  {myClanCapabilities.TRANSFER_OWNERSHIP && (
                    <button className="btn-secondary" onClick={() => onTransfer(m)}>Tornar dono</button>
                  )}
                  {myClanCapabilities.MANAGE_MEMBERS && ROLE_ORDER.indexOf(myClanRole) < ROLE_ORDER.indexOf(m.clanRole) && (
                    <button className="btn-danger-text" onClick={() => onKick(m)}>Expulsar</button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === 'tags' && (
        <div className="clan-tags-tab">
          {/* Item pedido: "não mostra uma lista, mostra se [quer]
              mostrar a tag, deixe desativada [por padrão]" — como só
              existe uma tag por clã agora, não faz mais sentido uma
              lista pra "escolher entre várias" — vira um interruptor
              simples de ligar/desligar essa única tag, começando
              sempre desligado até a pessoa ativar por conta própria. */}
          {myClan.tags.length === 0 ? (
            <p className="dim">Este clã ainda não tem uma tag.</p>
          ) : (
            <label className="clan-tag-toggle-row">
              <input type="checkbox" checked={!!user.clanTagId} onChange={(e) => onPickMyTag(e.target.checked ? myClan.tags[0].id : null)} />
              Mostrar a tag <span className="clan-tag-chip clan-tag-chip-inline">{myClan.tags[0].tag}</span> no meu perfil
              {myClanCapabilities.MANAGE_TAGS && <button type="button" className="clan-chat-delete-btn" title="Excluir tag" onClick={(e) => { e.preventDefault(); onDeleteTag(myClan.tags[0]); }}>×</button>}
            </label>
          )}
          {myClanCapabilities.MANAGE_TAGS && myClan.tags.length === 0 && (
            <div className="clan-create-tag-row">
              <input value={newTag} onChange={(e) => setNewTag(e.target.value.toUpperCase())} maxLength={4} placeholder="Tag do clã (até 4 letras)" />
              <button className="btn-primary" onClick={onCreateTag}>Criar</button>
            </div>
          )}
          {tagError && <div className="form-error">{tagError}</div>}
        </div>
      )}

      {tab === 'settings' && (
        <div className="clan-settings-tab">
          {myClanCapabilities.EDIT_CLAN ? (
            <>
              <div className="clan-create-icon-row">
                <div className="clan-icon-preview">
                  <ClanIcon icon={icons.find((i) => i.id === settingsForm.iconId)} color={settingsForm.iconColor} />
                </div>
                <label>
                  ÍCONE
                  <select value={settingsForm.iconId} onChange={(e) => setSettingsForm({ ...settingsForm, iconId: e.target.value })}>
                    <option value="">Padrão</option>
                    {icons.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                  </select>
                </label>
              </div>
              <label>NOME<input value={settingsForm.name} onChange={(e) => setSettingsForm({ ...settingsForm, name: e.target.value })} maxLength={40} /></label>
              <label>DESCRIÇÃO<textarea value={settingsForm.description} onChange={(e) => setSettingsForm({ ...settingsForm, description: e.target.value })} maxLength={200} rows={2} /></label>
              <label className="clan-public-toggle">
                <input type="checkbox" checked={settingsForm.isPublic} onChange={(e) => setSettingsForm({ ...settingsForm, isPublic: e.target.checked })} />
                {settingsForm.isPublic ? 'Público' : 'Privado'}
              </label>
              <button className="btn-primary" onClick={onSaveSettings}>Salvar alterações</button>
              <hr />
            </>
          ) : (
            <p className="dim">Só o dono e o sub-dono podem editar as configurações do clã.</p>
          )}
          <button className="btn-danger-text" onClick={onLeaveClan}>Sair do clã</button>
        </div>
      )}
    </div>
  );
}
