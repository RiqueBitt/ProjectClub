import { AppearanceExtras, AccessibilityMore, NotificationExtras, VoiceExtras, PrivacyExtras } from '../settings/ExtraSettings.jsx';
import PasskeysBlock from '../settings/PasskeysBlock.jsx';
import { setExtra, getExtra, useExtra } from '../../utils/extraPrefs';
import { useLiveRefresh } from '../../utils/liveRefresh';
import ProfileShopItems from '../shop/ProfileShopItems.jsx';
import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import IconGlyph from '../IconGlyph.jsx';
import ProfileSectionOrderEditor from '../ProfileSectionOrderEditor.jsx';
import { DISABLED_PROFILE_SECTIONS } from '../../utils/profileSections';
import PhotoAlbumModal from './PhotoAlbumModal.jsx';
import AchievementPickerModal from './AchievementPickerModal.jsx';
import micIcon from '../../assets/icons/nav-mic.png';
// Item pedido: "substitua os emojis pelos ícones fornecidos no .zip,
// mantendo o mesmo tamanho, alinhamento, espaçamento e estilo visual"
// — mesmo padrão de micIcon acima (IconGlyph, mask-image, herda a cor
// do texto ao redor automaticamente).
import settingsProfileIcon from '../../assets/icons/settings-profile.png';
import settingsMiniProfileIcon from '../../assets/icons/settings-mini-profile.png';
import settingsColumnsIcon from '../../assets/icons/settings-columns.png';
import settingsAccountIcon from '../../assets/icons/settings-account.png';
import settingsSecurityIcon from '../../assets/icons/settings-security.png';
import settingsAppearanceIcon from '../../assets/icons/settings-appearance.png';
import settingsAccessibilityIcon from '../../assets/icons/settings-accessibility.png';
import settingsSystemIcon from '../../assets/icons/settings-system.png';
import settingsLanguageIcon from '../../assets/icons/settings-language.png';
// Item pedido: "Notificações, Jogos e Apps não possuem um ícone
// específico no arquivo... utilize ícones que já existam no sistema" —
// os mesmos já usados noutros lugares do app pra representar essas
// categorias (o sino já usado no topo pra notificações, o mesmo ícone
// de grade já usado no item "Apps" da barra principal, e o escudo já
// usado como símbolo de privacidade/proteção).
import settingsNotificationsIcon from '../../assets/icons/nav-notifications.png';
import settingsGamesIcon from '../../assets/icons/nav-apps.png';
import settingsPrivacyIcon from '../../assets/icons/shield.png';
import settingsProfileContentIcon from '../../assets/icons/nav-image.png';
import settingsAccountStatusIcon from '../../assets/icons/document.png';
import logoutIcon from '../../assets/icons/settings-logout.png';
import emojiPickerIcon from '../../assets/icons/emoji-picker.png';
import Modal from '../Modal.jsx';
import { isWebPushSupported, getWebPushState, enableWebPush, disableWebPush } from '../../utils/webPush';
import { getInstallState, onInstallStateChange, promptInstall } from '../../utils/pwaInstall';
import EmojiPicker from '../EmojiPicker.jsx';
import ClanIcon from '../ClanIcon.jsx';
import UserAvatar from '../UserAvatar.jsx';
import { usePopoverCoordination } from '../../utils/popoverCoordinator';
import { isGradientColor, gradientStops, makeGradient } from '../../utils/roleColor';
import { NAME_FONTS, NAME_EFFECTS, nameStyleProps, nameStyleClassName, FONT_FAMILY, DEFAULT_MULTI_COLORS } from '../../utils/nameStyle';
import { EMOJI_STYLE_OPTIONS, emojiImageUrl, useEmojiSet } from '../../utils/emojiStyle';
import { isEyeDropperSupported, pickColorFromScreen } from '../../utils/eyeDropper';

// Item pedido: "sistema... você pode escolher as cores de tudo" —
// combinações prontas de 2 cores, clicáveis (aplicam profileNameColor
// + profileNameColor2 de uma vez), inspiradas no seletor de cor de
// cargo do Discord.
const NAME_COLOR_PRESETS = [
  ['#7b5cff', '#ff8a3d'], ['#ff8a3d', '#ff5c8a'], ['#e8464b', '#e8464b'],
  ['#7b5cff', '#4c9fff'], ['#4c9fff', '#3ddce0'], ['#3ddce0', '#61e786'],
];
import { useAuth } from '../../context/AuthContext.jsx';
import { useSocket } from '../../context/SocketContext.jsx';
import { STATUS_LABEL } from '../../utils/status';
import PresenceDot from '../PresenceDot.jsx';
import { usePromptDialog } from '../../utils/usePromptDialog.jsx';
import { useStore } from '../../store/useStore';
import { proxyImage } from '../../utils/imageProxy';
import ImageCropperModal from './ImageCropperModal.jsx';
import BannerImage, { PROFILE_BANNER_ASPECT, MINI_BANNER_ASPECT, ID_CARD_ASPECT } from '../ProfileBanner.jsx';
import { PENGUIN_COLORS, penguinAvatarUrl, isPenguinAvatarUrl } from '../PenguinAvatar.jsx';
import PenguinAvatar from '../PenguinAvatar.jsx';
import youtubeConnIcon from '../../assets/icons/social-youtube.png';
import steamConnIcon from '../../assets/icons/social-steam.png';
import { useVoice } from '../../context/VoiceContext.jsx';
import { CUSTOM_BACKGROUND_ENABLED } from '../../utils/featureFlags';
import { LayoutCustomizer, AccessibilityExtras, ColorVisionSettings } from '../AppearanceSettings.jsx';
import { trackSave, useSaveStatus } from '../../utils/saveIndicator';
import { useShallow } from 'zustand/react/shallow';
import { chatZoomSaver, interfaceZoomSaver } from '../../utils/zoomSave';
import '../../styles/settings.css';
import ConnectedAccountsBlock from '../auth/ConnectedAccountsBlock.jsx';
import {
  getPreferredMicId, getPreferredSpeakerId, setPreferredSpeakerId,
  isOutputSelectionSupported, listAudioDevices,
} from '../../utils/audioDevices';
import { getVoicePrefs, setVoicePref, prettyKeyName, pttReleaseFromPrefs } from '../../utils/voicePrefs';
import { isSpeechRecognitionSupported } from '../voice/CallExtras.jsx';
import robloxConnIcon from '../../assets/icons/social-roblox.png';
import xConnIcon from '../../assets/icons/social-x.png';
import { looksLikeGif, isGifByContent, GIF_AVATAR_MAX_MB } from '../../utils/gifDetect';
import AndroidUpdateInfo from '../AndroidUpdateInfo';
import {
  updateProfile, updateUsername, uploadAvatar, uploadBanner, uploadMiniProfileBanner, uploadIdCard, removeIdCard,
  setup2FA, confirm2FA, disable2FA, getRecoveryCodesStatus, regenerateRecoveryCodes, setLayoutStyle, setMyClanTag,
  listBlockedUsers, unblockUser,
  setEmojiStyle as setEmojiStyleApi,
  listSessions, revokeSession, revokeOtherSessions,
  createProfilePoll, listProfilePollsByAuthor, deleteProfilePoll,
  changePassword, deleteAccount, deactivateAccount,
  listRegisteredGames, addRegisteredGame, removeRegisteredGame,
  listMyShortcuts, setShortcut, deleteShortcut,
  uploadMyCustomPendant, removeMyCustomPendant,
} from '../../api/endpoints';

// Item pedido: separar "Edição do Perfil" das "Configurações gerais" da
// aplicação, e dentro de Perfil, separar a EDIÇÃO (avatar/banner/bio/
// conexões) das OPÇÕES DE EXIBIÇÃO (quais conquistas aparecem, tag da
// comunidade) e do CONTEÚDO (enquetes, álbum de fotos) — são coisas
// diferentes, mesmo todas sendo "sobre o perfil". Item pedido depois:
// centralizar em Configurações — TAG voltou pra cá (tinha ido pro
// próprio UserProfileModal.jsx numa resposta anterior).
// Item pedido: "estrutura de configurações semelhante ao Discord...
// Conta / Dados e privacidade / Notificações / EXPERIÊNCIA (Voz e
// vídeo, Aparência, Acessibilidade, Sistema, Idioma e horário) /
// JOGOS E APPS (...) — EXPERIÊNCIA e JOGOS E APPS funcionam como
// separadores visuais, não são páginas clicáveis, só organizam o
// resto" — reaproveita o mesmo sistema de grupos que já existia
// (group.label vira o separador, group.tabs vira os itens clicáveis
// logo abaixo dele), só reorganizado com a hierarquia pedida.
// "Meu perfil" é uma categoria própria do Project Club sem
// equivalente direto no documento (edição de bio/conquistas
// exibidas/colunas do perfil) — mantida como já estava, sem mexer.
const TAB_GROUPS = [
  // Miniperfil virou uma seção dentro de Perfil (não é mais aba própria).
  { label: 'Perfil', tabs: ['PROFILE', 'PROFILE_CONTENT', 'COLUMNS'] },
  { label: 'Conta', tabs: ['ACCOUNT', 'SECURITY', 'ACCOUNT_STATUS'] },
  { label: 'Dados e privacidade', tabs: ['PRIVACY'] },
  { label: 'Notificações', tabs: ['NOTIFICATIONS'] },
  { label: 'Experiência', tabs: ['VOICE', 'APPEARANCE', 'ACCESSIBILITY', 'SYSTEM', 'LANGUAGE'] },
  { label: 'Jogos e apps', tabs: ['GAMES'] },
];

