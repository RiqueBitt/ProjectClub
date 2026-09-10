import { useEffect, useRef, useState, memo } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useContextMenu } from '../context/ContextMenuContext.jsx';
import { useStore, messageMentionsUser } from '../store/useStore';
import {
  editMessage, deleteMessage, togglePinMessage, reactToMessage,
  warnMember, timeoutMember, addFavoriteGif, removeFavoriteGif, sendMessage, votePoll, reportMessage,
} from '../api/endpoints';
import { getMyCommunityPermissions, hasPermission } from '../utils/permissions';
import { renderRichContent, isEmojiOnlyMessage } from '../utils/richTextRender.jsx';
import { groupReactions, MAX_DISTINCT_REACTIONS } from '../utils/reactions';
import { roleTextStyle, highestColoredRole } from '../utils/roleColor';
import { nameStyleProps, hasCustomNameStyle, nameStyleClassName } from '../utils/nameStyle';
import { formatMessageTime, formatEmbedTime } from '../utils/formatTime';
import EmojiPicker from './EmojiPicker.jsx';
import StyledEmoji from './StyledEmoji.jsx';
import CustomAudioPlayer from './CustomAudioPlayer.jsx';
import { usePopoverCoordination } from '../utils/popoverCoordinator';
import TagBadge from './TagBadge.jsx';
import ClanTagBadge from './ClanTagBadge.jsx';
import UserAvatar from './UserAvatar.jsx';
import personIcon from '../assets/icons/person.png';
import emojiPickerIcon from '../assets/icons/emoji-picker.png';
import starIcon from '../assets/icons/star.png';
import pinIcon from '../assets/icons/pin.png';
import trashIcon from '../assets/icons/trash.png';
import errorIcon from '../assets/icons/error.png';
import micIcon from '../assets/icons/mic.png';
import documentIcon from '../assets/icons/document.png';
import selectedIcon from '../assets/icons/selected.png';
import PenguinAvatar, { isPenguinAvatarUrl, penguinColorFromUrl } from './PenguinAvatar.jsx';
import { proxyImage } from '../utils/imageProxy';

// BUG CORRIGIDO: <img src={...avatarUrl}> quebrava (bloqueado pela CSP
// img-src) quando o autor da mensagem respondida tem avatar de pinguim
// (pseudo-URL "penguin:<cor>", não uma URL de rede de verdade) — ver
// PenguinAvatar.jsx.
function ReplyAvatarImg({ url }) {
  if (isPenguinAvatarUrl(url)) return <PenguinAvatar color={penguinColorFromUrl(url)} size={16} />;
  return <img src={url} alt="" />;
}

// 4 popular quick-react emojis shown directly in the hover toolbar (like
// Discord's own quick-react bar) — clicking one reacts immediately. The "+"
// next to them opens the full picker (unicode search + this server's custom
// emojis + custom emojis from other servers the user belongs to).
const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮'];

// Approximate width of the full emoji-picker popover on desktop — kept in
// sync with `.reaction-picker` in global.css (`width: min(340px, 92vw)`),
// documented here only as a pointer for anyone tuning that CSS; the JS side
// no longer needs it now that the picker centers itself horizontally.
const PICKER_GAP = 8;

const BARE_IMAGE_URL_RE = /^https?:\/\/\S+\.(gif|png|jpe?g|webp)(\?\S*)?$/i;
const GIF_URL_RE = /\.gif(\?\S*)?$/i;

