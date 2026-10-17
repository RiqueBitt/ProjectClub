import { getExtra } from '../utils/extraPrefs';
import CodeFilePreview, { isCodeFile } from './CodeFilePreview.jsx';
import { topReactions, recordReaction, useMsgExtras, toggleSaved, markUnreadFrom, copyMessageLink, toggleIgnore } from '../utils/messageExtras';
import { useEffect, useRef, useState, memo } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useContextMenu } from '../context/ContextMenuContext.jsx';
import { useStore, messageMentionsUser, roomKeyFor } from '../store/useStore';
import {
  editMessage, deleteMessage, togglePinMessage, reactToMessage,
  warnMember, timeoutMember, addFavoriteGif, removeFavoriteGif, sendMessage, votePoll, reportMessage,
} from '../api/endpoints';
import { getMyCommunityPermissions, hasPermission } from '../utils/permissions';
import { renderRichContent, isEmojiOnlyMessage } from '../utils/richTextRender.jsx';
import { groupReactions, reactorsByEmoji, MAX_DISTINCT_REACTIONS } from '../utils/reactions';
import { roleTextStyle, highestColoredRole } from '../utils/roleColor';
import { nameStyleProps, hasCustomNameStyle, nameStyleClassName } from '../utils/nameStyle';
import { formatMessageTime, formatEmbedTime, formatTimeOnly } from '../utils/formatTime';
import ChatIcon from './ChatIcons.jsx';
import EmojiPicker from './EmojiPicker.jsx';
import CustomAudioPlayer from './CustomAudioPlayer.jsx';
import { usePopoverCoordination } from '../utils/popoverCoordinator';
import TagBadge from './TagBadge.jsx';
import PendantIcon from './PendantIcon.jsx';
import ClanTagBadge from './ClanTagBadge.jsx';
import UserAvatar from './UserAvatar.jsx';
import ReactionChip from './ReactionChip.jsx';
import pinIcon from '../assets/icons/pin.png';
import micIcon from '../assets/icons/mic.png';
import documentIcon from '../assets/icons/document.png';
import selectedIcon from '../assets/icons/selected.png';
import PenguinAvatar, { isPenguinAvatarUrl, penguinColorFromUrl } from './PenguinAvatar.jsx';
import { proxyImage } from '../utils/imageProxy';
import { InternalLinkCards } from './InternalLinkCard.jsx';
import { findInternalLinks } from '../utils/internalLinks';
import { cssZoom } from '../utils/cssZoom';
import { registerEditor, getRetry, getCancel } from '../utils/chatComposerBus';
import { discardOptimistic } from '../utils/messageSender';
import { EditedTag, ForwardedLabel, ForwardMessageModal, LinkPreview } from './MessageExtras.jsx';
import ReminderModal from './modals/ReminderModal.jsx';

// BUG CORRIGIDO: <img src={...avatarUrl}> quebrava (bloqueado pela CSP
// img-src) quando o autor da mensagem respondida tem avatar de pinguim
// (pseudo-URL "penguin:<cor>", não uma URL de rede de verdade) — ver
// PenguinAvatar.jsx.
function ReplyAvatarImg({ url }) {
  if (isPenguinAvatarUrl(url)) return <PenguinAvatar color={penguinColorFromUrl(url)} size={18} />;
  return <img src={url} alt="" />;
}

// 4 popular quick-react emojis shown directly in the hover toolbar (like
// Discord's own quick-react bar) — clicking one reacts immediately. The "+"
// next to them opens the full picker (unicode search + this server's custom
// emojis + custom emojis from other servers the user belongs to).

// Approximate width of the full emoji-picker popover on desktop — kept in
// sync with `.reaction-picker` in global.css (`width: min(340px, 92vw)`),
// documented here only as a pointer for anyone tuning that CSS; the JS side
// no longer needs it now that the picker centers itself horizontally.
const PICKER_GAP = 8;

const BARE_IMAGE_URL_RE = /^https?:\/\/\S+\.(gif|png|jpe?g|webp)(\?\S*)?$/i;
const GIF_URL_RE = /\.gif(\?\S*)?$/i;

// BUG CORRIGIDO ("vários chats ficam com 'Essa parte travou'"): a
// checagem de mensagem apagada retornava ANTES dos hooks que vêm depois
// (useEffect) — quando alguém apagava uma mensagem com o chat aberto, a
// mesma mensagem passava a renderizar com menos hooks e o React
// derrubava o chat inteiro. Agora a mensagem apagada é outro componente.
function MessageComponent(props) {
  // Autor ignorado (menu → Ignorar): a mensagem fica recolhida pra você.
  const hidden = useMsgExtras((s) => s.ignored.has(props.message.authorId) && !s.revealed.has(props.message.id));
  if (props.message.deleted) {
    return <div className="message deleted-message"><em>Mensagem apagada</em></div>;
  }
  if (hidden) {
    return (
      <div className="message message-ignored">
        <em>Mensagem de alguém que você ignora.</em>
        <button type="button" className="btn-link" onClick={() => useMsgExtras.getState().reveal(props.message.id)}>Mostrar mesmo assim</button>
      </div>
    );
  }
  return <MessageBody {...props} />;
}

