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
import emojiPickerIcon from '../../assets/icons/emoji-picker.png';
import Modal from '../Modal.jsx';
import EmojiPicker from '../EmojiPicker.jsx';
import ClanIcon from '../ClanIcon.jsx';
import { usePopoverCoordination } from '../../utils/popoverCoordinator';
import { isGradientColor, gradientStops, makeGradient } from '../../utils/roleColor';
import { NAME_FONTS, NAME_EFFECTS, nameStyleProps, nameStyleClassName, FONT_FAMILY, DEFAULT_MULTI_COLORS } from '../../utils/nameStyle';
import { EMOJI_STYLE_OPTIONS, emojiImageUrl } from '../../utils/emojiStyle';
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
import IdCardPreviewModal from './IdCardPreviewModal.jsx';
import ImageCropperModal from './ImageCropperModal.jsx';
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
  updateProfile, updateUsername, uploadAvatar, uploadBanner, uploadMiniProfileBanner, removeIdCard,
  setup2FA, confirm2FA, disable2FA, setPreferredTheme, setMyClanTag, setChatZoom,
  setEmojiStyle as setEmojiStyleApi,
  listSessions, revokeSession, revokeOtherSessions,
  createProfilePoll, listProfilePollsByAuthor, deleteProfilePoll,
  changePassword, deleteAccount,
  listRegisteredGames, addRegisteredGame, removeRegisteredGame,
  listMyShortcuts, setShortcut, deleteShortcut,
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
  { label: 'Perfil', tabs: ['PROFILE', 'MINI_PROFILE', 'PROFILE_CONTENT', 'COLUMNS'] },
  { label: 'Conta', tabs: ['ACCOUNT', 'SECURITY', 'ACCOUNT_STATUS'] },
  { label: 'Dados e privacidade', tabs: ['PRIVACY'] },
  { label: 'Notificações', tabs: ['NOTIFICATIONS'] },
  { label: 'EXPERIÊNCIA', tabs: ['VOICE', 'APPEARANCE', 'ACCESSIBILITY', 'SYSTEM', 'LANGUAGE'] },
  { label: 'JOGOS E APPS', tabs: ['GAMES'] },
];

