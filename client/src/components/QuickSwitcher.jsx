import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useStore, isChannelUnread, isConversationUnread, useMyRoleIds } from '../store/useStore';
import { useAuth } from '../context/AuthContext.jsx';
import { useVoice } from '../context/VoiceContext.jsx';
import UserAvatar from './UserAvatar.jsx';
import PresenceDot from './PresenceDot.jsx';
import NavIcon from './NavIcons.jsx';
import { CustomIcon, hasCustomIcon } from './ChannelIcon.jsx';
import '../styles/nav.css';

// Ctrl+K / Cmd+K quick-jump palette - search across every channel in the
// server you're currently in, plus every DM/group conversation, and jump
// straight there. Adapted from an idea in a Discord-clone reference project
// the user shared (that one used cmdk + Next.js routing; this is the same
// concept rebuilt on this app's own Modal/react-router-dom setup rather
// than pulling in a new UI library for one feature).
//
// Versão nova: também acha canais de voz, pessoas (membros/amigos),
// páginas do app e seções de Configurações; mostra os recentes quando a
// busca está vazia; prefixos # (canais), ! (voz), @ (pessoas), > (páginas).
// Abre pelo atalho ou pelo botão da barra do topo (quickSwitcherOpen).

const VOICE_TYPES = ['VOICE', 'STAGE'];
const RECENT_MAX = 6;
const GROUP_LIMIT = 6;

const PAGES = [
  { path: '/inicio', label: 'Início', keywords: 'home novidades destaques' },
  { path: '/', label: 'Comunidade', keywords: 'chat canais servidor' },
  { path: '/comunidades', label: 'Fórum', keywords: 'forum fórum feed feeds posts temas' },
  { path: '/dms', label: 'Social', keywords: 'amigos mensagens clubes dm' },
  { path: '/jogos', label: 'Apps', keywords: 'jogos aplicativos' },
  { path: '/jogos/mods', label: 'Mods', keywords: 'modpacks jogos instalar' },
  { path: '/progresso', label: 'Progresso', keywords: 'ranks conquistas recompensas nível xp' },
  { path: '/tickets', label: 'Suporte', keywords: 'ajuda tickets denúncia' },
  { path: '/notifications', label: 'Notificações', keywords: 'avisos sino' },
  { path: '/search', label: 'Busca', keywords: 'procurar pesquisar' },
  { path: '/comunidade/eventos', label: 'Eventos', keywords: 'agenda calendário' },
  { path: '/comunidade/galeria', label: 'Galeria', keywords: 'fotos imagens mídia' },
  { path: '/economia', label: 'Economia', keywords: 'moedas loja' },
  { path: '/casas', label: 'Casas', keywords: 'casa' },
  { path: '/figurinhas', label: 'Figurinhas', keywords: 'stickers álbum' },
  { path: '/admin', label: 'Painel da staff', keywords: 'admin moderação', staff: true },
];

const SETTINGS_TABS = [
  ['PROFILE', 'perfil avatar banner bio'], ['MINI_PROFILE', 'mini perfil cartão'], ['PROFILE_CONTENT', 'perfil completo enquetes álbum'],
  ['COLUMNS', 'colunas perfil'], ['ACCOUNT', 'conta email usuário'], ['SECURITY', 'senha 2fa segurança sessões'],
  ['ACCOUNT_STATUS', 'status conta'], ['PRIVACY', 'privacidade dados dm'], ['NOTIFICATIONS', 'notificações sons avisos'],
  ['VOICE', 'voz vídeo microfone áudio'], ['APPEARANCE', 'aparência tema layout cores'], ['ACCESSIBILITY', 'acessibilidade movimento'],
  ['SYSTEM', 'sistema desenvolvedor'], ['LANGUAGE', 'idioma horário língua'], ['GAMES', 'jogos apps atividade'],
];

