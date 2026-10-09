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
import UserAvatar from '../components/UserAvatar.jsx';
import PageIcon from '../components/PageIcons.jsx';
import { ClubTile, PrivacyChip, ClubForm, ICON_COLORS, privacyOf } from '../components/ClubBits.jsx';
import { usePromptDialog } from '../utils/usePromptDialog.jsx';
import { formatMessageTime } from '../utils/formatTime';
import '../styles/clubs.css';

const ROLE_LABEL = { OWNER: 'Dono', SUB_OWNER: 'Sub-dono', ADMIN: 'Admin', MODERATOR: 'Moderador', MEMBER: 'Membro' };
const ROLE_ORDER = ['OWNER', 'SUB_OWNER', 'ADMIN', 'MODERATOR', 'MEMBER'];
const TABS = [
  { key: 'chat', label: 'Chat', icon: 'chat' },
  { key: 'members', label: 'Membros', icon: 'user' },
  { key: 'tags', label: 'Tag', icon: 'hash' },
  { key: 'settings', label: 'Configurações', icon: 'key' },
];
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// Página do clube: cabeçalho com identidade e chamada de voz, e abas
// Chat / Membros / Tag / Configurações. Cada cargo vê só as ações que
// pode usar (o servidor também confere tudo).
export default function ClanPage() {
  const navigate = useNavigate();
  const { user, setUser } = useAuth();
  const voice = useVoice();
  const myClan = useStore((s) => s.myClan);
  const myClanRole = useStore((s) => s.myClanRole);
  const caps = useStore((s) => s.myClanCapabilities);
  const pending = useStore((s) => s.myClanPendingRequests);
  const setMyClan = useStore((s) => s.setMyClan);
  const { confirmAsync, DialogElement } = usePromptDialog();
  const [tab, setTab] = useState('chat');
  const [messages, setMessages] = useState(null);
  const [content, setContent] = useState('');
  const [icons, setIcons] = useState([]);
  const [settingsForm, setSettingsForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [newTag, setNewTag] = useState('');
  const [tagError, setTagError] = useState('');
  const endRef = useRef(null);
  const inVoice = voice.call?.channelId === `clan:${myClan?.id}`;

  const refreshMyClan = () => getMyClan().then((d) => setMyClan(d));

  useEffect(() => {
    if (!myClan) { navigate('/dms'); return; }
    listClanMessages(myClan.id).then((d) => setMessages(d.messages)).catch(() => setMessages([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myClan?.id]);

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [messages?.length, tab]);

  useEffect(() => {
    if (!myClan) return;
    setSettingsForm({ name: myClan.name, description: myClan.description || '', privacyType: privacyOf(myClan), iconId: myClan.icon?.id || '', iconColor: myClan.iconColor || ICON_COLORS[0] });
    if (caps.EDIT_CLAN) listClanIcons().then((d) => setIcons(d.icons)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myClan?.id]);

  if (!myClan || !settingsForm) return null;

  const fail = (err, msg) => useStore.getState().pushNotice(err?.response?.data?.error || msg);

  const sendMsg = async (e) => {
    e.preventDefault();
    const trimmed = content.trim();
    if (!trimmed) return;
    setContent('');
    try {
      const { message } = await sendClanMessage(myClan.id, trimmed);
      setMessages((m) => [...(m || []), message]);
    } catch (err) { fail(err, 'Não foi possível enviar a mensagem.'); }
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
    if (!(await confirmAsync(myClanRole === 'OWNER' ? 'Sair do clube? Se houver outros membros, transfira a liderança antes.' : 'Sair do clube?'))) return;
    try { await leaveClan(); setMyClan({ clan: null }); navigate('/dms'); } catch (err) { fail(err, 'Não foi possível sair do clube.'); }
  };
  const onChangeRole = async (member, role) => {
    try { await setClanMemberRole(myClan.id, member.id, role); await refreshMyClan(); } catch (err) { fail(err, 'Não foi possível mudar o cargo.'); }
  };
  const onKick = async (member) => {
    if (!(await confirmAsync(`Expulsar ${member.displayName} do clube?`))) return;
    try { await kickClanMember(myClan.id, member.id); await refreshMyClan(); } catch (err) { fail(err, 'Não foi possível expulsar esse membro.'); }
  };
  const onTransfer = async (member) => {
    if (!(await confirmAsync(`Passar a liderança do clube para ${member.displayName}? Você vira Sub-dono.`))) return;
    try { await transferClanOwnership(myClan.id, member.id); await refreshMyClan(); } catch (err) { fail(err, 'Não foi possível transferir a liderança.'); }
  };
  const onRespondRequest = async (request, approve) => {
    try { await respondClanJoinRequest(myClan.id, request.id, approve); await refreshMyClan(); } catch (err) { fail(err, 'Não foi possível responder à solicitação.'); }
  };
  const onCreateTag = async () => {
    setTagError('');
    try { await createClanTag(myClan.id, newTag); setNewTag(''); await refreshMyClan(); } catch (err) { setTagError(err?.response?.data?.error || 'Não foi possível criar a tag.'); }
  };
  const onDeleteTag = async (tag) => {
    if (!(await confirmAsync(`Excluir a tag "${tag.tag}"?`))) return;
    await deleteClanTag(myClan.id, tag.id).catch(() => {});
    await refreshMyClan();
  };
  const onPickMyTag = async (tagId) => {
    try {
      const { clanTagId, clanTag } = await setMyClanTag(tagId || null);
      setUser({ ...user, clanTagId, clanTag });
    } catch (err) { fail(err, 'Não foi possível atualizar sua tag.'); }
  };
  const onSaveSettings = async () => {
    if (!settingsForm.name.trim()) { useStore.getState().pushNotice('O clube precisa de um nome.'); return; }
    setSaving(true);
    try {
      await updateClan(myClan.id, {
        name: settingsForm.name.trim(), description: settingsForm.description.trim() || null,
        privacyType: settingsForm.privacyType, iconId: settingsForm.iconId || null, iconColor: settingsForm.iconColor,
      });
      await refreshMyClan();
      useStore.getState().pushNotice('Clube atualizado.');
    } catch (err) { fail(err, 'Não foi possível salvar.'); } finally { setSaving(false); }
  };

  const myLevel = ROLE_ORDER.indexOf(myClanRole);
  const assignableRoles = ROLE_ORDER.filter((r) => r !== 'OWNER' && ROLE_ORDER.indexOf(r) > myLevel);
  const members = [...(myClan.members || [])].sort((a, b) => ROLE_ORDER.indexOf(a.clanRole) - ROLE_ORDER.indexOf(b.clanRole));
  const pendingCount = caps.MANAGE_JOIN_REQUESTS ? (pending?.length || 0) : 0;
  const color = myClan.iconColor || ICON_COLORS[0];

  return (
    <div className="cb cb-page" style={{ '--club-color': color }}>
      {DialogElement}

      <header className="cb-hero">
        <div className="cb-mine-glow" aria-hidden="true" />
        <button type="button" className="cb-back" onClick={() => navigate('/dms')} aria-label="Voltar para Clubes"><PageIcon name="back" size={20} /></button>
        <ClubTile clan={myClan} size={76} />
        <div className="cb-hero-info">
          <h1 className="truncate">{myClan.name}</h1>
          <div className="cb-chips">
            <span className={`cb-role role-${myClanRole?.toLowerCase()}`}>{ROLE_LABEL[myClanRole]}</span>
            <span className="cb-chip"><PageIcon name="user" size={13} /> {plural(myClan.memberCount, 'membro', 'membros')}</span>
            <PrivacyChip clan={myClan} />
          </div>
          {myClan.description && <p className="cb-hero-desc">{myClan.description}</p>}
        </div>
        <button type="button" className={`cb-voice${inVoice ? ' on' : ''}`} onClick={toggleVoice}>
          <PageIcon name="headset" size={18} /> {inVoice ? 'Sair da voz' : 'Entrar na voz'}
        </button>
      </header>

      <div className="cb-tabs" role="tablist" aria-label="Seções do clube">
        {TABS.filter((t) => t.key !== 'tags' || caps.MANAGE_TAGS).map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={`cb-tab${tab === t.key ? ' active' : ''}`} onClick={() => setTab(t.key)}>
            <PageIcon name={t.icon} size={16} /> {t.label}
            {t.key === 'members' && pendingCount > 0 && <span className="cb-badge">{pendingCount}</span>}
          </button>
        ))}
      </div>

      {tab === 'chat' && (
        <section className="cb-panel cb-chat">
          <div className="cb-chat-list">
            {messages === null && <div className="cb-chat-empty">Carregando…</div>}
            {messages?.length === 0 && (
              <div className="cb-chat-empty">
                <span className="cb-empty-icon"><PageIcon name="chat" size={26} /></span>
                <strong>Comece a conversa</strong>
                <span>As mensagens daqui só aparecem para quem é do clube.</span>
              </div>
            )}
            {messages?.map((m, i) => {
              const prev = messages[i - 1];
              const grouped = prev && prev.authorId === m.authorId && new Date(m.createdAt) - new Date(prev.createdAt) < 5 * 60000;
              const canDelete = m.authorId === user.id || (caps.MODERATE_CLAN_CHAT && ROLE_ORDER.indexOf(myClanRole) < ROLE_ORDER.indexOf(m.author.clanRole));
              return (
                <div key={m.id} className={`cb-msg${grouped ? ' grouped' : ''}`}>
                  {grouped ? <span className="cb-msg-gap" /> : <UserAvatar user={m.author} size={36} />}
                  <div className="cb-msg-body">
                    {!grouped && (
                      <div className="cb-msg-head">
                        <strong>{m.author.displayName}</strong>
                        {m.author.clanRole && m.author.clanRole !== 'MEMBER' && <span className={`cb-role small role-${m.author.clanRole.toLowerCase()}`}>{ROLE_LABEL[m.author.clanRole]}</span>}
                        <time dateTime={m.createdAt}>{formatMessageTime(m.createdAt)}</time>
                      </div>
                    )}
                    <div className="cb-msg-text">{m.content}</div>
                  </div>
                  {canDelete && <button type="button" className="cb-msg-del" title="Apagar" aria-label="Apagar mensagem" onClick={() => removeMsg(m)}><PageIcon name="close" size={15} /></button>}
                </div>
              );
            })}
            <div ref={endRef} />
          </div>
          <form className="cb-composer" onSubmit={sendMsg}>
            <input value={content} onChange={(e) => setContent(e.target.value)} placeholder={`Conversar em ${myClan.name}`} maxLength={2000} />
            <button type="submit" className="cb-send" disabled={!content.trim()} aria-label="Enviar"><PageIcon name="send" size={18} /></button>
          </form>
        </section>
      )}

      {tab === 'members' && (
        <div className="cb-stack-col">
          {pendingCount > 0 && (
            <section className="cb-panel">
              <h3 className="cb-section-title"><PageIcon name="inbox" size={16} /> Pedidos para entrar <span>{pendingCount}</span></h3>
              <ul className="cb-members">
                {pending.map((r) => (
                  <li key={r.id} className="cb-member is-request">
                    <UserAvatar user={r.user} size={40} />
                    <span className="cb-member-name truncate">{r.user.displayName}</span>
                    <div className="cb-member-actions">
                      <button type="button" className="cb-btn primary sm" onClick={() => onRespondRequest(r, true)}><PageIcon name="check" size={15} /> Aceitar</button>
                      <button type="button" className="cb-btn ghost sm" onClick={() => onRespondRequest(r, false)}>Recusar</button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section className="cb-panel">
            <h3 className="cb-section-title"><PageIcon name="user" size={16} /> Membros <span>{members.length}</span></h3>
            <ul className="cb-members">
              {members.map((m) => {
                const canAct = m.id !== user.id && m.clanRole !== 'OWNER' && ROLE_ORDER.indexOf(myClanRole) < ROLE_ORDER.indexOf(m.clanRole);
                return (
                  <li key={m.id} className="cb-member">
                    <UserAvatar user={m} size={40} />
                    <span className="cb-member-name truncate">{m.displayName}{m.id === user.id && <span className="cb-you">você</span>}</span>
                    <span className={`cb-role role-${m.clanRole?.toLowerCase()}`}>{ROLE_LABEL[m.clanRole]}</span>
                    {canAct && (
                      <div className="cb-member-actions">
                        {caps.MANAGE_ROLES && assignableRoles.length > 0 && (
                          <select className="cb-select" value={m.clanRole} onChange={(e) => onChangeRole(m, e.target.value)} aria-label={`Cargo de ${m.displayName}`}>
                            {[...assignableRoles, m.clanRole].filter((v, i, arr) => arr.indexOf(v) === i).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                          </select>
                        )}
                        {caps.TRANSFER_OWNERSHIP && <button type="button" className="cb-icon-btn" title="Passar liderança" aria-label="Passar liderança" onClick={() => onTransfer(m)}><PageIcon name="star" size={16} /></button>}
                        {caps.MANAGE_MEMBERS && <button type="button" className="cb-icon-btn danger" title="Expulsar" aria-label="Expulsar" onClick={() => onKick(m)}><PageIcon name="close" size={16} /></button>}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      )}

      {tab === 'tags' && (
        <section className="cb-panel cb-tagpanel">
          <h3 className="cb-section-title"><PageIcon name="hash" size={16} /> Tag do clube</h3>
          <p className="cb-muted">A tag aparece ao lado do nome de quem escolher mostrar.</p>
          {myClan.tags.length === 0 ? (
            caps.MANAGE_TAGS ? (
              <div className="cb-tag-create">
                <input value={newTag} onChange={(e) => setNewTag(e.target.value.toUpperCase())} maxLength={4} placeholder="ABCD" aria-label="Tag (até 4 letras)" />
                <button type="button" className="cb-btn primary" onClick={onCreateTag} disabled={!newTag.trim()}>Criar tag</button>
              </div>
            ) : <p className="cb-muted">Este clube ainda não tem uma tag.</p>
          ) : (
            <div className="cb-tag-row">
              <span className="cb-tag" style={{ '--club-color': color }}>{myClan.tags[0].tag}</span>
              <label className="cb-switch-row">
                <span>Mostrar no meu nome</span>
                <input type="checkbox" checked={!!user.clanTagId} onChange={(e) => onPickMyTag(e.target.checked ? myClan.tags[0].id : null)} />
                <span className="cb-switch" aria-hidden="true" />
              </label>
              {caps.MANAGE_TAGS && <button type="button" className="cb-icon-btn danger" title="Excluir tag" aria-label="Excluir tag" onClick={() => onDeleteTag(myClan.tags[0])}><PageIcon name="close" size={16} /></button>}
            </div>
          )}
          {tagError && <p className="cb-error" role="alert">{tagError}</p>}
        </section>
      )}

      {tab === 'settings' && (
        <div className="cb-stack-col">
          {caps.EDIT_CLAN ? (
            <section className="cb-panel">
              <h3 className="cb-section-title"><PageIcon name="key" size={16} /> Identidade do clube</h3>
              <ClubForm form={settingsForm} setForm={setSettingsForm} icons={icons} />
              <div className="cb-panel-foot">
                <button type="button" className="cb-btn primary" onClick={onSaveSettings} disabled={saving}>{saving ? 'Salvando…' : 'Salvar alterações'}</button>
              </div>
            </section>
          ) : (
            <section className="cb-panel"><p className="cb-muted">Só o dono e o sub-dono podem editar o clube.</p></section>
          )}
          <section className="cb-panel cb-danger">
            <div>
              <strong>Sair do clube</strong>
              <p className="cb-muted">{myClanRole === 'OWNER' ? 'Como dono, passe a liderança antes de sair (se houver outros membros).' : 'Você pode entrar em outro clube depois.'}</p>
            </div>
            <button type="button" className="cb-btn danger" onClick={onLeaveClan}>Sair do clube</button>
          </section>
        </div>
      )}
    </div>
  );
}