export default function UserSettingsModal({ onClose }) {
  const { t: translate } = useTranslation();
  const { user, setUser, logout } = useAuth();
  const navigate = useNavigate();
  const { theme, setTheme, customBackground, setCustomBackground, emojiStyle, setEmojiStyle: setEmojiStyleStore, myClan, chatZoom, setChatZoom: setChatZoomStore, userSettings, updateUserSetting } = useStore();
  const disabledSystems = useStore((s) => s.disabledSystems);
  // Ver adminController.js (TOGGLEABLE_SYSTEMS) e a nova opção "Cores
  // personalizadas para perfil" em /admin → Sistema: quando a staff
  // desativa esse sistema, a seção de editar a cor do perfil abaixo some
  // por completo pra todo mundo (o valor já salvo continua sendo usado
  // normalmente em todo o app — só a EDIÇÃO fica bloqueada, ver também o
  // guard equivalente em server/src/controllers/userController.js).
  const profileColorEditEnabled = !disabledSystems.includes('cores_perfil');
  const [tab, setTab] = useState('PROFILE');
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
  const [idCardFile, setIdCardFile] = useState(null);

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

  // Item pedido: "sistema igual da Steam" — ordem das seções do
  // perfil (aba Colunas). Mesmo padrão de salvamento das outras
  // preferências acima.
  const saveProfileSectionOrder = async (orderJson) => {
    const { user: updated } = await updateProfile({ profileSectionOrder: orderJson });
    setUser(updated);
  };

  // Item pedido: aniversário editável em "Editar Perfil" — dia e mês
  // separados (o ano não importa pro sistema de aniversariantes, que
  // ignora ele de propósito por privacidade). Usa um ano fixo
  // (bissexto, aceita 29/fev) só como "caixa" pra guardar dia+mês
  // como um DateTime de verdade no banco.
  const initialBirth = user.birthDate ? new Date(user.birthDate) : null;
  const [birthDay, setBirthDay] = useState(initialBirth ? initialBirth.getUTCDate() : '');
  const [birthMonth, setBirthMonth] = useState(initialBirth ? initialBirth.getUTCMonth() + 1 : '');
  const saveBirthday = async (day, month) => {
    if (!day || !month) {
      const { user: updated } = await updateProfile({ birthDate: null });
      setUser(updated);
      return;
    }
    const iso = `2000-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const { user: updated } = await updateProfile({ birthDate: iso });
    setUser(updated);
  };
  const onBirthDayChange = (e) => { const v = e.target.value; setBirthDay(v); saveBirthday(v, birthMonth); };
  const onBirthMonthChange = (e) => { const v = e.target.value; setBirthMonth(v); saveBirthday(birthDay, v); };

  // Item pedido: "opacidade das caixas das colunas" — padrão de 3.5%
  // (o mesmo valor fixo que já existia no CSS antes dessa opção
  // existir, ver .profile-section em global.css) quando a pessoa
  // nunca mexeu nisso.
  const [sectionOpacity, setSectionOpacity] = useState(user.profileSectionOpacity ?? 3);
  const saveSectionOpacity = async (value) => {
    const { user: updated } = await updateProfile({ profileSectionOpacity: value });
    setUser(updated);
  };

  // Item pedido: "centralizar em Configurações" — tag da comunidade
  // (voltou pra cá) e enquetes de perfil (criar/apagar — a exibição +
  // votação continua no próprio perfil, pra quem visita poder votar).
  const [tagSaving, setTagSaving] = useState(false);
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
    if (!pollQuestion.trim() || cleanOptions.length < 2 || pollCreating) return;
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
  const pickTheme = (t) => {
    setTheme(t);
    setPreferredTheme(t).catch(() => {});
  };

  // Item pedido: "sistema podendo mudar o zoom de 1,0 até 2,0... pra
  // melhor personalização" — mesmo padrão de pickTheme acima (aplica
  // na hora, salva na conta em segundo plano).
  const pickChatZoom = (z) => {
    setChatZoomStore(z);
    setChatZoom(z).catch(() => {});
  };

  // Item pedido: "5 variantes de visual dos meus emoji" — mesmo padrão
  // de pickTheme acima.
  const pickEmojiStyleSetting = (s) => {
    setEmojiStyleStore(s);
    setEmojiStyleApi(s).catch(() => {});
  };

  const saveUsername = async () => {
    setError('');
    try {
      const { user: updated } = await updateUsername(username);
      setUser(updated);
    } catch (err) { setError(err.response?.data?.error || 'Erro.'); }
  };

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
  const isGifFile = (f) => f.type === 'image/gif' || /\.gif$/i.test(f.name || '');

  const onAvatar = (e) => {
    const file = e.target.files[0]; if (!file) return;
    e.target.value = ''; // permite escolher o MESMO arquivo de novo depois de cancelar
    if (isGifFile(file)) {
      uploadAvatar(file).then(({ user: updated }) => setUser(updated));
      return;
    }
    setCropperState({
      file, aspectRatio: 1, shape: 'circle', title: 'Ajustar avatar',
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

  const onBanner = (e) => {
    const file = e.target.files[0]; if (!file) return;
    e.target.value = '';
    if (isGifFile(file)) {
      uploadBanner(file).then(({ user: updated }) => setUser(updated));
      return;
    }
    setCropperState({
      file, aspectRatio: 820 / 100, shape: 'rect', title: 'Ajustar banner do perfil',
      onConfirm: async (cropped) => {
        const { user: updated } = await uploadBanner(cropped);
        setUser(updated);
        setCropperState(null);
      },
    });
  };

  // Item pedido: "dois banners independentes" — mesmo padrão de
  // onBanner acima, só salvando no campo separado do miniperfil.
  const onMiniProfileBanner = (e) => {
    const file = e.target.files[0]; if (!file) return;
    e.target.value = '';
    if (isGifFile(file)) {
      uploadMiniProfileBanner(file).then(({ user: updated }) => setUser(updated));
      return;
    }
    setCropperState({
      file, aspectRatio: 320 / 60, shape: 'rect', title: 'Ajustar banner do mini perfil',
      onConfirm: async (cropped) => {
        const { user: updated } = await uploadMiniProfileBanner(cropped);
        setUser(updated);
        setCropperState(null);
      },
    });
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
    // BUG CORRIGIDO ("não funciona no PC, no celular sim"): window.
    // prompt() é desabilitado por completo no Electron (decisão de
    // design oficial do próprio projeto — nunca vai ser suportado),
    // então sempre devolvia null ali, e essa ação simplesmente
    // desistia sem nenhum aviso. Trocado pelo modal próprio do app
    // (usePromptDialog.jsx), que funciona em qualquer plataforma.
    const password = await promptAsync('Digite sua senha para desativar o 2FA:');
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
    setPwSaving(true);
    try {
      await changePassword(pwForm.current, pwForm.next);
      setPwForm({ current: '', next: '', confirm: '' });
      setPwSuccess(true);
    } catch (err) {
      setPwError(err.response?.data?.error || 'Não foi possível trocar a senha.');
    } finally {
      setPwSaving(false);
    }
  };

  const [deleteError, setDeleteError] = useState('');
  const [deleting, setDeleting] = useState(false);
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
    <Modal title="Configurações do usuário" onClose={onClose} width="820px" className="settings-modal-box">
      <div className="settings-modal-layout">
        <div className="settings-modal-sidebar">
          {TAB_GROUPS.map((group) => (
            <div key={group.label} className="settings-modal-sidebar-group">
              <div className="settings-modal-sidebar-group-label">{group.label}</div>
              {group.tabs.map((t) => (
                <button key={t} className={`settings-modal-sidebar-item ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
                  <span className="settings-modal-sidebar-icon">{iconFor(t)}</span>
                  {labelFor(t, translate)}
                </button>
              ))}
            </div>
          ))}
          <div className="settings-modal-sidebar-divider" />
          <button className="settings-modal-sidebar-item settings-modal-logout" onClick={doLogout}>
            <span className="settings-modal-sidebar-icon">🚪</span>
            Sair da conta
          </button>
        </div>
        <div className="settings-modal-content" key={tab}>
      {DialogElement}

      {tab === 'PROFILE' && (
        <div className="settings-grid">
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
                {/* Item pedido: "adicione uma nova opção chamada mini
                    perfil, mova tudo que é sobre mini perfil pra lá" —
                    o botão de banner do miniperfil (que morava aqui
                    junto do banner do perfil completo) foi pra sua
                    própria aba (MINI_PROFILE), junto das cores dele. */}
                <label className="btn-secondary">Alterar banner do perfil completo<input type="file" accept="image/*" hidden onChange={onBanner} /></label>
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
            </div>
            <label>PRONOMES<input name="pronouns" value={form.pronouns} onChange={onChange} placeholder="ele/dele, ela/dela..." /></label>
            {/* Item pedido: aniversário — dia/mês editável a qualquer
                momento, sem ficar "preso" numa data depois de escolher
                uma vez. */}
            <label>
              ANIVERSÁRIO
              <div className="birthday-picker-row">
                <select value={birthDay} onChange={onBirthDayChange}>
                  <option value="">Dia</option>
                  {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
                <select value={birthMonth} onChange={onBirthMonthChange}>
                  <option value="">Mês</option>
                  {['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'].map((m, i) => (
                    <option key={m} value={i + 1}>{m}</option>
                  ))}
                </select>
              </div>
            </label>
            <label>
              BIOGRAFIA
              <div className="bio-input-row">
                <textarea name="bio" value={form.bio} onChange={onChange} maxLength={190} />
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
            <h4>Cor da barra de nível</h4>
            <p className="dim">A barra de progresso de nível no seu perfil é verde por padrão — escolha outra cor se preferir.</p>
            <div className="role-color-row profile-color-row">
              <label>
                COR DA BARRA
                <input type="color" value={form.levelBarColor || '#23a55a'} onChange={(e) => setForm((f) => ({ ...f, levelBarColor: e.target.value }))} />
              </label>
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
            <p className="dim">A fonte, o efeito e a cor abaixo aparecem em mensagens, na lista de membros e no seu perfil.</p>
            <div className="name-style-preview" style={{ fontSize: 22, fontWeight: 700 }}>
              <span className={nameStyleClassName(form)} style={nameStyleProps(form)}>{form.displayName || user.displayName}</span>
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
                          <span className={nameStyleClassName(form)} style={{ ...nameStyleProps(form), fontFamily: FONT_FAMILY[f.value] }}>Abc</span>
                          <span className="name-style-picker-option-label">{f.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              >
                <span className={`name-style-picker-button-sample ${nameStyleClassName(form)}`} style={{ ...nameStyleProps(form), fontFamily: FONT_FAMILY[form.profileNameFont] }}>Abc</span>
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
                            <span className={nameStyleClassName(previewUser)} style={nameStyleProps(previewUser)}>Abc</span>
                            <span className="name-style-picker-option-label">{f.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              >
                <span className={`name-style-picker-button-sample ${nameStyleClassName(form)}`} style={nameStyleProps(form)}>Abc</span>
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
                  onChange={(e) => { const f = e.target.files[0]; if (f) setIdCardFile(f); e.target.value = ''; }}
                />
              </label>
              {user.idCardUrl && (
                <button className="btn-link danger" onClick={removeIdCardNow}>Remover</button>
              )}
            </div>
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

          {/* Item pedido: "acabei com a categoria exibição e passa a
              tag pro perfil e as conquistas pro perfil e o mini
              perfil" — movido de dentro da extinta aba "Exibição". */}
          <div className="settings-block">
            <h4>Conquistas em destaque no perfil</h4>
            <p className="dim">Escolha até 6 conquistas pra aparecerem no seu perfil completo.</p>
            <button type="button" className="btn-secondary" onClick={() => setAchievementPickerOpen('profile')}>Escolher conquistas (até 6)</button>
          </div>

          {myClan?.tags?.length > 0 && (
            <div className="settings-block">
              <h4>Tag do clã</h4>
              <p className="dim">Exiba a tag do seu clã do lado do seu nome no chat, na lista de membros e no seu perfil.</p>
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

          <button className="btn-primary profile-edit-save" onClick={saveProfile}>Salvar alterações</button>
        </div>
      )}

      {tab === 'PROFILE_CONTENT' && (
        <div className="settings-grid">
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
                <input value={pollQuestion} onChange={(e) => setPollQuestion(e.target.value)} placeholder="Pergunta da enquete..." maxLength={200} />
                {pollOptions.map((opt, i) => (
                  <input
                    key={i}
                    value={opt}
                    onChange={(e) => setPollOptions((prev) => prev.map((o, j) => (j === i ? e.target.value : o)))}
                    placeholder={`Opção ${i + 1}`}
                    maxLength={100}
                  />
                ))}
                {pollError && <p className="dim" style={{ color: 'var(--red)' }}>{pollError}</p>}
                <div className="profile-poll-composer-actions">
                  {pollOptions.length < 10 && <button type="button" className="btn-secondary" onClick={() => setPollOptions((prev) => [...prev, ''])}>+ Opção</button>}
                  <button type="button" className="btn-secondary" disabled={pollCreating} onClick={createPoll}>Criar enquete</button>
                </div>
              </div>
            ) : (
              <p className="dim" style={{ fontStyle: 'italic' }}>Você já tem 2 enquetes — apague uma abaixo antes de criar outra.</p>
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
            <ProfileSectionOrderEditor value={user.profileSectionOrder} onChange={saveProfileSectionOrder} />
          </div>
        </div>
      )}

      {/* Item pedido: "adicione uma nova opção chamada mini perfil,
          mova tudo que é sobre mini perfil pra lá, e também adicione
          poder editar as cores do mini perfil separada do perfil
          grande, mudando a cor do perfil, mudando a cor do botão ver
          perfil completo". */}
      {tab === 'MINI_PROFILE' && (
        <div className="settings-grid">
          {/* Item pedido: "acabei com a categoria exibição e passa...
              as conquistas pro perfil e o mini perfil" — a parte do
              miniperfil, movida de dentro da extinta aba "Exibição". */}
          <div className="settings-block">
            <h4>Conquistas em destaque no miniperfil</h4>
            <p className="dim">Escolha até 4 conquistas pra aparecerem no cartão pequeno do miniperfil.</p>
            <button type="button" className="btn-secondary" onClick={() => setAchievementPickerOpen('mini')}>Escolher conquistas (até 4)</button>
          </div>

          <div className="settings-block">
            <h4>Banner do miniperfil</h4>
            <p className="dim">Esse banner aparece só no cartão pequeno que abre ao clicar no seu nome/avatar — independente do banner do seu perfil completo.</p>
            <label className="btn-secondary">Alterar banner do miniperfil<input type="file" accept="image/*" hidden onChange={onMiniProfileBanner} /></label>
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
          </div>

          <button type="button" className="btn-primary" onClick={saveProfile}>Salvar</button>
        </div>
      )}

      {tab === 'ACCOUNT' && (
        <div className="settings-grid">
          <div className="settings-block">
            <h4>Informações básicas</h4>
            <label>E-MAIL<input value={user.email} disabled /></label>
            <label>
              NOME DE USUÁRIO
              <input value={username} onChange={(e) => setUsernameField(e.target.value)} />
            </label>
            {error && <div className="auth-error">{error}</div>}
            <button className="btn-primary" onClick={saveUsername}>Salvar nome de usuário</button>
          </div>

          <div className="settings-block">
            <h4>Trocar senha</h4>
            <label>SENHA ATUAL<input type="password" value={pwForm.current} onChange={(e) => setPwForm((f) => ({ ...f, current: e.target.value }))} /></label>
            <label>SENHA NOVA<input type="password" value={pwForm.next} onChange={(e) => setPwForm((f) => ({ ...f, next: e.target.value }))} /></label>
            <label>CONFIRME A SENHA NOVA<input type="password" value={pwForm.confirm} onChange={(e) => setPwForm((f) => ({ ...f, confirm: e.target.value }))} /></label>
            <p className="dim" style={{ fontSize: 12 }}>Pelo menos 8 caracteres, com letras e números. Você continua logado aqui, mas é desconectado dos outros dispositivos.</p>
            {pwError && <div className="auth-error">{pwError}</div>}
            {pwSuccess && <p className="dim" style={{ color: 'var(--green)' }}>Senha alterada com sucesso.</p>}
            <button className="btn-primary" disabled={pwSaving || !pwForm.current || !pwForm.next} onClick={submitChangePassword}>
              {pwSaving ? 'Salvando...' : 'Trocar senha'}
            </button>
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
                <div className="danger-zone-row-title">Desativar conta</div>
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

          <div className="settings-block">
            <h4>Autenticação de dois fatores</h4>
            {user.twoFactorEnabled ? (
              <>
                <p className="dim">2FA está ativado na sua conta.</p>
                <button className="btn-danger" onClick={turnOff2FA}>Desativar 2FA</button>
              </>
            ) : twoFA.qrDataUrl ? (
              <>
                <p className="dim">Escaneie o QR code com seu app autenticador e digite o código gerado.</p>
                <img src={twoFA.qrDataUrl} alt="QR code 2FA" width={180} height={180} />
                <div className="dim">Ou insira manualmente: {twoFA.secret}</div>
                <input placeholder="Código de 6 dígitos" value={twoFA.code} onChange={(e) => setTwoFA((s) => ({ ...s, code: e.target.value }))} />
                {error && <div className="auth-error">{error}</div>}
                <button className="btn-primary" onClick={confirm2FASubmit}>Confirmar e ativar</button>
              </>
            ) : (
              <>
                <p className="dim">Peça um código do seu app autenticador (Google Authenticator, Authy, etc) toda vez que entrar.</p>
                <button className="btn-primary" onClick={start2FA}>Configurar 2FA</button>
              </>
            )}
          </div>

          <div className="settings-block">
            <h4>Sessões ativas</h4>
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
        </div>
      )}

      {tab === 'APPEARANCE' && (
        <div className="settings-grid">
          <div className="settings-block">
            <h4>Tema</h4>
            <div className="theme-options">
              {['facebook', 'light', 'dark', 'amoled', 'clubpenguin'].map((t) => (
                <button key={t} className={`theme-swatch ${t} ${theme === t && !customBackground ? 'active' : ''}`} onClick={() => pickTheme(t)}>
                  {{ facebook: 'Muito Claro', clubpenguin: 'Cartoon', dark: 'Cinza', light: 'Claro', amoled: 'Preto' }[t]}
                </button>
              ))}
            </div>
          </div>

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
                type="range" min="1" max="2" step="0.1"
                value={chatZoom}
                onChange={(e) => pickChatZoom(Number(e.target.value))}
              />
              <span className="chat-zoom-value">{chatZoom.toFixed(1)}x</span>
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
          {!userSettings ? <div className="dim">Carregando...</div> : (
            <>
              <div className="settings-block">
                <h4>Idioma</h4>
                <p className="dim">Muda o idioma usado na interface do Project Club.</p>
                <select value={userSettings.language} onChange={(e) => updateUserSetting('language', e.target.value)}>
                  <option value="pt-BR">Português (Brasil)</option>
                  <option value="en-US">English</option>
                  <option value="es-ES">Español</option>
                </select>
              </div>
              <div className="settings-block">
                <h4>Formato de horário</h4>
                <p className="dim">Como os horários aparecem nas mensagens e em toda a interface.</p>
                <select value={userSettings.timeFormat} onChange={(e) => updateUserSetting('timeFormat', e.target.value)}>
                  <option value="auto">Automático (baseado no idioma)</option>
                  <option value="12h">12 horas</option>
                  <option value="24h">24 horas</option>
                </select>
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
          {!userSettings ? <div className="dim">Carregando...</div> : (
            <>
              <div className="settings-block settings-toggle-row">
                <div>
                  <h4>Movimento reduzido</h4>
                  <p className="dim">Reduz animações e efeitos visuais para tornar a interface mais confortável.</p>
                </div>
                <button
                  type="button" className={`toggle-switch ${userSettings.reducedMotion ? 'on' : ''}`}
                  onClick={() => updateUserSetting('reducedMotion', !userSettings.reducedMotion)}
                />
              </div>
              <div className="settings-block settings-toggle-row">
                <div>
                  <h4>Contraste alto</h4>
                  <p className="dim">Aumenta o contraste de cores da interface.</p>
                </div>
                <button
                  type="button" className={`toggle-switch ${userSettings.highContrast ? 'on' : ''}`}
                  onClick={() => updateUserSetting('highContrast', !userSettings.highContrast)}
                />
              </div>
              <div className="settings-block">
                <h4>Tamanho do texto</h4>
                <input
                  type="range" min="0.8" max="1.5" step="0.1"
                  value={userSettings.textScale}
                  onChange={(e) => updateUserSetting('textScale', Number(e.target.value))}
                />
              </div>
              <div className="settings-block">
                <h4>Saturação</h4>
                <div className="chip-choice-row">
                  {[100, 75, 50, 0].map((v) => (
                    <button key={v} type="button" className={`chip-choice ${userSettings.saturation === v ? 'active' : ''}`} onClick={() => updateUserSetting('saturation', v)}>{v}%</button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Item pedido: "Dados e privacidade... Privacidade do perfil...
          Permissão de mensagem... Filtrar conteúdo... Filtrar spam" —
          mesmo padrão de Idioma/Acessibilidade acima: lido/salvo via
          userSettings/updateUserSetting (UserSettings no banco, já
          validado em settingsController.js). A privacidade de PEDIDO
          DE AMIZADE já mora na aba Senha e segurança (campo separado,
          do User, não do UserSettings) — não duplicada aqui.
          IMPORTANTE: esta tela salva a PREFERÊNCIA. A aplicação real
          dela (o backend recusar de fato uma DM/visualização de
          perfil com base nesses valores) é um trabalho à parte, ainda
          não implementado nos controllers de perfil/conversa — ver
          próxima fase. */}
      {tab === 'PRIVACY' && (
        <div className="settings-grid">
          {!userSettings ? <div className="dim">Carregando...</div> : (
            <>
              <div className="settings-block">
                <h4>Privacidade do perfil</h4>
                <p className="dim">Quem pode ver os detalhes completos do seu perfil.</p>
                <select value={userSettings.profilePrivacy} onChange={(e) => updateUserSetting('profilePrivacy', e.target.value)}>
                  <option value="everyone">Qualquer pessoa</option>
                  <option value="friends_groups">Amigos e pessoas dos meus grupos</option>
                  <option value="friends">Apenas amigos</option>
                </select>
              </div>
              <div className="settings-block">
                <h4>Quem pode me enviar mensagens</h4>
                <p className="dim">Controla quem pode iniciar uma conversa direta com você.</p>
                <select value={userSettings.dmPrivacy} onChange={(e) => updateUserSetting('dmPrivacy', e.target.value)}>
                  <option value="everyone">Todos</option>
                  <option value="friends">Amigos</option>
                  <option value="friends_groups">Pessoas que compartilham grupos comigo</option>
                  <option value="none">Ninguém</option>
                </select>
              </div>
              <div className="settings-block">
                <h4>Filtrar conteúdo</h4>
                <p className="dim">Nível de filtragem aplicado às mensagens que você recebe.</p>
                <div className="chip-choice-row">
                  {[['off', 'Desativado'], ['moderate', 'Moderado'], ['high', 'Alto']].map(([value, label]) => (
                    <button key={value} type="button" className={`chip-choice ${userSettings.contentFilterLevel === value ? 'active' : ''}`} onClick={() => updateUserSetting('contentFilterLevel', value)}>{label}</button>
                  ))}
                </div>
              </div>
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
          notificationSounds). Silenciar por servidor/canal individual
          precisa de uma tabela própria (algo como
          ChannelNotificationOverride) que ainda não existe — fica
          para uma próxima parte. */}
      {tab === 'NOTIFICATIONS' && (
        <div className="settings-grid">
          {!userSettings ? <div className="dim">Carregando...</div> : (
            <>
              <div className="settings-block settings-toggle-row">
                <div>
                  <h4>Notificações de desktop</h4>
                  <p className="dim">Mostra um alerta na tela quando chega uma mensagem nova, mesmo com o Project Club em segundo plano.</p>
                </div>
                <button
                  type="button" className={`toggle-switch ${userSettings.desktopNotifications ? 'on' : ''}`}
                  onClick={() => updateUserSetting('desktopNotifications', !userSettings.desktopNotifications)}
                />
              </div>
              <div className="settings-block settings-toggle-row">
                <div>
                  <h4>Notificações por e-mail</h4>
                  <p className="dim">Recebe um e-mail para eventos importantes, como pedidos de amizade e menções, quando você está offline.</p>
                </div>
                <button
                  type="button" className={`toggle-switch ${userSettings.emailNotifications ? 'on' : ''}`}
                  onClick={() => updateUserSetting('emailNotifications', !userSettings.emailNotifications)}
                />
              </div>
              <div className="settings-block settings-toggle-row">
                <div>
                  <h4>Sons de notificação</h4>
                  <p className="dim">Toca um som quando você recebe uma mensagem, menção ou chamada.</p>
                </div>
                <button
                  type="button" className={`toggle-switch ${userSettings.notificationSounds ? 'on' : ''}`}
                  onClick={() => updateUserSetting('notificationSounds', !userSettings.notificationSounds)}
                />
              </div>
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
      {tab === 'ACCOUNT_STATUS' && (
        <div className="settings-grid">
          <div className="settings-block">
            <h4>Status</h4>
            <p className="dim">
              {user.accountDisabledAt
                ? 'Desativada'
                : user.isPlatformBanned
                  ? 'Banida'
                  : user.suspendedUntil && new Date(user.suspendedUntil) > new Date()
                    ? 'Parcialmente limitada'
                    : user.timeoutUntil && new Date(user.timeoutUntil) > new Date()
                      ? 'Em silenciamento temporário'
                      : 'Ativa'}
            </p>
          </div>
          <div className="settings-block">
            <h4>Conta criada em</h4>
            <p className="dim">{new Date(user.createdAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}</p>
          </div>
          <div className="settings-block">
            <h4>Verificação de e-mail</h4>
            <p className="dim">{user.emailVerified ? 'E-mail verificado' : 'E-mail ainda não verificado'}</p>
          </div>
          <div className="settings-block">
            <h4>Restrições</h4>
            {user.isPlatformBanned ? (
              <p className="dim">Banida{user.platformBanReason ? ` — motivo: ${user.platformBanReason}` : ''}</p>
            ) : user.suspendedUntil && new Date(user.suspendedUntil) > new Date() ? (
              <p className="dim">Suspensa até {new Date(user.suspendedUntil).toLocaleString('pt-BR')}</p>
            ) : user.timeoutUntil && new Date(user.timeoutUntil) > new Date() ? (
              <p className="dim">Silenciada até {new Date(user.timeoutUntil).toLocaleString('pt-BR')}</p>
            ) : (
              <p className="dim">Nenhuma</p>
            )}
          </div>
        </div>
      )}

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
          {!userSettings ? <div className="dim">Carregando...</div> : (
            <>
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
                  <p className="dim">Abre o Project Club automaticamente quando o computador liga. Só tem efeito no aplicativo ".exe".</p>
                </div>
                <button
                  type="button" className={`toggle-switch ${userSettings.startWithSystem ? 'on' : ''}`}
                  onClick={() => updateUserSetting('startWithSystem', !userSettings.startWithSystem)}
                />
              </div>
              <div className="settings-block settings-toggle-row">
                <div>
                  <h4>Minimizar para a bandeja</h4>
                  <p className="dim">Ao fechar a janela, o app continua rodando na bandeja do sistema em vez de encerrar. Só tem efeito no ".exe".</p>
                </div>
                <button
                  type="button" className={`toggle-switch ${userSettings.minimizeToTray ? 'on' : ''}`}
                  onClick={() => updateUserSetting('minimizeToTray', !userSettings.minimizeToTray)}
                />
              </div>
              <div className="settings-block settings-toggle-row">
                <div>
                  <h4>Abrir links no aplicativo</h4>
                  <p className="dim">Links clicados dentro do Project Club abrem numa janela do próprio app em vez do navegador padrão. Só tem efeito no ".exe".</p>
                </div>
                <button
                  type="button" className={`toggle-switch ${userSettings.openLinksInApp ? 'on' : ''}`}
                  onClick={() => updateUserSetting('openLinksInApp', !userSettings.openLinksInApp)}
                />
              </div>
              <div className="settings-block settings-toggle-row">
                <div>
                  <h4>Confirmar antes de sair</h4>
                  <p className="dim">Pede confirmação ao tentar fechar o aplicativo. Só tem efeito no ".exe".</p>
                </div>
                <button
                  type="button" className={`toggle-switch ${userSettings.confirmOnExit ? 'on' : ''}`}
                  onClick={() => updateUserSetting('confirmOnExit', !userSettings.confirmOnExit)}
                />
              </div>
              <div className="settings-block settings-toggle-row">
                <div>
                  <h4>Modo desenvolvedor</h4>
                  <p className="dim">Mostra IDs e informações técnicas extras em menus de contexto (canais, mensagens, usuários).</p>
                </div>
                <button
                  type="button" className={`toggle-switch ${userSettings.developerMode ? 'on' : ''}`}
                  onClick={() => updateUserSetting('developerMode', !userSettings.developerMode)}
                />
              </div>

              {/* Item pedido: "Atalhos personalizados... UserShortcut...
                  Antes de salvar: verificar se já existe outro comando
                  usando a combinação. Se houver conflito: 'Este atalho
                  já está sendo utilizado.'" — backend novo (ver
                  shortcutsController.js), a mensagem de conflito vem
                  direto da resposta de erro da API. */}
              <div className="settings-block">
                <h4>Atalhos personalizados</h4>
                <p className="dim">Defina uma combinação de teclas pra uma ação (ex: "abrir_configuracoes" → "Ctrl+,").</p>
                {shortcutsError && <div className="auth-error">{shortcutsError}</div>}
                {shortcuts === null && !shortcutsError && <p className="dim">Carregando...</p>}
                {shortcuts && (
                  <ul className="settings-poll-list">
                    {shortcuts.map((s) => (
                      <li key={s.id} className="settings-poll-list-item">
                        <span className="truncate">{s.action} — {s.keyCombination}</span>
                        <button type="button" className="profile-relationship-end" onClick={() => removeShortcutFromList(s.id)}>Remover</button>
                      </li>
                    ))}
                    {shortcuts.length === 0 && <li className="dim" style={{ fontStyle: 'italic' }}>Nenhum atalho personalizado ainda.</li>}
                  </ul>
                )}
                <div className="birthday-picker-row" style={{ marginTop: 10 }}>
                  <input
                    value={newShortcutAction}
                    onChange={(e) => setNewShortcutAction(e.target.value)}
                    placeholder="Ação (ex: abrir_configuracoes)"
                    maxLength={64}
                  />
                  <input
                    value={newShortcutCombo}
                    onChange={(e) => setNewShortcutCombo(e.target.value)}
                    placeholder="Combinação (ex: Ctrl+,)"
                    maxLength={32}
                  />
                  <button type="button" className="btn-secondary" disabled={savingShortcut || !newShortcutAction.trim() || !newShortcutCombo.trim()} onClick={submitShortcut}>
                    {savingShortcut ? '...' : 'Salvar'}
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
            <h4>Jogos adicionados</h4>
            <p className="dim">Jogos que aparecem como sua atividade quando detectados (detecção automática só funciona no aplicativo ".exe").</p>
            {gamesError && <div className="auth-error">{gamesError}</div>}
            {games === null && !gamesError && <p className="dim">Carregando...</p>}
            {games && (
              <ul className="settings-poll-list">
                {games.map((g) => (
                  <li key={g.id} className="settings-poll-list-item">
                    <span className="truncate">{g.displayName}</span>
                    <button type="button" className="profile-relationship-end" onClick={() => removeGameFromList(g.id)}>Remover</button>
                  </li>
                ))}
                {games.length === 0 && <li className="dim" style={{ fontStyle: 'italic' }}>Nenhum jogo adicionado ainda.</li>}
              </ul>
            )}
            <div className="birthday-picker-row" style={{ marginTop: 10 }}>
              <input
                value={newGameName}
                onChange={(e) => setNewGameName(e.target.value)}
                placeholder="Nome do jogo (ex: Minecraft)"
                maxLength={100}
              />
              <button type="button" className="btn-secondary" disabled={addingGame || !newGameName.trim()} onClick={submitAddGame}>
                {addingGame ? '...' : 'Adicionar'}
              </button>
            </div>
          </div>

          {!userSettings ? <div className="dim">Carregando...</div> : (
            <>
              <div className="settings-block settings-toggle-row">
                <div>
                  <h4>Detecção automática de jogos</h4>
                  <p className="dim">Detecta sozinho quando você abre um jogo instalado. Só tem efeito no aplicativo ".exe".</p>
                </div>
                <button
                  type="button" className={`toggle-switch ${userSettings.gameDetectionEnabled ? 'on' : ''}`}
                  onClick={() => updateUserSetting('gameDetectionEnabled', !userSettings.gameDetectionEnabled)}
                />
              </div>
              <div className="settings-block settings-toggle-row">
                <div>
                  <h4>Compartilhar atividade</h4>
                  <p className="dim">Mostra pros outros o que você está jogando agora, quando detectado.</p>
                </div>
                <button
                  type="button" className={`toggle-switch ${userSettings.activitySharing ? 'on' : ''}`}
                  onClick={() => updateUserSetting('activitySharing', !userSettings.activitySharing)}
                />
              </div>
              <div className="settings-block">
                <h4>Quem pode ver minha atividade</h4>
                <select value={userSettings.activityVisibility} onChange={(e) => updateUserSetting('activityVisibility', e.target.value)}>
                  <option value="everyone">Todos permitidos</option>
                  <option value="friends">Somente amigos</option>
                  <option value="friends_groups">Pessoas dos mesmos grupos</option>
                  <option value="none">Ninguém</option>
                </select>
              </div>
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
                  <p className="dim">Mostra mensagens e notificações por cima do jogo enquanto você joga. Só tem efeito no ".exe".</p>
                </div>
                <button
                  type="button" className={`toggle-switch ${userSettings.overlayEnabled ? 'on' : ''}`}
                  onClick={() => updateUserSetting('overlayEnabled', !userSettings.overlayEnabled)}
                />
              </div>
              {userSettings.overlayEnabled && (
                <div className="settings-block settings-toggle-row">
                  <div>
                    <h4>Notificações na sobreposição</h4>
                    <p className="dim">Nova mensagem, menção, convite, pedido de amizade e entrada em chamada aparecem na overlay.</p>
                  </div>
                  <button
                    type="button" className={`toggle-switch ${userSettings.overlayNotifications ? 'on' : ''}`}
                    onClick={() => updateUserSetting('overlayNotifications', !userSettings.overlayNotifications)}
                  />
                </div>
              )}
            </>
          )}
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
    {cropperState && (
      <ImageCropperModal
        file={cropperState.file}
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
  // VOICE usa o ícone novo (mesmo pacote da barra lateral) em vez de
  // emoji — os outros continuam emoji por enquanto.
  if (t === 'VOICE') return <IconGlyph src={micIcon} size={16} />;
  return {
    PROFILE: '👤', PROFILE_CONTENT: '🖼️', COLUMNS: '📐', MINI_PROFILE: '🪪', ACCOUNT: '⚙️', SECURITY: '🔒', APPEARANCE: '🎨',
    ACCOUNT_STATUS: '📋', PRIVACY: '🛡️', NOTIFICATIONS: '🔔', ACCESSIBILITY: '♿', SYSTEM: '🖥️', LANGUAGE: '🌐', GAMES: '🎮',
  }[t];
}

// ============================================================
// Voz e Áudio — escolher microfone/saída de áudio, testar o microfone com
// um medidor de volume ao vivo. Sem redução de ruído nem qualquer
// processamento automático de áudio (item pedido) — o microfone vai pro
// ar exatamente como captado.
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
            🎨
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
        <span className={`name-style-picker-button-caret ${open ? 'open' : ''}`}>▾</span>
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