function norm(s) {
  return (s || '').toString().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// Pontuação simples: começo do nome > começo de palavra > contém > letras em ordem.
function scoreOf(q, label, extra = '') {
  if (!q) return 1;
  const l = norm(label);
  if (l === q) return 10;
  if (l.startsWith(q)) return 8;
  if (l.split(/[\s\-_/·]+/).some((w) => w.startsWith(q))) return 6;
  if (l.includes(q)) return 5;
  const e = norm(extra);
  if (e && e.split(/\s+/).some((w) => w.startsWith(q))) return 3;
  let i = 0;
  for (const ch of l) { if (ch === q[i]) i += 1; if (i === q.length) return 1; }
  return 0;
}

function readRecent(userId) {
  try { return JSON.parse(localStorage.getItem(`quickSwitcherRecent:${userId}`) || '[]'); } catch { return []; }
}
function writeRecent(userId, keys) {
  try { localStorage.setItem(`quickSwitcherRecent:${userId}`, JSON.stringify(keys)); } catch { /* sem localStorage */ }
}

// Abre Configurações já na seção escolhida: o modal sempre abre no
// Perfil, então espera ele montar e clica no item certo da barra dele.
function openSettingsAt(label) {
  useStore.getState().openSettings();
  let tries = 0;
  const tick = () => {
    tries += 1;
    const btn = [...document.querySelectorAll('.settings-modal-sidebar-item')].find((b) => b.textContent.trim().endsWith(label));
    if (btn) { btn.click(); return; }
    if (tries < 40) setTimeout(tick, 75);
  };
  setTimeout(tick, 60);
}

export default function QuickSwitcher() {
  const open = useStore((s) => s.quickSwitcherOpen);
  const setOpen = useStore((s) => s.setQuickSwitcherOpen);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const categories = useStore((s) => s.categories);
  const channels = useStore((s) => s.channels);
  const conversations = useStore((s) => s.conversations);
  const members = useStore((s) => s.members);
  const friends = useStore((s) => s.friends);
  const presence = useStore((s) => s.presence);
  const channelReadAt = useStore((s) => s.channelReadAt);
  const { user } = useAuth();
  const myRoleIds = useMyRoleIds(user.id);
  const voice = useVoice();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const listRef = useRef(null);
  const [recentKeys, setRecentKeys] = useState(() => readRecent(user.id));

  useEffect(() => {
    const onKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === 'Escape' && useStore.getState().quickSwitcherOpen) setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [setOpen]);

  useEffect(() => {
    if (open) { setQuery(''); setActiveIndex(0); setRecentKeys(readRecent(user.id)); }
  }, [open, user.id]);

  // Todos os itens pesquisáveis, cada um com uma chave estável (pros recentes).
  const allItems = useMemo(() => {
    const items = [];
    const isStaff = user?.platformRole === 'ADMIN' || user?.platformRole === 'MODERATOR';
    const sections = [{ name: null, channels }, ...categories.map((c) => ({ name: c.name, channels: c.channels || [] }))];
    sections.forEach((sec) => sec.channels.forEach((c) => {
      const isVoice = VOICE_TYPES.includes(c.type);
      const roster = isVoice ? (voice?.roster?.[c.id] || []) : [];
      items.push({
        key: `${isVoice ? 'voice' : 'channel'}:${c.id}`,
        kind: isVoice ? 'voice' : 'channel',
        label: c.name,
        sub: isVoice ? (roster.length ? `${roster.length} na sala${sec.name ? ` · ${sec.name}` : ''}` : (sec.name || 'Canal de voz')) : (sec.name || 'Canal'),
        icon: hasCustomIcon(c) ? <CustomIcon item={c} className="qs-custom-icon" /> : <NavIcon name={isVoice ? 'voice' : 'hash'} size={17} />,
        unread: !isVoice && isChannelUnread(c, channelReadAt, user.id, myRoleIds),
        mentions: c.unreadMentions || 0,
        go: () => navigate(`/channels/${c.id}`),
      });
    }));

    conversations.forEach((c) => {
      const other = !c.isGroup ? c.members.find((m) => m.id !== user.id) : null;
      const name = c.isGroup ? (c.name || c.members.map((m) => m.displayName).join(', ')) : other?.displayName;
      items.push({
        key: `dm:${c.id}`, kind: 'dm', label: name || 'Conversa',
        sub: c.isGroup ? `Grupo · ${c.members.length} pessoas` : `Mensagem direta${other?.username ? ` · @${other.username}` : ''}`,
        keywords: other?.username,
        avatarUser: other || null,
        status: other ? (presence[other.id]?.status || other.status) : null,
        icon: c.isGroup ? <NavIcon name="chat" size={17} /> : null,
        unread: isConversationUnread(c, user.id),
        go: () => navigate(`/conversations/${c.id}`),
      });
    });

    const people = new Map();
    members.forEach((m) => { if (m.user && m.user.id !== user.id) people.set(m.user.id, { u: m.user, friend: false }); });
    friends.filter((f) => f.status === 'ACCEPTED' && f.user).forEach((f) => {
      people.set(f.user.id, { u: { ...(people.get(f.user.id)?.u || {}), ...f.user }, friend: true });
    });
    people.forEach(({ u, friend }) => {
      items.push({
        key: `user:${u.id}`, kind: 'user', label: u.displayName || u.username,
        sub: `${u.username ? `@${u.username}` : ''}${friend ? ' · Amigo' : ''}`,
        keywords: u.username,
        avatarUser: u,
        status: presence[u.id]?.status || u.status || 'OFFLINE',
        go: () => useStore.getState().openProfile(u.id),
      });
    });

    PAGES.filter((p) => !p.staff || isStaff).forEach((p) => {
      items.push({ key: `page:${p.path}`, kind: 'page', label: p.label, sub: 'Página', keywords: p.keywords, icon: <NavIcon name="page" size={17} />, go: () => navigate(p.path) });
    });
    SETTINGS_TABS.forEach(([id, kw]) => {
      const label = t(`settings.tabs.${id}`);
      items.push({ key: `settings:${id}`, kind: 'settings', label, sub: 'Configurações', keywords: `configurações ajustes ${kw}`, icon: <NavIcon name="gear" size={17} />, go: () => openSettingsAt(label) });
    });
    return items;
  }, [categories, channels, conversations, members, friends, presence, channelReadAt, myRoleIds, voice?.roster, user, navigate, t]);

  const groups = useMemo(() => {
    let raw = query.trim();
    let only = null;
    const prefix = raw[0];
    if (prefix === '#') only = ['channel'];
    else if (prefix === '!') only = ['voice'];
    else if (prefix === '@') only = ['user', 'dm'];
    else if (prefix === '>') only = ['page', 'settings'];
    if (only) raw = raw.slice(1).trim();
    const q = norm(raw);

    if (!q && !only) {
      const byKey = new Map(allItems.map((it) => [it.key, it]));
      const recent = recentKeys.map((k) => byKey.get(k)).filter(Boolean).slice(0, RECENT_MAX);
      const recentSet = new Set(recent.map((r) => r.key));
      const unread = allItems.filter((it) => (it.unread || it.mentions > 0) && !recentSet.has(it.key)).slice(0, 5);
      const suggest = allItems.filter((it) => it.kind === 'page').slice(0, recent.length ? 4 : 8);
      return [
        { heading: 'Recentes', items: recent },
        { heading: 'Não lidas', items: unread },
        { heading: 'Ir para', items: suggest },
      ].filter((g) => g.items.length > 0);
    }

    const HEADINGS = { channel: 'Canais', voice: 'Canais de voz', dm: 'Conversas', user: 'Pessoas', page: 'Páginas', settings: 'Configurações' };
    const buckets = {};
    allItems.forEach((it) => {
      if (only && !only.includes(it.kind)) return;
      const s = scoreOf(q, it.label, it.keywords);
      if (s <= 0) return;
      (buckets[it.kind] ||= []).push({ ...it, score: s + (it.unread ? 0.2 : 0) });
    });
    return Object.entries(buckets)
      .map(([kind, list]) => {
        const items = list.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label)).slice(0, only ? 12 : GROUP_LIMIT);
        return { heading: HEADINGS[kind], items, best: items[0]?.score || 0 };
      })
      .sort((a, b) => b.best - a.best);
  }, [query, allItems, recentKeys]);

  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  useEffect(() => {
    const el = listRef.current?.querySelector('.qs-item.active');
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  const choose = (item) => {
    if (!item) return;
    const next = [item.key, ...recentKeys.filter((k) => k !== item.key)].slice(0, 12);
    writeRecent(user.id, next);
    setRecentKeys(next);
    setOpen(false);
    useStore.getState().closeMobileChannelList?.();
    item.go();
  };

  const onKeyDownInput = (e) => {
    if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) { e.preventDefault(); setActiveIndex((i) => (flat.length ? (i + 1) % flat.length : 0)); }
    if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) { e.preventDefault(); setActiveIndex((i) => (flat.length ? (i - 1 + flat.length) % flat.length : 0)); }
    if (e.key === 'Enter') { e.preventDefault(); choose(flat[activeIndex]); }
  };

  if (!open) return null;

  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '');

  return createPortal(
    <div className="qs-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="qs-box" role="dialog" aria-modal="true" aria-label="Busca rápida">
        <div className="qs-input-row">
          <NavIcon name="search" size={18} className="qs-input-icon" />
          <input
            autoFocus
            className="qs-input"
            placeholder="Para onde você quer ir?"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActiveIndex(0); }}
            onKeyDown={onKeyDownInput}
            role="combobox" aria-expanded="true" aria-controls="qs-results" aria-activedescendant={flat[activeIndex] ? `qs-${flat[activeIndex].key}` : undefined}
          />
          <button type="button" className="qs-close" onClick={() => setOpen(false)} aria-label="Fechar"><NavIcon name="close" size={16} /></button>
        </div>
        <div className="qs-results" id="qs-results" role="listbox" ref={listRef}>
          {flat.length === 0 && (
            <div className="qs-empty">
              <span className="qs-empty-icon"><NavIcon name="search" size={22} /></span>
              <strong>Nada encontrado</strong>
              <span>Tente outro nome — ou use # canais, @ pessoas, ! voz, &gt; páginas.</span>
            </div>
          )}
          {groups.map((group) => (
            <div key={group.heading} className="qs-group" role="group" aria-label={group.heading}>
              <div className="qs-group-label">
                {group.heading === 'Recentes' && <NavIcon name="clock" size={12} />}
                {group.heading}
              </div>
              {group.items.map((item) => {
                const index = flat.indexOf(item);
                return (
                  <button
                    type="button"
                    key={item.key}
                    id={`qs-${item.key}`}
                    role="option"
                    aria-selected={index === activeIndex}
                    className={`qs-item qs-kind-${item.kind} ${index === activeIndex ? 'active' : ''} ${item.unread ? 'is-unread' : ''}`}
                    onMouseMove={() => { if (index !== activeIndex) setActiveIndex(index); }}
                    onClick={() => choose(item)}
                  >
                    <span className="qs-item-icon">
                      {item.avatarUser ? (
                        <span className="qs-avatar">
                          <UserAvatar user={item.avatarUser} size={26} />
                          {item.status && <PresenceDot status={item.status} />}
                        </span>
                      ) : item.icon}
                    </span>
                    <span className="qs-item-text">
                      <span className="qs-item-label truncate">{item.label}</span>
                      {item.sub && <span className="qs-item-sub truncate">{item.sub}</span>}
                    </span>
                    {item.mentions > 0 && <span className="qs-badge">{item.mentions > 99 ? '99+' : item.mentions}</span>}
                    {!(item.mentions > 0) && item.unread && <span className="qs-dot" aria-label="Não lida" />}
                    <span className="qs-item-enter" aria-hidden="true"><NavIcon name="enter" size={14} /></span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div className="qs-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> navegar</span>
          <span><kbd>Enter</kbd> abrir</span>
          <span><kbd>Esc</kbd> fechar</span>
          <span className="qs-footer-tip"><b>#</b> canais · <b>@</b> pessoas · <b>!</b> voz · <b>&gt;</b> páginas</span>
          <span className="qs-footer-shortcut"><kbd>{isMac ? '⌘' : 'Ctrl'}</kbd><kbd>K</kbd></span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Botão pequeno pra abrir a busca rápida (barra do topo).
export function QuickSwitcherButton({ className = '' }) {
  const setOpen = useStore((s) => s.setQuickSwitcherOpen);
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '');
  return (
    <button
      type="button" className={`qs-trigger ${className}`} onClick={() => setOpen(true)}
      title={`Busca rápida (${isMac ? '⌘' : 'Ctrl'}+K)`} aria-label="Busca rápida"
    >
      <NavIcon name="command" size={15} />
      <span className="qs-trigger-label">Ir para…</span>
      <kbd className="qs-trigger-kbd">{isMac ? '⌘K' : 'Ctrl K'}</kbd>
    </button>
  );
}
