import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useParams } from 'react-router-dom';
import { useStore, roomKeyFor } from '../store/useStore';
import { useAuth } from '../context/AuthContext.jsx';
import { useSocket } from '../context/SocketContext.jsx';
import { useVoice } from '../context/VoiceContext.jsx';
import { listMessages, sendMessage, searchMessages, markConversationRead, markChannelRead } from '../api/endpoints';
import Message from './Message.jsx';
import VoiceChannelView from './VoiceChannelView.jsx';
import ErrorBoundary from './ErrorBoundary.jsx';
import RulesChannelView from './RulesChannelView.jsx';
import EmojiPicker from './EmojiPicker.jsx';
import GifPicker from './GifPicker.jsx';
import TopicThreadModal from './modals/TopicThreadModal.jsx';
import PollComposerModal from './modals/PollComposerModal.jsx';
import GroupSettingsModal from './modals/GroupSettingsModal.jsx';
import ConversationIcon from './ConversationIcon.jsx';
import ChannelSwitcher from './ChannelSwitcher.jsx';
import { getMyCommunityPermissions, hasPermission } from '../utils/permissions';
import { TYPE_ICON } from '../utils/channelIcons';
import { STATUS_COLOR } from '../utils/status';
import { usePopoverCoordination } from '../utils/popoverCoordinator';
import searchIcon from '../assets/icons/search.png';
import phoneIcon from '../assets/icons/phone.png';
import cancelIcon from '../assets/icons/cancel.png';
import selectedIcon from '../assets/icons/selected.png';
import plusIcon from '../assets/icons/plus.png';
import documentIcon from '../assets/icons/document.png';
import micIcon from '../assets/icons/mic.png';
import PenguinAvatar, { isPenguinAvatarUrl, penguinColorFromUrl } from './PenguinAvatar.jsx';

// BUG CORRIGIDO: <img src={dmOther.avatarUrl}> quebrava (bloqueado pela
// CSP img-src) quando a outra pessoa da DM tem avatar de pinguim
// (pseudo-URL "penguin:<cor>", não uma URL de rede de verdade) — ver
// PenguinAvatar.jsx.
function HeaderAvatarImg({ url }) {
  if (isPenguinAvatarUrl(url)) return <PenguinAvatar color={penguinColorFromUrl(url)} size={28} />;
  return <img src={url} alt="" />;
}

// Below 900px .members-list becomes an off-canvas drawer (see global.css) —
// this arrow button, next to the channel name in the header, is what pulls
// it in from the right, since there's no room to show it inline alongside
// the chat anymore. Hidden on desktop/tablet-wide via CSS, where the
// members list is already visible inline.
function MembersToggleButton({ title = 'Membros da comunidade' }) {
  const toggleMobileMembers = useStore((s) => s.toggleMobileMembers);
  return (
    <button className="icon-btn mobile-members-toggle" onClick={toggleMobileMembers} title={title}>❮</button>
  );
}

const TYPING_TIMEOUT = 3000;

// Matches the server's default MAX_UPLOAD_MB (server/.env) — validating
// client-side too means someone gets told immediately, instead of only
// after waiting for the whole file to upload and the server to reject it.
// If MAX_UPLOAD_MB is changed on the server, update this to match.
const MAX_UPLOAD_MB = 25;
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

const MENTION_RE = /@([a-zA-Z0-9_ ]{0,24})$/;

function findChannel(categories, channels, channelId) {
  const all = [...channels, ...categories.flatMap((c) => c.channels)];
  return all.find((c) => c.id === channelId) || null;
}