// Busca de configurações: palavras que levam a cada aba (sem acento,
// minúsculas). O nome da própria aba também conta.
const TAB_KEYWORDS = {
  PROFILE: 'perfil avatar foto banner bio biografia nome exibicao cor pronomes status miniperfil mini perfil pingente fonte efeito botao bolha tag clube',
  PROFILE_CONTENT: 'conteudo enquete enquetes album fotos conquistas destaque',
  COLUMNS: 'colunas secoes ordem organizar perfil',
  ACCOUNT: 'conta email e-mail nome de usuario username desativar excluir apagar',
  SECURITY: 'seguranca senha chave de acesso passkey digital trocar senha 2fa dois fatores autenticacao sessoes dispositivos pedidos de amizade amigos',
  ACCOUNT_STATUS: 'status da conta punicoes avisos advertencias banimento',
  PRIVACY: 'privacidade dados mensagens dm direta filtro conteudo jogos quem pode ver atividade jogando ouvindo spotify',
  NOTIFICATIONS: 'notificacoes avisos sons som email alertas',
  VOICE: 'voz video audio microfone saida fone alto-falante teste redutor ruido apertar pra falar push to talk legendas nivelar volume reacoes gravar',
  APPEARANCE: 'aparencia tema layout zoom emoji fundo cores interface',
  ACCESSIBILITY: 'acessibilidade movimento reduzido contraste fonte tamanho leitura',
  SYSTEM: 'sistema ajuda tour boas-vindas atalhos teclado inicializacao bandeja iniciar com o windows versao atualizacao atualizar sobre apk',
  LANGUAGE: 'idioma lingua horario hora data formato',
  GAMES: 'jogos apps deteccao atividade overlay sobreposicao compartilhar registrados',
};
// Uma linha explicando cada aba (topo da página de conteúdo).
const TAB_DESCRIPTION = {
  PROFILE: 'Foto, banner, nome, cores e o seu miniperfil.',
  PROFILE_CONTENT: 'Enquetes, álbum de fotos e conquistas em destaque.',
  COLUMNS: 'Escolha a ordem das seções do seu perfil.',
  ACCOUNT: 'Nome de usuário, e-mail e opções da conta.',
  SECURITY: 'Senha, verificação em duas etapas e sessões abertas.',
  ACCOUNT_STATUS: 'Situação da sua conta e avisos recebidos.',
  PRIVACY: 'Quem pode ver seu perfil, seus jogos e falar com você.',
  NOTIFICATIONS: 'Quando e como o Project Club te avisa.',
  VOICE: 'Microfone, saída, redutor de ruído, apertar pra falar e legendas.',
  APPEARANCE: 'Tema, layout, zoom e estilo dos emojis.',
  ACCESSIBILITY: 'Movimento, contraste e leitura confortável.',
  SYSTEM: 'Atalhos e comportamento do aplicativo.',
  LANGUAGE: 'Idioma e formato de data e hora.',
  GAMES: 'Detecção de jogos, atividade e sobreposição.',
};
// Link de conexão: vazio vale; senão precisa parecer um endereço (o
// servidor completa o "https://" sozinho).
const looksLikeLink = (v) => !v || !v.trim() || /^(https?:\/\/)?[\w-]+(\.[\w-]+)+([/?#]\S*)?$/i.test(v.trim());
// Nome falado por leitor de tela de cada chave liga/desliga.
const TOGGLE_LABEL = {
  reducedMotion: 'Movimento reduzido', highContrast: 'Contraste alto',
  desktopNotifications: 'Notificações de desktop', emailNotifications: 'Notificações por e-mail', notificationSounds: 'Sons de notificação',
  startWithSystem: 'Iniciar com o sistema', minimizeToTray: 'Minimizar para a bandeja', openLinksInApp: 'Abrir links no aplicativo',
  confirmOnExit: 'Confirmar antes de sair', developerMode: 'Modo desenvolvedor',
  gameDetectionEnabled: 'Detecção automática de jogos', activitySharing: 'Compartilhar atividade',
  overlayEnabled: 'Sobreposição no jogo', overlayNotifications: 'Notificações na sobreposição',
};
// Requisitos da senha nova (os mesmos que o servidor confere).
function passwordRules(pw) {
  const v = pw || '';
  return [
    { ok: v.length >= 8, label: 'Pelo menos 8 caracteres' },
    { ok: /[A-Za-zÀ-ÿ]/.test(v), label: 'Pelo menos uma letra' },
    { ok: /\d/.test(v), label: 'Pelo menos um número' },
  ];
}
// "Ctrl+Shift+K" a partir de um keydown (null se só apertou modificador).
function comboFromEvent(e) {
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return null;
  const parts = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  if (e.metaKey) parts.push('Meta');
  const key = e.key === ' ' ? 'Espaço' : e.key.length === 1 ? e.key.toUpperCase() : e.key;
  parts.push(key);
  return parts.join('+');
}
// "Agora: 14:32" / "2:32 PM" conforme o formato escolhido.
function formatClockSample(fmt, lang) {
  const opts = { hour: 'numeric', minute: '2-digit' };
  if (fmt === '12h') opts.hour12 = true;
  if (fmt === '24h') opts.hour12 = false;
  try { return new Date().toLocaleTimeString(lang || 'pt-BR', opts); } catch { return new Date().toLocaleTimeString('pt-BR', opts); }
}
const normalizeSearch = (v) => String(v || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

export default function UserSettingsModal({ onClose }) {
  const { t: translate } = useTranslation();
  const { user, setUser, logout } = useAuth();
  const navigate = useNavigate();
  // Seletor com comparação rasa: antes era useStore() sem seletor, que
  // re-renderizava este modal inteiro a CADA mudança do store (mensagem
  // chegando, alguém digitando, presença...) enquanto ele estava aberto.
  const { layoutStyle, setLayoutStyle: setLayoutStyleStore, customBackground, setCustomBackground, emojiStyle, setEmojiStyle: setEmojiStyleStore, myClan, chatZoom, setChatZoom: setChatZoomStore, interfaceZoom, setInterfaceZoom: setInterfaceZoomStore, userSettings, updateUserSetting } = useStore(useShallow((s) => ({
    layoutStyle: s.layoutStyle, setLayoutStyle: s.setLayoutStyle, customBackground: s.customBackground, setCustomBackground: s.setCustomBackground, emojiStyle: s.emojiStyle, setEmojiStyle: s.setEmojiStyle, myClan: s.myClan, chatZoom: s.chatZoom, setChatZoom: s.setChatZoom, interfaceZoom: s.interfaceZoom, setInterfaceZoom: s.setInterfaceZoom, userSettings: s.userSettings, updateUserSetting: s.updateUserSetting,
  })));
  const disabledSystems = useStore((s) => s.disabledSystems);
  // Ver adminController.js (TOGGLEABLE_SYSTEMS) e a nova opção "Cores
  // personalizadas para perfil" em /admin → Sistema: quando a staff
  // desativa esse sistema, a seção de editar a cor do perfil abaixo some
  // por completo pra todo mundo (o valor já salvo continua sendo usado
  // normalmente em todo o app — só a EDIÇÃO fica bloqueada, ver também o
  // guard equivalente em server/src/controllers/userController.js).
  const profileColorEditEnabled = !disabledSystems.includes('cores_perfil');
  // Volta de "Conectar conta" (OAuthReturnPage) abre direto em Segurança.
  const [tab, setTab] = useState(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem('pc-settings-open-tab') || 'null');
      if (saved?.tab && Date.now() - saved.at < 60 * 1000) return saved.tab;
      sessionStorage.removeItem('pc-settings-open-tab');
    } catch { /* sem sessionStorage */ }
    return 'PROFILE';
  });
  useEffect(() => {
    if (tab !== 'SECURITY') { try { sessionStorage.removeItem('pc-settings-open-tab'); } catch { /* sem storage */ } }
  }, [tab]);
  // Busca de configurações (filtra as abas da barra lateral)
  const [settingsQuery, setSettingsQuery] = useState('');
  // Item pedido: verificar todos os sistemas de Configurações e afins —
  // diagnóstico de instalações duplicadas do app desktop. Só busca de
  // verdade quando existe (window.electronAPI), então continua vazio
  // sem efeito nenhum no navegador/mobile.
  const [appDiag, setAppDiag] = useState(null); // { version, path }
  useEffect(() => {
    if (!window.electronAPI?.getAppVersion) return;
    Promise.all([window.electronAPI.getAppVersion(), window.electronAPI.getAppInstallPath?.()])
      .then(([version, path]) => setAppDiag({ version, path }))
      .catch(() => {});
  }, []);
  const { promptAsync, confirmAsync, DialogElement } = usePromptDialog();
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

  const removeIdCardNow = async () => {
    const { user: updated } = await removeIdCard();
    setUser(updated);
  };
  const [form, setForm] = useState({
    displayName: user.displayName, bio: user.bio || '', pronouns: user.pronouns || '',
    customStatus: user.customStatus || '', customStatusEmoji: user.customStatusEmoji || '', profileColor: user.profileColor,
    // Item pedido: cor da barra de nível personalizável — null usa o
    // verde padrão (ver .profile-level-progress-fill em global.css).
    levelBarColor: user.levelBarColor || '',
    // Item pedido: "cores do mini perfil separadas do perfil grande"
    miniProfileColor: user.miniProfileColor || '',
    miniProfileButtonColor: user.miniProfileButtonColor || '',
    // (Removido) A cor personalizada da bolinha de status (statusBubbleColor)
    // não é mais oferecida na interface — a bolinha mostra só a cor real
    // da presença. A coluna no banco continua existindo (não é mais lida
    // nem enviada daqui); ver schema.prisma e userController.js.
    profileNameFont: user.profileNameFont || 'NORMAL',
    profileNameEffect: user.profileNameEffect || 'SOLID',
    profileNameColor: user.profileNameColor || '#F2894D',
    profileNameColor2: user.profileNameColor2 || '#FFFFFF',
    // Item pedido: "poder editar cada cor... do arco-íris/glitch" —
    // array de cores pros efeitos com mais de 2 cores (ver
    // DEFAULT_MULTI_COLORS em utils/nameStyle.js). String vazia = usa
    // as cores padrão daquele efeito.
    profileNameColors: user.profileNameColors || '',
    // Conexões — plain profile links shown as icon-buttons under the user's
    // profile card (see UserProfileModal.jsx). No OAuth/verification, just
    // an optional URL per platform.
    youtubeUrl: user.youtubeUrl || '', steamUrl: user.steamUrl || '',
    robloxUrl: user.robloxUrl || '', xUrl: user.xUrl || '',
  });
  const [username, setUsernameField] = useState(user.username);
  // Item pedido: "quero que abra um menu e mostre as fontes" — em vez
  // do grid sempre visível, um botão compacto abre um popover só
  // quando clicado.
  const [fontMenuOpen, setFontMenuOpen] = useState(false);
  const [effectMenuOpen, setEffectMenuOpen] = useState(false);
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

  const saveProfile = async (snapshot = form) => {
    const { user: updated } = await trackSave(updateProfile(snapshot));
    setUser(updated);
  };

  // Salvamento automático (sem botão "Salvar alterações"): texto espera
  // ~800ms depois da última tecla; cores/opções salvam logo em seguida.
  const PROFILE_TEXT_FIELDS = ['displayName', 'bio', 'pronouns', 'customStatus', 'youtubeUrl', 'steamUrl', 'robloxUrl', 'xUrl'];
  const savedFormRef = useRef(form);
  const latestFormRef = useRef(form);
  latestFormRef.current = form;
  const formSaveTimerRef = useRef(null);
  useEffect(() => {
    const prev = savedFormRef.current;
    const changed = Object.keys(form).filter((k) => form[k] !== prev[k]);
    if (!changed.length) return;
    if (!form.displayName.trim()) return; // nome vazio não é salvo
    clearTimeout(formSaveTimerRef.current);
    const delay = changed.some((k) => PROFILE_TEXT_FIELDS.includes(k)) ? 800 : 200;
    formSaveTimerRef.current = setTimeout(() => {
      formSaveTimerRef.current = null;
      savedFormRef.current = form;
      saveProfile(form).catch(() => {});
    }, delay);
  }, [form]);
  // Fechou a janela antes do tempo? Salva o que faltava na hora.
  useEffect(() => () => {
    if (!formSaveTimerRef.current) return;
    clearTimeout(formSaveTimerRef.current);
    const latest = latestFormRef.current;
    if (latest.displayName.trim()) trackSave(updateProfile(latest)).then(({ user: updated }) => setUser(updated)).catch(() => {});
  }, []);

  const [friendRequestPrivacy, setFriendRequestPrivacy] = useState(user.friendRequestPrivacy || 'EVERYONE');
  const saveFriendRequestPrivacy = async (value) => {
    setFriendRequestPrivacy(value);
    const { user: updated } = await trackSave(updateProfile({ friendRequestPrivacy: value }));
    setUser(updated);
  };

  // Item pedido: "sistema igual da Steam" — ordem das seções do
  // perfil (aba Colunas). Mesmo padrão de salvamento das outras
  // preferências acima.
  const saveProfileSectionOrder = async (orderJson) => {
    const { user: updated } = await trackSave(updateProfile({ profileSectionOrder: orderJson }));
    setUser(updated);
  };

  // Aniversário saiu das Configurações (segurança de dados) — o campo
  // no banco continua existindo, só não é mais editado/mostrado.

  // Item pedido: "opacidade das caixas das colunas" — padrão de 3.5%
  // (o mesmo valor fixo que já existia no CSS antes dessa opção
  // existir, ver .profile-section em global.css) quando a pessoa
  // nunca mexeu nisso.
  const [sectionOpacity, setSectionOpacity] = useState(user.profileSectionOpacity ?? 3);
  const saveSectionOpacity = async (value) => {
    const { user: updated } = await trackSave(updateProfile({ profileSectionOpacity: value }));
    setUser(updated);
  };

  // Item pedido: "centralizar em Configurações" — tag da comunidade
  // (voltou pra cá) e enquetes de perfil (criar/apagar — a exibição +
  // votação continua no próprio perfil, pra quem visita poder votar).
  const [tagSaving, setTagSaving] = useState(false);
  // Pingente: agora é SEMPRE uma imagem/GIF enviada pela própria pessoa
  // (o catálogo da staff foi removido a pedido).
  const [pendantSaving, setPendantSaving] = useState(false);
  const [pendantError, setPendantError] = useState('');
  const uploadCustomPendant = async (file) => {
    setPendantError('');
    if (file.size > 10 * 1024 * 1024) { setPendantError('Imagem grande demais: o limite do pingente é 10 MB.'); return; }
    setPendantSaving(true);
    try {
      const { user: updated } = await uploadMyCustomPendant(file);
      setUser(updated);
    } catch (err) {
      setPendantError(err.response?.data?.error || 'Não foi possível enviar o pingente.');
    } finally {
      setPendantSaving(false);
    }
  };
  const clearCustomPendant = async () => {
    setPendantSaving(true);
    try {
      const { user: updated } = await removeMyCustomPendant();
      setUser(updated);
    } finally {
      setPendantSaving(false);
    }
  };
  // Item pedido: "quero que a tag do clã apareça... se não tiver tag
  // de um clã não apareça nada" — a tag genérica de comunidade foi
  // removida de vez (não existe mais como opção na tela), então essa
  // função só cuida da tag do clã em si, sem mais precisar desligar
  // nenhuma outra coisa junto.
  const pickClanTag = async (active) => {
    setTagSaving(true);
    try {
      const { clanTagId, clanTag } = await setMyClanTag(active ? myClan.tags[0].id : null);
      setUser({ ...user, clanTagId, clanTag });
    } finally {
      setTagSaving(false);
    }
  };

  const [myPolls, setMyPolls] = useState([]);
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState(['', '']);
  const [pollCreating, setPollCreating] = useState(false);
  const [pollError, setPollError] = useState('');
  useEffect(() => {
    listProfilePollsByAuthor(user.id).then((d) => setMyPolls(d.polls)).catch(() => {});
  }, [user.id]);

  const createPoll = () => {
    const cleanOptions = pollOptions.map((o) => o.trim()).filter(Boolean);
    if (pollCreating) return;
    // Antes o botão simplesmente não fazia nada sem pergunta/opções.
    if (!pollQuestion.trim()) { setPollError('Escreva a pergunta da enquete.'); return; }
    if (cleanOptions.length < 2) { setPollError('Preencha pelo menos 2 opções.'); return; }
    if (new Set(cleanOptions.map((o) => o.toLowerCase())).size !== cleanOptions.length) { setPollError('Há opções repetidas.'); return; }
    setPollCreating(true);
    setPollError('');
    createProfilePoll(pollQuestion.trim(), cleanOptions)
      .then((d) => { setMyPolls((prev) => [d.poll, ...prev]); setPollQuestion(''); setPollOptions(['', '']); })
      .catch((err) => setPollError(err?.response?.data?.error || 'Não foi possível criar a enquete.'))
      .finally(() => setPollCreating(false));
  };

  const removePoll = async (pollId) => {
    if (!(await confirmAsync('Apagar essa enquete?'))) return;
    deleteProfilePoll(pollId).then(() => setMyPolls((prev) => prev.filter((p) => p.id !== pollId))).catch(() => {});
  };

  const [albumManagerOpen, setAlbumManagerOpen] = useState(false);

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
  // Tema preto é o único agora (sem seletor de tema) — ver useStore.setTheme.

  // Item pedido: "em aparência adicione uma nova opção de layout, a
  // opção normal e a opção de layout discord" — mesmo padrão de
  // pickTheme acima.
  const pickLayoutStyle = (l) => {
    setLayoutStyleStore(l);
    trackSave(setLayoutStyle(l)).catch(() => {});
  };

  // Item pedido: "sistema podendo mudar o zoom de 1,0 até 2,0... pra
  // melhor personalização" — mesmo padrão de pickTheme acima (aplica
  // na hora, salva na conta em segundo plano).
  // Salva na conta só depois que a pessoa para de mexer (ver utils/zoomSave.js).
  const pickChatZoom = (z) => {
    setChatZoomStore(z);
    chatZoomSaver.known(user?.chatZoom);
    chatZoomSaver.schedule(z);
  };

  // Item pedido: "adicione nas configurações do usuário ele poder
  // aumentar ou diminuir o zoom quanto quiser" — zoom GERAL de toda a
  // interface, mesmo padrão de pickChatZoom acima.
  const pickInterfaceZoom = (z) => {
    setInterfaceZoomStore(z);
    interfaceZoomSaver.known(user?.interfaceZoom);
    interfaceZoomSaver.schedule(z);
  };

  // Item pedido: "5 variantes de visual dos meus emoji" — mesmo padrão
  // de pickTheme acima.
  const pickEmojiStyleSetting = (s) => {
    setEmojiStyleStore(s);
    trackSave(setEmojiStyleApi(s)).catch(() => {});
  };

  const usernameChangedAtMs = user.usernameChangedAt ? new Date(user.usernameChangedAt).getTime() : 0;
  const usernameCooldownUntil = usernameChangedAtMs && Date.now() - usernameChangedAtMs < 7 * 24 * 60 * 60 * 1000
    ? new Date(usernameChangedAtMs + 7 * 24 * 60 * 60 * 1000)
    : null;
  const saveUsername = async (value = username) => {
    setError('');
    try {
      const { user: updated } = await trackSave(updateUsername(value));
      setUser(updated);
    } catch (err) { setError(err.response?.data?.error || 'Erro.'); }
  };
  // Nome de usuário salva sozinho ~1s depois de parar de digitar.
  // Mesmas regras do servidor (utils/usernameRules.js) — inclusive o
  // intervalo de 7 dias entre trocas, avisado aqui antes de tentar.
  useEffect(() => {
    const value = username.trim();
    if (value === user.username) { setError(''); return undefined; }
    if (!/^[a-zA-Z0-9_.]{3,32}$/.test(value)) {
      setError('A ClubTag deve ter de 3 a 32 caracteres: letras, números, _ ou ponto.');
      return undefined;
    }
    if (usernameCooldownUntil) {
      setError(`Você só pode trocar sua ClubTag uma vez a cada 7 dias. Próxima troca liberada em ${usernameCooldownUntil.toLocaleString('pt-BR')}.`);
      return undefined;
    }
    const id = setTimeout(() => saveUsername(value), 1000);
    return () => clearTimeout(id);
  }, [username]);

  // Item pedido: "abra um menu pra você selecionar a área que quer
  // mostrar... vai mostrar um retângulo, quadrado, etc" — em vez de
  // mandar o arquivo escolhido direto pro upload, abre o recortador
  // com a proporção certa pra cada caso (quadrado pro avatar, bem
  // largo pro banner) — só faz o upload de verdade quando a pessoa
  // confirma o enquadramento.
  const [cropperState, setCropperState] = useState(null); // { file, aspectRatio, shape, onConfirm } | null

  // BUG CORRIGIDO ("banner/avatar em GIF parou de animar"): o
  // recortador desenha a imagem num <canvas> e exporta como JPEG —
  // isso sempre "achata" a animação num único frame estático, já que
  // <canvas>/JPEG não têm como preservar quadros de GIF (recortar um
  // GIF de verdade, quadro a quadro, preservando a animação, exigiria
  // decodificar/recompor cada frame manualmente — fora do escopo
  // razoável aqui). GIF pula o recortador e vai direto pro upload,
  // exatamente como funcionava antes dele existir.
  //
  // isGifFile checa também a extensão do arquivo, não só file.type —
  // esse campo vem do próprio navegador/sistema operacional
  // detectando o tipo sozinho, e raramente (mas às vezes) vem vazio
  // ou errado pra um GIF de verdade, dependendo de como o arquivo foi
  // salvo originalmente; isso faria o arquivo passar batido pelo
  // recortador mesmo sendo GIF, achatando a animação de qualquer jeito.
  const isGifFile = looksLikeGif;
  // GIF vai direto (sem recorte, pra manter a animação). Antes, se o envio
  // falhasse (arquivo grande demais, etc.) nada acontecia na tela.
  const MAX_GIF_MB = 25;
  const uploadGif = (file, uploader) => {
    if (file.size > MAX_GIF_MB * 1024 * 1024) {
      useStore.getState().pushNotice(`Esse GIF tem ${(file.size / 1048576).toFixed(1)} MB. O limite é ${MAX_GIF_MB} MB.`);
      return;
    }
    useStore.getState().pushNotice('Enviando GIF…');
    uploader(file)
      .then(({ user: updated }) => { setUser(updated); useStore.getState().pushNotice('GIF aplicado!'); })
      .catch((err) => useStore.getState().pushNotice(err.response?.data?.error || 'Não foi possível enviar o GIF.'));
  };

  const onAvatar = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    e.target.value = ''; // permite escolher o MESMO arquivo de novo depois de cancelar
    // GIF (detectado pelo conteúdo, ver utils/gifDetect): abre o editor só
    // pra ENQUADRAR (modo 'frame' — sem canvas, a animação continua) e o
    // servidor recorta todos os quadros com esse enquadramento.
    if (await isGifByContent(file)) {
      if (file.size > GIF_AVATAR_MAX_MB * 1024 * 1024) {
        useStore.getState().pushNotice(`Esse GIF tem ${(file.size / 1048576).toFixed(1)} MB. O limite para foto de perfil é ${GIF_AVATAR_MAX_MB} MB.`);
        return;
      }
      setCropperState({
        file, mode: 'frame', gif: true, aspectRatio: 1, shape: 'circle', title: 'Ajustar avatar (GIF)', preview: 'avatar',
        onConfirm: async (outFile, framing) => {
          useStore.getState().pushNotice('Enviando GIF…');
          const { user: updated } = await uploadAvatar(outFile, framing);
          setUser(updated);
          setCropperState(null);
          useStore.getState().pushNotice('GIF aplicado!');
        },
      });
      return;
    }
    setCropperState({
      file, aspectRatio: 1, shape: 'circle', title: 'Ajustar avatar', preview: 'avatar',
      onConfirm: async (cropped) => {
        const { user: updated } = await uploadAvatar(cropped);
        setUser(updated);
        setCropperState(null);
      },
    });
  };

  // Item pedido: "remover o fundo preto das fotos de perfil" — reabre a
  // foto ATUAL no editor (pelo nosso servidor, pra poder ler os pixels)
  // com "Tirar fundo preto", sem precisar achar o arquivo de novo.
  const canFixAvatarBg = !!user.avatarUrl && !isPenguinAvatarUrl(user.avatarUrl) && !/\.gif(\?|$)/i.test(user.avatarUrl);
  const fixAvatarBackground = () => {
    if (!canFixAvatarBg) return;
    setCropperState({
      file: null, src: proxyImage(user.avatarUrl), aspectRatio: 1, shape: 'circle', title: 'Tirar fundo da foto', preview: 'avatar',
      onConfirm: async (cropped) => {
        const { user: updated } = await uploadAvatar(cropped);
        setUser(updated);
        setCropperState(null);
      },
    });
  };

  const pickPenguinAvatar = async (colorKey) => {
    const { user: updated } = await updateProfile({ avatarUrl: penguinAvatarUrl(colorKey) });
    setUser(updated);
  };

  // Editor de banner estilo Discord (ImageCropperModal): a moldura tem
  // a MESMA proporção da faixa do perfil (PROFILE_BANNER_ASPECT /
  // MINI_BANNER_ASPECT em ProfileBanner.jsx), então o que aparece no
  // editor é o que aparece no perfil.
  //  - Imagem estática: recorta no navegador e envia já recortada.
  //  - GIF: canvas perderia a animação → envia o GIF original junto com
  //    o enquadramento escolhido ("x,y,zoom"), que a exibição aplica.
  const gifTooBig = (file) => {
    if (file.size <= MAX_GIF_MB * 1024 * 1024) return false;
    useStore.getState().pushNotice(`Esse GIF tem ${(file.size / 1048576).toFixed(1)} MB. O limite é ${MAX_GIF_MB} MB.`);
    return true;
  };
  const openBannerEditor = (file, kind) => {
    const isMini = kind === 'mini';
    const uploader = isMini ? uploadMiniProfileBanner : uploadBanner;
    const gif = isGifFile(file);
    if (gif && gifTooBig(file)) return;
    setCropperState({
      file,
      mode: gif ? 'frame' : 'crop',
      aspectRatio: isMini ? MINI_BANNER_ASPECT : PROFILE_BANNER_ASPECT,
      shape: 'rect',
      preview: isMini ? 'mini' : 'banner',
      title: isMini ? 'Ajustar banner do miniperfil' : 'Ajustar banner do perfil',
      onConfirm: async (outFile, framing) => {
        const { user: updated } = await uploader(outFile, framing);
        setUser(updated);
        setCropperState(null);
        useStore.getState().pushNotice(gif ? 'GIF aplicado!' : 'Banner atualizado!');
      },
    });
  };
  // Reajustar o enquadramento do banner ATUAL sem enviar de novo — só
  // salva o "x,y,zoom" (serve pra imagem estática e GIF).
  const adjustCurrentBanner = (kind) => {
    const isMini = kind === 'mini';
    const bannerUrl = isMini ? user.miniProfileBannerUrl : user.bannerUrl;
    if (!bannerUrl) return;
    setCropperState({
      src: proxyImage(bannerUrl),
      mode: 'frame',
      initialFraming: isMini ? user.miniProfileBannerFraming : user.bannerFraming,
      aspectRatio: isMini ? MINI_BANNER_ASPECT : PROFILE_BANNER_ASPECT,
      shape: 'rect',
      preview: isMini ? 'mini' : 'banner',
      title: 'Ajustar enquadramento',
      onConfirm: async (_file, framing) => {
        const { user: updated } = await updateProfile(isMini ? { miniProfileBannerFraming: framing } : { bannerFraming: framing });
        setUser(updated);
        setCropperState(null);
      },
    });
  };

  // Placa de identificação (User.idCardUrl): mesmo editor dos banners, pra
  // a pessoa posicionar e dar zoom (arrastar + pinça/roda) na imagem antes
  // de enviar. Imagem estática recorta no navegador; GIF envia o original
  // + enquadramento ("x,y,zoom"), que a lista de membros aplica no fundo.
  const openIdCardEditor = (file) => {
    const gif = isGifFile(file);
    if (gif && gifTooBig(file)) return;
    setCropperState({
      file,
      mode: gif ? 'frame' : 'crop',
      aspectRatio: ID_CARD_ASPECT,
      shape: 'rect',
      preview: 'banner',
      title: 'Ajustar a placa de identificação',
      onConfirm: async (outFile, framing) => {
        const { user: updated } = await uploadIdCard(outFile, framing);
        setUser(updated);
        setCropperState(null);
        useStore.getState().pushNotice(gif ? 'GIF aplicado!' : 'Placa atualizada!');
      },
    });
  };
  // Reposicionar a placa ATUAL sem reenviar a imagem — só salva o "x,y,zoom".
  const adjustCurrentIdCard = () => {
    if (!user.idCardUrl) return;
    setCropperState({
      src: proxyImage(user.idCardUrl),
      mode: 'frame',
      initialFraming: user.idCardFraming,
      aspectRatio: ID_CARD_ASPECT,
      shape: 'rect',
      preview: 'banner',
      title: 'Ajustar enquadramento da placa',
      onConfirm: async (_file, framing) => {
        const { user: updated } = await updateProfile({ idCardFraming: framing });
        setUser(updated);
        setCropperState(null);
      },
    });
  };

  const onBanner = (e) => {
    const file = e.target.files[0]; if (!file) return;
    e.target.value = '';
    openBannerEditor(file, 'profile');
  };

  // Item pedido: "dois banners independentes" — mesmo padrão de
  // onBanner acima, só salvando no campo separado do miniperfil.
  const onMiniProfileBanner = (e) => {
    const file = e.target.files[0]; if (!file) return;
    e.target.value = '';
    openBannerEditor(file, 'mini');
  };

  // 2FA (configurar/desativar/códigos de recuperação) mora no componente
  // TwoFactorBlock, mais abaixo neste arquivo.

  // "Onde estou logado" — loaded lazily the first time the Security tab is
  // actually opened, not on every settings modal mount, since it's an extra
  // request nobody needs for the (much more common) Profile/Appearance tabs.
  useEffect(() => {
    if (tab !== 'SECURITY' || sessions !== null) return;
    listSessions().then((d) => setSessions(d.sessions)).catch(() => setSessionsError('Não foi possível carregar suas sessões.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // Item pedido: "Jogos adicionados... Minecraft [Remover], Palworld
  // [Remover]" — mesmo padrão de "Sessões ativas" acima: só carrega
  // na primeira vez que a aba GAMES é aberta de verdade.
  const [games, setGames] = useState(null);
  const [gamesError, setGamesError] = useState('');
  const [newGameName, setNewGameName] = useState('');
  const [addingGame, setAddingGame] = useState(false);
  useEffect(() => {
    if (tab !== 'GAMES' || games !== null) return;
    listRegisteredGames().then((d) => setGames(d.games)).catch(() => setGamesError('Não foi possível carregar seus jogos.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const submitAddGame = async () => {
    const displayName = newGameName.trim();
    if (!displayName || addingGame) return;
    if ((games || []).some((g) => g.displayName.toLowerCase() === displayName.toLowerCase())) {
      setGamesError('Esse jogo já está na sua lista.');
      return;
    }
    setGamesError('');
    setAddingGame(true);
    try {
      // gameKey é gerado a partir do nome digitado — simples e
      // suficiente pra esta fase (sem catálogo de jogos conhecidos
      // ainda), já que o backend normaliza/valida de qualquer jeito.
      const gameKey = displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 64);
      const { game } = await addRegisteredGame({ gameKey, displayName });
      setGames((prev) => [...(prev || []), game]);
      setNewGameName('');
    } catch (err) {
      setGamesError(err.response?.data?.error || 'Não foi possível adicionar esse jogo.');
    } finally {
      setAddingGame(false);
    }
  };

  const removeGameFromList = async (id) => {
    try {
      await removeRegisteredGame(id);
      setGames((prev) => prev.filter((g) => g.id !== id));
    } catch {
      setGamesError('Não foi possível remover esse jogo.');
    }
  };

  // Item pedido: "Atalhos personalizados... verificar se já existe
  // outro comando usando a combinação" — mesmo padrão de "Jogos
  // adicionados" acima: carrega só quando a aba SYSTEM é aberta.
  const [shortcuts, setShortcuts] = useState(null);
  const [shortcutsError, setShortcutsError] = useState('');
  const [newShortcutAction, setNewShortcutAction] = useState('');
  const [newShortcutCombo, setNewShortcutCombo] = useState('');
  const [savingShortcut, setSavingShortcut] = useState(false);
  useEffect(() => {
    if (tab !== 'SYSTEM' || shortcuts !== null) return;
    listMyShortcuts().then((d) => setShortcuts(d.shortcuts)).catch(() => setShortcutsError('Não foi possível carregar seus atalhos.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // Tempo real (11s): listas da aba aberta (sessões de outros
  // dispositivos, jogos, atalhos) e enquetes — campos sendo editados
  // ficam como estão (só listas carregadas são atualizadas).
  useLiveRefresh(async ({ put }) => {
    await Promise.allSettled([
      listProfilePollsByAuthor(user.id).then((d) => put(setMyPolls)(d.polls)),
      tab === 'SECURITY' && sessions !== null ? listSessions().then((d) => put(setSessions)(d.sessions)) : null,
      tab === 'GAMES' && games !== null ? listRegisteredGames().then((d) => put(setGames)(d.games)) : null,
      tab === 'SYSTEM' && shortcuts !== null ? listMyShortcuts().then((d) => put(setShortcuts)(d.shortcuts)) : null,
    ]);
  });

  const submitShortcut = async () => {
    const action = newShortcutAction.trim();
    const combo = newShortcutCombo.trim();
    if (!action || !combo || savingShortcut) return;
    setShortcutsError('');
    setSavingShortcut(true);
    try {
      const { shortcut } = await setShortcut(action, combo);
      setShortcuts((prev) => [...(prev || []).filter((s) => s.action !== shortcut.action), shortcut]);
      setNewShortcutAction('');
      setNewShortcutCombo('');
    } catch (err) {
      setShortcutsError(err.response?.data?.error || 'Não foi possível salvar esse atalho.');
    } finally {
      setSavingShortcut(false);
    }
  };

  const removeShortcutFromList = async (id) => {
    try {
      await deleteShortcut(id);
      setShortcuts((prev) => prev.filter((s) => s.id !== id));
    } catch {
      setShortcutsError('Não foi possível remover esse atalho.');
    }
  };

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

  // Item pedido: "repaginada completa em Configurações... adicionando"
  // — a aba Minha Conta não tinha NENHUM jeito de trocar a própria
  // senha (só o fluxo de "esqueci minha senha" por e-mail existia)
  // nem de encerrar a conta. Backend novo: changePassword/deleteAccount
  // (authController.js) — a "exclusão" na verdade desativa a conta
  // (accountDisabledAt no schema), sem apagar nada de verdade, pra não
  // quebrar mensagens/posts antigos de outras pessoas.
  const [pwForm, setPwForm] = useState({ current: '', next: '', confirm: '' });
  const [pwError, setPwError] = useState('');
  const [pwSuccess, setPwSuccess] = useState(false);
  const [pwSaving, setPwSaving] = useState(false);
  const submitChangePassword = async () => {
    setPwError(''); setPwSuccess(false);
    if (pwForm.next !== pwForm.confirm) { setPwError('As duas senhas novas não são iguais.'); return; }
    if (!passwordRules(pwForm.next).every((r) => r.ok)) { setPwError('A senha nova ainda não cumpre todos os requisitos.'); return; }
    if (pwForm.next === pwForm.current) { setPwError('A senha nova precisa ser diferente da atual.'); return; }
    setPwSaving(true);
    try {
      await changePassword(pwForm.current, pwForm.next);
      setPwForm({ current: '', next: '', confirm: '' });
      setPwSuccess(true);
      // O servidor encerrou as outras sessões — a lista já reflete isso.
      setSessions((s) => s?.filter((sess) => sess.isCurrent));
    } catch (err) {
      setPwError(err.response?.data?.error || 'Não foi possível trocar a senha.');
    } finally {
      setPwSaving(false);
    }
  };

  const [deleteError, setDeleteError] = useState('');
  const [deleting, setDeleting] = useState(false);
  // Desativar temporariamente: entrar de novo reativa (nada é apagado).
  const startDeactivate = async () => {
    if (!(await confirmAsync('Desativar sua conta por um tempo? Você sai de todos os aparelhos, some das buscas e ninguém consegue te mandar mensagem. É só entrar de novo pra reativar.'))) return;
    const password = await promptAsync('Digite sua senha pra confirmar:');
    if (!password) return;
    setDeleteError('');
    setDeleting(true);
    try {
      await deactivateAccount(password);
      await logout();
      onClose();
      navigate('/login');
    } catch (err) {
      setDeleteError(err.response?.data?.error || 'Senha incorreta.');
      setDeleting(false);
    }
  };

  const startDeleteAccount = async () => {
    if (!(await confirmAsync('Tem certeza que quer desativar sua conta? Você é desconectado na hora e não consegue mais entrar com ela.'))) return;
    const password = await promptAsync('Digite sua senha pra confirmar:');
    if (!password) return;
    setDeleteError('');
    setDeleting(true);
    try {
      await deleteAccount(password);
      await logout();
      onClose();
      navigate('/login');
    } catch (err) {
      setDeleteError(err.response?.data?.error || 'Senha incorreta.');
      setDeleting(false);
    }
  };

  return (
    <>
    <Modal title={<span className="settings-title-row">Configurações do usuário <SaveStatusPill /></span>} onClose={onClose} width="1240px" className="settings-modal-box settings-modal-wide">
      <div className="settings-modal-layout">
        <div className="settings-modal-sidebar">
          {/* Item pedido: "reformule a interface das Configurações...
              use a imagem como referência visual... padrão de fonte,
              cores, espaçamentos, organização" — cabeçalho com
              avatar + nome no topo da barra lateral, igual a
              referência enviada, clicável pra ir direto no Perfil
              (a aba que já tem essa edição). */}
          <button type="button" className="settings-modal-sidebar-header" onClick={() => setTab('PROFILE')}>
            <UserAvatar user={user} size={40} />
            <div className="settings-modal-sidebar-header-text">
              <div className="settings-modal-sidebar-header-name">{user.displayName}</div>
              <div className="settings-modal-sidebar-header-edit">Editar perfil</div>
            </div>
          </button>
          {(() => {
            // Busca: cada palavra digitada precisa aparecer no nome da aba,
            // no nome do grupo ou nas palavras-chave dela.
            const words = normalizeSearch(settingsQuery).split(/\s+/).filter(Boolean);
            const matches = (group, t) => !words.length || words.every((w) => normalizeSearch(`${labelFor(t, translate)} ${group.label} ${TAB_KEYWORDS[t] || ''}`).includes(w));
            const groups = TAB_GROUPS.map((g) => ({ ...g, shown: g.tabs.filter((t) => matches(g, t)) })).filter((g) => g.shown.length > 0);
            const first = groups[0]?.shown[0];
            return (
              <>
                <div className="settings-search" role="search">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
                  <input
                    type="search" value={settingsQuery} placeholder="Buscar configuração"
                    aria-label="Buscar configuração"
                    onChange={(e) => setSettingsQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && first) { setTab(first); }
                      if (e.key === 'Escape' && settingsQuery) { e.stopPropagation(); setSettingsQuery(''); }
                    }}
                  />
                  {settingsQuery && (
                    <button type="button" className="settings-search-clear" aria-label="Limpar busca" onClick={() => setSettingsQuery('')}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
                    </button>
                  )}
                </div>
                {groups.length === 0 && <div className="settings-search-empty">Nenhuma configuração encontrada.</div>}
                {groups.map((group) => (
                  <div key={group.label} className="settings-modal-sidebar-group">
                    <div className="settings-modal-sidebar-group-label">{group.label}</div>
                    {group.shown.map((t) => (
                      <button key={t} className={`settings-modal-sidebar-item ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
                        <span className="settings-modal-sidebar-icon">{iconFor(t)}</span>
                        {labelFor(t, translate)}
                      </button>
                    ))}
                  </div>
                ))}
              </>
            );
          })()}
          <div className="settings-modal-sidebar-divider" />
          <a className="settings-modal-sidebar-item" href="https://livepix.gg/projectclubr" target="_blank" rel="noreferrer" style={{ color: '#ff4d6d', textDecoration: 'none' }}>
            <span className="settings-modal-sidebar-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 20.5s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.7c0 5.6-7.5 10.2-7.5 10.2z" /></svg></span>
            Apoiar o Project Club
          </a>
          <button className="settings-modal-sidebar-item settings-modal-logout" onClick={doLogout}>
            {/* Item pedido: "troque o emoji/ícone de porta... mantenha
                o ícone na cor vermelha, exatamente igual à cor do
                texto" — mesmo padrão IconGlyph (mask-image +
                currentColor) das outras abas: como este botão já
                herda color: var(--red) (.settings-modal-logout, ver
                CSS), o ícone já sai na mesma cor automaticamente, sem
                precisar fixar um valor de cor separado que poderia
                sair dessincronizado do texto no futuro. */}
            <span className="settings-modal-sidebar-icon"><IconGlyph src={logoutIcon} size={16} /></span>
            Sair da conta
          </button>
        </div>
        <div className="settings-modal-content" key={tab}>
      {DialogElement}
      {/* Cabeçalho da página atual (ícone + nome + uma linha de ajuda) */}
      <div className="settings-page-head">
        <span className="settings-page-head-icon">{iconFor(tab)}</span>
        <div className="settings-page-head-text">
          <h2>{labelFor(tab, translate)}</h2>
          {TAB_DESCRIPTION[tab] && <p>{TAB_DESCRIPTION[tab]}</p>}
        </div>
      </div>

      {tab === 'PROFILE' && (
        <div className="settings-grid">
          <div className="settings-block profile-edit-card">
            <div className="profile-preview-banner profile-edit-banner" style={{ background: form.profileColor }}>
              <BannerImage url={user.bannerUrl} framing={user.bannerFraming} />
            </div>
            <div className="profile-edit-identity">
              <div className="avatar large profile-edit-avatar" style={{ background: form.profileColor, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                {isPenguinAvatarUrl(user.avatarUrl)
                  ? <PenguinAvatar color={PENGUIN_COLORS[user.avatarUrl.slice(8)] || PENGUIN_COLORS.blue} size={80} />
                  : user.avatarUrl ? <img src={proxyImage(user.avatarUrl)} alt="" /> : user.displayName[0].toUpperCase()}
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
                <SIcon name="eye" /> Ver miniperfil
              </button>
            </div>

            <div className="profile-edit-body">
              <div className="image-uploads">
                <AvatarChangeMenu onFile={onAvatar} canFixBackground={canFixAvatarBg} onFixBackground={fixAvatarBackground} />
                {/* Item pedido: "adicione uma nova opção chamada mini
                    perfil, mova tudo que é sobre mini perfil pra lá" —
                    o botão de banner do miniperfil (que morava aqui
                    junto do banner do perfil completo) foi pra sua
                    seção "Miniperfil" mais abaixo nesta mesma aba. */}
                <label className="btn-secondary">Alterar banner do perfil completo<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={onBanner} /></label>
                {user.bannerUrl && (
                  <button type="button" className="btn-secondary pb-adjust-btn" onClick={() => adjustCurrentBanner('profile')}>Ajustar enquadramento</button>
                )}
                <span className="dim settings-upload-hint">Aceita GIF animado (até 25 MB)</span>
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
              <label>
                <span className="settings-label-row">NOME DE EXIBIÇÃO <CharCount value={form.displayName} max={32} /></span>
                <input name="displayName" value={form.displayName} onChange={onChange} maxLength={32} aria-invalid={!form.displayName.trim()} />
              </label>
              {!form.displayName.trim() && <FieldError>O nome de exibição não pode ficar vazio. Enquanto estiver vazio, ele não é salvo.</FieldError>}
            </div>
            <label>
              <span className="settings-label-row">PRONOMES <CharCount value={form.pronouns} max={40} /></span>
              <input name="pronouns" value={form.pronouns} onChange={onChange} maxLength={40} placeholder="ele/dele, ela/dela..." />
            </label>
            <label>
              <span className="settings-label-row">BIOGRAFIA <CharCount value={form.bio} max={190} /></span>
              <div className="bio-input-row">
                <textarea name="bio" value={form.bio} onChange={onChange} maxLength={190} placeholder="Conte um pouco sobre você" />
                <div className="composer-picker-anchor">
                  <button type="button" className="icon-btn" title="Emoji" onClick={() => setBioEmojiOpen((v) => !v)}><img className="ui-icon" src={emojiPickerIcon} alt="" /></button>
                  {bioEmojiOpen && <EmojiPicker serverEmojis={useStore.getState().usableEmojis} onPick={insertBioEmoji} onClose={() => setBioEmojiOpen(false)} />}
                </div>
              </div>
            </label>
          </div>

          <div className="profile-edit-columns">
          <div className="settings-block">
            <h4>Status de presença</h4>
            <p className="dim">Escolher qualquer um diferente de Online desativa o "ausente automático" — só volta a valer quando você escolher Online de novo.</p>
            <StatusPicker />
          </div>
          <div className="settings-block">
            <h4>Status personalizado</h4>
            <label>
              <div className="bio-input-row">
                <input name="customStatus" value={form.customStatus} onChange={onChange} maxLength={128} placeholder="O que você está pensando?" />
                <div className="composer-picker-anchor">
                  <button ref={statusEmojiBtnRef} type="button" className="icon-btn" title="Emoji do status" onClick={() => setStatusEmojiOpen((v) => !v)}>
                    {form.customStatusEmoji || <SIcon name="smile" size={18} />}
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
            {(form.customStatus || form.customStatusEmoji) && (
              <button type="button" className="btn-link settings-inline-link" onClick={() => setForm((f) => ({ ...f, customStatus: '', customStatusEmoji: '' }))}>Limpar status</button>
            )}
          </div>

          <div className="settings-block">
            <h4>Pingente</h4>
            <p className="dim">Uma imagenzinha sua (pode ser GIF animado) que aparece ao lado do seu nome no chat, no miniperfil e no perfil completo.</p>
            <div className="pendant-editor">
              <div className="pendant-editor-preview">
                {user.customPendantUrl
                  ? <img src={proxyImage(user.customPendantUrl)} alt="Seu pingente" />
                  : <span aria-hidden="true">+</span>}
              </div>
              <div className="pendant-editor-side">
                <div className="pendant-editor-sample">
                  <strong>{user.displayName}</strong>
                  {user.customPendantUrl && <img src={proxyImage(user.customPendantUrl)} alt="" className="pendant-icon" style={{ width: 20, height: 20 }} />}
                </div>
                <div className="pendant-editor-actions">
                  <label className={`btn-primary pendant-editor-upload${pendantSaving ? ' is-busy' : ''}`}>
                    {pendantSaving ? 'Enviando…' : user.customPendantUrl ? 'Trocar imagem' : 'Enviar imagem'}
                    <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden disabled={pendantSaving} onChange={(e) => { const f = e.target.files[0]; if (f) uploadCustomPendant(f); e.target.value = ''; }} />
                  </label>
                  {user.customPendantUrl && <button type="button" className="btn-link" disabled={pendantSaving} onClick={clearCustomPendant}>Remover</button>}
                </div>
                <span className="dim settings-upload-hint">PNG, JPG, WEBP ou GIF · até 10 MB · imagem quadrada fica melhor</span>
                {pendantError && <span className="pendant-editor-error" role="alert">{pendantError}</span>}
              </div>
            </div>
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
            <h4>Cor da barra de nível</h4>
            <p className="dim">A barra de progresso de nível no seu perfil é verde por padrão — escolha outra cor se preferir.</p>
            <div className="role-color-row profile-color-row">
              <label>
                COR DA BARRA
                <input type="color" value={form.levelBarColor || '#23a55a'} onChange={(e) => setForm((f) => ({ ...f, levelBarColor: e.target.value }))} />
              </label>
              <span className="settings-level-preview" aria-hidden="true"><i style={{ background: form.levelBarColor || 'var(--green)' }} /></span>
              {form.levelBarColor && (
                <button type="button" className="btn-link" onClick={() => setForm((f) => ({ ...f, levelBarColor: '' }))}>Usar verde padrão</button>
              )}
            </div>
          </div>

          {/* Item pedido: "poder mudar a opacidade das caixas das
              colunas, deixando invisível ou mostrando melhor" — 0 =
              sem fundo nenhum (invisível), 100 = fundo bem visível. */}
          <div className="settings-block">
            <h4>Opacidade das caixas do perfil</h4>
            <p className="dim">Controla o quanto o fundo das seções (Sobre, Recados, etc) aparece — 0 deixa invisível, valores altos deixam bem visível.</p>
            <div className="birthday-picker-row">
              <input
                type="range" min={0} max={100} step={5}
                value={sectionOpacity}
                onChange={(e) => { const v = Number(e.target.value); setSectionOpacity(v); saveSectionOpacity(v); }}
              />
              <span className="dim" style={{ minWidth: 36, textAlign: 'right' }}>{sectionOpacity}%</span>
            </div>
          </div>

          <div className="settings-block">
            <h4>Estilo do nome</h4>
            <p className="dim">
              A fonte e a cor abaixo aparecem em mensagens e na lista de membros. Efeitos mais elaborados (néon,
              arco-íris, glitch...) só aparecem no seu mini perfil e perfil completo — em mensagens e na lista de
              membros o nome fica só com a fonte e a cor, mais discreto e legível.
            </p>
            <div className="name-style-preview" style={{ fontSize: 22, fontWeight: 700 }}>
              <span className={nameStyleClassName(form, { fullEffect: true })} style={nameStyleProps(form, { fullEffect: true })}>{form.displayName || user.displayName}</span>
            </div>

            <div className="name-style-picker-row">
              <NameStylePickerButton
                label="Fonte" open={fontMenuOpen} setOpen={setFontMenuOpen}
                currentLabel={NAME_FONTS.find((f) => f.value === form.profileNameFont)?.label}
                menu={(
                  <div className="name-style-picker-menu">
                    <div className="name-style-picker-grid">
                      {NAME_FONTS.map((f) => (
                        <button
                          type="button" key={f.value}
                          className={`name-style-picker-option ${form.profileNameFont === f.value ? 'active' : ''}`}
                          onClick={() => { setForm((s) => ({ ...s, profileNameFont: f.value })); setFontMenuOpen(false); }}
                        >
                          <span className={nameStyleClassName(form, { fullEffect: true })} style={{ ...nameStyleProps(form, { fullEffect: true }), fontFamily: FONT_FAMILY[f.value] }}>Abc</span>
                          <span className="name-style-picker-option-label">{f.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              >
                <span className={`name-style-picker-button-sample ${nameStyleClassName(form, { fullEffect: true })}`} style={{ ...nameStyleProps(form, { fullEffect: true }), fontFamily: FONT_FAMILY[form.profileNameFont] }}>Abc</span>
              </NameStylePickerButton>
            </div>

            <div className="name-style-picker-row">
              <NameStylePickerButton
                label="Efeito" open={effectMenuOpen} setOpen={setEffectMenuOpen}
                currentLabel={NAME_EFFECTS.find((f) => f.value === form.profileNameEffect)?.label}
                menu={(
                  <div className="name-style-picker-menu">
                    <div className="name-style-picker-grid">
                      {NAME_EFFECTS.map((f) => {
                        const previewUser = { ...form, profileNameEffect: f.value };
                        return (
                          <button
                            type="button" key={f.value}
                            className={`name-style-picker-option ${form.profileNameEffect === f.value ? 'active' : ''}`}
                            onClick={() => { setForm((s) => ({ ...s, profileNameEffect: f.value })); setEffectMenuOpen(false); }}
                          >
                            <span className={nameStyleClassName(previewUser, { fullEffect: true })} style={nameStyleProps(previewUser, { fullEffect: true })}>Abc</span>
                            <span className="name-style-picker-option-label">{f.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              >
                <span className={`name-style-picker-button-sample ${nameStyleClassName(form, { fullEffect: true })}`} style={nameStyleProps(form, { fullEffect: true })}>Abc</span>
              </NameStylePickerButton>
            </div>
            {form.profileNameEffect !== 'RAINBOW' && (
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
            )}
            {DEFAULT_MULTI_COLORS[form.profileNameEffect] && (
              <MultiColorEditor effect={form.profileNameEffect} form={form} setForm={setForm} />
            )}
            {form.profileNameEffect !== 'RAINBOW' && form.profileNameEffect !== 'GLITCH' && (
              <NameColorPresets setForm={setForm} />
            )}
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
                  onChange={(e) => { const f = e.target.files[0]; if (f) openIdCardEditor(f); e.target.value = ''; }}
                />
              </label>
              {user.idCardUrl && (
                <button type="button" className="btn-secondary" onClick={adjustCurrentIdCard}>Ajustar posição/zoom</button>
              )}
              {user.idCardUrl && (
                <button className="btn-link danger" onClick={removeIdCardNow}>Remover</button>
              )}
            </div>
          </div>

          </div>

          {/* Miniperfil (antes era uma aba própria): banner, cores e bolha de status. */}
          <div className="settings-section-title" id="settings-miniperfil">Miniperfil</div>
          {/* Item pedido: "acabei com a categoria exibição e passa...
              as conquistas pro perfil e o mini perfil" — a parte do
              miniperfil, movida de dentro da extinta aba "Exibição".
              ATUALIZADO ("remover conquistas em destaque do mini
              perfil, deixar somente no perfil completo") — o
              miniperfil não mostra mais conquistas nenhuma (ver
              MiniProfileCard.jsx), então essa escolha aqui não tinha
              mais efeito nenhum — removida junto. */}
          <div className="settings-block">
            <h4>Banner do miniperfil</h4>
            <p className="dim">Esse banner aparece só no cartão pequeno que abre ao clicar no seu nome/avatar — independente do banner do seu perfil completo.</p>
            {(user.miniProfileBannerUrl || user.bannerUrl) && (
              <div className="pb-mini-preview" style={{ background: user.miniProfileColor || form.profileColor }}>
                <BannerImage
                  url={user.miniProfileBannerUrl || user.bannerUrl}
                  framing={user.miniProfileBannerUrl ? user.miniProfileBannerFraming : user.bannerFraming}
                />
              </div>
            )}
            <div className="pb-settings-actions">
              <label className="btn-secondary">Alterar banner do miniperfil<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={onMiniProfileBanner} /></label>
              {user.miniProfileBannerUrl && (
                <button type="button" className="btn-secondary pb-adjust-btn" onClick={() => adjustCurrentBanner('mini')}>Ajustar enquadramento</button>
              )}
            </div>
            <span className="dim settings-upload-hint">Aceita GIF animado (até 25 MB)</span>
          </div>

          <div className="profile-edit-columns">
          <div className="settings-block">
            <h4>Cor do miniperfil</h4>
            <p className="dim">Sem escolher aqui, o miniperfil usa a mesma cor do seu perfil completo — escolha uma diferente se quiser.</p>
            <div className="role-color-row profile-color-row">
              <label>
                COR DO MINIPERFIL
                <input type="color" value={form.miniProfileColor || form.profileColor} onChange={(e) => setForm((f) => ({ ...f, miniProfileColor: e.target.value }))} />
              </label>
              {form.miniProfileColor && (
                <button type="button" className="btn-link" onClick={() => setForm((f) => ({ ...f, miniProfileColor: '' }))}>Usar a mesma do perfil completo</button>
              )}
            </div>
          </div>

          <div className="settings-block">
            <h4>Cor do botão "Ver perfil completo"</h4>
            <div className="role-color-row profile-color-row">
              <label>
                COR DO BOTÃO
                <input type="color" value={form.miniProfileButtonColor || '#4C9FFF'} onChange={(e) => setForm((f) => ({ ...f, miniProfileButtonColor: e.target.value }))} />
              </label>
              {form.miniProfileButtonColor && (
                <button type="button" className="btn-link" onClick={() => setForm((f) => ({ ...f, miniProfileButtonColor: '' }))}>Usar cor padrão</button>
              )}
            </div>
          </div>

          {/* (Removido) O seletor de "cor de fundo da bolha de status"
              saiu da interface: a bolinha de status mostra só a cor real
              da presença (online/ausente/não perturbe/offline). A coluna
              statusBubbleColor continua no banco, mas não é mais lida
              nem gravada daqui. */}
          </div>

          <div className="settings-block">
            <h4>Conexões</h4>
            <p className="dim">Links que aparecem como botões no seu perfil completo. Deixe vazio pra esconder.</p>
            <div className="profile-edit-connections-grid">
              <label>
                <span className="connection-label"><img className="ui-icon-sm" src={youtubeConnIcon} alt="" /> YOUTUBE</span>
                <input name="youtubeUrl" value={form.youtubeUrl} onChange={onChange} placeholder="Link do seu canal do YouTube" inputMode="url" aria-invalid={!looksLikeLink(form.youtubeUrl)} />
                {!looksLikeLink(form.youtubeUrl) && <FieldError>Isso não parece um link. Exemplo: https://site.com/seu-perfil</FieldError>}
              </label>
              <label>
                <span className="connection-label"><img className="ui-icon-sm" src={steamConnIcon} alt="" /> STEAM</span>
                <input name="steamUrl" value={form.steamUrl} onChange={onChange} placeholder="Link do seu perfil da Steam" inputMode="url" aria-invalid={!looksLikeLink(form.steamUrl)} />
                {!looksLikeLink(form.steamUrl) && <FieldError>Isso não parece um link. Exemplo: https://site.com/seu-perfil</FieldError>}
              </label>
              <label>
                <span className="connection-label"><img className="ui-icon-sm" src={robloxConnIcon} alt="" /> ROBLOX</span>
                <input name="robloxUrl" value={form.robloxUrl} onChange={onChange} placeholder="Link do seu perfil do Roblox" inputMode="url" aria-invalid={!looksLikeLink(form.robloxUrl)} />
                {!looksLikeLink(form.robloxUrl) && <FieldError>Isso não parece um link. Exemplo: https://site.com/seu-perfil</FieldError>}
              </label>
              <label>
                <span className="connection-label"><img className="ui-icon-sm" src={xConnIcon} alt="" /> X (TWITTER)</span>
                <input name="xUrl" value={form.xUrl} onChange={onChange} placeholder="Link do seu perfil no X" inputMode="url" aria-invalid={!looksLikeLink(form.xUrl)} />
                {!looksLikeLink(form.xUrl) && <FieldError>Isso não parece um link. Exemplo: https://site.com/seu-perfil</FieldError>}
              </label>
            </div>
          </div>

          {/* Item pedido: "acabei com a categoria exibição e passa a
              tag pro perfil e as conquistas pro perfil e o mini
              perfil" — movido de dentro da extinta aba "Exibição". */}
          {/* Item pedido: "Ranks e Conquistas ficam dentro da mesma
              categoria (Progresso)" + "tudo que modifica somente o
              perfil completo fica na aba Perfil Completo" — quais
              conquistas aparecem em destaque só afeta o perfil
              completo (ver UserProfileModal.jsx; o mini perfil não
              mostra mais conquistas, ver aba Mini Perfil), então essa
              escolha se mudou pra lá, junto do Álbum/Enquetes que já
              eram só do perfil completo. */}

          {myClan?.tags?.length > 0 && (
            <div className="settings-block">
              <h4>Tag do clube</h4>
              <p className="dim">Exiba a tag do seu clube do lado do seu nome no chat, na lista de membros e no seu perfil.</p>
              <div className="server-tag-options">
                <button
                  type="button"
                  className={`server-tag-option ${!user.clanTagId ? 'active' : ''}`}
                  disabled={tagSaving}
                  onClick={async () => { setTagSaving(true); try { const { clanTagId, clanTag } = await setMyClanTag(null); setUser({ ...user, clanTagId, clanTag }); } finally { setTagSaving(false); } }}
                >
                  Nenhuma
                </button>
                <button
                  type="button"
                  className={`server-tag-option ${user.clanTagId ? 'active' : ''}`}
                  disabled={tagSaving}
                  onClick={() => pickClanTag(true)}
                >
                  <span className="server-tag-badge clan-tag-badge"><ClanIcon icon={myClan.icon} color={myClan.iconColor} size={14} /> {myClan.tags[0].tag}</span>
                </button>
              </div>
            </div>
          )}

          <ProfileShopItems />
        </div>
      )}

      {tab === 'PROFILE_CONTENT' && (
        <div className="settings-grid">
          <div className="settings-block">
            <h4>Conquistas em destaque no perfil completo</h4>
            <p className="dim">Escolha até 6 conquistas pra aparecerem no seu perfil completo. Também dá pra mudar direto no seu perfil, em "Editar vitrine".</p>
            <div className="settings-inline-actions">
              <button type="button" className="btn-secondary" onClick={() => setAchievementPickerOpen('profile')}>Escolher conquistas</button>
              <span className="settings-chip">{myDisplayedAchievements.profile.length} de 6 escolhidas</span>
            </div>
          </div>

          {/* Item pedido: "desativar Galeria de fotos, sem apagar
              nada" — mantém o componente/rota/lógica intactos, só
              não mostra o botão de gerenciar enquanto estiver na
              lista de desativadas. */}
          {!DISABLED_PROFILE_SECTIONS.includes('album') && (
            <div className="settings-block">
              <h4>Álbum de fotos</h4>
              <p className="dim">Adicione, organize ou apague fotos e vídeos do seu álbum de perfil.</p>
              <button type="button" className="btn-secondary" onClick={() => setAlbumManagerOpen(true)}>Gerenciar álbum</button>
            </div>
          )}

          <div className="settings-block">
            <h4>Enquetes {myPolls.length > 0 ? `(${myPolls.length}/2)` : ''}</h4>
            <p className="dim">Crie uma pergunta com opções pros seus amigos votarem, direto no seu perfil — no máximo 2 por vez.</p>
            {myPolls.length < 2 ? (
              <div className="profile-poll-composer">
                <label>
                  <span className="settings-label-row">PERGUNTA <CharCount value={pollQuestion} max={200} /></span>
                  <input value={pollQuestion} onChange={(e) => setPollQuestion(e.target.value)} placeholder="Ex.: Qual jogo a gente joga sábado?" maxLength={200} />
                </label>
                <span className="settings-label-row">OPÇÕES <span className="settings-char-count">{pollOptions.length}/10</span></span>
                {pollOptions.map((opt, i) => (
                  <div key={i} className="settings-poll-option-row">
                    <input
                      value={opt}
                      onChange={(e) => setPollOptions((prev) => prev.map((o, j) => (j === i ? e.target.value : o)))}
                      placeholder={`Opção ${i + 1}`}
                      aria-label={`Opção ${i + 1}`}
                      maxLength={100}
                    />
                    {pollOptions.length > 2 && (
                      <button type="button" className="settings-icon-btn" aria-label={`Tirar opção ${i + 1}`} title="Tirar opção" onClick={() => setPollOptions((prev) => prev.filter((_, j) => j !== i))}>
                        <SIcon name="close" size={14} />
                      </button>
                    )}
                  </div>
                ))}
                <FieldError>{pollError}</FieldError>
                <div className="profile-poll-composer-actions">
                  {pollOptions.length < 10 && <button type="button" className="btn-secondary" onClick={() => setPollOptions((prev) => [...prev, ''])}><SIcon name="plus" size={14} /> Opção</button>}
                  <button type="button" className="btn-primary" disabled={pollCreating} onClick={createPoll}>{pollCreating ? 'Criando…' : 'Criar enquete'}</button>
                </div>
              </div>
            ) : (
              <p className="dim" style={{ fontStyle: 'italic' }}>Você já tem 2 enquetes — apague uma abaixo antes de criar outra.</p>
            )}
            {myPolls.length === 0 && (
              <div className="settings-empty"><span className="settings-empty-icon"><SIcon name="check" /></span>Nenhuma enquete ativa no seu perfil.</div>
            )}
            {myPolls.length > 0 && (
              <ul className="settings-poll-list">
                {myPolls.map((p) => (
                  <li key={p.id} className="settings-poll-list-item">
                    <span className="truncate">{p.question}</span>
                    <button type="button" className="profile-relationship-end" onClick={() => removePoll(p.id)}>Apagar</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {tab === 'COLUMNS' && (
        <div className="settings-grid">
          <div className="settings-block">
            <h4>Ordem das seções do perfil</h4>
            <p className="dim">Arraste ou use as setas pra mudar a ordem; o olho esconde a seção. Cada mudança é salva na hora.</p>
            <ProfileSectionOrderEditor value={user.profileSectionOrder} onChange={saveProfileSectionOrder} />
            <div className="settings-inline-actions">
              <button type="button" className="btn-secondary" onClick={() => useStore.getState().openProfile(user.id)}><SIcon name="eye" /> Ver meu perfil</button>
            </div>
          </div>
        </div>
      )}

      {tab === 'ACCOUNT' && (
        <div className="settings-grid">
          <div className="settings-block">
            <h4>Informações básicas</h4>
            <label>
              <span className="settings-label-row">E-MAIL
                {user.emailVerified
                  ? <span className="settings-chip is-ok"><SIcon name="check" size={12} /> Verificado</span>
                  : <span className="settings-chip is-warn"><SIcon name="alert" size={12} /> Não verificado</span>}
              </span>
              <input className="pc-sensitive" value={user.email} disabled />
            </label>
            <p className="dim settings-field-hint">O e-mail não pode ser trocado por aqui. Ele é usado pra entrar e recuperar a senha.</p>
            <label>
              <span className="settings-label-row">NOME DE USUÁRIO <CharCount value={username} max={32} /></span>
              <div className="settings-prefix-input">
                <span aria-hidden="true">@</span>
                <input value={username} maxLength={32} autoComplete="username" spellCheck={false} aria-invalid={!!error} onChange={(e) => setUsernameField(e.target.value.replace(/\s+/g, ''))} />
              </div>
            </label>
            <FieldError>{error}</FieldError>
            <p className="dim settings-autosave-hint">
              Salvo automaticamente 1 segundo depois de parar de digitar. De 3 a 32 caracteres: letras, números, _ ou ponto. Só dá pra trocar uma vez a cada 7 dias.
              {usernameCooldownUntil && ` Próxima troca liberada em ${usernameCooldownUntil.toLocaleString('pt-BR')}.`}
            </p>
          </div>

          <div className="settings-block danger-zone">
            <h4>Zona de risco</h4>
            <div className="danger-zone-row">
              <div>
                <div className="danger-zone-row-title">Sair da conta</div>
                <p className="dim">Você precisa entrar de novo com seu e-mail e senha neste dispositivo.</p>
              </div>
              <button className="btn-secondary" onClick={doLogout}>Sair</button>
            </div>
            <div className="danger-zone-row">
              <div>
                <div className="danger-zone-row-title">Desativar temporariamente</div>
                <p className="dim">Sai de tudo e some das buscas, mas é só entrar de novo pra voltar. Nada é apagado.</p>
              </div>
              <button className="btn-secondary" disabled={deleting} onClick={startDeactivate}>
                {deleting ? '...' : 'Desativar por um tempo'}
              </button>
            </div>
            <div className="danger-zone-row">
              <div>
                <div className="danger-zone-row-title">Desativar de vez</div>
                <p className="dim">Você é desconectado de tudo na hora e não consegue mais entrar com ela — nenhuma mensagem ou post antigo é apagado.</p>
              </div>
              <button className="btn-danger" disabled={deleting} onClick={startDeleteAccount}>
                {deleting ? '...' : 'Desativar'}
              </button>
            </div>
            {deleteError && <div className="auth-error">{deleteError}</div>}
          </div>
        </div>
      )}

      {tab === 'VOICE' && <VoiceSettingsTab />}

      {tab === 'SECURITY' && (
        <div className="settings-grid">
          {/* Item pedido: privacidade de pedidos de amizade saiu da aba
              Perfil e mora aqui agora — faz mais sentido junto de
              autenticação/2FA do que junto de edição de identidade
              (avatar/banner/bio). */}
          <div className="settings-block">
            <h4>Privacidade de pedidos de amizade</h4>
            <p className="dim">Quem pode te mandar um pedido de amizade novo.</p>
            <Segmented
              label="Quem pode me mandar pedido de amizade" value={friendRequestPrivacy} onChange={saveFriendRequestPrivacy}
              options={[['EVERYONE', 'Qualquer pessoa'], ['FRIENDS_OF_FRIENDS', 'Amigos de amigos'], ['NOBODY', 'Ninguém']]}
            />
          </div>

          {/* Trocar senha: morava em "Informação de conta", mas a aba
              que tem "senha" no nome é esta. */}
          <PasswordChangeBlock
            pwForm={pwForm} setPwForm={setPwForm} pwError={pwError} pwSuccess={pwSuccess} pwSaving={pwSaving}
            onSubmit={submitChangePassword}
          />

          <TwoFactorBlock user={user} setUser={setUser} />

          <PasskeysBlock />

          <ConnectedAccountsBlock />

          <div className="settings-block">
            <h4 className="settings-h4-row">Sessões ativas {sessions && <span className="settings-chip">{sessions.length}</span>}</h4>
            <p className="dim">Dispositivos e navegadores onde sua conta está logada agora. Encerre os que você não reconhece.</p>
            <FieldError>{sessionsError}</FieldError>
            {sessions === null && !sessionsError && <SettingsSkeleton rows={2} />}
            {sessions && (
              <>
                <div className="sessions-list">
                  {sessions.map((s) => (
                    <div key={s.id} className={`session-row ${s.isCurrent ? 'is-current' : ''}`}>
                      <span className="settings-row-icon" aria-hidden="true"><SIcon name="monitor" /></span>
                      <div className="session-row-info">
                        <div>{s.device || describeSession(s.userAgent)}{s.isCurrent && <span className="session-current-badge">Este dispositivo</span>}</div>
                        <div className="dim">
                          {s.ip ? `IP ${s.ip} · ` : ''}
                          Último uso {new Date(s.lastUsedAt || s.createdAt).toLocaleString('pt-BR')}
                        </div>
                        <div className="dim">Conectado desde {new Date(s.createdAt).toLocaleString('pt-BR')}</div>
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

          <BlockedUsersBlock />
        </div>
      )}

      {tab === 'APPEARANCE' && (
        <div className="settings-grid">
          {/* Item pedido: "em aparência adicione uma nova opção de
              layout, a opção normal (a atual) e a opção de layout
              discord — o layout discord faz os canais/categorias
              ficarem num popover no canto da tela, aberto por um
              ícone" — mesmo padrão visual do seletor de tema acima. */}
          <div className="settings-block">
            <h4>Layout</h4>
            <p className="dim">Como o menu e os canais ficam organizados na tela.</p>
            {/* Rótulos renomeados a pedido (normal→Beta, discord→Normal);
                os valores internos continuam os mesmos. */}
            <RadioCards
              label="Layout" value={layoutStyle} onChange={pickLayoutStyle}
              options={[
                { value: 'normal2', label: 'Normal 2.0', hint: 'Menu e canais juntos numa coluna à esquerda.' },
                { value: 'discord', label: 'Normal', hint: 'Barra de ícones com os canais ao lado.' },
                { value: 'normal', label: 'Beta', hint: 'Canais em abas no topo do chat.' },
              ]}
            />
          </div>

          {/* Personalizar layout (densidade, cantos, coluna, fonte, fundo animado, temas sazonais) */}
          <LayoutCustomizer />
          <AppearanceExtras />

          {/* Item pedido: "sistema podendo mudar o zoom de 1,0 até
              2,0... pra melhor personalização" — só afeta o chat e a
              barra de digitar (não o app inteiro), e só faz efeito em
              telas de PC — no celular o app já se ajusta ao tamanho
              da tela de outro jeito. */}
          <div className="settings-block">
            <h4>Zoom do chat</h4>
            <p className="dim">Deixa o texto das mensagens e a barra de digitar maiores ou menores — só no PC, o celular não muda.</p>
            <div className="chat-zoom-row">
              <input
                type="range" min="1" max="2" step="0.1" aria-label="Zoom do chat"
                value={chatZoom}
                onChange={(e) => pickChatZoom(Number(e.target.value))}
              />
              <span className="chat-zoom-value">{chatZoom.toFixed(1)}x</span>
              {chatZoom !== 1 && <button type="button" className="settings-icon-btn" title="Voltar pra 1.0x" aria-label="Voltar o zoom do chat pra 1.0x" onClick={() => pickChatZoom(1)}><SIcon name="reset" size={14} /></button>}
            </div>
          </div>

          {/* Item pedido: "criar um sistema em personalização pra
              poder escolher o zoom de 50% a 200%, 1% por 1%, com uma
              parte pra escolher [digitar]" — slider fino (1% por
              passo) + campo numérico pro valor exato, sincronizados
              entre si; zoom GERAL de toda a interface (diferente do
              zoom do chat acima, que só afeta as mensagens). */}
          <div className="settings-block">
            <h4>Zoom da interface</h4>
            <p className="dim">Deixa o app inteiro maior ou menor, de 50% a 200% — só no PC, o celular não muda.</p>
            <div className="chat-zoom-row">
              <input
                type="range" min="0.5" max="2" step="0.01" aria-label="Zoom da interface"
                value={interfaceZoom}
                onChange={(e) => pickInterfaceZoom(Number(e.target.value))}
              />
              <input
                type="number" min="50" max="200" step="1"
                className="chat-zoom-input" aria-label="Zoom da interface em porcentagem"
                value={Math.round(interfaceZoom * 100)}
                onChange={(e) => {
                  const percent = Number(e.target.value);
                  if (!Number.isFinite(percent)) return;
                  const clamped = Math.min(200, Math.max(50, percent));
                  pickInterfaceZoom(clamped / 100);
                }}
              />
              <span className="chat-zoom-value">%</span>
              {Math.round(interfaceZoom * 100) !== 100 && <button type="button" className="settings-icon-btn" title="Voltar pra 100%" aria-label="Voltar o zoom da interface pra 100%" onClick={() => pickInterfaceZoom(1)}><SIcon name="reset" size={14} /></button>}
            </div>
          </div>

          {/* Item pedido: "5 variantes de visual dos meus emoji...
              uma delas o mesmo tema do Discord" — Twemoji (o
              conjunto que o Discord usa de verdade — eles nunca
              desenharam o próprio emoji). */}
          <div className="settings-block">
            <h4>Estilo de emoji</h4>
            <p className="dim">Muda o desenho dos emojis pra ficar igual em qualquer tela — em vez de depender da fonte de cada sistema (Windows, Mac, Android costumam desenhar diferente).</p>
            <div className="emoji-style-options">
              {EMOJI_STYLE_OPTIONS.map((opt) => (
                <button
                  type="button" key={opt.value}
                  className={`emoji-style-option ${emojiStyle === opt.value ? 'active' : ''}`}
                  onClick={() => pickEmojiStyleSetting(opt.value)}
                >
                  <EmojiStylePreview style={opt.value} />
                  <span>{opt.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Função de fundo/tema personalizado desativada (CUSTOM_BACKGROUND_ENABLED
              em utils/featureFlags.js) — código mantido intacto, só a UI fica oculta. */}
          {CUSTOM_BACKGROUND_ENABLED && (
            <div className="settings-block">
              <h4>Fundo personalizado</h4>
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
            </div>
          )}
        </div>
      )}

      {/* Item pedido: "sistema completo de configurações... Idioma e
          horário" — primeira tela ligada de verdade ao backend novo
          (UserSettings, ver settingsController.js) — mostra "..."
          enquanto ainda não carregou (nunca undefined/false piscando
          na tela, como pedido) e salva sozinho a cada escolha. */}
      {tab === 'LANGUAGE' && (
        <div className="settings-grid">
          {!userSettings ? <SettingsSkeleton /> : (
            <>
              <div className="settings-block">
                <h4>Idioma</h4>
                <p className="dim">Muda o idioma usado na interface do Project Club.</p>
                <select aria-label="Idioma" value={userSettings.language} onChange={(e) => updateUserSetting('language', e.target.value)}>
                  <option value="pt-BR">Português (Brasil)</option>
                  <option value="en-US">English</option>
                  <option value="es-ES">Español</option>
                </select>
              </div>
              <div className="settings-block">
                <h4>Formato de horário</h4>
                <p className="dim">Como os horários aparecem nas mensagens e em toda a interface.</p>
                <select aria-label="Formato de horário" value={userSettings.timeFormat} onChange={(e) => updateUserSetting('timeFormat', e.target.value)}>
                  <option value="auto">Automático (baseado no idioma)</option>
                  <option value="12h">12 horas</option>
                  <option value="24h">24 horas</option>
                </select>
                <p className="dim settings-field-hint">Agora: <strong>{formatClockSample(userSettings.timeFormat, userSettings.language)}</strong></p>
              </div>
            </>
          )}
        </div>
      )}

      {/* Item pedido: "Movimento reduzido... Contraste alto...
          Saturação... Tamanho do texto" — reducedMotion e
          highContrast aplicam uma classe no <html> (mesmo padrão já
          usado pro tema); textScale e saturation viram variáveis CSS
          (--font-scale, --saturation) que o CSS global usa em toda a
          interface, não só nesta tela. */}
      {tab === 'ACCESSIBILITY' && (
        <div className="settings-grid">
          {!userSettings ? <SettingsSkeleton /> : (
            <>
              <div className="settings-block settings-toggle-row">
                <div>
                  <h4>Movimento reduzido</h4>
                  <p className="dim">Reduz animações e efeitos visuais para tornar a interface mais confortável.</p>
                </div>
                <Toggle on={userSettings.reducedMotion} onChange={(v) => updateUserSetting('reducedMotion', v)} label={TOGGLE_LABEL.reducedMotion} />
              </div>
              <div className="settings-block settings-toggle-row">
                <div>
                  <h4>Contraste alto</h4>
                  <p className="dim">Aumenta o contraste de cores da interface.</p>
                </div>
                <Toggle on={userSettings.highContrast} onChange={(v) => updateUserSetting('highContrast', v)} label={TOGGLE_LABEL.highContrast} />
              </div>
              <div className="settings-block">
                <h4 className="settings-h4-row">Tamanho do texto <span className="settings-chip">{Math.round(userSettings.textScale * 100)}%</span></h4>
                <p className="dim">Aumenta ou diminui o texto de toda a interface.</p>
                <div className="chat-zoom-row">
                  <input
                    type="range" min="0.8" max="1.5" step="0.1" aria-label="Tamanho do texto"
                    value={userSettings.textScale}
                    onChange={(e) => updateUserSetting('textScale', Math.round(Number(e.target.value) * 10) / 10)}
                  />
                  {userSettings.textScale !== 1 && <button type="button" className="settings-icon-btn" title="Voltar pra 100%" aria-label="Voltar o tamanho do texto pra 100%" onClick={() => updateUserSetting('textScale', 1)}><SIcon name="reset" size={14} /></button>}
                </div>
                <p className="settings-text-sample" style={{ fontSize: `${15 * userSettings.textScale}px` }}>Exemplo: Bora jogar hoje à noite?</p>
              </div>
              <div className="settings-block">
                <h4>Saturação</h4>
                <p className="dim">Deixa as cores do app mais fracas. 0% fica em preto e branco.</p>
                <Segmented
                  label="Saturação" value={userSettings.saturation} onChange={(v) => updateUserSetting('saturation', v)}
                  options={[[100, '100%'], [75, '75%'], [50, '50%'], [0, '0%']]}
                />
              </div>
            </>
          )}
          <ColorVisionSettings />
          <AccessibilityExtras />
          <AccessibilityMore />
        </div>
      )}

      {/* Item pedido: "Dados e privacidade... Privacidade do perfil...
          Permissão de mensagem... Filtrar conteúdo... Filtrar spam" —
          mesmo padrão de Idioma/Acessibilidade acima: lido/salvo via
          userSettings/updateUserSetting (UserSettings no banco, já
          validado em settingsController.js). A privacidade de PEDIDO
          DE AMIZADE já mora na aba Senha e segurança (campo separado,
          do User, não do UserSettings) — não duplicada aqui.
          COMENTÁRIO DESATUALIZADO CORRIGIDO: isso aqui dizia que a
          aplicação real (o servidor recusar de fato) ainda não
          existia — não é mais verdade. profilePrivacy é aplicado em
          hasFullProfileAccess, dmPrivacy em canSendDirectMessage
          (services/dmPermissions.js, usado por conversationController
          e messageController) e contentFilterLevel em
          applyContentFilter (messageController.js) — os três já
          recusam/filtram de verdade no servidor, não só salvam a
          preferência. */}
      {tab === 'PRIVACY' && (
        <div className="settings-grid">
          {!userSettings ? <SettingsSkeleton /> : (
            <>
              <DataExportRow />
              <div className="settings-block">
                <h4>Privacidade do perfil</h4>
                <p className="dim">Quem pode ver os detalhes completos do seu perfil (bio, conexões, insígnias, recados…). Nome, foto e banner continuam visíveis pra todo mundo.</p>
                <RadioCards
                  label="Privacidade do perfil" value={userSettings.profilePrivacy} onChange={(v) => updateUserSetting('profilePrivacy', v)}
                  options={[
                    { value: 'everyone', label: 'Qualquer pessoa' },
                    { value: 'friends_groups', label: 'Amigos e pessoas dos meus grupos' },
                    { value: 'friends', label: 'Apenas amigos' },
                  ]}
                />
              </div>
              <div className="settings-block">
                <h4>Quem pode me enviar mensagens</h4>
                <p className="dim">Controla quem pode iniciar uma conversa direta com você.</p>
                <RadioCards
                  label="Quem pode me enviar mensagens" value={userSettings.dmPrivacy} onChange={(v) => updateUserSetting('dmPrivacy', v)}
                  options={[
                    { value: 'everyone', label: 'Todos' },
                    { value: 'friends', label: 'Amigos' },
                    { value: 'friends_groups', label: 'Pessoas que compartilham grupos comigo' },
                    { value: 'none', label: 'Ninguém', hint: 'Conversas que já existem continuam abertas.' },
                  ]}
                />
              </div>
              <div className="settings-block settings-toggle-row">
                <div>
                  <h4>Mostrar confirmação de leitura</h4>
                  <p className="dim">Mostra "Visto" nas conversas diretas quando a pessoa lê sua mensagem. Desligado, você também não vê o "Visto" dos outros.</p>
                </div>
                <Toggle on={userSettings.showReadReceipts !== false} onChange={(v) => updateUserSetting('showReadReceipts', v)} label="Mostrar confirmação de leitura" />
              </div>
              <div className="settings-block">
                <h4>Filtrar conteúdo</h4>
                <p className="dim">Nível de filtragem aplicado às mensagens que você recebe.</p>
                <Segmented
                  label="Filtrar conteúdo" value={userSettings.contentFilterLevel} onChange={(v) => updateUserSetting('contentFilterLevel', v)}
                  options={[['off', 'Desativado'], ['moderate', 'Moderado'], ['high', 'Alto']]}
                />
              </div>
              {/* Rodada 5: jogos e atividade também na privacidade.
                  gamesVisibility (everyone|friends|nobody) é validado no
                  servidor (settingsController.js); activitySharing é o
                  MESMO campo do toggle da aba Jogos e apps. */}
              <div className="settings-block">
                <h4>Quem pode ver meus jogos</h4>
                <p className="dim">Controla quem vê a sua lista de jogos e estatísticas de jogo no perfil.</p>
                <div className="chip-choice-row settings-segmented" role="radiogroup" aria-label="Quem pode ver meus jogos">
                  {[['everyone', 'Todos'], ['friends', 'Amigos'], ['nobody', 'Ninguém']].map(([value, label]) => (
                    <button
                      key={value} type="button" role="radio"
                      aria-checked={(userSettings.gamesVisibility || 'friends') === value}
                      className={`chip-choice ${(userSettings.gamesVisibility || 'friends') === value ? 'active' : ''}`}
                      onClick={() => updateUserSetting('gamesVisibility', value)}
                    >{label}</button>
                  ))}
                </div>
              </div>
              <div className="settings-block settings-toggle-row">
                <div>
                  <h4>Mostrar o que estou jogando/ouvindo</h4>
                  <p className="dim">Mostra pros outros o jogo, app ou música do Spotify que o aplicativo detectar.</p>
                </div>
                <Toggle on={userSettings.activitySharing} onChange={(v) => updateUserSetting('activitySharing', v)} label="Mostrar o que estou jogando/ouvindo" />
              </div>
              {userSettings.activitySharing && (
                <div className="settings-block">
                  <h4>Quem pode ver minha atividade</h4>
                  <ActivityVisibilityPicker value={userSettings.activityVisibility} onChange={(v) => updateUserSetting('activityVisibility', v)} />
                </div>
              )}
              {/* BUG CORRIGIDO ("botão que não muda nada de verdade"):
                  havia um controle "Filtro de spam" aqui, ligado a
                  spamFilterEnabled — mas em nenhum lugar do backend
                  esse campo é lido pra mudar algum comportamento. A
                  proteção contra flood/repetição de mensagens (ver
                  checkSpamLimits em messageController.js) é, por
                  decisão de segurança já registrada em comentário lá,
                  SEMPRE ativa pra todo mundo, sem depender de
                  nenhuma preferência pessoal — não é opcional. Mexer
                  nesse toggle salvava um valor no banco que nunca
                  mudava nada de verdade, exatamente o tipo de "botão
                  falso" que o pedido original de Configurações pediu
                  pra nunca acontecer. Removido daqui até existir uma
                  camada de verdade pra ele controlar; o campo
                  continua existindo no banco (spamFilterEnabled), só
                  não é mostrado como controle até ter um efeito real
                  ligado a ele. */}
            </>
          )}
          <PrivacyExtras />
        </div>
      )}

      {/* Item pedido: "Notificações... Visão geral... Sons" — mesmo
          padrão de Idioma/Acessibilidade/Privacidade acima
          (userSettings/updateUserSetting, já validado em
          settingsController.js). Os subitens "Insígnias", "E-mail"
          detalhado e "Avançado" (silenciar por servidor/canal, ver
          seção 18 do documento) não entraram nesta parte — aqui só
          os três controles globais que já existem prontos no
          UserSettings (desktopNotifications, emailNotifications,
          notificationSounds). Silenciar/nível por canal e categoria
          (tabela NotificationOverride, menu de clique direito na lista
          de canais), o padrão dos canais e o "Não perturbe" agendado
          ficam em NotificationExtras (settings/ExtraSettings.jsx). */}
      {tab === 'NOTIFICATIONS' && (
        <div className="settings-grid">
          {!userSettings ? <SettingsSkeleton /> : (
            <>
              <div className="settings-block settings-toggle-row">
                <div>
                  <h4>Notificações de desktop</h4>
                  <p className="dim">Mostra um alerta na tela quando chega uma mensagem nova, mesmo com o Project Club em segundo plano.</p>
                  {userSettings.desktopNotifications && <NotificationPermissionNote />}
                </div>
                <Toggle on={userSettings.desktopNotifications} onChange={(v) => updateUserSetting('desktopNotifications', v)} label={TOGGLE_LABEL.desktopNotifications} />
              </div>
              <WebPushRow />
              <div className="settings-block settings-toggle-row">
                <div>
                  <h4>Notificações por e-mail</h4>
                  <p className="dim">Recebe um e-mail para eventos importantes, como pedidos de amizade e menções, quando você está offline.</p>
                </div>
                <Toggle on={userSettings.emailNotifications} onChange={(v) => updateUserSetting('emailNotifications', v)} label={TOGGLE_LABEL.emailNotifications} />
              </div>
              <div className="settings-block settings-toggle-row">
                <div>
                  <h4>Sons de notificação</h4>
                  <p className="dim">Toca um som quando você recebe uma mensagem, menção ou chamada.</p>
                </div>
                <Toggle on={userSettings.notificationSounds} onChange={(v) => updateUserSetting('notificationSounds', v)} label={TOGGLE_LABEL.notificationSounds} />
              </div>
              <NotificationExtras />
            </>
          )}
        </div>
      )}

      {/* Item pedido: "Status da conta... Status: Ativa... Conta
          criada em... Verificação... Restrições: Nenhuma... Caso
          exista punição: motivo, data de término... Não mostrar
          informações administrativas internas que não devam ser
          expostas ao usuário" — tela só de leitura, sem nenhum
          endpoint novo: todo campo aqui já existe no próprio User
          (accountDisabledAt/isPlatformBanned/platformBanReason/
          suspendedUntil/timeoutUntil/emailVerified/createdAt), sem
          expor nada que a staff não deva mostrar (motivo interno de
          moderação continua só no painel admin). */}
      {tab === 'ACCOUNT_STATUS' && <AccountStatusTab user={user} />}

      {/* Item pedido: "Sistema... Geral... Iniciar com o sistema...
          Minimizar para bandeja... Abrir links no aplicativo...
          Confirmar saída... Essas funções podem existir no '.exe'
          sem necessariamente existirem na versão web" — mesmo padrão
          de Idioma/Acessibilidade/Privacidade/Notificações acima
          (userSettings/updateUserSetting, já validado em
          settingsController.js). A preferência é salva igual em
          qualquer plataforma (sincroniza entre dispositivos, como
          pedido na seção 7), mas só o app ".exe" de fato lê e aplica
          esses valores (bandeja do sistema, abrir link externo
          dentro do próprio app, etc) — no navegador eles ficam
          salvos sem efeito nenhum, o que é esperado. Atalhos
          personalizados (UserShortcut) já entram aqui embaixo, com
          seu próprio backend (shortcutsController.js). */}
      {tab === 'SYSTEM' && (
        <div className="settings-grid">
          {!userSettings ? <SettingsSkeleton /> : (
            <>
              <AndroidUpdateInfo />
              <PwaInstallRow />
              {appDiag && (
                <div className="settings-block">
                  <h4>Sobre este aplicativo</h4>
                  <p className="dim" style={{ fontSize: 13, wordBreak: 'break-all' }}>
                    Versão {appDiag.version} — instalado em: {appDiag.path || 'desconhecido'}
                  </p>
                  {appDiag.path && /program files/i.test(appDiag.path) && (
                    <p className="dim" style={{ fontSize: 12 }}>Instalação "para todos os usuários" (Program Files).</p>
                  )}
                  {appDiag.path && /appdata/i.test(appDiag.path) && (
                    <p className="dim" style={{ fontSize: 12 }}>Instalação "só para este usuário" (AppData).</p>
                  )}
                </div>
              )}
              <div className="settings-block settings-toggle-row">
                <div>
                  <h4>Iniciar com o sistema</h4>
                  <p className="dim">Abre o Project Club automaticamente quando o computador liga.</p>
                  <DesktopOnlyChip />
                </div>
                <Toggle on={userSettings.startWithSystem} onChange={(v) => updateUserSetting('startWithSystem', v)} label={TOGGLE_LABEL.startWithSystem} />
              </div>
              <div className="settings-block settings-toggle-row">
                <div>
                  <h4>Minimizar para a bandeja</h4>
                  <p className="dim">Ao fechar a janela, o app continua rodando na bandeja do sistema em vez de encerrar.</p>
                  <DesktopOnlyChip />
                </div>
                <Toggle on={userSettings.minimizeToTray} onChange={(v) => updateUserSetting('minimizeToTray', v)} label={TOGGLE_LABEL.minimizeToTray} />
              </div>
              <div className="settings-block settings-toggle-row">
                <div>
                  <h4>Abrir links no aplicativo</h4>
                  <p className="dim">Links clicados dentro do Project Club abrem numa janela do próprio app em vez do navegador padrão.</p>
                  <DesktopOnlyChip />
                </div>
                <Toggle on={userSettings.openLinksInApp} onChange={(v) => updateUserSetting('openLinksInApp', v)} label={TOGGLE_LABEL.openLinksInApp} />
              </div>
              <div className="settings-block settings-toggle-row">
                <div>
                  <h4>Confirmar antes de sair</h4>
                  <p className="dim">Pede confirmação ao tentar fechar o aplicativo.</p>
                  <DesktopOnlyChip />
                </div>
                <Toggle on={userSettings.confirmOnExit} onChange={(v) => updateUserSetting('confirmOnExit', v)} label={TOGGLE_LABEL.confirmOnExit} />
              </div>
              <div className="settings-block settings-toggle-row">
                <div>
                  <h4>Modo desenvolvedor</h4>
                  <p className="dim">Mostra IDs e informações técnicas extras em menus de contexto (canais, mensagens, usuários).</p>
                </div>
                <Toggle on={userSettings.developerMode} onChange={(v) => updateUserSetting('developerMode', v)} label={TOGGLE_LABEL.developerMode} />
              </div>

              {/* Item pedido: "Atalhos personalizados... UserShortcut...
                  Antes de salvar: verificar se já existe outro comando
                  usando a combinação. Se houver conflito: 'Este atalho
                  já está sendo utilizado.'" — backend novo (ver
                  shortcutsController.js), a mensagem de conflito vem
                  direto da resposta de erro da API. */}
              {/* Ajuda: tour de boas-vindas e lista de atalhos (ver components/conforto). */}
              <div className="settings-block">
                <h4>Ajuda</h4>
                <p className="dim">Reveja o passeio pela interface ou consulte os atalhos de teclado (Ctrl + / em qualquer tela).</p>
                <div className="birthday-picker-row">
                  <button type="button" className="btn-secondary" onClick={() => window.dispatchEvent(new CustomEvent('pc:open-tour'))}>Rever o tour de boas-vindas</button>
                  <button type="button" className="btn-secondary" onClick={() => window.dispatchEvent(new CustomEvent('pc:open-shortcuts'))}>Ver atalhos de teclado</button>
                </div>
              </div>
              <div className="settings-block">
                <h4>Atalhos personalizados</h4>
                <p className="dim">Dê um nome pra ação e aperte as teclas no campo da combinação (Backspace limpa). Uma combinação só pode ser usada por uma ação.</p>
                <FieldError>{shortcutsError}</FieldError>
                {shortcuts === null && !shortcutsError && <SettingsSkeleton rows={2} />}
                {shortcuts && (
                  <ul className="settings-poll-list">
                    {shortcuts.map((s) => (
                      <li key={s.id} className="settings-poll-list-item">
                        <span className="truncate">{s.action}</span>
                        <kbd className="settings-kbd">{s.keyCombination}</kbd>
                        <button type="button" className="profile-relationship-end" onClick={() => removeShortcutFromList(s.id)}>Remover</button>
                      </li>
                    ))}
                    {shortcuts.length === 0 && <li className="settings-empty"><span className="settings-empty-icon"><SIcon name="keyboard" /></span>Nenhum atalho personalizado ainda.</li>}
                  </ul>
                )}
                <div className="birthday-picker-row settings-shortcut-form">
                  <input
                    value={newShortcutAction}
                    onChange={(e) => setNewShortcutAction(e.target.value)}
                    placeholder="Ação (ex: abrir_configuracoes)"
                    aria-label="Ação do atalho"
                    maxLength={64}
                  />
                  <input
                    value={newShortcutCombo}
                    onChange={(e) => setNewShortcutCombo(e.target.value)}
                    onKeyDown={(e) => {
                      // Grava a combinação apertada (Tab/Backspace continuam normais).
                      if (e.key === 'Tab') return;
                      if (e.key === 'Backspace' && !e.ctrlKey && !e.altKey && !e.metaKey) { e.preventDefault(); setNewShortcutCombo(''); return; }
                      const combo = comboFromEvent(e);
                      if (combo) { e.preventDefault(); e.stopPropagation(); setNewShortcutCombo(combo); }
                    }}
                    placeholder="Aperte as teclas (ex: Ctrl+,)"
                    aria-label="Combinação de teclas"
                    maxLength={32}
                  />
                  <button type="button" className="btn-secondary" disabled={savingShortcut || !newShortcutAction.trim() || !newShortcutCombo.trim()} onClick={submitShortcut}>
                    {savingShortcut ? '...' : 'Adicionar atalho'}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Item pedido: "Jogos registrados... Jogos adicionados...
          Privacidade nas atividades... Sobreposições de jogo" —
          "Jogos adicionados" usa o backend novo (RegisteredGame, ver
          gamesController.js). "Detecção de jogos" (Game Detection
          Manager lendo processos ativos) e a "Sobreposição" de
          verdade (Overlay Manager desenhando por cima de outros
          apps) só são possíveis dentro do aplicativo ".exe" — aqui
          só a PREFERÊNCIA de cada uma é salva (mesmo padrão de
          Sistema, acima), sincronizada entre dispositivos; quem
          efetivamente lê e aplica esses valores é o app desktop,
          quando esse lado for trabalhado. Atividade atual (Rich
          Presence — o que a pessoa está jogando agora) depende da
          mesma detecção de processos e também fica para quando o
          ".exe" existir. */}
      {tab === 'GAMES' && (
        <div className="settings-grid">
          <div className="settings-block">
            <h4 className="settings-h4-row">Jogos adicionados {games && games.length > 0 && <span className="settings-chip">{games.length}</span>}</h4>
            <p className="dim">Jogos que aparecem como sua atividade quando detectados (detecção automática só funciona no app de computador).</p>
            <FieldError>{gamesError}</FieldError>
            {games === null && !gamesError && <SettingsSkeleton rows={2} />}
            {games && (
              <ul className="settings-poll-list">
                {games.map((g) => (
                  <li key={g.id} className="settings-poll-list-item">
                    <span className="truncate">{g.displayName}</span>
                    <button type="button" className="profile-relationship-end" onClick={() => removeGameFromList(g.id)}>Remover</button>
                  </li>
                ))}
                {games.length === 0 && <li className="settings-empty"><span className="settings-empty-icon"><SIcon name="gamepad" /></span>Nenhum jogo adicionado ainda. Digite o nome abaixo.</li>}
              </ul>
            )}
            <div className="birthday-picker-row" style={{ marginTop: 10 }}>
              <input
                value={newGameName}
                onChange={(e) => setNewGameName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') submitAddGame(); }}
                aria-label="Nome do jogo"
                placeholder="Nome do jogo (ex: Minecraft)"
                maxLength={100}
              />
              <button type="button" className="btn-secondary" disabled={addingGame || !newGameName.trim()} onClick={submitAddGame}>
                {addingGame ? '...' : 'Adicionar'}
              </button>
            </div>
          </div>

          {!userSettings ? <SettingsSkeleton /> : (
            <>
              <div className="settings-block settings-toggle-row">
                <div>
                  <h4>Detecção automática de jogos</h4>
                  <p className="dim">Detecta sozinho quando você abre um jogo instalado.</p>
                  <DesktopOnlyChip />
                </div>
                <Toggle on={userSettings.gameDetectionEnabled} onChange={(v) => updateUserSetting('gameDetectionEnabled', v)} label={TOGGLE_LABEL.gameDetectionEnabled} />
              </div>
              <div className="settings-block settings-toggle-row">
                <div>
                  <h4>Compartilhar atividade</h4>
                  <p className="dim">Mostra pros outros o que você está jogando agora, quando detectado.</p>
                </div>
                <Toggle on={userSettings.activitySharing} onChange={(v) => updateUserSetting('activitySharing', v)} label={TOGGLE_LABEL.activitySharing} />
              </div>
              {/* Mesmo comportamento da aba Dados e privacidade: só aparece
                  com o compartilhamento ligado (antes aparecia sempre aqui). */}
              {userSettings.activitySharing && (
                <div className="settings-block">
                  <h4>Quem pode ver minha atividade</h4>
                  <ActivityVisibilityPicker value={userSettings.activityVisibility} onChange={(v) => updateUserSetting('activityVisibility', v)} />
                </div>
              )}
              {/* BUG CORRIGIDO ("botão que não muda nada de verdade"):
                  havia um controle "Quem pode se juntar ao meu jogo"
                  aqui, ligado a gameJoinPrivacy — mas isso descreve um
                  recurso de "convite/entrar no jogo de um amigo" (tipo
                  Discord "Ask to Join") que não existe no Project Club.
                  O sistema de atividade atual (ver socket
                  activity:update) só guarda type+name+detail — sem
                  servidor/porta/mundo específico, não tem dado
                  suficiente pra alguém "entrar" em lugar nenhum. Mexer
                  nesse controle salvava um valor no banco que nunca
                  mudava nada de verdade. Removido daqui até esse recurso
                  existir; o campo continua no banco (gameJoinPrivacy)
                  pra quando isso for construído de verdade. */}
              <div className="settings-block settings-toggle-row">
                <div>
                  <h4>Sobreposição no jogo (overlay)</h4>
                  <p className="dim">Mostra mensagens e notificações por cima do jogo enquanto você joga.</p>
                  <DesktopOnlyChip />
                </div>
                <Toggle on={userSettings.overlayEnabled} onChange={(v) => updateUserSetting('overlayEnabled', v)} label={TOGGLE_LABEL.overlayEnabled} />
              </div>
              {userSettings.overlayEnabled && (
                <div className="settings-block settings-toggle-row">
                  <div>
                    <h4>Notificações na sobreposição</h4>
                    <p className="dim">Nova mensagem, menção, convite, pedido de amizade e entrada em chamada aparecem na overlay.</p>
                  </div>
                  <Toggle on={userSettings.overlayNotifications} onChange={(v) => updateUserSetting('overlayNotifications', v)} label={TOGGLE_LABEL.overlayNotifications} />
                </div>
              )}
            </>
          )}
        </div>
      )}

        </div>
      </div>
    </Modal>
    {cropperState && (
      <ImageCropperModal
        file={cropperState.file}
        src={cropperState.src}
        mode={cropperState.mode}
        gif={!!cropperState.gif}
        initialFraming={cropperState.initialFraming}
        preview={cropperState.preview}
        previewUser={{ ...user, profileColor: form.profileColor || user.profileColor }}
        aspectRatio={cropperState.aspectRatio}
        shape={cropperState.shape}
        title={cropperState.title}
        onConfirm={cropperState.onConfirm}
        onClose={() => setCropperState(null)}
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
    {albumManagerOpen && (
      <PhotoAlbumModal
        ownerId={user.id}
        ownerName={user.displayName}
        isMe
        onClose={() => setAlbumManagerOpen(false)}
      />
    )}
    </>
  );
}

function labelFor(tabKey, translate) {
  return {
    PROFILE: translate('settings.tabs.PROFILE'), PROFILE_CONTENT: translate('settings.tabs.PROFILE_CONTENT'), COLUMNS: translate('settings.tabs.COLUMNS'), MINI_PROFILE: translate('settings.tabs.MINI_PROFILE'), ACCOUNT: translate('settings.tabs.ACCOUNT'), VOICE: translate('settings.tabs.VOICE'), SECURITY: translate('settings.tabs.SECURITY'), APPEARANCE: translate('settings.tabs.APPEARANCE'),
    ACCOUNT_STATUS: translate('settings.tabs.ACCOUNT_STATUS'), PRIVACY: translate('settings.tabs.PRIVACY'), NOTIFICATIONS: translate('settings.tabs.NOTIFICATIONS'), ACCESSIBILITY: translate('settings.tabs.ACCESSIBILITY'), SYSTEM: translate('settings.tabs.SYSTEM'), LANGUAGE: translate('settings.tabs.LANGUAGE'), GAMES: translate('settings.tabs.GAMES'),
  }[tabKey];
}

function iconFor(t) {
  // Item pedido: "substitua os emojis pelos ícones fornecidos...
  // mantendo o mesmo tamanho, alinhamento, espaçamento e estilo
  // visual" — mesmo padrão já usado pro VOICE (abaixo), agora pra
  // todas as abas.
  const ICONS = {
    PROFILE: settingsProfileIcon, PROFILE_CONTENT: settingsProfileContentIcon, COLUMNS: settingsColumnsIcon,
    MINI_PROFILE: settingsMiniProfileIcon, ACCOUNT: settingsAccountIcon, SECURITY: settingsSecurityIcon,
    APPEARANCE: settingsAppearanceIcon, ACCOUNT_STATUS: settingsAccountStatusIcon, PRIVACY: settingsPrivacyIcon,
    NOTIFICATIONS: settingsNotificationsIcon, ACCESSIBILITY: settingsAccessibilityIcon, SYSTEM: settingsSystemIcon,
    LANGUAGE: settingsLanguageIcon, GAMES: settingsGamesIcon, VOICE: micIcon,
  };
  return <IconGlyph src={ICONS[t]} size={16} />;
}

// ============================================================
// Voz e vídeo — escolher microfone/saída de áudio, testar o microfone com
// um medidor de volume ao vivo, e as preferências self-service de chamada:
// redutor de ruído (B), nivelar volume (E), apertar pra falar (F) e
// legendas ao vivo (K). Tudo guardado no dispositivo (utils/voicePrefs.js).
// ============================================================
// Item pedido: "quero que abra um menu e mostre as fontes" — botão
// compacto (mostra o nome da opção atual + um mini-preview) que abre
// um popover flutuante com a grade completa, em vez do grid inteiro
// sempre visível na tela. Fecha sozinho ao clicar fora.
// Item pedido: "sistema... você pode escolher as cores de tudo" —
// grade de gradientes prontos (clicar aplica as duas cores de uma
// vez) + conta-gotas nativo (só aparece se o navegador suportar —
// Chrome/Edge desktop; em qualquer outro lugar, incluindo o app
// mobile, simplesmente não aparece, sem quebrar nada). setForm é a
// mesma função de sempre — isso não introduz nenhum campo novo no
// banco, só uma forma mais rápida de preencher os 2 já existentes.
// Item pedido: "poder editar cada cor... tipo todas as cores que
// aparecem no arco-íris... podendo deixar mais bonito do seu jeito" —
// N seletores de cor (um por cor do efeito — 6 pro Arco-íris, 2 pro
// Glitch), em vez de forçar um valor fixo. "Restaurar padrão" volta
// pras cores originais (limpa profileNameColors do formulário).
function MultiColorEditor({ effect, form, setForm }) {
  const defaults = DEFAULT_MULTI_COLORS[effect];
  let colors = defaults;
  try {
    const parsed = form.profileNameColors ? JSON.parse(form.profileNameColors) : null;
    if (Array.isArray(parsed) && parsed.length === defaults.length) colors = parsed;
  } catch { /* ignora — usa o padrão */ }

  const setColorAt = (index, value) => {
    const next = [...colors];
    next[index] = value;
    setForm((s) => ({ ...s, profileNameColors: JSON.stringify(next) }));
  };
  const restoreDefaults = () => setForm((s) => ({ ...s, profileNameColors: '' }));

  // Item pedido: "invés de ser quadradinho fosse uma barra que mostra
  // o degradê" — a barra em si já mostra a mistura real entre as
  // cores (background: linear-gradient com todas elas), e cada
  // <input type="color"> vira um marcador redondo posicionado EM CIMA
  // da barra, na posição correspondente à cor dele — clicar continua
  // abrindo o seletor de cor nativo de sempre, só o visual mudou.
  return (
    <div className="multi-color-editor">
      <div className="multi-color-gradient-bar" style={{ backgroundImage: `linear-gradient(90deg, ${colors.join(', ')})` }}>
        {colors.map((c, i) => (
          <input
            key={i} type="color" value={c} title={`Cor ${i + 1}`}
            className="multi-color-gradient-handle"
            style={{ left: `calc(8px + (100% - 16px) * ${i / (colors.length - 1)})` }}
            onChange={(e) => setColorAt(i, e.target.value)}
          />
        ))}
      </div>
      <button type="button" className="btn-link" onClick={restoreDefaults}>Restaurar cores padrão</button>
    </div>
  );
}

// Item pedido: "adicione... pode escolher qual vai ser o seu status
// como online, ocupado, ausência ou não perturbe" (esclarecido:
// "ocupado" é o mesmo Não perturbe já existente, nome mantido) — o
// backend já tinha TUDO isso pronto e testado (evento de socket
// presence:set, incluindo a regra de "escolha manual desativa o
// ausente automático até voltar pro Online" — onManualStatusChange
// em server/src/sockets/index.js) — só faltava esse botão pra chamar.
// Reaproveita STATUS_LABEL/STATUS_COLOR (utils/status.js), já usados
// em vários outros lugares do app pra não duplicar essas listas.
function StatusPicker() {
  const { user } = useAuth();
  const { socket } = useSocket();
  const presence = useStore((s) => s.presence);
  const current = presence[user.id]?.status || user.status || 'ONLINE';

  return (
    <div className="status-picker-row">
      {['ONLINE', 'IDLE', 'DND', 'INVISIBLE'].map((value) => (
        <button
          type="button" key={value}
          className={`status-picker-option ${current === value ? 'active' : ''}`}
          onClick={() => socket?.emit('presence:set', value)}
        >
          <PresenceDot status={value} className="status-picker-dot" />
          {STATUS_LABEL[value]}
        </button>
      ))}
    </div>
  );
}

// Item pedido: "5 variantes de visual dos meus emoji" — mostra um
// emoji de exemplo NO ESTILO ESPECÍFICO passado por prop (diferente
// de StyledEmoji.jsx, que sempre usa o estilo ATUAL da pessoa — aqui
// preciso mostrar os 5 ao mesmo tempo, cada um com seu próprio
// estilo, pra comparar antes de escolher). Mesmo fallback gracioso:
// se a imagem falhar, cai pro texto normal.
function EmojiStylePreview({ style, emoji = '😀' }) {
  const [failed, setFailed] = useState(false);
  useEmojiSet(style);
  const url = style !== 'native' && !failed ? emojiImageUrl(emoji, style) : null;
  if (!url) return <span style={{ fontSize: 28 }}>{emoji}</span>;
  return <img src={url} alt={emoji} width={28} height={28} onError={() => setFailed(true)} />;
}

function NameColorPresets({ setForm }) {
  const [pickerError, setPickerError] = useState('');
  const pickWithEyeDropper = async () => {
    setPickerError('');
    try {
      const hex = await pickColorFromScreen();
      if (hex) setForm((s) => ({ ...s, profileNameColor: hex }));
    } catch {
      setPickerError('Não foi possível usar o conta-gotas agora.');
    }
  };

  return (
    <div className="name-color-presets">
      <div className="name-color-presets-row">
        {NAME_COLOR_PRESETS.map(([c1, c2], i) => (
          <button
            type="button" key={i} className="name-color-preset-swatch"
            style={{ background: c1 === c2 ? c1 : `linear-gradient(135deg, ${c1}, ${c2})` }}
            title={c1 === c2 ? c1 : `${c1} → ${c2}`}
            onClick={() => setForm((s) => ({ ...s, profileNameColor: c1, profileNameColor2: c2 }))}
          />
        ))}
        {isEyeDropperSupported() && (
          <button type="button" className="name-color-eyedropper-btn" title="Escolher cor da tela (conta-gotas)" onClick={pickWithEyeDropper}>
            <SIcon name="pipette" size={16} />
          </button>
        )}
      </div>
      {pickerError && <p className="dim" style={{ fontSize: 11, margin: '2px 0 0' }}>{pickerError}</p>}
    </div>
  );
}

function NameStylePickerButton({ label, open, setOpen, currentLabel, children, menu }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open, setOpen]);

  return (
    <div className="name-style-picker-button-wrap" ref={ref}>
      <button type="button" className="name-style-picker-button" onClick={() => setOpen((v) => !v)}>
        <span className="name-style-picker-button-label">{label}</span>
        {children}
        <span className="name-style-picker-button-current truncate">{currentLabel}</span>
        <span className={`name-style-picker-button-caret ${open ? 'open' : ''}`}><SIcon name="caret" size={14} /></span>
      </button>
      {open && menu}
    </div>
  );
}

function VoiceSettingsTab() {
  const voice = useVoice();
  const [mics, setMics] = useState([]);
  const [speakers, setSpeakers] = useState([]);
  const [selectedMic, setSelectedMic] = useState(getPreferredMicId());
  const [selectedSpeaker, setSelectedSpeaker] = useState(getPreferredSpeakerId());
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [level, setLevel] = useState(0);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const testStreamRef = useRef(null);
  const testCtxRef = useRef(null);
  const testRafRef = useRef(null);
  // Preferências de voz guardadas no dispositivo (voicePrefs).
  const [prefs, setPrefs] = useState(getVoicePrefs);
  const [capturingKey, setCapturingKey] = useState(false);
  const updatePref = (name, value) => {
    setVoicePref(name, value);
    setPrefs((p) => ({ ...p, [name]: value }));
    if (name === 'noiseReduction') voice.setNoiseReduction?.(value);
  };
  // Captura da tecla do "apertar pra falar": escuta o próximo toque.
  useEffect(() => {
    if (!capturingKey) return undefined;
    const onKey = (e) => {
      e.preventDefault();
      if (e.code === 'Escape') { setCapturingKey(false); return; }
      updatePref('pushToTalkKey', e.code);
      setCapturingKey(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [capturingKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const refreshDevices = async () => {
    try {
      // Nomes de verdade (em vez de "Microfone 1") só vêm depois de alguma
      // permissão de mídia já ter sido concedida — pede um microfone
      // qualquer só pra "destravar" isso, sem manter nada gravando.
      const probe = await navigator.mediaDevices.getUserMedia({ audio: true }).catch((err) => {
        if (err?.name === 'NotAllowedError') setPermissionDenied(true);
        return null;
      });
      if (probe) setPermissionDenied(false);
      probe?.getTracks().forEach((t) => t.stop());
      const { mics: m, speakers: s } = await listAudioDevices();
      setMics(m);
      setSpeakers(s);
    } catch { /* sem permissão de mídia — deixa a lista vazia */ }
  };
  useEffect(() => {
    refreshDevices();
    // Item pedido: "o mais fácil possível... aproveitar [o dispositivo]
    // ao entrar" — sem isso, conectar um fone/microfone novo enquanto
    // essa tela já estava aberta não atualizava a lista sozinho (só
    // reaparecia se a pessoa fechasse e abrisse de novo).
    navigator.mediaDevices?.addEventListener?.('devicechange', refreshDevices);
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', refreshDevices);
  }, []);

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
    } catch (err) {
      if (err?.name === 'NotAllowedError') setPermissionDenied(true);
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
        <h4 className="settings-h4-row"><SIcon name="mic" size={16} /> Microfone</h4>
        {permissionDenied && <FieldError>O navegador bloqueou o microfone. Libere o acesso nas permissões do site e tente de novo.</FieldError>}
        <label>
          DISPOSITIVO
          <select value={selectedMic} onChange={(e) => changeMic(e.target.value)}>
            <option value="">Padrão do sistema</option>
            {mics.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Microfone sem nome'}</option>)}
          </select>
        </label>
        {saving && <p className="dim" style={{ fontSize: 12 }}>Trocando microfone...</p>}
        {!saving && mics.length === 0 && !permissionDenied && <p className="dim settings-field-hint">Nenhum microfone encontrado. Conecte um e ele aparece aqui sozinho.</p>}
        <div className="settings-inline-actions">
          <button className={testing ? 'btn-danger' : 'btn-secondary'} onClick={testing ? stopTest : startTest}>
            <SIcon name="mic" size={14} /> {testing ? 'Parar teste' : 'Testar microfone'}
          </button>
        </div>
        {testing && (
          <div className="settings-mic-test">
            <div className="mic-level-meter" role="meter" aria-label="Volume do microfone" aria-valuemin={0} aria-valuemax={100} aria-valuenow={level}>
              <div className="mic-level-meter-fill" style={{ width: `${level}%` }} />
            </div>
            <span className="dim">{level > 8 ? 'Estamos ouvindo você.' : 'Fale alguma coisa…'}</span>
          </div>
        )}
      </div>

      {isOutputSelectionSupported() && (
        <div className="settings-block">
          <h4 className="settings-h4-row"><SIcon name="speaker" size={16} /> Saída de áudio</h4>
          <label>
            DISPOSITIVO (fones, caixa de som...)
            <select value={selectedSpeaker} onChange={(e) => changeSpeaker(e.target.value)}>
              <option value="">Padrão do sistema</option>
              {speakers.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Saída sem nome'}</option>)}
            </select>
          </label>
        </div>
      )}

      {/* Testar antes de entrar (painel de pré-entrada da chamada) */}
      <PreJoinToggle />

      {/* Redutor de ruído (B) */}
      <div className="settings-block settings-toggle-row">
        <div>
          <h4>Redutor de ruído</h4>
          <p className="dim">Remove ruído de fundo (ventilador, teclado, eco) e nivela o volume do seu microfone. No servidor de voz próprio usa o RNNoise (rede neural, igual ao do Jitsi). Desligue se usa microfone de estúdio e prefere o som original.</p>
        </div>
        <Toggle on={prefs.noiseReduction} onChange={(v) => { updatePref('noiseReduction', v); if (getExtra().inputProfile !== 'custom') setExtra({ inputProfile: 'custom' }); }} label="Redutor de ruído" />
      </div>

      {/* Nivelar volume automático (E) */}
      <div className="settings-block settings-toggle-row">
        <div>
          <h4>Nivelar volume automaticamente</h4>
          <p className="dim">Aproxima o volume das pessoas: quem fala baixo fica mais audível e quem fala alto não estoura. Afeta só o que você ouve.</p>
        </div>
        <Toggle on={prefs.autoLevelVolume} onChange={(v) => updatePref('autoLevelVolume', v)} label="Nivelar volume automaticamente" />
      </div>

      {/* Apertar pra falar (F) */}
      <div className="settings-block settings-toggle-row">
        <div>
          <h4>Apertar pra falar</h4>
          <p className="dim">Seu microfone fica mudo e só vai ao ar enquanto você segura a tecla escolhida.</p>
        </div>
        <Toggle on={prefs.pushToTalkEnabled} onChange={(v) => updatePref('pushToTalkEnabled', v)} label="Apertar pra falar" />
      </div>
      {prefs.pushToTalkEnabled && (
        <div className="settings-block">
          <h4 className="settings-h4-row">Tecla do apertar pra falar <span className="settings-chip">{prettyKeyName(prefs.pushToTalkKey)}</span></h4>
          <div className="settings-inline-actions">
            <button type="button" className={capturingKey ? 'btn-danger' : 'btn-secondary'} onClick={() => setCapturingKey((v) => !v)}>
              {capturingKey ? 'Pressione uma tecla… (Esc cancela)' : 'Trocar tecla'}
            </button>
          </div>
          {/* Folga ao soltar a tecla: o mic continua aberto esse tempo (não corta a última sílaba). */}
          <h4 className="settings-h4-row" style={{ marginTop: 14 }}>
            Atraso ao soltar a tecla <span className="settings-chip">{pttReleaseFromPrefs(prefs.pushToTalkReleaseMs)} ms</span>
          </h4>
          <p className="dim">Quanto tempo o microfone continua aberto depois de soltar a tecla.</p>
          <input
            type="range" min="0" max="1000" step="20" value={pttReleaseFromPrefs(prefs.pushToTalkReleaseMs)}
            onChange={(e) => updatePref('pushToTalkReleaseMs', Number(e.target.value))}
            aria-label="Atraso ao soltar a tecla do apertar pra falar (ms)" style={{ width: '100%', maxWidth: 360 }}
          />
        </div>
      )}

      {/* Legendas ao vivo (K) */}
      <div className="settings-block settings-toggle-row">
        <div>
          <h4>Legendas ao vivo (automáticas)</h4>
          <p className="dim">
            Mostra na tela, em tempo real, o que você fala (pt-BR), usando o reconhecimento de voz do navegador. São automáticas e podem conter erros.
            {!isSpeechRecognitionSupported() && ' Seu navegador não suporta este recurso.'}
          </p>
        </div>
        <Toggle on={prefs.captions} onChange={(v) => updatePref('captions', v)} label="Legendas ao vivo" disabled={!isSpeechRecognitionSupported()} />
      </div>
      <VoiceExtras prefs={prefs} updatePref={updatePref} />
    </div>
  );
}

// Indicador do salvamento automático ("Salvando…" / "Salvo").
function SaveStatusPill() {
  const status = useSaveStatus();
  if (status === 'idle') return null;
  const label = { saving: 'Salvando…', saved: 'Salvo', error: 'Não foi possível salvar' }[status];
  return (
    <span className={`settings-save-pill is-${status}`} role="status" aria-live="polite">
      {status === 'saving' ? <span className="settings-save-spinner" aria-hidden="true" /> : (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d={status === 'saved' ? 'M5 12.5l4.5 4.5L19 7.5' : 'M12 8v5M12 16.5v.5'} />
        </svg>
      )}
      {label}
    </span>
  );
}

// "Alterar avatar": abre um menu com enviar nova foto ou tirar o fundo
// preto da foto atual (o editor de imagem também tem essa opção ao
// escolher uma foto nova).
function AvatarChangeMenu({ onFile, canFixBackground, onFixBackground }) {
  const [pos, setPos] = useState(null); // posição do menu (fixo, fora do cartão que corta)
  const btnRef = useRef(null);
  const menuRef = useRef(null);
  const fileRef = useRef(null);
  const open = !!pos;
  const toggle = () => {
    if (open) { setPos(null); return; }
    const r = btnRef.current.getBoundingClientRect();
    const width = Math.min(300, window.innerWidth - 16);
    setPos({ top: r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)), width });
  };
  useEffect(() => {
    if (!open) return undefined;
    const close = () => setPos(null);
    const onDown = (e) => { if (!menuRef.current?.contains(e.target) && !btnRef.current?.contains(e.target)) close(); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', close);
    document.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', close);
      document.removeEventListener('scroll', close, true);
    };
  }, [open]);
  return (
    <>
      <button ref={btnRef} type="button" className="btn-secondary" aria-haspopup="menu" aria-expanded={open} onClick={toggle}>
        Alterar avatar
      </button>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { setPos(null); onFile(e); }} />
      {open && createPortal(
        <div ref={menuRef} className="avatar-change-menu" role="menu" style={{ top: pos.top, left: pos.left, width: pos.width }}>
          <button type="button" role="menuitem" onClick={() => fileRef.current?.click()}>
            <strong>Escolher nova foto</strong>
            <span>PNG, JPG, WEBP ou GIF. No editor dá pra tirar o fundo preto.</span>
          </button>
          {canFixBackground && (
            <button type="button" role="menuitem" onClick={() => { setPos(null); onFixBackground(); }}>
              <strong>Tirar fundo preto da foto atual</strong>
              <span>Deixa transparente pra mostrar a cor do seu perfil.</span>
            </button>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}

// ============================================================
// Peças pequenas reaproveitadas pelas abas (rodada 7).
// ============================================================
// Ícones de traço locais (mesmo estilo de NavIcons/PageIcons).
const S_ICONS = {
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  eyeOff: 'M3 3l18 18M10.6 5.1A10.6 10.6 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.2M6.5 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7a9.8 9.8 0 0 0 4.4-1M9.9 9.9a3 3 0 0 0 4.2 4.2',
  smile: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8.5 14.5s1.2 1.8 3.5 1.8 3.5-1.8 3.5-1.8M9 9.5h.01M15 9.5h.01',
  pipette: 'M14.5 4.5l5 5M17 2.5a2.1 2.1 0 0 1 3 3l-2.5 2.5-3-3zM14.5 7.5 5 17v2h2l9.5-9.5',
  caret: 'M6 9l6 6 6-6',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  alert: 'M12 8v5M12 16.5v.5M10.3 3.9 2.6 17a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  lock: 'M6 11h12v10H6zM8.5 11V7.5a3.5 3.5 0 0 1 7 0V11',
  mail: 'M3 6h18v12H3zM3 7l9 6 9-6',
  calendar: 'M4 6h16v15H4zM4 10h16M8 3v4M16 3v4',
  shield: 'M12 3l8 3v6c0 4.6-3.4 8.3-8 9-4.6-.7-8-4.4-8-9V6z',
  mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3',
  speaker: 'M4 9v6h4l5 4V5L8 9zM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12',
  bell: 'M6 16V11a6 6 0 1 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0',
  keyboard: 'M3 6h18v12H3zM7 10h.01M11 10h.01M15 10h.01M7 14h10',
  close: 'M6 6l12 12M18 6 6 18',
  plus: 'M12 5v14M5 12h14',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  reset: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5',
  monitor: 'M3 4h18v12H3zM8 20h8M12 16v4',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  gamepad: 'M6 9h12a4 4 0 0 1 4 4v1a3 3 0 0 1-5.4 1.8L15 14H9l-1.6 1.8A3 3 0 0 1 2 14v-1a4 4 0 0 1 4-4zM8 11v3M6.5 12.5h3M15.5 12h.01M17.5 13.5h.01',
};
function SIcon({ name, size = 15, strokeWidth = 2 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="s-icon">
      <path d={S_ICONS[name]} />
    </svg>
  );
}

// "Testar antes de entrar": painel com microfone/câmera/saída antes de
// conectar numa chamada. Salvo na conta (extraPrefs.preJoinCheck) — é o
// mesmo valor que o "Não mostrar de novo" do painel desliga.
function PreJoinToggle() {
  const on = useExtra('preJoinCheck') === true;
  return (
    <div className="settings-block settings-toggle-row">
      <div>
        <h4>Testar antes de entrar</h4>
        <p className="dim">Antes de entrar numa chamada, mostra um painel para escolher e testar o microfone (com medidor), a câmera (com prévia) e a saída de áudio, e decidir se entra mudo ou com a câmera ligada.</p>
      </div>
      <Toggle on={on} onChange={(v) => setExtra({ preJoinCheck: v })} label="Testar antes de entrar" />
    </div>
  );
}

// Chave liga/desliga acessível (antes era um <button> sem nome nem estado).
function Toggle({ on, onChange, label, disabled }) {
  return (
    <button
      type="button" role="switch" aria-checked={!!on} aria-label={label} disabled={disabled}
      className={`toggle-switch ${on ? 'on' : ''}`} onClick={() => onChange(!on)}
    />
  );
}

// Lista de opções com título + explicação (escolha única).
function RadioCards({ value, options, onChange, label }) {
  return (
    <div className="settings-radio-cards" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value} type="button" role="radio" aria-checked={value === o.value}
          className={`settings-radio-card ${value === o.value ? 'active' : ''}`}
          onClick={() => onChange(o.value)}
        >
          <span className="settings-radio-dot" aria-hidden="true" />
          <span className="settings-radio-text">
            <strong>{o.label}</strong>
            {o.hint && <span>{o.hint}</span>}
          </span>
        </button>
      ))}
    </div>
  );
}

// Escolha curta (2–4 opções) em pílulas.
function Segmented({ value, options, onChange, label }) {
  return (
    <div className="chip-choice-row settings-segmented" role="radiogroup" aria-label={label}>
      {options.map(([v, l]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} className={`chip-choice ${value === v ? 'active' : ''}`} onClick={() => onChange(v)}>{l}</button>
      ))}
    </div>
  );
}

// Esqueleto enquanto as preferências da conta carregam.
function SettingsSkeleton({ rows = 3 }) {
  return (
    <div className="settings-skeleton" aria-label="Carregando" role="status">
      {Array.from({ length: rows }, (_, i) => <span key={i} className="settings-sk-block" />)}
    </div>
  );
}

// Mensagem de erro de um campo.
function FieldError({ children }) {
  if (!children) return null;
  return <span className="settings-field-error" role="alert"><SIcon name="alert" size={13} /> {children}</span>;
}

// Contador de caracteres (fica laranja perto do limite).
function CharCount({ value, max }) {
  const n = (value || '').length;
  return <span className={`settings-char-count ${n >= max * 0.9 ? 'is-near' : ''}`}>{n}/{max}</span>;
}

// Selo "só no app de computador" pras opções que o navegador ignora.
function DesktopOnlyChip() {
  if (typeof window !== 'undefined' && window.electronAPI) return null;
  return <span className="settings-chip"><SIcon name="monitor" size={12} /> Só no app de computador</span>;
}

// Verificação em duas etapas (aba Senha e segurança). Toda ação sensível
// pede a senha atual num campo de senha de verdade (não no prompt
// genérico, que mostrava a senha em texto puro): configurar, desativar
// (senha + código do app OU um código de recuperação) e gerar códigos de
// recuperação novos. Os códigos de recuperação aparecem UMA vez só —
// logo depois de ativar ou de gerar novos — com botões de copiar/baixar.
function TwoFactorBlock({ user, setUser }) {
  const [setup, setSetup] = useState(null); // { qrDataUrl, secret } durante a configuração
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState(null); // null | 'setup-password' | 'disable' | 'regenerate'
  const [useRecovery, setUseRecovery] = useState(false);
  const [recoveryInput, setRecoveryInput] = useState('');
  const [freshCodes, setFreshCodes] = useState(null); // códigos recém-gerados (mostrados uma vez)
  const [remaining, setRemaining] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!user.twoFactorEnabled) { setRemaining(null); return; }
    getRecoveryCodesStatus().then((d) => setRemaining(d.remaining)).catch(() => {});
  }, [user.twoFactorEnabled]);

  const reset = () => {
    setMode(null); setPassword(''); setCode(''); setRecoveryInput(''); setUseRecovery(false); setErr('');
  };
  const apiErr = (e, fallback) => e?.response?.data?.error || fallback;

  const startSetup = async () => {
    setErr(''); setBusy(true);
    try {
      const data = await setup2FA(password);
      setSetup(data);
      setMode(null); setPassword(''); setCode('');
    } catch (e) { setErr(apiErr(e, 'Não foi possível começar a configuração do 2FA.')); } finally { setBusy(false); }
  };

  const confirmSetup = async () => {
    setErr(''); setBusy(true);
    try {
      const data = await confirm2FA(code);
      setUser({ ...user, twoFactorEnabled: true });
      setSetup(null); setCode('');
      setFreshCodes(data.recoveryCodes || null);
      setRemaining(data.recoveryCodes?.length ?? null);
    } catch (e) { setErr(apiErr(e, 'Código inválido.')); } finally { setBusy(false); }
  };

  const submitDisable = async () => {
    setErr(''); setBusy(true);
    try {
      await disable2FA(password, useRecovery ? { recoveryCode: recoveryInput } : { code });
      setUser({ ...user, twoFactorEnabled: false });
      setFreshCodes(null);
      reset();
    } catch (e) { setErr(apiErr(e, 'Não foi possível desativar o 2FA.')); } finally { setBusy(false); }
  };

  const submitRegenerate = async () => {
    setErr(''); setBusy(true);
    try {
      const data = await regenerateRecoveryCodes(password);
      setFreshCodes(data.recoveryCodes);
      setRemaining(data.recoveryCodes.length);
      reset();
    } catch (e) { setErr(apiErr(e, 'Não foi possível gerar novos códigos.')); } finally { setBusy(false); }
  };

  const codesText = () => [
    'Project Club — códigos de recuperação da verificação em duas etapas',
    `Conta: @${user.username}`,
    `Gerados em: ${new Date().toLocaleString('pt-BR')}`,
    '',
    'Cada código funciona UMA vez. Guarde num lugar seguro.',
    '',
    ...(freshCodes || []),
    '',
  ].join('\n');
  const copyCodes = () => navigator.clipboard?.writeText((freshCodes || []).join('\n'))
    .then(() => useStore.getState().pushNotice('Códigos copiados.')).catch(() => {});
  const downloadCodes = () => {
    const blob = new Blob([codesText()], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'projectclub-codigos-de-recuperacao.txt';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const passwordField = (
    <label>SENHA ATUAL
      <input
        type="password" autoComplete="current-password" value={password} autoFocus
        onChange={(e) => setPassword(e.target.value)}
      />
    </label>
  );

  return (
    <div className="settings-block">
      <h4 className="settings-h4-row">
        Verificação em duas etapas (2FA)
        {user.twoFactorEnabled
          ? <span className="settings-chip is-ok"><SIcon name="shield" size={12} /> Ativada</span>
          : <span className="settings-chip">Desativada</span>}
      </h4>

      {freshCodes && (
        <div className="settings-recovery-codes" role="region" aria-label="Códigos de recuperação">
          <p><strong>Seus códigos de recuperação</strong></p>
          <p className="dim">
            Se você perder o celular com o app autenticador, entre com um destes códigos no lugar do código de 6 dígitos.
            Cada um funciona <b>uma vez só</b>. Guarde num lugar seguro — eles <b>não</b> vão aparecer de novo.
          </p>
          <ol className="settings-recovery-list">
            {freshCodes.map((c) => <li key={c}><code>{c}</code></li>)}
          </ol>
          <div className="settings-inline-actions">
            <button type="button" className="btn-secondary" onClick={copyCodes}><SIcon name="copy" size={14} /> Copiar</button>
            <button type="button" className="btn-secondary" onClick={downloadCodes}>Baixar .txt</button>
            <button type="button" className="btn-primary" onClick={() => setFreshCodes(null)}>Já guardei</button>
          </div>
        </div>
      )}

      {user.twoFactorEnabled ? (
        <>
          <p className="dim">Ao entrar, além da senha, pedimos um código do seu app autenticador.</p>
          {remaining !== null && (
            <p className="dim settings-field-hint">
              Códigos de recuperação restantes: <b>{remaining}</b>
              {remaining <= 2 && ' — gere novos antes que acabem.'}
            </p>
          )}

          {mode === 'disable' && (
            <div className="settings-2fa-form">
              {passwordField}
              {useRecovery ? (
                <label>CÓDIGO DE RECUPERAÇÃO
                  <input value={recoveryInput} placeholder="xxxxx-xxxxx" autoComplete="off" spellCheck={false} maxLength={14} onChange={(e) => setRecoveryInput(e.target.value)} />
                </label>
              ) : (
                <label>CÓDIGO DO APP AUTENTICADOR
                  <input
                    className="settings-code-input" placeholder="000000" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
                    value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  />
                </label>
              )}
              <button type="button" className="btn-link settings-inline-link" onClick={() => { setUseRecovery((v) => !v); setErr(''); }}>
                {useRecovery ? 'Usar o código do app' : 'Sem acesso ao app? Usar código de recuperação'}
              </button>
              <FieldError>{err}</FieldError>
              <div className="settings-inline-actions">
                <button
                  className="btn-danger"
                  disabled={busy || !password || (useRecovery ? !recoveryInput.trim() : code.length !== 6)}
                  onClick={submitDisable}
                >
                  {busy ? '...' : 'Confirmar e desativar'}
                </button>
                <button type="button" className="btn-link" onClick={reset}>Cancelar</button>
              </div>
            </div>
          )}

          {mode === 'regenerate' && (
            <div className="settings-2fa-form">
              <p className="dim">Os códigos antigos (usados ou não) deixam de funcionar na hora.</p>
              {passwordField}
              <FieldError>{err}</FieldError>
              <div className="settings-inline-actions">
                <button className="btn-primary" disabled={busy || !password} onClick={submitRegenerate}>
                  {busy ? '...' : 'Gerar novos códigos'}
                </button>
                <button type="button" className="btn-link" onClick={reset}>Cancelar</button>
              </div>
            </div>
          )}

          {!mode && (
            <div className="settings-inline-actions">
              <button className="btn-secondary" onClick={() => { reset(); setMode('regenerate'); }}>Gerar novos códigos de recuperação</button>
              <button className="btn-danger" onClick={() => { reset(); setMode('disable'); }}>Desativar 2FA</button>
            </div>
          )}
        </>
      ) : setup ? (
        <div className="settings-2fa-setup">
          <img src={setup.qrDataUrl} alt="QR code pra configurar o 2FA" width={168} height={168} className="settings-2fa-qr" />
          <div className="settings-2fa-steps">
            <ol>
              <li>Abra seu app autenticador (Google Authenticator, Authy…).</li>
              <li>Escaneie o QR code ou digite a chave abaixo.</li>
              <li>Digite o código de 6 dígitos que aparecer.</li>
            </ol>
            <div className="settings-2fa-secret">
              <code>{setup.secret}</code>
              <button type="button" className="settings-icon-btn" title="Copiar chave" aria-label="Copiar chave" onClick={() => navigator.clipboard?.writeText(setup.secret).then(() => useStore.getState().pushNotice('Chave copiada.')).catch(() => {})}>
                <SIcon name="copy" size={14} />
              </button>
            </div>
            <input
              className="settings-code-input" placeholder="000000" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
              aria-label="Código de 6 dígitos" value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              onKeyDown={(e) => { if (e.key === 'Enter' && code.length === 6) confirmSetup(); }}
            />
            <FieldError>{err}</FieldError>
            <div className="settings-inline-actions">
              <button className="btn-primary" disabled={busy || code.length !== 6} onClick={confirmSetup}>Confirmar e ativar</button>
              <button type="button" className="btn-link" onClick={() => { setSetup(null); setCode(''); setErr(''); }}>Cancelar</button>
            </div>
          </div>
        </div>
      ) : (
        <>
          <p className="dim">Além da senha, pede um código do seu app autenticador (Google Authenticator, Authy…) toda vez que você entrar. Protege sua conta mesmo se alguém descobrir a senha.</p>
          {mode === 'setup-password' ? (
            <div className="settings-2fa-form">
              {passwordField}
              <FieldError>{err}</FieldError>
              <div className="settings-inline-actions">
                <button className="btn-primary" disabled={busy || !password} onClick={startSetup}>{busy ? '...' : 'Continuar'}</button>
                <button type="button" className="btn-link" onClick={reset}>Cancelar</button>
              </div>
            </div>
          ) : (
            <div className="settings-inline-actions">
              <button className="btn-primary" onClick={() => { reset(); setMode('setup-password'); }}>Configurar 2FA</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// "Lista de bloqueados" (aba Senha e segurança): quem VOCÊ bloqueou, com
// botão de desbloquear. Nunca mostra quem bloqueou você.
function BlockedUsersBlock() {
  const [blocked, setBlocked] = useState(null);
  const [err, setErr] = useState('');
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    listBlockedUsers().then((d) => setBlocked(d.blocked)).catch(() => setErr('Não foi possível carregar sua lista de bloqueados.'));
  }, []);

  const doUnblock = async (userId) => {
    setErr(''); setBusyId(userId);
    try {
      await unblockUser(userId);
      setBlocked((list) => list?.filter((b) => b.user?.id !== userId));
    } catch (e) {
      setErr(e?.response?.data?.error || 'Não foi possível desbloquear.');
    } finally { setBusyId(null); }
  };

  return (
    <div className="settings-block">
      <h4 className="settings-h4-row">Lista de bloqueados {blocked && <span className="settings-chip">{blocked.length}</span>}</h4>
      <p className="dim">Pessoas bloqueadas não podem te mandar mensagem direta, nem te colocar em grupos, nem te mandar pedido de amizade.</p>
      <FieldError>{err}</FieldError>
      {blocked === null && !err && <SettingsSkeleton rows={2} />}
      {blocked && blocked.length === 0 && <p className="dim">Você não bloqueou ninguém.</p>}
      {blocked && blocked.length > 0 && (
        <div className="sessions-list">
          {blocked.map((b) => (
            <div key={b.id} className="session-row">
              <UserAvatar user={b.user} size={32} />
              <div className="session-row-info">
                <div>{b.user?.displayName}</div>
                <div className="dim">@{b.user?.username} · bloqueado em {new Date(b.blockedAt).toLocaleDateString('pt-BR')}</div>
              </div>
              <button className="btn-secondary" disabled={busyId === b.user?.id} onClick={() => doUnblock(b.user?.id)}>
                {busyId === b.user?.id ? '...' : 'Desbloquear'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Trocar senha (aba Senha e segurança): mostrar/esconder, requisitos ao
// vivo e aviso certo sobre as sessões (o servidor encerra TODAS).
function PasswordChangeBlock({ pwForm, setPwForm, pwError, pwSuccess, pwSaving, onSubmit }) {
  const [show, setShow] = useState(false);
  const rules = passwordRules(pwForm.next);
  const mismatch = pwForm.confirm && pwForm.next !== pwForm.confirm;
  const type = show ? 'text' : 'password';
  const set = (k) => (e) => setPwForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <div className="settings-block">
      <h4 className="settings-h4-row">
        Trocar senha
        <button type="button" className="btn-link settings-inline-link" aria-pressed={show} onClick={() => setShow((v) => !v)}>
          <SIcon name={show ? 'eyeOff' : 'eye'} size={14} /> {show ? 'Esconder' : 'Mostrar'}
        </button>
      </h4>
      <label>SENHA ATUAL<input type={type} autoComplete="current-password" value={pwForm.current} onChange={set('current')} /></label>
      <label>SENHA NOVA<input type={type} autoComplete="new-password" value={pwForm.next} onChange={set('next')} /></label>
      {pwForm.next && (
        <ul className="settings-pw-rules">
          {rules.map((r) => (
            <li key={r.label} className={r.ok ? 'is-ok' : ''}><SIcon name={r.ok ? 'check' : 'close'} size={12} /> {r.label}</li>
          ))}
        </ul>
      )}
      <label>CONFIRME A SENHA NOVA<input type={type} autoComplete="new-password" value={pwForm.confirm} aria-invalid={!!mismatch} onChange={set('confirm')} /></label>
      {mismatch && <FieldError>As duas senhas novas não são iguais.</FieldError>}
      <p className="dim settings-field-hint">Por segurança, trocar a senha encerra todas as outras sessões abertas (outros aparelhos e navegadores). Este dispositivo continua conectado.</p>
      <FieldError>{pwError}</FieldError>
      {pwSuccess && <span className="settings-field-ok" role="status"><SIcon name="check" size={13} /> Senha alterada com sucesso.</span>}
      <div className="settings-inline-actions">
        <button className="btn-primary" disabled={pwSaving || !pwForm.current || !pwForm.next || !pwForm.confirm} onClick={onSubmit}>
          {pwSaving ? 'Salvando…' : 'Trocar senha'}
        </button>
      </div>
    </div>
  );
}

// Status da conta (só leitura): um resumo com selo colorido + linhas.
function AccountStatusTab({ user }) {
  const now = new Date();
  const suspended = user.suspendedUntil && new Date(user.suspendedUntil) > now;
  const timedOut = user.timeoutUntil && new Date(user.timeoutUntil) > now;
  const state = user.accountDisabledAt ? 'disabled' : user.isPlatformBanned ? 'banned' : suspended ? 'limited' : timedOut ? 'muted' : 'ok';
  const STATE = {
    ok: { label: 'Ativa', text: 'Tudo certo com a sua conta. Nenhuma restrição.', tone: 'ok', icon: 'check' },
    limited: { label: 'Parcialmente limitada', text: `Suspensa até ${suspended ? new Date(user.suspendedUntil).toLocaleString('pt-BR') : ''}.`, tone: 'warn', icon: 'alert' },
    muted: { label: 'Em silenciamento temporário', text: `Você não pode mandar mensagens até ${timedOut ? new Date(user.timeoutUntil).toLocaleString('pt-BR') : ''}.`, tone: 'warn', icon: 'clock' },
    banned: { label: 'Banida', text: user.platformBanReason ? `Motivo: ${user.platformBanReason}` : 'A conta foi banida pela equipe.', tone: 'bad', icon: 'lock' },
    disabled: { label: 'Desativada', text: 'A conta foi desativada.', tone: 'bad', icon: 'lock' },
  }[state];
  const created = new Date(user.createdAt);
  return (
    <div className="settings-grid">
      <div className={`settings-block settings-status-hero is-${STATE.tone}`}>
        <span className="settings-status-hero-icon" aria-hidden="true"><SIcon name={STATE.icon} size={22} /></span>
        <div>
          <h4>Conta {STATE.label.toLowerCase()}</h4>
          <p className="dim">{STATE.text}</p>
        </div>
      </div>
      <div className="settings-block">
        <h4>Detalhes</h4>
        <div className="settings-info-rows">
          <div className="settings-info-row">
            <span className="settings-row-icon" aria-hidden="true"><SIcon name="calendar" /></span>
            <span>Conta criada em</span>
            <strong>{Number.isNaN(created.getTime()) ? '—' : created.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}</strong>
          </div>
          <div className="settings-info-row">
            <span className="settings-row-icon" aria-hidden="true"><SIcon name="mail" /></span>
            <span>Verificação de e-mail</span>
            {user.emailVerified
              ? <span className="settings-chip is-ok"><SIcon name="check" size={12} /> Verificado</span>
              : <span className="settings-chip is-warn"><SIcon name="alert" size={12} /> Ainda não verificado</span>}
          </div>
          <div className="settings-info-row">
            <span className="settings-row-icon" aria-hidden="true"><SIcon name="shield" /></span>
            <span>Verificação em duas etapas</span>
            {user.twoFactorEnabled
              ? <span className="settings-chip is-ok"><SIcon name="check" size={12} /> Ativada</span>
              : <span className="settings-chip">Desativada</span>}
          </div>
          <div className="settings-info-row">
            <span className="settings-row-icon" aria-hidden="true"><SIcon name="alert" /></span>
            <span>Restrições</span>
            <strong>{state === 'ok' ? 'Nenhuma' : STATE.label}</strong>
          </div>
        </div>
      </div>
    </div>
  );
}

// Quem pode ver minha atividade (mesmo controle nas duas abas).
function ActivityVisibilityPicker({ value, onChange }) {
  return (
    <RadioCards
      label="Quem pode ver minha atividade" value={value} onChange={onChange}
      options={[
        { value: 'everyone', label: 'Todos permitidos' },
        { value: 'friends', label: 'Somente amigos' },
        { value: 'friends_groups', label: 'Pessoas dos mesmos grupos' },
        { value: 'none', label: 'Ninguém' },
      ]}
    />
  );
}

// Aviso quando o navegador bloqueia notificações (antes a chave ficava
// "ligada" sem efeito nenhum, sem explicar por quê) + botão de teste.
// LGPD: baixar todos os meus dados em JSON (conta, configurações, mensagens,
// posts, extrato, amigos, jogos...). O arquivo vem do servidor com o token
// da sessão (axios), não por link direto.
function DataExportRow() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const download = async () => {
    if (busy) return;
    setBusy(true); setErr('');
    try {
      const { api } = await import('../../api/client');
      const res = await api.get('/auth/export-data', { responseType: 'blob' });
      const name = (res.headers['content-disposition'] || '').match(/filename="([^"]+)"/)?.[1] || 'projectclub-dados.json';
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) {
      setErr(e?.response?.status === 429 ? 'Muitas tentativas. Tente de novo em alguns minutos.' : 'Não foi possível gerar o arquivo agora.');
    } finally { setBusy(false); }
  };
  return (
    <div className="settings-block settings-toggle-row">
      <div>
        <h4>Baixar meus dados</h4>
        <p className="dim">Um arquivo JSON com tudo que a sua conta tem: perfil, configurações, mensagens e posts que você escreveu, extrato da economia, amigos, jogos e conquistas. É o seu direito pela LGPD (portabilidade).</p>
        {err && <FieldError>{err}</FieldError>}
      </div>
      <button type="button" className="btn-primary" disabled={busy} onClick={download}>{busy ? 'Gerando…' : 'Baixar (.json)'}</button>
    </div>
  );
}

// Notificações push do navegador/PWA (mesmo com o site fechado). Só aparece
// onde o navegador suporta (não no desktop Electron nem no app Android, que
// já têm o caminho próprio).
function WebPushRow() {
  const [state, setState] = useState(() => getWebPushState());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  if (state === 'unsupported' || !isWebPushSupported()) return null;
  const toggle = async (on) => {
    if (busy) return;
    setBusy(true); setErr('');
    try {
      if (on) {
        const r = await enableWebPush();
        if (!r.ok) {
          setErr(r.reason === 'denied' ? 'O navegador está bloqueando as notificações deste site. Libere nas permissões do site (o cadeado ao lado do endereço).'
            : r.reason === 'server' ? 'O servidor ainda não está com as notificações push ativadas.'
              : r.reason === 'dismissed' ? '' : 'Não foi possível ativar agora. Tente de novo.');
        }
      } else {
        await disableWebPush();
      }
    } finally {
      setBusy(false);
      setState(getWebPushState());
    }
  };
  return (
    <div className="settings-block settings-toggle-row">
      <div>
        <h4>Notificações push</h4>
        <p className="dim">Receba aviso de mensagens, menções e chamadas <b>mesmo com o Project Club fechado</b>, pelo navegador ou pelo app instalado.</p>
        {err && <FieldError>{err}</FieldError>}
        {state === 'denied' && !err && <FieldError>O navegador está bloqueando as notificações deste site. Libere nas permissões do site (o cadeado ao lado do endereço).</FieldError>}
      </div>
      <Toggle on={state === 'on'} onChange={toggle} label="Notificações push" disabled={busy || state === 'denied'} />
    </div>
  );
}

// "Instalar como app" (PWA). Some quando já está instalado ou onde não dá.
function PwaInstallRow() {
  const [state, setState] = useState(() => getInstallState());
  useEffect(() => onInstallStateChange(setState), []);
  if (state === 'unsupported' || state === 'unavailable') return null;
  return (
    <div className="settings-block settings-toggle-row">
      <div>
        <h4>Instalar como aplicativo</h4>
        {state === 'installed' && <p className="dim">O Project Club já está instalado neste aparelho.</p>}
        {state === 'available' && <p className="dim">Abre em janela própria, mais rápido, e fica na sua tela inicial / menu iniciar — sem baixar nada.</p>}
        {state === 'ios' && <p className="dim">No iPhone/iPad: toque em <b>Compartilhar</b> e depois em <b>Adicionar à Tela de Início</b>.</p>}
      </div>
      {state === 'available' && (
        <button type="button" className="btn-primary" onClick={() => promptInstall().then(() => setState(getInstallState()))}>Instalar</button>
      )}
    </div>
  );
}

function NotificationPermissionNote() {
  const supported = typeof window !== 'undefined' && 'Notification' in window;
  const [perm, setPerm] = useState(() => (supported ? Notification.permission : 'unsupported'));
  if (!supported || window.electronAPI) return null;
  const ask = () => Notification.requestPermission().then(setPerm).catch(() => {});
  const test = () => { try { new Notification('Project Club', { body: 'As notificações estão funcionando.' }); } catch { /* alguns navegadores só deixam via service worker */ } };
  if (perm === 'granted') {
    return <button type="button" className="btn-link settings-inline-link" onClick={test}><SIcon name="bell" size={14} /> Mandar notificação de teste</button>;
  }
  if (perm === 'denied') {
    return <FieldError>O navegador está bloqueando as notificações deste site. Libere nas permissões do site (o cadeado ao lado do endereço).</FieldError>;
  }
  return (
    <span className="settings-field-hint settings-perm-row">
      O navegador ainda não deu permissão. <button type="button" className="btn-link settings-inline-link" onClick={ask}>Permitir notificações</button>
    </span>
  );
}