function MessageComponent({ message, showAuthor, onReply, topics = [], onOpenTopic }) {
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

  if (message.deleted) {
    return <div className="message deleted-message"><em>Mensagem apagada</em></div>;
  }

  const saveEdit = async () => {
    if (draft.trim() && draft !== message.content) await editMessage(message.id, draft.trim());
    setEditing(false);
  };

  const react = async (emoji) => {
    setShowEmojiPicker(false);
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
    const rect = btn.getBoundingClientRect();
    const estimatedHeight = Math.min(window.innerHeight * (REACTION_PICKER_DEFAULT_VH / 100), window.innerHeight - 24);
    let top = rect.top - estimatedHeight - PICKER_GAP;
    if (top < 8) top = Math.min(rect.bottom + PICKER_GAP, window.innerHeight - estimatedHeight - 8);
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

  const onContextMenu = (e) => {
    if (isPending) return;
    const items = [
      { label: 'Ver perfil', icon: <img className="ui-icon-sm" src={personIcon} alt="" />, onClick: () => useStore.getState().openProfile(message.authorId) },
      { label: 'Copiar ID do usuário', icon: '🆔', onClick: () => navigator.clipboard?.writeText(message.author?.publicId || message.authorId) },
      { label: 'Reagir', icon: <img className="ui-icon-sm" src={emojiPickerIcon} alt="" />, onClick: () => setShowEmojiPicker((v) => !v) },
    ];
    if (isGifMessage) {
      items.push({
        label: isFavoriteGif ? 'Remover dos favoritos' : 'Adicionar aos favoritos',
        icon: isFavoriteGif ? <img className="ui-icon-sm" src={starIcon} alt="" /> : '☆',
        onClick: () => toggleFavoriteGif(message.content.trim()),
      });
    }
    items.push(
      { label: 'Responder', icon: '↪', onClick: () => onReply(message) },
      { label: 'Copiar texto', icon: '📋', onClick: () => navigator.clipboard?.writeText(message.content || ''), disabled: !message.content },
      { label: message.pinned ? 'Desafixar' : 'Fixar', icon: <img className="ui-icon-sm" src={pinIcon} alt="" />, onClick: () => togglePinMessage(message.id) },
    );
    if (message.channelId && hasPermission(myPerms, 'CREATE_TOPICS')) items.push({ label: 'Criar tópico', icon: '🧵', onClick: createTopic });
    if (isOwn) items.push({ label: 'Editar', icon: '✎', onClick: () => setEditing(true) });
    if (!isOwn) {
      items.push({ divider: true });
      items.push({ label: 'Denunciar', icon: '🚩', onClick: reportThisMessage });
    }
    if (isOwn || canManageMessages) {
      items.push({ divider: true });
      items.push({ label: 'Apagar mensagem', icon: <img className="ui-icon-sm" src={trashIcon} alt="" />, danger: true, onClick: removeMessage });
    }
    if (canModerateAuthor) {
      items.push({ divider: true });
      items.push({
        label: 'Advertir autor', icon: <img className="ui-icon-sm" src={errorIcon} alt="" />, danger: true,
        onClick: () => { const reason = prompt('Motivo da advertência:'); if (reason) warnMember(message.authorId, reason); },
      });
      items.push({
        label: 'Silenciar autor', icon: '🔇', danger: true,
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

  const groupedReactions = groupReactions(message.reactions, user.id);
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
      className={`message ${showAuthor ? 'with-author' : ''} ${message.pinned ? 'pinned' : ''} ${message.pending ? 'pending' : ''} ${message.failed ? 'failed' : ''} ${highlighted ? 'mentioned' : ''}`}
      onContextMenu={onContextMenu}
    >
      {!isPending && (
        <div className="message-hover-actions">
          {QUICK_EMOJIS.map((e) => (
            <button key={e} type="button" className="message-hover-action quick-react" title={`Reagir com ${e}`} onClick={() => reactWithLimitCheck(e)}>
              {e}
            </button>
          ))}
          <button
            ref={reactBtnRef}
            type="button"
            className="message-hover-action"
            title="Mais reações"
            onClick={() => setShowEmojiPicker((v) => !v)}
          >
            +
          </button>
          <button type="button" className="message-hover-action" title="Responder" onClick={() => onReply(message)}>↪</button>
        </div>
      )}
      {showAuthor && (
        <div className="avatar clickable" onClick={(e) => useStore.getState().openMiniProfile(message.authorId, e.currentTarget.getBoundingClientRect())}>
          <UserAvatar user={message.author} size={40} />
        </div>
      )}
      <div className="message-body">
        {showAuthor && (
          <div className="message-meta">
            <span className={`message-author ${hasCustomNameStyle(message.author) ? nameStyleClassName(message.author) : ''}`} style={hasCustomNameStyle(message.author) ? nameStyleProps(message.author) : roleTextStyle(authorRoleColor)}>{message.author.displayName}</span>
            <TagBadge user={message.author} />
            <ClanTagBadge user={message.author} />
            <span className="message-time">{formatTime(message.createdAt)}</span>
            {message.pinned && <span className="pin-badge"><img className="ui-icon-sm" src={pinIcon} alt="" /> fixada</span>}
            {message.pending && <span className="pending-badge">enviando…</span>}
            {message.failed && <span className="failed-badge">falhou ao enviar</span>}
          </div>
        )}
        {message.replyTo && (
          <div className="reply-preview">
            <span className="reply-preview-connector">↪</span>
            <span className="reply-preview-avatar" style={{ background: message.replyTo.author.profileColor }}>
              {message.replyTo.author.avatarUrl
                ? <ReplyAvatarImg url={message.replyTo.author.avatarUrl} />
                : message.replyTo.author.displayName[0].toUpperCase()}
            </span>
            <b className={`reply-preview-name ${hasCustomNameStyle(message.replyTo.author) ? nameStyleClassName(message.replyTo.author) : ''}`} style={hasCustomNameStyle(message.replyTo.author) ? nameStyleProps(message.replyTo.author) : roleTextStyle(replyAuthorRoleColor)}>{message.replyTo.author.displayName}</b>
            <span className="reply-preview-content">{message.replyTo.content?.slice(0, 80) || 'anexo'}</span>
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
                  {message.edited && <span className="edited-tag"> (editado)</span>}
                </div>
              )
            )}
          </>
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
            {groupedReactions.map(([emoji, count, mine]) => (
              <button key={emoji} className={`reaction-chip ${mine ? 'mine' : ''}`} onClick={() => react(emoji)}>
                {emoji.startsWith(':') && emojiMap[emoji.slice(1, -1)] ? (
                  <img className="inline-emoji" src={emojiMap[emoji.slice(1, -1)]} alt={emoji} />
                ) : (
                  <StyledEmoji emoji={emoji} size={16} />
                )} {count}
              </button>
            ))}
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
  const [revealed, setRevealed] = useState(!attachment.isSpoiler);

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
            👁 Spoiler
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
      <div className="attachment-video-wrap">
        <video className="attachment-video" src={attachment.url} controls />
        <button
          type="button" className="attachment-video-expand" title="Ver em tela cheia"
          onClick={() => useStore.getState().openLightbox([{ url: attachment.url, filename: attachment.filename, mimeType: attachment.mimeType }], 0)}
        >⤢</button>
      </div>
    );
  }
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