export default function ChatWindow({ kind }) {
  const params = useParams();
  const conversationId = kind === 'conversation' ? params.conversationId : null;
  const channelId = kind === 'channel' ? params.channelId : null;
  const roomKey = roomKeyFor({ conversationId, channelId });

  const { user } = useAuth();
  const { socket } = useSocket();
  const voice = useVoice();
  // Kept in the store purely so SocketContext.jsx's `message:new` handler
  // can tell "is this message for the exact channel/DM I'm already looking
  // at right now?" and skip the notification sound for it — without this,
  // every incoming message played a sound even while its own conversation
  // was open and on-screen. Cleared on unmount so switching away (closing
  // the app, going back to the server list) doesn't leave a stale id behind
  // that would wrongly keep suppressing sounds for a channel you've left.
  const setActiveChannel = useStore((s) => s.setActiveChannel);
  const setActiveConversation = useStore((s) => s.setActiveConversation);
  useEffect(() => {
    if (channelId) setActiveChannel(channelId);
    else if (conversationId) setActiveConversation(conversationId);
    return () => {
      if (channelId) setActiveChannel(null);
      else if (conversationId) setActiveConversation(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId, conversationId]);
  const messages = useStore((s) => s.messagesByRoom[roomKey] || []);
  // Every message whose replyToId points at another message *and* carries a
  // title is a topic/thread root (see Message.jsx's "Criar tópico" action) —
  // grouped by parent so each parent message can show its own topic pills.
  const topicsByParent = useMemo(() => {
    const map = new Map();
    messages.forEach((mm) => {
      if (mm.title && mm.replyToId) {
        if (!map.has(mm.replyToId)) map.set(mm.replyToId, []);
        map.get(mm.replyToId).push(mm);
      }
    });
    return map;
  }, [messages]);
  const setRoomMessages = useStore((s) => s.setRoomMessages);
  const typingUserIds = useStore((s) => s.typing[roomKey] || []);
  const conversations = useStore((s) => s.conversations);
  const categories = useStore((s) => s.categories);
  const channels = useStore((s) => s.channels);
  const members = useStore((s) => s.members);
  const roles = useStore((s) => s.roles);
  const markConversationReadLocal = useStore((s) => s.markConversationReadLocal);
  const markChannelReadLocal = useStore((s) => s.markChannelReadLocal);

  const [content, setContent] = useState('');
  const [files, setFiles] = useState([]);
  const [replyTo, setReplyTo] = useState(null);
  // Item pedido ("pulinho" ao mandar mensagem): a barra de "respondendo
  // a" e a de anexos pendentes somem instantaneamente quando a mensagem
  // é enviada (o estado zera na hora) — sem transição nenhuma, o resto
  // do campo de digitação e a lista de mensagens acima dela pulam de
  // repente pro lugar novo. `replyToVisible`/`filesVisible` copiam o
  // valor real, mas com um pequeno atraso só na hora de SUMIR — dá
  // tempo da transição de CSS (ver .reply-bar/.pending-files no
  // global.css) encolher suavemente antes do elemento realmente deixar
  // de existir, em vez de piscar sumido na hora.
  const [replyToVisible, setReplyToVisible] = useState(null);
  const [filesVisible, setFilesVisible] = useState([]);
  const [replyBarLeaving, setReplyBarLeaving] = useState(false);
  const [filesBarLeaving, setFilesBarLeaving] = useState(false);
  useEffect(() => {
    if (replyTo) {
      setReplyToVisible(replyTo);
      setReplyBarLeaving(false);
    } else if (replyToVisible) {
      setReplyBarLeaving(true);
      const t = setTimeout(() => { setReplyToVisible(null); setReplyBarLeaving(false); }, 150);
      return () => clearTimeout(t);
    }
  }, [replyTo]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (files.length > 0) {
      setFilesVisible(files);
      setFilesBarLeaving(false);
    } else if (filesVisible.length > 0) {
      setFilesBarLeaving(true);
      const t = setTimeout(() => { setFilesVisible([]); setFilesBarLeaving(false); }, 150);
      return () => clearTimeout(t);
    }
  }, [files]); // eslint-disable-line react-hooks/exhaustive-deps
  const [searchOpen, setSearchOpen] = useState(false);
  const [groupSettingsOpen, setGroupSettingsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  usePopoverCoordination(emojiPickerOpen, () => setEmojiPickerOpen(false));
  const [openTopic, setOpenTopic] = useState(null);
  const [pollComposerOpen, setPollComposerOpen] = useState(false);
  const [gifPickerOpen, setGifPickerOpen] = useState(false);
  usePopoverCoordination(gifPickerOpen, () => setGifPickerOpen(false));
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState(null); // null = not showing; '' or partial name otherwise
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const typingTimeoutRef = useRef(null);
  const bottomRef = useRef(null);
  const chatListRef = useRef(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMoreOlder, setHasMoreOlder] = useState(true);
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const recordedChunksRef = useRef([]);
  const recordStreamRef = useRef(null);
  const recordTimerRef = useRef(null);

  const channel = channelId ? findChannel(categories, channels, channelId) : null;
  // Who you're actually talking to, for the small avatar+status shown next
  // to the title in a DM header — same "other member" lookup DMSidebar.jsx
  // uses for its own rows, just scoped to whichever conversation is open.
  const dmConvo = conversationId ? conversations.find((c) => c.id === conversationId) : null;
  const dmOther = dmConvo && !dmConvo.isGroup ? dmConvo.members.find((m) => m.id !== user.id) : null;
  const dmOtherPresence = useStore((s) => (dmOther ? s.presence[dmOther.id] : null));
  const myPerms = getMyCommunityPermissions(roles, members, user.id, user.platformRole);
  const canMentionEveryone = channel && hasPermission(myPerms, 'MENTION_EVERYONE');
  const mentionCandidates = channel
    ? [
        ...(canMentionEveryone ? [{ id: '@everyone', label: 'everyone', hint: 'Notificar todos no canal' }, { id: '@here', label: 'here', hint: 'Notificar quem está online' }] : []),
        ...roles
          .filter((r) => !r.isDefault && r.mentionable)
          .map((r) => ({ id: `role:${r.id}`, label: r.name, hint: 'Cargo' })),
        ...members
          .map((m) => ({ id: m.user.id, label: m.user.displayName, hint: `@${m.user.username}` })),
      ].filter((c) => !mentionQuery || c.label.toLowerCase().includes(mentionQuery.toLowerCase())).slice(0, 8)
    : [];

  const title = useMemo(() => {
    if (conversationId) {
      const convo = conversations.find((c) => c.id === conversationId);
      if (!convo) return '';
      if (convo.isGroup) return convo.name || convo.members.map((m) => m.displayName).join(', ');
      const other = convo.members.find((m) => m.id !== user.id);
      return other?.displayName || '';
    }
    if (channel) {
      const icon = TYPE_ICON[channel.type] || '#';
      return `${icon} ${channel.name}`;
    }
    return '';
  }, [conversationId, channel, conversations, user.id]);

  const markRead = () => {
    if (conversationId) {
      markConversationRead(conversationId).catch(() => {});
      markConversationReadLocal(conversationId);
    } else if (channelId) {
      markChannelRead(channelId).catch(() => {});
      markChannelReadLocal(channelId);
    }
  };

  const isCallChannel = channel && (channel.type === 'VOICE' || channel.type === 'STAGE');
  const isNonChatChannel = isCallChannel || channel?.type === 'RULES';

  useEffect(() => {
    if (isNonChatChannel) return;
    setRoomMessages(roomKey, []);
    setHasMoreOlder(true);
    listMessages({ conversationId, channelId }).then((d) => {
      setRoomMessages(roomKey, d.messages);
      if (d.messages.length < 50) setHasMoreOlder(false);
    });
    if (socket && channelId) socket.emit('channel:join', channelId);
    if (socket && conversationId) socket.emit('conversation:join', conversationId);
    markRead();
  }, [roomKey, isNonChatChannel]);

  // Loads an older page (see the existing `before` cursor support already
  // in messageController.listMessages on the server — this used to just
  // never be called from anywhere, so scrolling up never revealed
  // anything past the most recent 50 messages). Preserves scroll position
  // by measuring how much taller the list got and offsetting scrollTop by
  // exactly that, so prepending older messages doesn't yank the view.
  const loadOlderMessages = async () => {
    if (loadingOlder || !hasMoreOlder || messages.length === 0 || isNonChatChannel) return;
    const list = chatListRef.current;
    const prevScrollHeight = list?.scrollHeight || 0;
    setLoadingOlder(true);
    try {
      const d = await listMessages({ conversationId, channelId, before: messages[0].createdAt });
      if (d.messages.length === 0) { setHasMoreOlder(false); return; }
      if (d.messages.length < 50) setHasMoreOlder(false);
      useStore.getState().prependRoomMessages(roomKey, d.messages);
      // Runs after the prepended messages have actually painted, so
      // scrollHeight reflects the new (taller) content.
      requestAnimationFrame(() => {
        if (list) list.scrollTop += list.scrollHeight - prevScrollHeight;
      });
    } finally {
      setLoadingOlder(false);
    }
  };

  useEffect(() => {
    const list = chatListRef.current;
    if (!list) return undefined;
    const onScroll = () => {
      if (list.scrollTop < 60) loadOlderMessages();
      // Manual scrolling is what actually decides whether we keep following
      // new messages — scrolling away from the bottom releases the pin
      // (matches the existing "don't yank them back down mid-read"
      // behavior above), scrolling back down near it re-engages auto-scroll.
      const distanceFromBottom = list.scrollHeight - list.scrollTop - list.clientHeight;
      stickToBottomRef.current = distanceFromBottom <= 120;
    };
    list.addEventListener('scroll', onScroll);
    return () => list.removeEventListener('scroll', onScroll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomKey, loadingOlder, hasMoreOlder, messages]);

  const hasInitializedScrollRef = useRef(false);
  // Whether we should keep the view pinned to the newest message. Starts
  // `true` on every fresh room open (so it opens on the latest messages,
  // never wherever the previous channel happened to be scrolled) and only
  // flips to `false` once the person deliberately scrolls up to read
  // something older — set from the scroll handler below, not from message
  // updates, so a burst of incoming messages can't fight a person who's
  // mid-read.
  const stickToBottomRef = useRef(true);
  useEffect(() => {
    hasInitializedScrollRef.current = false;
    stickToBottomRef.current = true;
  }, [roomKey]);

  useEffect(() => {
    if (isNonChatChannel) return;
    // The room-switch effect above clears messages to `[]` while the new
    // page is fetched (see the `setRoomMessages(roomKey, [])` call), which
    // used to run through this same effect and consume the "first render
    // of this room" flag on an empty list — before any real messages, let
    // alone their final layout, existed. That left the *next* run (the one
    // with the actual 50 messages) mistakenly treated as a follow-up
    // scroll-position check instead of a fresh room open, computed against
    // a stale scrollTop still left over from whatever channel was open
    // before. Skipping the empty transient here means the flag only gets
    // consumed once there's something real to scroll to.
    if (messages.length === 0) return;
    const list = chatListRef.current;
    const distanceFromBottom = list ? list.scrollHeight - list.scrollTop - list.clientHeight : 0;
    const shouldAutoScroll = !hasInitializedScrollRef.current || stickToBottomRef.current || distanceFromBottom <= 120;
    hasInitializedScrollRef.current = true;
    if (shouldAutoScroll) {
      stickToBottomRef.current = true;
      bottomRef.current?.scrollIntoView({ block: 'end' });
    }
    // A new message arrived while this room is open — count it as read too.
    markRead();
  }, [messages.length, isNonChatChannel]);

  // Attachments, images, embeds and link previews inside messages finish
  // loading after this initial paint and can grow the list's height —
  // without this, opening a channel could visually land a few pixels short
  // of the true bottom once a late-loading image pushes new content below
  // the fold. Re-pins to the bottom whenever the list's height changes
  // while we're still supposed to be stuck to it, so the "latest messages"
  // guarantee holds even for content that loads in asynchronously.
  useEffect(() => {
    const list = chatListRef.current;
    if (!list || isNonChatChannel || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => {
      if (stickToBottomRef.current) bottomRef.current?.scrollIntoView({ block: 'end' });
    });
    observer.observe(list);
    return () => observer.disconnect();
  }, [roomKey, isNonChatChannel]);

  const notifyTyping = () => {
    socket?.emit('typing:start', { conversationId, channelId });
    clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      socket?.emit('typing:stop', { conversationId, channelId });
    }, TYPING_TIMEOUT);
  };

  const onContentChange = (value) => {
    setContent(value);
    notifyTyping();
    const m = value.match(MENTION_RE);
    setMentionQuery(m ? m[1] : null);
  };

  const insertText = (text) => {
    setContent((c) => `${c}${text} `);
    inputRef.current?.focus();
  };

  // Shared by both attach buttons (and the audio recorder below) — rejects
  // anything over the size limit right away instead of letting it upload
  // and fail on the server after the fact.
  const addFiles = (incoming) => {
    const tooBig = incoming.filter((f) => f.size > MAX_UPLOAD_BYTES);
    const ok = incoming.filter((f) => f.size <= MAX_UPLOAD_BYTES);
    if (tooBig.length > 0) {
      useStore.getState().pushNotice(
        tooBig.length === 1
          ? `"${tooBig[0].name}" é maior que ${MAX_UPLOAD_MB}MB e não foi anexado.`
          : `${tooBig.length} arquivos maiores que ${MAX_UPLOAD_MB}MB não foram anexados.`,
      );
    }
    if (ok.length > 0) setFiles((f) => [...f, ...ok]);
  };

  // --- Voice message recording ---
  const startRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      useStore.getState().pushNotice('Gravar áudio não é suportado neste navegador.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordStreamRef.current = stream;
      recordedChunksRef.current = [];
      // Not every browser supports every mime type — let the browser pick
      // its own default (undefined options) if webm/opus isn't available,
      // rather than throwing on construction.
      const mimeType = MediaRecorder.isTypeSupported?.('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : undefined;
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunksRef.current.push(e.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        recordStreamRef.current = null;
        const blob = new Blob(recordedChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        if (blob.size > 0) {
          const ext = (recorder.mimeType || 'audio/webm').includes('ogg') ? 'ogg' : 'webm';
          const file = new File([blob], `audio-${Date.now()}.${ext}`, { type: blob.type });
          addFiles([file]);
        }
      };
      recorder.start();
      setRecording(true);
      setRecordSeconds(0);
      recordTimerRef.current = setInterval(() => setRecordSeconds((s) => s + 1), 1000);
    } catch (err) {
      useStore.getState().pushNotice('Não foi possível acessar o microfone.');
    }
  };

  const stopRecording = (discard) => {
    clearInterval(recordTimerRef.current);
    setRecording(false);
    setRecordSeconds(0);
    if (discard) recordedChunksRef.current = [];
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      if (discard) recorder.onstop = () => { recordStreamRef.current?.getTracks().forEach((t) => t.stop()); recordStreamRef.current = null; };
      recorder.stop();
    }
  };

  useEffect(() => () => {
    clearInterval(recordTimerRef.current);
    recordStreamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  const pickMention = (candidate) => {
    setContent((c) => c.replace(MENTION_RE, `@${candidate.label} `));
    setMentionQuery(null);
    inputRef.current?.focus();
  };

  // Builds a placeholder message shown immediately in the list, before the
  // server round-trip finishes — see `resolveOptimisticMessage` in the store
  // for how it gets swapped for the real one (or dropped if the real-time
  // socket echo beats the HTTP response back).
  const makeOptimisticMessage = (overrides) => ({
    id: `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    authorId: user.id,
    author: user,
    conversationId: conversationId || null,
    channelId: channelId || null,
    replyToId: null,
    replyTo: null,
    title: null,
    attachments: [],
    reactions: [],
    mentions: [],
    createdAt: new Date().toISOString(),
    edited: false,
    pinned: false,
    pending: true,
    ...overrides,
  });

  const sendGif = async (url) => {
    setGifPickerOpen(false);
    const fd = new FormData();
    if (conversationId) fd.append('conversationId', conversationId);
    if (channelId) fd.append('channelId', channelId);
    fd.append('content', url);

    const optimistic = makeOptimisticMessage({ content: url });
    useStore.getState().addMessage(roomKey, optimistic);
    try {
      const { message } = await sendMessage(fd);
      useStore.getState().resolveOptimisticMessage(roomKey, optimistic.id, message);
    } catch (err) {
      useStore.getState().failOptimisticMessage(roomKey, optimistic.id);
    }
  };

  // A sticker isn't inserted as text like an emoji shortcode — it's sent as
  // its own standalone message right away, via the dedicated Message.stickerUrl
  // field (small, chrome-free — deliberately NOT the embed system GIFs/rich
  // links use, see Message.jsx), no new upload needed since the sticker's
  // image already lives on the server (see StickerManagerModal.jsx).
  const sendSticker = async (sticker) => {
    setEmojiPickerOpen(false);
    const fd = new FormData();
    if (conversationId) fd.append('conversationId', conversationId);
    if (channelId) fd.append('channelId', channelId);
    fd.append('stickerUrl', sticker.url);

    const optimistic = makeOptimisticMessage({ content: null, stickerUrl: sticker.url });
    useStore.getState().addMessage(roomKey, optimistic);
    try {
      const { message } = await sendMessage(fd);
      useStore.getState().resolveOptimisticMessage(roomKey, optimistic.id, message);
    } catch (err) {
      useStore.getState().failOptimisticMessage(roomKey, optimistic.id);
    }
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!content.trim() && files.length === 0) return;
    const trimmedContent = content.trim();
    const pendingFiles = files;
    const pendingReplyTo = replyTo;

    const fd = new FormData();
    if (conversationId) fd.append('conversationId', conversationId);
    if (channelId) fd.append('channelId', channelId);
    if (trimmedContent) fd.append('content', trimmedContent);
    if (pendingReplyTo) fd.append('replyToId', pendingReplyTo.id);
    pendingFiles.forEach((f) => fd.append('attachments', f));

    setContent('');
    setFiles([]);
    setReplyTo(null);
    socket?.emit('typing:stop', { conversationId, channelId });

    // Attachments still need to upload, so there's nothing real to show yet
    // for those — but text sends instantly, which is the common case.
    const optimistic = makeOptimisticMessage({
      content: trimmedContent || (pendingFiles.length ? `Enviando ${pendingFiles.length} arquivo(s)...` : null),
      replyToId: pendingReplyTo?.id || null,
      replyTo: pendingReplyTo || null,
    });
    useStore.getState().addMessage(roomKey, optimistic);

    try {
      const { message } = await sendMessage(fd);
      useStore.getState().resolveOptimisticMessage(roomKey, optimistic.id, message);
    } catch (err) {
      useStore.getState().failOptimisticMessage(roomKey, optimistic.id);
      const serverMsg = err?.response?.data?.error;
      if (serverMsg) useStore.getState().pushNotice(serverMsg);
    }
  };

  const runSearch = async (e) => {
    e.preventDefault();
    const { messages } = await searchMessages({ conversationId, channelId, q: searchQuery });
    setSearchResults(messages);
  };

  if (isCallChannel) {
    return (
      <section className="chat-window">
        {channelId && <ChannelSwitcher currentChannelId={channelId} />}
        <header className="chat-header">
          <div className="chat-title-block">
            <span className="chat-title truncate">{title}</span>
          </div>
          <MembersToggleButton />
        </header>
        <ErrorBoundary compact>
          <VoiceChannelView channel={channel} />
        </ErrorBoundary>
      </section>
    );
  }

  if (channel?.type === 'RULES') {
    return (
      <section className="chat-window">
        {channelId && <ChannelSwitcher currentChannelId={channelId} />}
        <header className="chat-header">
          <div className="chat-title-block">
            <span className="chat-title truncate">{title}</span>
          </div>
          <MembersToggleButton />
        </header>
        <RulesChannelView channel={channel} />
      </section>
    );
  }

  let lastAuthor = null;
  let lastTime = 0;

  return (
    <section className="chat-window">
      {channelId && <ChannelSwitcher currentChannelId={channelId} />}
      <header className="chat-header">
        {dmOther && (
          <div className="avatar-wrap small chat-header-avatar">
            <div className="avatar small" style={{ background: dmOther.profileColor || '#F2894D' }}>
              {dmOther.avatarUrl ? <HeaderAvatarImg url={dmOther.avatarUrl} /> : title[0]?.toUpperCase()}
            </div>
            <span className="status-dot" style={{ background: STATUS_COLOR[dmOtherPresence?.status || dmOther.status || 'OFFLINE'] }} />
          </div>
        )}
        {dmConvo?.isGroup && (
          <button className="chat-header-avatar clickable icon-btn" title="Configurações do grupo" onClick={() => setGroupSettingsOpen(true)}>
            <ConversationIcon conversation={dmConvo} size="small" />
          </button>
        )}
        <div className="chat-title-block">
          <span className="chat-title truncate">{title}</span>
        </div>
        <button className="icon-btn" onClick={() => setSearchOpen((v) => !v)} title="Buscar mensagens"><img className="ui-icon" src={searchIcon} alt="" /></button>
        {conversationId && (
          <button
            className={`icon-btn ${voice.call?.channelId === `dm:${conversationId}` ? 'on' : ''}`}
            title={voice.call?.channelId === `dm:${conversationId}` ? 'Você está nesta chamada' : 'Ligar'}
            onClick={() => {
              if (voice.call?.channelId === `dm:${conversationId}`) return;
              voice.joinChannel(null, `dm:${conversationId}`, title, 'DM');
            }}
          >
            <img className="ui-icon" src={phoneIcon} alt="" />
          </button>
        )}
        {channelId && <MembersToggleButton />}
        {conversationId && <MembersToggleButton title="Perfil" />}
      </header>

      {searchOpen && (
        <div className="search-panel">
          <form onSubmit={runSearch}>
            <input placeholder="Buscar mensagens..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} autoFocus />
          </form>
          <ul>
            {searchResults.map((m) => (
              <li key={m.id}><b>{m.author.displayName}:</b> {m.content}</li>
            ))}
          </ul>
        </div>
      )}

      {channel?.ticket && (channel.ticket.bannerImageUrl || channel.ticket.welcomeText) && (
        <TicketChannelBanner ticket={channel.ticket} />
      )}

      <div className="message-list" ref={chatListRef}>
        {loadingOlder && <div className="message-list-loading-older dim">Carregando mensagens antigas...</div>}
        {messages.map((m) => {
          const showAuthor = m.authorId !== lastAuthor || new Date(m.createdAt) - lastTime > 5 * 60 * 1000;
          lastAuthor = m.authorId;
          lastTime = new Date(m.createdAt);
          return (
            <Message
              key={m.id}
              message={m}
              showAuthor={showAuthor}
              onReply={setReplyTo}
              topics={topicsByParent.get(m.id) || []}
              onOpenTopic={setOpenTopic}
            />
          );
        })}
        <div ref={bottomRef} />
      </div>

      {openTopic && (
        <TopicThreadModal
          channel={channel}
          rootMessage={messages.find((m) => m.id === openTopic.id) || openTopic}
          onClose={() => setOpenTopic(null)}
        />
      )}
      {pollComposerOpen && (
        <PollComposerModal
          channelId={channel?.id}
          conversationId={conversationId}
          onClose={() => setPollComposerOpen(false)}
        />
      )}
      {groupSettingsOpen && dmConvo?.isGroup && (
        <GroupSettingsModal conversation={dmConvo} onClose={() => setGroupSettingsOpen(false)} />
      )}

      {typingUserIds.filter((id) => id !== user.id).length > 0 && (
        <div className="typing-indicator">Alguém está digitando...</div>
      )}

      {!!channel?.slowModeSeconds && (
        <div className="slow-mode-hint" title="Modo lento ativo neste canal">
          🐢 Modo lento: {formatSlowModeDuration(channel.slowModeSeconds)} entre mensagens
        </div>
      )}

      <form className="message-input-bar" onSubmit={onSubmit}>
        {replyToVisible && (
          <div className={`reply-bar ${replyBarLeaving ? 'leaving' : ''}`}>
            Respondendo a <b>{replyToVisible.author.displayName}</b>
            <button type="button" className="icon-btn-small" onClick={() => setReplyTo(null)}><img className="ui-icon-sm" src={cancelIcon} alt="x" /></button>
          </div>
        )}
        {filesVisible.length > 0 && (
          <div className={`pending-files ${filesBarLeaving ? 'leaving' : ''}`}>
            {filesVisible.map((f, i) => (
              <span key={i} className="chip">{f.name} <button type="button" onClick={() => setFiles(files.filter((_, idx) => idx !== i))}><img className="ui-icon-sm" src={cancelIcon} alt="x" /></button></span>
            ))}
          </div>
        )}
        {mentionQuery !== null && mentionCandidates.length > 0 && (
          <div className="mention-autocomplete">
            {mentionCandidates.map((c) => (
              <button key={c.id} type="button" onClick={() => pickMention(c)}>
                <span className="mention-autocomplete-name">@{c.label}</span>
                <span className="dim">{c.hint}</span>
              </button>
            ))}
          </div>
        )}
        {recording && (
          <div className="reply-bar recording-bar">
            <span className="recording-dot" /> Gravando áudio... {formatDuration(recordSeconds)}
            <button type="button" className="icon-btn-small" title="Cancelar" onClick={() => stopRecording(true)}><img className="ui-icon-sm" src={cancelIcon} alt="x" /></button>
            <button type="button" className="icon-btn-small" title="Concluir e anexar" onClick={() => stopRecording(false)}><img className="ui-icon-sm" src={selectedIcon} alt="" /></button>
          </div>
        )}
        <div className="message-input-row">
          <input
            ref={fileInputRef}
            type="file" multiple hidden
            onChange={(e) => { addFiles(Array.from(e.target.files)); e.target.value = ''; }}
          />
          <div className="composer-picker-anchor">
            <button type="button" className="icon-btn attach-plus-btn" title="Adicionar" onClick={() => setAttachMenuOpen((v) => !v)}><img className="ui-icon" src={plusIcon} alt="+" /></button>
            {attachMenuOpen && (
              <div className="attach-menu">
                <button type="button" onClick={() => { fileInputRef.current?.click(); setAttachMenuOpen(false); }}>
                  <img className="ui-icon-sm" src={documentIcon} alt="" /> Enviar arquivos
                </button>
                {channel && hasPermission(myPerms, 'CREATE_POLLS') && (
                  <button type="button" onClick={() => { setPollComposerOpen(true); setAttachMenuOpen(false); }}>
                    📊 Criar enquete
                  </button>
                )}
              </div>
            )}
          </div>
          <button
            type="button"
            className={`icon-btn ${recording ? 'danger-toggle' : ''}`}
            title={recording ? 'Parar gravação' : 'Gravar áudio'}
            onClick={() => (recording ? stopRecording(false) : startRecording())}
          >
            <img className="ui-icon" src={micIcon} alt="" />
          </button>
          <input
            ref={inputRef}
            className="message-input"
            placeholder={`Conversar em ${title || ''}`}
            value={content}
            onChange={(e) => onContentChange(e.target.value)}
          />
          <div className="composer-picker-anchor">
            <button type="button" className="icon-btn" title="GIF" onClick={() => { setGifPickerOpen((v) => !v); setEmojiPickerOpen(false); }}>GIF</button>
            {gifPickerOpen && <GifPicker onPick={sendGif} onClose={() => setGifPickerOpen(false)} />}
          </div>
          <div className="composer-picker-anchor">
            <button type="button" className="icon-btn" title="Emoji" onClick={() => { setEmojiPickerOpen((v) => !v); setGifPickerOpen(false); }}>☺</button>
            {emojiPickerOpen && createPortal(
              <EmojiPicker
                variant="composer-centered"
                onPick={insertText}
                onPickSticker={sendSticker}
                onClose={() => setEmojiPickerOpen(false)}
              />,
              document.body,
            )}
          </div>
          <button type="submit" className="icon-btn send-btn" title="Enviar">➤</button>
        
        </div>
      </form>
    </section>
  );
}

function formatDuration(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Readable label for the slow-mode hint above the composer (e.g. "30
// segundos", "2 minutos", "1 hora") — same duration list as
// EditChannelModal.jsx's SLOW_MODE_OPTIONS, just formatted for a sentence
// instead of a dropdown.
function formatSlowModeDuration(totalSeconds) {
  if (totalSeconds < 60) return `${totalSeconds} segundo${totalSeconds === 1 ? '' : 's'}`;
  if (totalSeconds < 3600) {
    const m = Math.round(totalSeconds / 60);
    return `${m} minuto${m === 1 ? '' : 's'}`;
  }
  const h = Math.round(totalSeconds / 3600);
  return `${h} hora${h === 1 ? '' : 's'}`;
}

// Persistent header shown at the top of a ticket's own channel — a snapshot
// (see Ticket.bannerImageUrl's schema comment) of whatever banner/text the
// ticket was opened with, taken once at creation and never re-derived from
// the option/settings afterwards. Lives here instead of as a chat Message
// because a Message needs a real author, and authoring it as the ticket's
// opener made every new ticket look like the member had written themselves
// a welcome note.
function TicketChannelBanner({ ticket }) {
  return (
    <div className="ticket-channel-banner">
      {ticket.bannerImageUrl && <img src={ticket.bannerImageUrl} alt="" />}
      {ticket.welcomeText && <p>{ticket.welcomeText}</p>}
    </div>
  );
}