function MessageBody({ message, showAuthor, onReply, topics = [], onOpenTopic }) {
  const { user } = useAuth();
  const { openMenu } = useContextMenu();
  const members = useStore((s) => s.members);
  const roles = useStore((s) => s.roles);
  const usableEmojis = useStore((s) => s.usableEmojis);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content || '');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  usePopoverCoordination(showEmojiPicker, () => setShowEmojiPicker(false));
  const [pickerStyle, setPickerStyle] = useState(null);
  const reactBtnRef = useRef(null);
  const pickerRef = useRef(null);
  const isOwn = message.authorId === user.id;
  const favoriteGifs = useStore((s) => s.favoriteGifs);
  const addFavoriteGifLocal = useStore((s) => s.addFavoriteGifLocal);
  const removeFavoriteGifLocal = useStore((s) => s.removeFavoriteGifLocal);

  // Seta pra cima no compositor vazio abre a edição desta mensagem (só as minhas, já enviadas).
  const canEditViaKey = isOwn && !message.pending && !message.failed && !String(message.id).startsWith('temp-');
  useEffect(() => {
    if (!canEditViaKey) return undefined;
    return registerEditor(message.id, () => { setDraft(message.content || ''); setEditing(true); });
  }, [canEditViaKey, message.id, message.content]);

  const saveEdit = async () => {
    const next = draft.trim();
    // Texto vazio numa mensagem só de texto: o servidor recusa (apague em vez disso).
    if (!next && !message.attachments?.length) { useStore.getState().pushNotice('A mensagem não pode ficar vazia — apague-a em vez disso.'); return; }
    if (next !== (message.content || '')) {
      try {
        await editMessage(message.id, next);
      } catch (err) {
        // AutoMod, sem permissão, silêncio temporário...
        useStore.getState().pushNotice(err?.response?.data?.error || 'Não foi possível editar a mensagem.');
        return;
      }
    }
    setEditing(false);
  };

  const react = async (emoji) => {
    setShowEmojiPicker(false);
    recordReaction(emoji);
    try {
      await reactToMessage(message.id, emoji);
    } catch (err) {
      useStore.getState().pushNotice(err?.response?.data?.error || 'Não foi possível reagir a esta mensagem.');
    }
  };

  // Shared by the 4 quick-react buttons and the full picker's onPick: warns
  // client-side instead of just letting the request 404/400 once a message
  // already has the max distinct emojis (unless this emoji is already one
  // of them, which is always allowed — same rule the server enforces, see
  // MAX_DISTINCT_REACTIONS in messageController.js).
  const reactWithLimitCheck = (emoji) => {
    const alreadyOnMessage = groupedReactions.some(([em]) => em === emoji);
    if (atReactionLimit && !alreadyOnMessage) {
      useStore.getState().pushNotice(`Limite de ${MAX_DISTINCT_REACTIONS} emojis diferentes atingido nesta mensagem.`);
      return;
    }
    react(emoji);
  };

  // Bug fix: the reaction popover used to be anchored to the *whole*
  // message row (`top: -40px` relative to `.message`), so on a message near
  // the top of the scrolled channel it opened up underneath the channel
  // header, half-hidden behind it. Instead, we measure the "+" button's own
  // on-screen position and place the popover with `position: fixed`,
  // flipping it below the button instead of above whenever there isn't
  // enough room above. Horizontally it's simply centered on the viewport
  // via CSS (`.reaction-picker`), which is also what was asked for, so we
  // only ever need to compute `top` here. Below 600px wide,
  // `.emoji-picker-popover` becomes a full-width bottom sheet via CSS
  // regardless of this — so on mobile we skip the calculation entirely.
  const REACTION_PICKER_DEFAULT_VH = 46;
  useEffect(() => {
    if (!showEmojiPicker) { setPickerStyle(null); return; }
    const isMobile = window.matchMedia('(max-width: 600px)').matches;
    if (isMobile) { setPickerStyle(null); return; }
    const btn = reactBtnRef.current;
    if (!btn) return;
    // Zoom CSS da interface: medidas em pixels da tela, `top` em pixels
    // CSS (multiplicados pelo zoom) — converte tudo pra mesma escala.
    const z = cssZoom();
    const raw = btn.getBoundingClientRect();
    const rect = { top: raw.top / z, bottom: raw.bottom / z };
    const vh = window.innerHeight / z;
    // (unidades vh do CSS já saem em pixels CSS de innerHeight/100.)
    const estimatedHeight = Math.min(window.innerHeight * (REACTION_PICKER_DEFAULT_VH / 100), vh - 24);
    let top = rect.top - estimatedHeight - PICKER_GAP;
    if (top < 8) top = Math.min(rect.bottom + PICKER_GAP, vh - estimatedHeight - 8);
    setPickerStyle({ position: 'fixed', top: `${Math.max(8, top)}px` });
  }, [showEmojiPicker]);

  // Close on an outside click/tap or on scrolling the message list, same as
  // the shared right-click context menu does.
  useEffect(() => {
    if (!showEmojiPicker) return;
    const onDocDown = (e) => {
      if (pickerRef.current?.contains(e.target) || reactBtnRef.current?.contains(e.target)) return;
      setShowEmojiPicker(false);
    };
    const onScroll = (e) => {
      // Bug fix: scroll events don't bubble, but a capture-phase listener
      // on window still sees them fire on any nested scrollable element as
      // they travel down to it — including the picker's own emoji grid.
      // That meant scrolling down *inside* the picker to see more emojis
      // was itself closing it. Only an actual scroll of something outside
      // the picker (e.g. the message list moving underneath it) should
      // close it.
      if (pickerRef.current?.contains(e.target)) return;
      setShowEmojiPicker(false);
    };
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('touchstart', onDocDown);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('touchstart', onDocDown);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [showEmojiPicker]);

  // Works the same whether the GIF is one someone else sent or one we sent
  // ourselves — a sent GIF is just a bare-URL message (see BARE_IMAGE_URL_RE
  // below), so the URL itself doubles as the favorite's dedupe key. Mirrors
  // the star toggle in EmojiPicker.jsx's own GIFs > Favoritos tab (GIFs
  // used to live in a separate GifPicker.jsx, now merged in there — see
  // "coloque os emojis personalizados dentro do menu de emojis...
  // deixando emojis, GIFs e figurinhas centralizados em um único menu").
  const toggleFavoriteGif = async (url) => {
    const isFav = favoriteGifs.some((g) => g.gifId === url);
    if (isFav) {
      removeFavoriteGifLocal(url);
      await removeFavoriteGif(url).catch(() => {});
    } else {
      addFavoriteGifLocal({ gifId: url, url, preview: url });
      await addFavoriteGif({ gifId: url, url, preview: url }).catch(() => {});
    }
  };

  const removeMessage = async () => {
    const reason = !isOwn ? (prompt('Motivo da remoção (opcional):') || undefined) : undefined;
    await deleteMessage(message.id, reason);
  };

  // Item pedido: "Formulário e aprovação manual" — denúncia manual de uma
  // mensagem, direto do menu de ações dela. Motivo em prompt() simples,
  // mesmo padrão já usado aqui pra "Advertir autor"/"Silenciar autor" —
  // sem modal novo pra manter consistência com o resto do menu.
  const reportThisMessage = async () => {
    const reason = prompt('Por que você está denunciando esta mensagem?');
    if (!reason || !reason.trim()) return;
    try {
      const result = await reportMessage(message.id, reason.trim());
      useStore.getState().pushNotice(result.alreadyReported ? 'Você já denunciou esta mensagem — nossa equipe ainda vai revisar.' : 'Denúncia enviada. Nossa equipe vai revisar.');
    } catch (err) {
      useStore.getState().pushNotice(err.response?.data?.error || 'Não foi possível enviar a denúncia.');
    }
  };

  // Topics/threads reuse the same replyTo + title mechanism forum posts use
  // (see ForumChannelView.jsx) — a "topic" is just a titled reply to this
  // message. Once created it shows up automatically as a pill below this
  // message (see the topics prop, computed in ChatWindow from every
  // currently-loaded message whose replyToId points here) since the new
  // message arrives over the socket like any other and gets picked up by
  // that same computation — no manual refresh needed.
  const createTopic = async () => {
    const title = prompt('Título do tópico:');
    if (!title || !title.trim()) return;
    const fd = new FormData();
    fd.append('channelId', message.channelId);
    fd.append('replyToId', message.id);
    fd.append('title', title.trim());
    await sendMessage(fd);
  };

  // Permissões globais da comunidade — só relevantes em mensagens de canal
  // (DMs não têm conceito de moderação/menção de cargo).
  const isChannelMessage = !!message.channelId;
  const myPerms = isChannelMessage ? getMyCommunityPermissions(roles, members, user.id, user.platformRole) : '0';
  const isAuthorAdmin = message.author?.platformRole === 'ADMIN';
  const canManageMessages = isChannelMessage && hasPermission(myPerms, 'MANAGE_MESSAGES');
  const canModerateAuthor = isChannelMessage && !isOwn && !isAuthorAdmin && hasPermission(myPerms, 'MODERATE_MEMBERS');

  // Optimistic (not-yet-confirmed) messages have a client-generated temp id
  // — the server doesn't know about it yet, so actions that hit the API
  // (react/edit/delete/pin/moderate) would just 404. Suppress the context
  // menu on those until they resolve to a real id.
  const isPending = message.id.startsWith('temp-');

  const isGifMessage = !!message.content && GIF_URL_RE.test(message.content.trim());
  const isFavoriteGif = isGifMessage && favoriteGifs.some((g) => g.gifId === message.content.trim());

  const [forwardOpen, setForwardOpen] = useState(false);
  const [reminderOpen, setReminderOpen] = useState(false);
  const onContextMenu = (e) => {
    if (isPending) return;
    // Redesenho do menu: ícones SVG (ver ContextMenuContext.jsx) e seções
    // separadas — ações na mensagem / pessoa / denúncia / apagar / moderação.
    // Mesmas ações e mesmas checagens de permissão de antes.
    const items = [
      { emojis: topReactions(4), onPick: (em) => reactWithLimitCheck(em) },
      { label: 'Reagir', icon: 'smilePlus', onClick: () => setShowEmojiPicker((v) => !v) },
      { label: 'Responder', icon: 'reply', onClick: () => onReply(message) },
    ];
    if (isOwn) items.push({ label: 'Editar', icon: 'edit', onClick: () => setEditing(true) });
    items.push({ label: 'Copiar texto', icon: 'copy', onClick: () => navigator.clipboard?.writeText(message.content || ''), disabled: !message.content });
    // "Falar mensagem" (velocidade em Configurações → Acessibilidade).
    if (message.content && typeof window !== 'undefined' && window.speechSynthesis) {
      items.push({ label: 'Falar mensagem', icon: 'volume', onClick: () => speakMessage(message) });
    }
    items.push({ label: 'Encaminhar', icon: 'reply', onClick: () => setForwardOpen(true) });
    items.push({ label: 'Lembrar-me', icon: 'clock', onClick: () => setReminderOpen(true) });
    const isSaved = useMsgExtras.getState().saved.has(message.id);
    items.push({ label: isSaved ? 'Desfavoritar mensagem' : 'Favoritar mensagem', icon: isSaved ? 'bookmarkOff' : 'bookmark', onClick: () => toggleSaved(message) });
    if (!isOwn) items.push({ label: 'Marcar como não lida', icon: 'unread', onClick: () => markUnreadFrom(message) });
    items.push({ label: 'Copiar link da mensagem', icon: 'link', onClick: () => copyMessageLink(message) });
    // Fixar só aparece pra quem pode (gerenciar mensagens no canal; em DM, todos).
    if (!isChannelMessage || canManageMessages) {
      items.push({ label: message.pinned ? 'Desafixar' : 'Fixar', icon: 'pin', onClick: () => togglePinMessage(message.id) });
    }
    if (message.channelId && hasPermission(myPerms, 'CREATE_TOPICS')) items.push({ label: 'Criar tópico', icon: 'thread', onClick: createTopic });
    if (isGifMessage) {
      items.push({
        label: isFavoriteGif ? 'Remover dos favoritos' : 'Adicionar aos favoritos',
        icon: 'star',
        onClick: () => toggleFavoriteGif(message.content.trim()),
      });
    }
    items.push(
      { divider: true },
      { label: 'Ver perfil', icon: 'user', onClick: () => useStore.getState().openProfile(message.authorId) },
      ...(!isOwn && message.author ? [{
        label: useMsgExtras.getState().ignored.has(message.authorId) ? 'Parar de ignorar' : 'Ignorar',
        icon: 'eyeOff', onClick: () => toggleIgnore({ id: message.authorId, displayName: message.author.displayName }),
      }] : []),
      { label: 'Copiar ID do usuário', icon: 'id', onClick: () => navigator.clipboard?.writeText(message.author?.publicId || message.authorId) },
    );
    // Item pedido: verificar se todos os toggles de Configurações têm
    // efeito real. "Modo desenvolvedor" já existia na tela ("Mostra IDs e
    // informações técnicas extras em menus de contexto") mas nenhum menu
    // de contexto checava esse valor — mexer nele nunca mudava nada.
    // Mesmo padrão do Discord: "Copiar ID" (aqui, da mensagem em si —
    // diferente do ID do usuário acima, que já é sempre visível por ser
    // algo que qualquer um pode querer compartilhar) só aparece com o
    // modo ligado.
    if (useStore.getState().userSettings?.developerMode) {
      items.push({ label: 'Copiar ID da mensagem', icon: 'id', onClick: () => navigator.clipboard?.writeText(message.id) });
    }
    if (!isOwn) {
      items.push({ divider: true });
      items.push({ label: 'Denunciar', icon: 'flag', onClick: reportThisMessage });
    }
    if (isOwn || canManageMessages) {
      items.push({ divider: true });
      items.push({ label: 'Apagar mensagem', icon: 'trash', danger: true, onClick: removeMessage });
    }
    if (canModerateAuthor) {
      items.push({ divider: true });
      items.push({
        label: 'Advertir autor', icon: 'warn', danger: true,
        onClick: () => { const reason = prompt('Motivo da advertência:'); if (reason) warnMember(message.authorId, reason); },
      });
      items.push({
        label: 'Silenciar autor', icon: 'mute', danger: true,
        onClick: () => { const m = prompt('Duração do silêncio (minutos):', '10'); if (m) timeoutMember(message.authorId, { minutes: parseInt(m, 10) }); },
      });
    }
    openMenu(e, items);
  };

  // Highlights a message with a yellow accent when it's relevant to the
  // current user: it @mentions them (by name, by a role they hold, or via
  // @everyone/@here), or it's a reply to one of their messages — mirrors
  // Discord's own "this pinged you" highlight. Deliberately NOT excluded
  // for the user's own messages: mentioning yourself, replying to your own
  // message, or sending an @everyone should still light up the same way it
  // would for anyone else reading it.
  const myMember = members.find((m) => m.user.id === user.id);
  // Cor do nome do autor da mensagem, e (separadamente) de quem está sendo
  // respondido na linha de preview — cada um usa a cor do próprio cargo
  // dessa pessoa, não necessariamente igual à do autor da mensagem.
  const authorMember = members.find((m) => m.user.id === message.authorId);
  const authorRoleColor = authorMember ? highestColoredRole(authorMember, roles)?.color : null;
  const replyAuthorMember = message.replyTo ? members.find((m) => m.user.id === (message.replyTo.authorId ?? message.replyTo.author?.id)) : null;
  const replyAuthorRoleColor = replyAuthorMember ? highestColoredRole(replyAuthorMember, roles)?.color : null;
  const mentionsMe = messageMentionsUser(message, user.id, myMember?.roleIds || []);
  const repliesToMe = !!message.replyTo && (message.replyTo.authorId ?? message.replyTo.author?.id) === user.id;
  const highlighted = mentionsMe || repliesToMe;

  // Rola até a mensagem respondida (se ela já estiver carregada na
  // lista) e dá um brilho rápido nela pra achar com o olho.
  const jumpToReplied = () => {
    const targetId = message.replyTo?.id || message.replyToId;
    const el = targetId && document.querySelector(`.message[data-message-id="${targetId}"]`);
    if (!el) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
    el.classList.remove('chat-flash');
    void el.offsetWidth;
    el.classList.add('chat-flash');
    setTimeout(() => el.classList.remove('chat-flash'), 1600);
  };

  const groupedReactions = groupReactions(message.reactions, user.id, message.reactionCounts);
  const reactionRows = reactorsByEmoji(message.reactions);
  const atReactionLimit = groupedReactions.length >= MAX_DISTINCT_REACTIONS;
  const emojiMap = Object.fromEntries(usableEmojis.map((e) => [e.name, e.url]));
  const memberNames = members.map((m) => m.user.displayName);
  // Só cargos não-padrão e mencionáveis ganham destaque de chip — igual ao
  // que o servidor aceita de fato como @NomeDoCargo (ver
  // server/src/services/mentions.js).
  const roleNames = roles.filter((r) => !r.isDefault && r.mentionable !== false).map((r) => r.name);
  const memberInfoByName = Object.fromEntries(members.map((m) => [m.user.displayName, m.user]));
  const roleInfoByName = Object.fromEntries(roleNames.map((n) => [n, roles.find((r) => r.name === n)]));

  return (
    <div
      className={`message ${showAuthor ? 'with-author' : ''} ${message.replyTo ? 'has-reply' : ''} ${message.pinned ? 'pinned' : ''} ${message.pending ? 'pending' : ''} ${message.failed ? 'failed' : ''} ${message.queued && !message.failed ? 'queued' : ''} ${highlighted ? 'mentioned' : ''} ${message._animateIn ? 'message-animate-in' : ''}`}
      data-message-id={message.id}
      onContextMenu={onContextMenu}
    >
      {/* Barra flutuante (só mouse — ver chat.css): reações rápidas,
          reagir, responder e "mais" (abre o mesmo menu do clique direito). */}
      {!isPending && (
        <div className="message-hover-actions">
          {topReactions(3).map((e) => (
            <button key={e} type="button" className="message-hover-action quick-react" title={`Reagir com ${e}`} onClick={() => reactWithLimitCheck(e)}>
              {e}
            </button>
          ))}
          <span className="message-hover-divider" aria-hidden="true" />
          <button
            ref={reactBtnRef}
            type="button"
            className={`message-hover-action ${showEmojiPicker ? 'on' : ''}`}
            title="Adicionar reação"
            aria-label="Adicionar reação"
            onClick={() => setShowEmojiPicker((v) => !v)}
          >
            <ChatIcon name="smilePlus" size={18} />
          </button>
          <button type="button" className="message-hover-action" title="Responder" aria-label="Responder" onClick={() => onReply(message)}><ChatIcon name="reply" size={18} /></button>
          <button type="button" className="message-hover-action" title="Mais opções" aria-label="Mais opções" onClick={onContextMenu}><ChatIcon name="more" size={18} /></button>
        </div>
      )}
      {/* Prévia da resposta acima da mensagem, com a linha curva saindo
          do avatar. Clicar pula até a mensagem original (se carregada). */}
      {message.replyTo && (
        <button type="button" className="reply-preview" onClick={jumpToReplied} title="Ir para a mensagem original">
          <span className="reply-preview-connector" aria-hidden="true" />
          <span className="reply-preview-avatar" style={{ background: message.replyTo.author.profileColor }}>
            {message.replyTo.author.avatarUrl
              ? <ReplyAvatarImg url={message.replyTo.author.avatarUrl} />
              : message.replyTo.author.displayName[0].toUpperCase()}
          </span>
          <b className={`reply-preview-name ${hasCustomNameStyle(message.replyTo.author) ? nameStyleClassName(message.replyTo.author, { fullEffect: true }) : ''}`} style={hasCustomNameStyle(message.replyTo.author) ? nameStyleProps(message.replyTo.author, { fullEffect: true }) : roleTextStyle(replyAuthorRoleColor)}>{message.replyTo.author.displayName}</b>
          <span className="reply-preview-content">{message.replyTo.content?.slice(0, 80) || <i>Clique para ver o anexo</i>}</span>
        </button>
      )}
      {!showAuthor && (
        <span className="message-gutter-time" title={formatEmbedTime(message.createdAt)}>{formatTimeOnly(message.createdAt)}</span>
      )}
      {showAuthor && (
        <div className="avatar clickable" onClick={(e) => useStore.getState().openMiniProfile(message.authorId, e.currentTarget.getBoundingClientRect())}>
          <UserAvatar user={message.author} size={40} />
        </div>
      )}
      <div className="message-body">
        {showAuthor && (
          <div className="message-meta">
            {/* Item pedido: "volte com as cores nos nomes no chat de
                novo... quero igual no mini perfil e no perfil" — o nome
                do autor aqui usava nameStyleProps/nameStyleClassName SEM
                fullEffect, que (de propósito, numa resposta anterior)
                reduzia qualquer estilo de nome personalizado (néon,
                gradiente, arco-íris etc) pra só cor sólida + fonte
                dentro do chat, guardando o efeito completo só pro Mini
                Perfil/Perfil Completo. Passando fullEffect: true aqui
                também, o nome no chat volta a mostrar a MESMA cor/efeito
                que aparece no perfil da pessoa, em vez da versão
                reduzida. Continua caindo em roleTextStyle(cor do cargo)
                quando a pessoa não tem nenhum estilo de nome próprio
                (hasCustomNameStyle false) — sem mudança nesse caso. */}
            <span className={`message-author ${hasCustomNameStyle(message.author) ? nameStyleClassName(message.author, { fullEffect: true }) : ''}`} style={hasCustomNameStyle(message.author) ? nameStyleProps(message.author, { fullEffect: true }) : roleTextStyle(authorRoleColor)}>{message.author.displayName}</span>
            <PendantIcon user={message.author} size={20} />
            <TagBadge user={message.author} />
            <ClanTagBadge user={message.author} />
            <span className="message-time" title={formatTime(message.createdAt)}>{formatTimeOnly(message.createdAt)}</span>
            {message.pinned && <span className="pin-badge"><img className="ui-icon-sm" src={pinIcon} alt="" /> fixada</span>}
            {message.pending && <span className="pending-badge">enviando…</span>}
            {message.queued && !message.failed && <span className="pending-badge queued-badge">na fila</span>}
            {message.failed && <span className="failed-badge">falhou ao enviar</span>}
          </div>
        )}

        {/* Item pedido: "Filtro de conteúdo... mostrar aviso / ser
            ocultada... dependendo da configuração" — contentFiltered/
            contentFlagged vêm calculados pelo BACKEND (ver
            applyContentFilter em messageController.js), com base no
            nível que O PRÓPRIO LEITOR escolheu — nunca decidido aqui
            no cliente. 'Alto' (contentFiltered) já chega SEM o texto
            de verdade (o servidor nem manda), então não tem "revelar"
            possível aqui — só o aviso fixo. 'Moderado' (contentFlagged)
            mantém o texto normal, só com um aviso em cima dele. */}
        {message.forwardedFrom && <ForwardedLabel forwardedFrom={message.forwardedFrom} />}
        {editing ? (
          <div className="edit-box">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditing(false); }}
              autoFocus
            />
            <button className="btn-link" onClick={saveEdit}>salvar</button>
            <button className="btn-link" onClick={() => setEditing(false)}>cancelar</button>
          </div>
        ) : message.contentFiltered ? (
          <div className="message-content content-filtered-notice dim" style={{ fontStyle: 'italic' }}>
            🚫 Mensagem oculta pelo seu filtro de conteúdo (nível Alto, ver Configurações → Dados e privacidade)
          </div>
        ) : (
          <>
            {message.contentFlagged && (
              <div className="content-flagged-notice dim" style={{ fontSize: 12, marginBottom: 2 }}>
                ⚠️ Esta mensagem pode conter conteúdo sensível (filtro de conteúdo: Moderado)
              </div>
            )}
            {message.content && (
              BARE_IMAGE_URL_RE.test(message.content.trim()) ? (
                <div className="attachments">
                  <img
                    className="attachment-image"
                    src={message.content.trim()}
                    alt="GIF"
                    loading="lazy"
                    style={{ cursor: 'zoom-in' }}
                    onClick={() => useStore.getState().openLightbox([{ url: message.content.trim(), filename: 'GIF' }], 0)}
                  />
                </div>
              ) : (
                <div className={`message-content ${isEmojiOnlyMessage(message.content, emojiMap) ? 'emoji-only' : ''}`}>
                  {renderRichContent(message.content, { emojiMap, memberNames, roleNames, memberInfoByName, roleInfoByName })}
                  {message.edited && <EditedTag message={message} />}
                </div>
              )
            )}
          </>
        )}


        {/* Envio com anexos: progresso real do upload + cancelar. */}
        {message.pending && message.upload && <UploadProgressRow message={message} />}

        {/* Sem conexão: fica na fila e sai sozinha quando a conexão voltar
            (utils/sendQueue.js). "Tentar de novo" tenta a fila agora. */}
        {message.queued && !message.failed && (
          <div className="message-failed-row message-queued-row" role="status">
            <span className="message-queued-dot" aria-hidden="true" />
            <span>Enviando quando a conexão voltar…</span>
            {getRetry(message.id) && (
              <button type="button" className="message-failed-btn" onClick={() => getRetry(message.id)?.()}>Tentar de novo</button>
            )}
            <button type="button" className="message-failed-btn ghost" onClick={() => discardOptimistic(roomKeyFor({ conversationId: message.conversationId, channelId: message.channelId }), message.id)}>Descartar</button>
          </div>
        )}

        {message.failed && (
          <div className="message-failed-row" role="alert">
            <span>Não foi enviada.</span>
            {getRetry(message.id) && (
              <button type="button" className="message-failed-btn" onClick={() => getRetry(message.id)?.()}>Tentar de novo</button>
            )}
            <button type="button" className="message-failed-btn ghost" onClick={() => discardOptimistic(roomKeyFor({ conversationId: message.conversationId, channelId: message.channelId }), message.id)}>Descartar</button>
          </div>
        )}

        {/* Cartões dos links internos do Project Club (post, modpack, perfil...) */}
        {!editing && !message.contentFiltered && <MessageLinkCards content={message.content} />}
        {/* Prévia de link externo (Open Graph) — no máximo 1 por mensagem. */}
        {!editing && !message.contentFiltered && !message.embed && !isPending && <LinkPreview content={message.content} />}
        {forwardOpen && <ForwardMessageModal message={message} myUserId={user.id} onClose={() => setForwardOpen(false)} />}
        {reminderOpen && (
          <ReminderModal
            message={message}
            link={message.channelId ? `/channels/${message.channelId}` : message.conversationId ? `/conversations/${message.conversationId}` : null}
            onClose={() => setReminderOpen(false)}
          />
        )}

        {message.poll && <PollCard poll={message.poll} myUserId={user.id} />}

        {/* A sent sticker (Message.stickerUrl) is deliberately NOT rendered
            via EmbedCard — it needs to look small and chrome-free (no card
            border/background), not like a rich-link/GIF embed, so it gets
            its own tiny plain <img>. */}
        {message.stickerUrl && <img className="sticker-message-image" src={message.stickerUrl} alt="figurinha" loading="lazy" />}

        {message.embed && <EmbedCard embed={message.embed} />}

        {message.attachments?.length > 0 && (
          <div className="attachments">
            {/* Item pedido: "se alguém enviar vários arquivo de
                imagem, ao clicar em uma das imagens vai abrir com as
                opções de baixar etc, e vai ter uma setinha de ir e
                voltar" — todas as imagens da mensagem (não vídeo, que
                já tem seu próprio jeito de ver com controles) formam
                uma "galeria" só, pra dar pra navegar entre elas
                dentro do visualizador ampliado sem precisar fechar e
                abrir de novo em cada uma. */}
            {(() => {
              const galleryImages = message.attachments
                .filter((a) => a.mimeType.startsWith('image/'))
                .map((a) => ({ url: a.url, filename: a.filename, mimeType: a.mimeType }));
              return message.attachments.map((a) => (
                <Attachment
                  key={a.id} attachment={a}
                  allImages={galleryImages}
                  imageIndex={galleryImages.findIndex((g) => g.url === a.url)}
                />
              ));
            })()}
          </div>
        )}

        {topics.length > 0 && (
          <div className="topic-pills">
            {topics.map((t) => (
              <button key={t.id} className={`topic-pill ${t.archived ? 'archived' : ''}`} onClick={() => onOpenTopic?.(t)}>
                {t.archived ? '🗄' : '🧵'} {t.title}
              </button>
            ))}
          </div>
        )}

        {groupedReactions.length > 0 && (
          <div className="reactions">
            {/* Clique reage/remove; clique direito, segurar o dedo ou a
                tecla Menu abrem "quem reagiu" (ver ReactionChip.jsx). */}
            {groupedReactions.map(([emoji, count, mine]) => {
              const rows = reactionRows.get(emoji) || [];
              return (
                <ReactionChip
                  key={emoji}
                  messageId={message.id}
                  emoji={emoji}
                  count={count}
                  mine={mine}
                  rows={rows}
                  trimmed={rows.length < count || rows.some((r) => !r.user)}
                  emojiMap={emojiMap}
                  onToggle={react}
                  disabled={isPending}
                />
              );
            })}
            {atReactionLimit && (
              <span className="reaction-limit-hint" title={`Limite de ${MAX_DISTINCT_REACTIONS} emojis diferentes por mensagem atingido`}>
                limite atingido
              </span>
            )}
          </div>
        )}
      </div>

      {/* Rendered via a portal straight into <body>, NOT as a normal child
          here — even though it's already `position: fixed`, leaving it
          nested inside `.message` still exposed it to whatever
          animation/stacking-context quirks that row picks up (the
          `message-in` mount animation applies a transform while it plays,
          which creates a *new* containing block for fixed-position
          descendants for that instant), enough to make the picker
          unreliable to actually tap/drag on some devices. A portal
          sidesteps all of that: it's a sibling of the whole app, position:
          fixed relative to the real viewport, nothing above it to get
          reparented by. */}
      {!isPending && showEmojiPicker && createPortal(
        <div ref={pickerRef} style={{ display: 'contents' }}>
          <EmojiPicker
            variant="reaction"
            defaultHeightVh={REACTION_PICKER_DEFAULT_VH}
            style={pickerStyle || {}}
            serverEmojis={usableEmojis}
            onPick={reactWithLimitCheck}
            onClose={() => setShowEmojiPicker(false)}
          />
        </div>,
        document.body,
      )}
    </div>
  );
}

