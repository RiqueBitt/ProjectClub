import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import IconGlyph from '../IconGlyph.jsx';
import AchievementPickerModal from './AchievementPickerModal.jsx';
import micIcon from '../../assets/icons/nav-mic.png';
import tagsIcon from '../../assets/icons/nav-tags.png';
import Modal from '../Modal.jsx';
import EmojiPicker from '../EmojiPicker.jsx';
import { usePopoverCoordination } from '../../utils/popoverCoordinator';
import { isGradientColor, gradientStops, makeGradient } from '../../utils/roleColor';
import { NAME_FONTS, NAME_EFFECTS, nameStyleProps } from '../../utils/nameStyle';
import { useAuth } from '../../context/AuthContext.jsx';
import { useStore } from '../../store/useStore';
import IdCardPreviewModal from './IdCardPreviewModal.jsx';
import { PENGUIN_COLORS, penguinAvatarUrl, isPenguinAvatarUrl } from '../PenguinAvatar.jsx';
import PenguinAvatar from '../PenguinAvatar.jsx';
import youtubeConnIcon from '../../assets/icons/social-youtube.png';
import steamConnIcon from '../../assets/icons/social-steam.png';
import { useVoice } from '../../context/VoiceContext.jsx';
import { CUSTOM_BACKGROUND_ENABLED } from '../../utils/featureFlags';
import {
  getPreferredMicId, getPreferredSpeakerId, setPreferredSpeakerId,
  isOutputSelectionSupported, listAudioDevices,
} from '../../utils/audioDevices';
import robloxConnIcon from '../../assets/icons/social-roblox.png';
import xConnIcon from '../../assets/icons/social-x.png';
import {
  updateProfile, updateUsername, uploadAvatar, uploadBanner, removeIdCard,
  setup2FA, confirm2FA, disable2FA, setActiveTag, setPreferredTheme,
  listSessions, revokeSession, revokeOtherSessions,
} from '../../api/endpoints';

const TABS = ['PROFILE', 'ACCOUNT', 'VOICE', 'SECURITY', 'APPEARANCE', 'TAGS'];