// message.embed is a JSON string (see messageController.createMessage) —
// { title?, description?, color?, imageUrl?,
// footer?, fields?: [{name,value,inline}] }. Parsed defensively since it's
// free-form user JSON round-tripped through the DB, not a guaranteed shape.
function EmbedCard({ embed }) {
  let data;
  try { data = JSON.parse(embed); } catch { return null; }
  if (!data) return null;
  return (
    <div className="embed-card" style={{ borderColor: data.color || '#F2894D' }}>
      {data.author?.name && (
        <div className="embed-card-author">
          {data.author.iconUrl && <img className="embed-card-author-icon" src={proxyImage(data.author.iconUrl)} alt="" />}
          {data.author.url ? (
            <a href={data.author.url} target="_blank" rel="noreferrer">{data.author.name}</a>
          ) : data.author.name}
        </div>
      )}
      <div className="embed-card-body">
        <div className="embed-card-main">
          {data.title && (
            data.titleUrl ? (
              <a className="embed-card-title" href={data.titleUrl} target="_blank" rel="noreferrer">{data.title}</a>
            ) : (
              <div className="embed-card-title">{data.title}</div>
            )
          )}
          {data.description && <div className="embed-card-description">{renderRichContent(data.description)}</div>}
          {data.fields?.length > 0 && (
            <div className="embed-card-fields">
              {data.fields.map((f, i) => (
                <div key={i} className={`embed-card-field ${f.inline ? 'inline' : ''}`}>
                  {f.name && <div className="embed-card-field-name">{f.name}</div>}
                  {f.value && <div className="embed-card-field-value">{f.value}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
        {data.thumbnailUrl && <img className="embed-card-thumbnail" src={data.thumbnailUrl} alt="" loading="lazy" />}
      </div>
      {data.imageUrl && <img className="embed-card-image" src={proxyImage(data.imageUrl)} alt="" loading="lazy" />}
      {(data.footer || data.timestamp) && (
        <div className="embed-card-footer">
          {data.footer}
          {data.footer && data.timestamp && ' • '}
          {data.timestamp && formatEmbedTime(data.timestamp)}
        </div>
      )}
    </div>
  );
}

function PollCard({ poll, myUserId }) {
  const [showVoters, setShowVoters] = useState(null); // option index currently expanded, or null
  const options = JSON.parse(poll.options);
  const votes = poll.votes || [];
  const totalVotes = votes.length;
  const myVote = votes.find((v) => v.userId === myUserId)?.optionIndex;
  const expired = new Date(poll.expiresAt) <= new Date();

  const vote = (i) => {
    if (expired) return;
    votePoll(poll.id, i).catch(() => {});
  };

  return (
    <div className="poll-card">
      <div className="poll-question">{poll.question}</div>
      <div className="poll-options">
        {options.map((label, i) => {
          const optionVotes = votes.filter((v) => v.optionIndex === i);
          const count = optionVotes.length;
          const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
          const mine = myVote === i;
          return (
            <div key={i} className="poll-option-wrap">
              <button
                type="button"
                className={`poll-option ${mine ? 'mine' : ''} ${expired ? 'expired' : ''}`}
                onClick={() => vote(i)}
                disabled={expired}
              >
                <div className="poll-option-bar" style={{ width: `${pct}%` }} />
                <span className="poll-option-label">{mine ? <img className="ui-icon-sm" src={selectedIcon} alt="" /> : ''} {label}</span>
                <span
                  className="poll-option-pct"
                  title="Ver quem votou"
                  onClick={(e) => { e.stopPropagation(); if (count > 0) setShowVoters((v) => (v === i ? null : i)); }}
                >
                  {pct}% ({count})
                </span>
              </button>
              {showVoters === i && count > 0 && (
                <div className="poll-voters">
                  {optionVotes.map((v) => (
                    <span key={v.userId} className="poll-voter">{v.user?.displayName || 'Alguém'}</span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="poll-meta dim">
        {totalVotes} {totalVotes === 1 ? 'voto' : 'votos'} · {expired ? 'Encerrada' : `Encerra em ${new Date(poll.expiresAt).toLocaleString('pt-BR')}`}
      </div>
    </div>
  );
}

function Attachment({ attachment, allImages, imageIndex }) {
  // Item pedido: "o ícone de olho vai representar... marcar imagem
  // com spoiler... vai ficar toda borrada, um botão escrito Spoiler,
  // e ao clicar vai tirar a censura" — começa escondida (borrada) se
  // isSpoiler; uma vez revelada nesta sessão de visualização, fica
  // revelada (não borra de novo sozinha).
  const [revealed, setRevealed] = useState(!attachment.isSpoiler || getExtra().spoilers === 'always');

  if (attachment.mimeType.startsWith('image/')) {
    return (
      <div className={`attachment-image-wrap ${!revealed ? 'is-spoiler' : ''}`}>
        <img
          className="attachment-image"
          src={attachment.url}
          alt={attachment.filename}
          loading="lazy"
          style={{ cursor: revealed ? 'zoom-in' : 'default' }}
          onClick={() => { if (revealed) useStore.getState().openLightbox(allImages, imageIndex); }}
        />
        {!revealed && (
          <button type="button" className="attachment-spoiler-reveal" onClick={() => setRevealed(true)}>
            <ChatIcon name="eye" size={15} /> Spoiler
          </button>
        )}
      </div>
    );
  }
  if (attachment.mimeType.startsWith('video/')) {
    // Item pedido: "quando mandarem... vídeo... clicar em baixar,
    // faça baixar já de vez" — botão de expandir num cantinho, em
    // vez de um onClick direto no próprio vídeo (que atrapalharia os
    // controles nativos de play/pause/volume — qualquer clique no
    // vídeo abriria o lightbox por engano, mesmo só querendo pausar).
    return (
      <div className={`attachment-video-wrap ${!revealed ? 'is-spoiler' : ''}`}>
        <video className="attachment-video" src={attachment.url} controls={revealed} preload="metadata" />
        {!revealed && (
          <button type="button" className="attachment-spoiler-reveal" onClick={() => setRevealed(true)}>
            <ChatIcon name="eye" size={15} /> Spoiler
          </button>
        )}
        {revealed && <button
          type="button" className="attachment-video-expand" title="Ver em tela cheia"
          onClick={() => useStore.getState().openLightbox([{ url: attachment.url, filename: attachment.filename, mimeType: attachment.mimeType }], 0)}
        >⤢</button>}
      </div>
    );
  }
  // Arquivos de texto/código: prévia com cores de sintaxe (igual ao Discord).
  if (isCodeFile(attachment)) return <CodeFilePreview attachment={attachment} />;
  if (attachment.mimeType.startsWith('audio/')) {
    return (
      <div className="attachment-audio">
        <span className="attachment-audio-icon"><img className="ui-icon" src={micIcon} alt="" /></span>
        <CustomAudioPlayer src={attachment.url} />
      </div>
    );
  }
  return (
    <a className="attachment-file" href={attachment.url} target="_blank" rel="noreferrer">
      <img className="ui-icon-sm" src={documentIcon} alt="" /> {attachment.filename}
    </a>
  );
}

function formatTime(iso) {
  return formatMessageTime(iso);
}

// Item pedido: otimização/velocidade — o componente mais repetido de
// toda a tela de chat (uma instância por mensagem visível, podem ser
// centenas numa conversa longa). Sem memo, QUALQUER re-render do
// ChatWindow pai (chega mensagem nova, alguém reage, digitando...)
// forçava TODAS as mensagens a re-renderizar de novo, mesmo as que não
// mudaram nada. Com React.memo, uma mensagem só re-renderiza de
// verdade quando algo dela mesma muda (ou os poucos props que ela
// recebe) — comparação rasa padrão, que já funciona aqui porque os
// callbacks (onReply/onOpenTopic) e o array de tópicos que o ChatWindow
// passa já são referências estáveis entre renders (ver comentário de
// EMPTY_TOPICS em ChatWindow.jsx).
export default memo(MessageComponent);

// Barra de progresso do upload (mensagem com anexos ainda subindo).
function UploadProgressRow({ message }) {
  const pct = message.upload?.pct;
  const count = message.uploadCount || 1;
  const known = typeof pct === 'number';
  const roomKey = roomKeyFor({ conversationId: message.conversationId, channelId: message.channelId });
  const cancel = getCancel(message.id);
  const mb = (n) => `${(n / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
  return (
    <div className="message-upload-row" role="progressbar" aria-label="Enviando anexos" aria-valuemin={0} aria-valuemax={100} aria-valuenow={known ? pct : undefined}>
      <div className="message-upload-info">
        <span>{pct === 100 ? 'Processando…' : `Enviando ${count} arquivo${count === 1 ? '' : 's'}`}</span>
        <span className="message-upload-pct">
          {known && message.upload?.total ? `${mb(message.upload.loaded || 0)} de ${mb(message.upload.total)} · ` : ''}
          {known ? `${pct}%` : ''}
        </span>
        {cancel && pct !== 100 && (
          <button type="button" className="message-upload-cancel" title="Cancelar envio" aria-label="Cancelar envio" onClick={() => discardOptimistic(roomKey, message.id)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        )}
      </div>
      <div className={`message-upload-bar ${known ? '' : 'is-indeterminate'}`}>
        <span style={known ? { width: `${pct}%` } : undefined} />
      </div>
    </div>
  );
}

// Prévia dos links internos da mensagem — some se a pessoa desligou
// "Mostrar prévia de links" nas configurações.
function MessageLinkCards({ content }) {
  const enabled = useStore((s) => s.userSettings?.showLinkPreviews !== false);
  if (!enabled || !content || !content.includes('http')) return null;
  const links = findInternalLinks(content);
  return links.length ? <InternalLinkCards links={links} /> : null;
}

// Lê a mensagem em voz alta (pt-BR) na velocidade escolhida.
function speakMessage(message) {
  try {
    const synth = window.speechSynthesis;
    synth.cancel();
    const text = `${message.author?.displayName || 'Alguém'} disse: ${String(message.content || '').replace(/<a?:(\w+):\d+>/g, '$1').replace(/https?:\/\/\S+/g, 'link')}`;
    const u = new SpeechSynthesisUtterance(text.slice(0, 1000));
    u.lang = 'pt-BR';
    u.rate = Number(getExtra().ttsRate) || 1;
    const voice = synth.getVoices().find((v) => /^pt(-|_)BR/i.test(v.lang));
    if (voice) u.voice = voice;
    synth.speak(u);
  } catch { /* sem voz no navegador */ }
}