export default function UserSettingsModal({ onClose }) {
  const { user, setUser, logout } = useAuth();
  const navigate = useNavigate();
  const { theme, setTheme, customBackground, setCustomBackground } = useStore();
  const disabledSystems = useStore((s) => s.disabledSystems);
  // Ver adminController.js (TOGGLEABLE_SYSTEMS) e a nova opção "Cores
  // personalizadas para perfil" em /admin → Sistema: quando a staff
  // desativa esse sistema, a seção de editar a cor do perfil abaixo some
  // por completo pra todo mundo (o valor já salvo continua sendo usado
  // normalmente em todo o app — só a EDIÇÃO fica bloqueada, ver também o
  // guard equivalente em server/src/controllers/userController.js).
  const profileColorEditEnabled = !disabledSystems.includes('cores_perfil');
  const [tab, setTab] = useState('PROFILE');
  const [tagSaving, setTagSaving] = useState(false);
  const [bioEmojiOpen, setBioEmojiOpen] = useState(false);
  usePopoverCoordination(bioEmojiOpen, () => setBioEmojiOpen(false));
  const [statusEmojiOpen, setStatusEmojiOpen] = useState(false);
  usePopoverCoordination(statusEmojiOpen, () => setStatusEmojiOpen(false));
  const [statusEmojiPickerStyle, setStatusEmojiPickerStyle] = useState(null);
  const statusEmojiBtnRef = useRef(null);
  const statusEmojiPickerRef = useRef(null);

  // Bug fix: this picker used to render inline (position:absolute inside
  // this modal's own scroll area) — since the settings modal itself
  // scrolls/clips its content, the picker regularly got visually cut off
  // instead of floating free above everything. Same fix as every other
  // reaction/emoji picker in the app now: portal to <body>, compute a
  // fixed position from the button's actual spot, flip above/below
  // depending on room.
  useEffect(() => {
    if (!statusEmojiOpen) { setStatusEmojiPickerStyle(null); return; }
    if (window.matchMedia('(max-width: 600px)').matches) { setStatusEmojiPickerStyle(null); return; }
    const btn = statusEmojiBtnRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const estimatedHeight = Math.min(window.innerHeight * 0.46, window.innerHeight - 24);
    let top = rect.top - estimatedHeight - 8;
    if (top < 8) top = Math.min(rect.bottom + 8, window.innerHeight - estimatedHeight - 8);
    setStatusEmojiPickerStyle({ position: 'fixed', top: `${Math.max(8, top)}px` });
  }, [statusEmojiOpen]);

  useEffect(() => {
    if (!statusEmojiOpen) return;
    const onDocDown = (e) => {
      if (statusEmojiPickerRef.current?.contains(e.target) || statusEmojiBtnRef.current?.contains(e.target)) return;
      setStatusEmojiOpen(false);
    };
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('touchstart', onDocDown);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('touchstart', onDocDown);
    };
  }, [statusEmojiOpen]);
  const [idCardFile, setIdCardFile] = useState(null);

  const removeIdCardNow = async () => {
    const { user: updated } = await removeIdCard();
    setUser(updated);
  };
  const [form, setForm] = useState({
    displayName: user.displayName, bio: user.bio || '', pronouns: user.pronouns || '',
    customStatus: user.customStatus || '', customStatusEmoji: user.customStatusEmoji || '', profileColor: user.profileColor,
    profileNameFont: user.profileNameFont || 'NORMAL',
    profileNameEffect: user.profileNameEffect || 'SOLID',
    profileNameColor: user.profileNameColor || '#F2894D',
    profileNameColor2: user.profileNameColor2 || '#FFFFFF',
    // Conexões — plain profile links shown as icon-buttons under the user's
    // profile card (see UserProfileModal.jsx). No OAuth/verification, just
    // an optional URL per platform.
    youtubeUrl: user.youtubeUrl || '', steamUrl: user.steamUrl || '',
    robloxUrl: user.robloxUrl || '', xUrl: user.xUrl || '',
  });
  const [username, setUsernameField] = useState(user.username);
  const [twoFA, setTwoFA] = useState({ qrDataUrl: null, secret: null, code: '' });
  const [error, setError] = useState('');
  const [sessions, setSessions] = useState(null);
  const [sessionsError, setSessionsError] = useState('');
  const [revokingId, setRevokingId] = useState(null);
  const [revokingOthers, setRevokingOthers] = useState(false);

  const onChange = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
  // Appends an emoji/shortcode picked from <EmojiPicker> onto the end of the
  // bio — simpler than tracking cursor position in a plain <textarea>, and
  // matches how most emoji pickers on mobile behave anyway.
  const insertBioEmoji = (text) => setForm((f) => ({ ...f, bio: (f.bio + text).slice(0, 190) }));

  const saveProfile = async () => {
    const { user: updated } = await updateProfile(form);
    setUser(updated);
  };

  const [friendRequestPrivacy, setFriendRequestPrivacy] = useState(user.friendRequestPrivacy || 'EVERYONE');
  const saveFriendRequestPrivacy = async (value) => {
    setFriendRequestPrivacy(value);
    const { user: updated } = await updateProfile({ friendRequestPrivacy: value });
    setUser(updated);
  };
  const [achievementPickerOpen, setAchievementPickerOpen] = useState(false); // false | 'profile' | 'mini'
  const [myDisplayedAchievements, setMyDisplayedAchievements] = useState({ profile: [], mini: [] });
  useEffect(() => {
    try {
      setMyDisplayedAchievements({
        profile: JSON.parse(user.displayedAchievements || '[]'),
        mini: JSON.parse(user.displayedAchievementsMini || '[]'),
      });
    } catch { /* mantém vazio se o JSON salvo estiver inválido */ }
  }, [user.displayedAchievements, user.displayedAchievementsMini]);

  // BUG CORRIGIDO ("tema escolhido não fica salvo"): aplica o tema local
  // na hora (feedback instantâneo, como antes) e agora TAMBÉM salva na
  // conta em segundo plano — é essa parte na conta que garante que o
  // tema sobrevive a trocar de navegador/dispositivo ou a qualquer falha
  // silenciosa do localStorage local (ver useStore.js). Falha de rede
  // aqui não trava nada — o tema já foi aplicado localmente de qualquer
  // forma, e a próxima vez que salvar com sucesso já resolve.
  const pickTheme = (t) => {
    setTheme(t);
    setPreferredTheme(t).catch(() => {});
  };

  const saveUsername = async () => {
    setError('');
    try {
      const { user: updated } = await updateUsername(username);
      setUser(updated);
    } catch (err) { setError(err.response?.data?.error || 'Erro.'); }
  };

  const onAvatar = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    const { user: updated } = await uploadAvatar(file);
    setUser(updated);
  };

  const pickPenguinAvatar = async (colorKey) => {
    const { user: updated } = await updateProfile({ avatarUrl: penguinAvatarUrl(colorKey) });
    setUser(updated);
  };

  const onBanner = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    const { user: updated } = await uploadBanner(file);
    setUser(updated);
  };

  const start2FA = async () => {
    const data = await setup2FA();
    setTwoFA({ ...data, code: '' });
  };

  const confirm2FASubmit = async () => {
    setError('');
    try {
      await confirm2FA(twoFA.code);
      setUser({ ...user, twoFactorEnabled: true });
      setTwoFA({ qrDataUrl: null, secret: null, code: '' });
    } catch (err) { setError(err.response?.data?.error || 'Código inválido.'); }
  };

  const turnOff2FA = async () => {
    // Backend now requires the account password to disable 2FA (a stolen
    // access token alone shouldn't be able to strip this protection) —
    // this is the one settings action that still needs a plain prompt()
    // instead of a form field, since it's a rare, deliberate, one-off
    // confirmation rather than part of the normal settings flow.
    const password = window.prompt('Digite sua senha para desativar o 2FA:');
    if (!password) return;
    try {
      await disable2FA(password);
      setUser({ ...user, twoFactorEnabled: false });
    } catch (err) {
      setError(err.response?.data?.error || 'Senha incorreta.');
    }
  };

  // "Onde estou logado" — loaded lazily the first time the Security tab is
  // actually opened, not on every settings modal mount, since it's an extra
  // request nobody needs for the (much more common) Profile/Appearance tabs.
  useEffect(() => {
    if (tab !== 'SECURITY' || sessions !== null) return;
    listSessions().then((d) => setSessions(d.sessions)).catch(() => setSessionsError('Não foi possível carregar suas sessões.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const doRevokeSession = async (id) => {
    setSessionsError('');
    setRevokingId(id);
    try {
      await revokeSession(id);
      setSessions((s) => s?.filter((sess) => sess.id !== id));
    } catch (err) {
      setSessionsError(err.response?.data?.error || 'Não foi possível encerrar essa sessão.');
    } finally {
      setRevokingId(null);
    }
  };

  const doRevokeOthers = async () => {
    setSessionsError('');
    setRevokingOthers(true);
    try {
      await revokeOtherSessions();
      setSessions((s) => s?.filter((sess) => sess.isCurrent));
    } catch (err) {
      setSessionsError(err.response?.data?.error || 'Não foi possível encerrar as outras sessões.');
    } finally {
      setRevokingOthers(false);
    }
  };

  // otherwise-plain-looking user-agent strings ("Mozilla/5.0 (Windows NT
  // 10.0; ...) Chrome/126...") aren't meant for end users to parse — this
  // is a best-effort, deliberately approximate "browser · OS" label, not a
  // real device-fingerprinting parse.
  const describeSession = (ua) => {
    if (!ua) return 'Dispositivo desconhecido';
    const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Navegador';
    const os = /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : '';
    return os ? `${browser} · ${os}` : browser;
  };

  const doLogout = async () => {
    await logout();
    onClose();
    navigate('/login');
  };

  return (
    <>
    <Modal title="Configurações do usuário" onClose={onClose} width="820px" className="settings-modal-box">
      <div className="settings-modal-layout">
        <div className="settings-modal-sidebar">
          {TABS.map((t) => (
            <button key={t} className={`settings-modal-sidebar-item ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
              <span className="settings-modal-sidebar-icon">{iconFor(t)}</span>
              {labelFor(t)}
            </button>
          ))}
          <div className="settings-modal-sidebar-divider" />
          <button className="settings-modal-sidebar-item settings-modal-logout" onClick={doLogout}>
            <span className="settings-modal-sidebar-icon">🚪</span>
            Sair da conta
          </button>
        </div>
        <div className="settings-modal-content" key={tab}>

      {tab === 'PROFILE' && (
        <div className="settings-grid profile-edit-grid">
          <div className="settings-block profile-edit-card">
            <div className="profile-preview-banner profile-edit-banner" style={{ background: user.bannerUrl ? `url(${user.bannerUrl}) center/cover` : form.profileColor }} />
            <div className="profile-edit-identity">
              <div className="avatar large profile-edit-avatar" style={{ background: form.profileColor, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                {isPenguinAvatarUrl(user.avatarUrl)
                  ? <PenguinAvatar color={PENGUIN_COLORS[user.avatarUrl.slice(8)] || PENGUIN_COLORS.blue} size={80} />
                  : user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : user.displayName[0].toUpperCase()}
              </div>
              <div className="profile-edit-identity-info">
                <div className="profile-edit-identity-name truncate">{form.displayName || user.displayName}</div>
                <div className="profile-edit-identity-username truncate">@{user.username}</div>
              </div>
              <button
                type="button"
                className="btn-link profile-edit-preview-link"
                onClick={(e) => useStore.getState().openMiniProfile(user.id, e.currentTarget.getBoundingClientRect())}
              >
                👁️ Ver miniperfil
              </button>
            </div>

            <div className="profile-edit-body">
              <div className="image-uploads">
                <label className="btn-secondary">Alterar avatar<input type="file" accept="image/*" hidden onChange={onAvatar} /></label>
                <label className="btn-secondary">Alterar banner<input type="file" accept="image/*" hidden onChange={onBanner} /></label>
              </div>

              <div className="profile-edit-subsection">
                <div className="profile-edit-subsection-label">OU ESCOLHA UM AVATAR DE PINGUIM</div>
                <div className="penguin-avatar-picker">
                  {Object.entries(PENGUIN_COLORS).map(([key, hex]) => (
                    <button
                      key={key}
                      type="button"
                      className={`penguin-avatar-option ${user.avatarUrl === penguinAvatarUrl(key) ? 'active' : ''}`}
                      title={key}
                      onClick={() => pickPenguinAvatar(key)}
                    >
                      <PenguinAvatar color={hex} size={40} />
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="settings-block">
            <h4>Informações básicas</h4>
            <div className="display-name-row">
              <label>NOME DE EXIBIÇÃO<input name="displayName" value={form.displayName} onChange={onChange} /></label>
              <label>
                FONTE (só no seu perfil)
                <select name="profileNameFont" value={form.profileNameFont} onChange={onChange}>
                  {NAME_FONTS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                </select>
              </label>
            </div>
            <label>PRONOMES<input name="pronouns" value={form.pronouns} onChange={onChange} placeholder="ele/dele, ela/dela..." /></label>
            <label>
              BIOGRAFIA
              <div className="bio-input-row">
                <textarea name="bio" value={form.bio} onChange={onChange} maxLength={190} />
                <div className="composer-picker-anchor">
                  <button type="button" className="icon-btn" title="Emoji" onClick={() => setBioEmojiOpen((v) => !v)}>☺</button>
                  {bioEmojiOpen && <EmojiPicker onPick={insertBioEmoji} onClose={() => setBioEmojiOpen(false)} />}
                </div>
              </div>
            </label>
          </div>

          <div className="settings-block">
            <h4>Status personalizado</h4>
            <label>
              <div className="bio-input-row">
                <input name="customStatus" value={form.customStatus} onChange={onChange} placeholder="O que você está pensando?" />
                <div className="composer-picker-anchor">
                  <button ref={statusEmojiBtnRef} type="button" className="icon-btn" title="Emoji do status" onClick={() => setStatusEmojiOpen((v) => !v)}>
                    {form.customStatusEmoji || '☺'}
                  </button>
                  {statusEmojiOpen && createPortal(
                    <div ref={statusEmojiPickerRef} style={{ display: 'contents' }}>
                      <EmojiPicker
                        variant="reaction"
                        serverEmojis={useStore.getState().usableEmojis}
                        style={statusEmojiPickerStyle || {}}
                        onPick={(e) => { setForm((f) => ({ ...f, customStatusEmoji: e })); setStatusEmojiOpen(false); }}
                        onClose={() => setStatusEmojiOpen(false)}
                      />
                    </div>,
                    document.body,
                  )}
                </div>
              </div>
            </label>
          </div>

          {profileColorEditEnabled && (
          <div className="settings-block">
            <h4>Cor do perfil</h4>
            <p className="dim">A cor (ou degradê) de fundo do seu banner e avatar quando você não tem uma imagem própria.</p>
            {/* Gradient toggle just for the profile banner/avatar fallback
                color — separate from the page-wide "Aparência" background
                gradient (that one repaints the whole app; this one is
                scoped to just this user's own profile card, same
                field/string trick already used for role colors, see
                utils/roleColor.js). */}
            <div className="role-color-row profile-color-row">
              <div className="role-color-pickers">
                {isGradientColor(form.profileColor) ? (
                  <>
                    <label>
                      COR DO PERFIL (INÍCIO)
                      <input
                        type="color"
                        defaultValue={gradientStops(form.profileColor)[0]}
                        onChange={(e) => setForm((f) => ({ ...f, profileColor: makeGradient(e.target.value, gradientStops(f.profileColor)[1]) }))}
                      />
                    </label>
                    <label>
                      COR DO PERFIL (FIM)
                      <input
                        type="color"
                        defaultValue={gradientStops(form.profileColor)[1]}
                        onChange={(e) => setForm((f) => ({ ...f, profileColor: makeGradient(gradientStops(f.profileColor)[0], e.target.value) }))}
                      />
                    </label>
                  </>
                ) : (
                  <label>COR DO PERFIL<input type="color" name="profileColor" value={form.profileColor} onChange={onChange} /></label>
                )}
                <label className="checkbox-row role-gradient-toggle">
                  <input
                    type="checkbox"
                    checked={isGradientColor(form.profileColor)}
                    onChange={(e) => {
                      const [a, b] = gradientStops(form.profileColor);
                      setForm((f) => ({ ...f, profileColor: e.target.checked ? makeGradient(a, b) : a }));
                    }}
                  />
                  Degradê
                </label>
              </div>
            </div>
          </div>
          )}

          <div className="settings-block">
            <h4>Estilo do nome (só no seu perfil)</h4>
            <p className="dim">A fonte, o efeito e a cor abaixo aparecem só na sua própria página de perfil — em mensagens, servidores e menções seu nome continua normal.</p>
            <div className="name-style-preview" style={{ fontSize: 22, fontWeight: 700 }}>
              <span style={nameStyleProps(form)}>{form.displayName || user.displayName}</span>
            </div>
            <label>
              EFEITO
              <select name="profileNameEffect" value={form.profileNameEffect} onChange={onChange}>
                {NAME_EFFECTS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </label>
            <div className="name-style-color-row">
              <label>
                {form.profileNameEffect === 'GRADIENT' ? 'COR DO NOME (INÍCIO)' : form.profileNameEffect === 'POP' ? 'COR DE TRÁS (CONTORNO)' : 'COR DO NOME'}
                <input type="color" name="profileNameColor" value={form.profileNameColor} onChange={onChange} />
              </label>
              {(form.profileNameEffect === 'GRADIENT' || form.profileNameEffect === 'POP') && (
                <label>
                  {form.profileNameEffect === 'GRADIENT' ? 'COR DO NOME (FIM)' : 'COR DA FRENTE (PREENCHIMENTO)'}
                  <input type="color" name="profileNameColor2" value={form.profileNameColor2} onChange={onChange} />
                </label>
              )}
            </div>
          </div>

          <div className="settings-block">
            <h4>Placa de identificação</h4>
            <p className="dim">Uma imagem ou GIF que aparece no fundo da sua linha, na lista de membros de qualquer servidor que você participa — outras pessoas veem essa imagem ali.</p>
            <div className="id-card-settings-row">
              {user.idCardUrl && <img src={user.idCardUrl} alt="" className="id-card-settings-preview" />}
              <label className="btn-secondary">
                {user.idCardUrl ? 'Trocar imagem' : 'Escolher imagem ou GIF'}
                <input
                  type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden
                  onChange={(e) => { const f = e.target.files[0]; if (f) setIdCardFile(f); e.target.value = ''; }}
                />
              </label>
              {user.idCardUrl && (
                <button className="btn-link danger" onClick={removeIdCardNow}>Remover</button>
              )}
            </div>
          </div>

          <div className="settings-block">
            <h4>Conexões</h4>
            <div className="profile-edit-connections-grid">
              <label>
                <span className="connection-label"><img className="ui-icon-sm" src={youtubeConnIcon} alt="" /> YOUTUBE</span>
                <input name="youtubeUrl" value={form.youtubeUrl} onChange={onChange} placeholder="Link do seu canal do YouTube" />
              </label>
              <label>
                <span className="connection-label"><img className="ui-icon-sm" src={steamConnIcon} alt="" /> STEAM</span>
                <input name="steamUrl" value={form.steamUrl} onChange={onChange} placeholder="Link do seu perfil da Steam" />
              </label>
              <label>
                <span className="connection-label"><img className="ui-icon-sm" src={robloxConnIcon} alt="" /> ROBLOX</span>
                <input name="robloxUrl" value={form.robloxUrl} onChange={onChange} placeholder="Link do seu perfil do Roblox" />
              </label>
              <label>
                <span className="connection-label"><img className="ui-icon-sm" src={xConnIcon} alt="" /> X (TWITTER)</span>
                <input name="xUrl" value={form.xUrl} onChange={onChange} placeholder="Link do seu perfil no X" />
              </label>
            </div>
          </div>

          <div className="settings-block">
            <h4>Conquistas em destaque</h4>
            <p className="dim">Escolha quais conquistas aparecem no seu perfil completo e no miniperfil.</p>
            <div className="modal-actions" style={{ justifyContent: 'flex-start', gap: 10 }}>
              <button type="button" className="btn-secondary" onClick={() => setAchievementPickerOpen('profile')}>Perfil (até 6)</button>
              <button type="button" className="btn-secondary" onClick={() => setAchievementPickerOpen('mini')}>Miniperfil (até 4)</button>
            </div>
          </div>

          <div className="settings-block">
            <h4>Privacidade de pedidos de amizade</h4>
            <p className="dim">Quem pode te mandar um pedido de amizade novo.</p>
            <div className="theme-options">
              {[['EVERYONE', 'Qualquer pessoa'], ['FRIENDS_OF_FRIENDS', 'Amigos de amigos'], ['NOBODY', 'Ninguém']].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={`theme-swatch ${friendRequestPrivacy === value ? 'active' : ''}`}
                  onClick={() => saveFriendRequestPrivacy(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <button className="btn-primary profile-edit-save" onClick={saveProfile}>Salvar alterações</button>
        </div>
      )}

      {tab === 'ACCOUNT' && (
        <div className="settings-grid">
          <label>E-MAIL<input value={user.email} disabled /></label>
          <label>
            NOME DE USUÁRIO
            <input value={username} onChange={(e) => setUsernameField(e.target.value)} />
          </label>
          {error && <div className="auth-error">{error}</div>}
          <button className="btn-primary" onClick={saveUsername}>Salvar nome de usuário</button>
          <hr />
          <button className="btn-danger" onClick={doLogout}>Sair da conta</button>
        </div>
      )}

      {tab === 'VOICE' && <VoiceSettingsTab />}

      {tab === 'SECURITY' && (
        <div className="settings-grid">
          <h3>Autenticação de dois fatores</h3>
          {user.twoFactorEnabled ? (
            <>
              <p>2FA está ativado na sua conta.</p>
              <button className="btn-danger" onClick={turnOff2FA}>Desativar 2FA</button>
            </>
          ) : twoFA.qrDataUrl ? (
            <>
              <p>Escaneie o QR code com seu app autenticador e digite o código gerado.</p>
              <img src={twoFA.qrDataUrl} alt="QR code 2FA" width={180} height={180} />
              <div className="dim">Ou insira manualmente: {twoFA.secret}</div>
              <input placeholder="Código de 6 dígitos" value={twoFA.code} onChange={(e) => setTwoFA((s) => ({ ...s, code: e.target.value }))} />
              {error && <div className="auth-error">{error}</div>}
              <button className="btn-primary" onClick={confirm2FASubmit}>Confirmar e ativar</button>
            </>
          ) : (
            <button className="btn-primary" onClick={start2FA}>Configurar 2FA</button>
          )}

          <h3>Sessões ativas</h3>
          <p className="dim">Dispositivos e navegadores onde sua conta está logada agora.</p>
          {sessionsError && <div className="auth-error">{sessionsError}</div>}
          {sessions === null && !sessionsError && <p className="dim">Carregando...</p>}
          {sessions && (
            <>
              <div className="sessions-list">
                {sessions.map((s) => (
                  <div key={s.id} className="session-row">
                    <div className="session-row-info">
                      <div>{describeSession(s.userAgent)}{s.isCurrent && <span className="session-current-badge">Este dispositivo</span>}</div>
                      <div className="dim">Desde {new Date(s.createdAt).toLocaleString('pt-BR')}</div>
                    </div>
                    {!s.isCurrent && (
                      <button className="btn-secondary" disabled={revokingId === s.id} onClick={() => doRevokeSession(s.id)}>
                        {revokingId === s.id ? '...' : 'Encerrar'}
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {sessions.some((s) => !s.isCurrent) && (
                <button className="btn-danger" disabled={revokingOthers} onClick={doRevokeOthers}>
                  {revokingOthers ? '...' : 'Encerrar todas as outras sessões'}
                </button>
              )}
            </>
          )}
        </div>
      )}

      {tab === 'APPEARANCE' && (
        <div className="settings-grid">
          <h3>Tema</h3>
          <div className="theme-options">
            {['facebook', 'light', 'dark', 'amoled', 'clubpenguin'].map((t) => (
              <button key={t} className={`theme-swatch ${t} ${theme === t && !customBackground ? 'active' : ''}`} onClick={() => pickTheme(t)}>
                {{ facebook: 'Muito Claro', clubpenguin: 'Cartoon', dark: 'Cinza', light: 'Claro', amoled: 'Preto' }[t]}
              </button>
            ))}
          </div>

          {/* Função de fundo/tema personalizado desativada (CUSTOM_BACKGROUND_ENABLED
              em utils/featureFlags.js) — código mantido intacto, só a UI fica oculta. */}
          {CUSTOM_BACKGROUND_ENABLED && (
            <>
              <h3>Fundo personalizado</h3>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={!!customBackground}
                  onChange={(e) => setCustomBackground(e.target.checked ? { top: '#ffffff', bottom: '#000000' } : null)}
                />
                Usar um degradê personalizado em vez da cor do tema
              </label>
              {customBackground && (
                <div className="custom-bg-row">
                  <label>
                    COR DE CIMA
                    <input
                      type="color"
                      value={customBackground.top}
                      onChange={(e) => setCustomBackground({ ...customBackground, top: e.target.value })}
                    />
                  </label>
                  <label>
                    COR DE BAIXO
                    <input
                      type="color"
                      value={customBackground.bottom}
                      onChange={(e) => setCustomBackground({ ...customBackground, bottom: e.target.value })}
                    />
                  </label>
                  <div className="custom-bg-preview" style={{ background: `linear-gradient(to bottom, ${customBackground.top}, ${customBackground.bottom})` }} />
                </div>
              )}
              <span className="dim">Afeta a tela de login/cadastro, a tela de carregamento e a barra de servidores.</span>
            </>
          )}
        </div>
      )}

      {tab === 'TAGS' && (
        <div className="settings-grid">
          <h3>Tag da comunidade</h3>
          <p className="dim">
            Exiba a tag da comunidade do lado do seu nome no chat, na lista de membros e no seu perfil.
          </p>
          {(() => {
            const pick = async (active) => {
              setTagSaving(true);
              try {
                const { user: updated } = await setActiveTag(active);
                setUser(updated);
              } finally {
                setTagSaving(false);
              }
            };
            return (
              <div className="server-tag-options">
                <button
                  type="button"
                  className={`server-tag-option ${!user.tagEmoji ? 'active' : ''}`}
                  disabled={tagSaving}
                  onClick={() => pick(false)}
                >
                  Nenhuma
                </button>
                <button
                  type="button"
                  className={`server-tag-option ${user.tagEmoji ? 'active' : ''}`}
                  disabled={tagSaving}
                  onClick={() => pick(true)}
                >
                  <span className="server-tag-badge">🏠 Mostrar tag</span>
                </button>
              </div>
            );
          })()}
        </div>
      )}
        </div>
      </div>
    </Modal>
    {idCardFile && (
      <IdCardPreviewModal
        file={idCardFile}
        onClose={() => setIdCardFile(null)}
        onSaved={(updated) => { setUser(updated); setIdCardFile(null); }}
      />
    )}
    {achievementPickerOpen && (
      <AchievementPickerModal
        slot={achievementPickerOpen}
        currentIds={achievementPickerOpen === 'profile' ? myDisplayedAchievements.profile : myDisplayedAchievements.mini}
        onClose={() => setAchievementPickerOpen(false)}
        onSaved={(field, achievements) => setUser({ ...user, [field]: JSON.stringify(achievements.map((a) => a.key)) })}
      />
    )}
    </>
  );
}

function labelFor(t) {
  return {
    PROFILE: 'Meu perfil', ACCOUNT: 'Minha conta', VOICE: 'Voz e Áudio', SECURITY: 'Segurança', APPEARANCE: 'Aparência',
    TAGS: 'Tags',
  }[t];
}

function iconFor(t) {
  // VOICE e TAGS agora usam os ícones novos (mesmo pacote da barra
  // lateral) em vez de emoji — os outros continuam emoji por enquanto.
  if (t === 'VOICE') return <IconGlyph src={micIcon} size={16} />;
  if (t === 'TAGS') return <IconGlyph src={tagsIcon} size={16} />;
  return {
    PROFILE: '👤', ACCOUNT: '⚙️', SECURITY: '🔒', APPEARANCE: '🎨',
  }[t];
}

// ============================================================
// Voz e Áudio — escolher microfone/saída de áudio, testar o microfone com
// um medidor de volume ao vivo. Sem redução de ruído nem qualquer
// processamento automático de áudio (item pedido) — o microfone vai pro
// ar exatamente como captado.
// ============================================================
function VoiceSettingsTab() {
  const voice = useVoice();
  const [mics, setMics] = useState([]);
  const [speakers, setSpeakers] = useState([]);
  const [selectedMic, setSelectedMic] = useState(getPreferredMicId());
  const [selectedSpeaker, setSelectedSpeaker] = useState(getPreferredSpeakerId());
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [level, setLevel] = useState(0);
  const testStreamRef = useRef(null);
  const testCtxRef = useRef(null);
  const testRafRef = useRef(null);

  const refreshDevices = async () => {
    try {
      // Nomes de verdade (em vez de "Microfone 1") só vêm depois de alguma
      // permissão de mídia já ter sido concedida — pede um microfone
      // qualquer só pra "destravar" isso, sem manter nada gravando.
      const probe = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null);
      probe?.getTracks().forEach((t) => t.stop());
      const { mics: m, speakers: s } = await listAudioDevices();
      setMics(m);
      setSpeakers(s);
    } catch { /* sem permissão de mídia — deixa a lista vazia */ }
  };
  useEffect(() => { refreshDevices(); }, []);

  const stopTest = () => {
    testRafRef.current && cancelAnimationFrame(testRafRef.current);
    testStreamRef.current?.getTracks().forEach((t) => t.stop());
    testCtxRef.current?.close().catch(() => {});
    testStreamRef.current = null;
    testCtxRef.current = null;
    setTesting(false);
    setLevel(0);
  };
  useEffect(() => () => stopTest(), []);

  const startTest = async () => {
    stopTest();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: selectedMic ? { deviceId: { exact: selectedMic } } : true,
      });
      testStreamRef.current = stream;
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      testCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      setTesting(true);
      const tick = () => {
        analyser.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b, 0) / data.length;
        setLevel(Math.min(100, Math.round((avg / 120) * 100)));
        testRafRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      setTesting(false);
    }
  };

  const changeMic = async (deviceId) => {
    setSelectedMic(deviceId);
    setSaving(true);
    await voice.switchMicrophone(deviceId);
    setSaving(false);
    if (testing) startTest();
  };

  const changeSpeaker = (deviceId) => {
    setSelectedSpeaker(deviceId);
    setPreferredSpeakerId(deviceId);
  };

  return (
    <div className="settings-grid">
      <div className="settings-block">
        <h4><IconGlyph src={micIcon} size={16} /> Microfone</h4>
        <label>
          DISPOSITIVO
          <select value={selectedMic} onChange={(e) => changeMic(e.target.value)}>
            <option value="">Padrão do sistema</option>
            {mics.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Microfone sem nome'}</option>)}
          </select>
        </label>
        {saving && <p className="dim" style={{ fontSize: 12 }}>Trocando microfone...</p>}
        <button className="btn-secondary" onClick={testing ? stopTest : startTest} style={{ marginTop: 8 }}>
          {testing ? 'Parar teste' : '🎤 Testar microfone'}
        </button>
        {testing && (
          <div className="mic-level-meter" style={{ marginTop: 10 }}>
            <div className="mic-level-meter-fill" style={{ width: `${level}%` }} />
          </div>
        )}
      </div>

      {isOutputSelectionSupported() && (
        <div className="settings-block">
          <h4>🔊 Saída de áudio</h4>
          <label>
            DISPOSITIVO (fones, caixa de som...)
            <select value={selectedSpeaker} onChange={(e) => changeSpeaker(e.target.value)}>
              <option value="">Padrão do sistema</option>
              {speakers.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Saída sem nome'}</option>)}
            </select>
          </label>
        </div>
      )}
    </div>
  );
}
