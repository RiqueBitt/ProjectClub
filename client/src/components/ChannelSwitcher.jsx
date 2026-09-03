import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore, isChannelUnread } from '../store/useStore';
import { useAuth } from '../context/AuthContext.jsx';
import ChannelTypeIcon from './ChannelTypeIcon.jsx';

// Navegação entre os chats disponíveis, fica bem onde antes aparecia o
// dropdown com nome/descrição do canal (ver ChatWindow.jsx).
//
// BUG CORRIGIDO ("canais ficam um na frente do outro sem saber qual
// categoria são"): antes, TODOS os canais (soltos + de dentro de
// categorias) eram achatados numa fileira única, sem nenhuma indicação
// de categoria. Categorias agora aparecem como abas de nível superior.
//
// BUG CORRIGIDO ("clicar pra abrir a categoria não faz nada, mesmo
// tendo canais dentro"): a primeira versão abria um menu suspenso
// (position: absolute) logo abaixo da categoria — só que o container
// da barra tem overflow-x: auto pra rolagem, e isso faz o navegador
// recortar automaticamente qualquer coisa que ultrapasse a altura
// visível dele, incluindo esse menu (mesmo ele "abrindo" de verdade
// por trás dos panos — o estado mudava, só que nada aparecia na
// tela). Item pedido: os canais aparecem do LADO da categoria, na
// MESMA barra (elementos normais na fileira, sem position: absolute
// nenhum) — não tem mais nada pra ser cortado.
//
// BUG CORRIGIDO ("não tem rolagem lateral pra ver os outros canais"):
// a rolagem em si já existia, só sem nenhum indício visual — setas
// próprias (ver .channel-tabs-arrow) substituem a barra nativa
// escondida, aparecendo só quando há conteúdo cortado de cada lado.
export default function ChannelSwitcher({ currentChannelId }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const categories = useStore((s) => s.categories);
  const channels = useStore((s) => s.channels);
  const channelReadAt = useStore((s) => s.channelReadAt);

  const [openCategoryId, setOpenCategoryId] = useState(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const scrollRef = useRef(null);

  const updateScrollArrows = () => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 4);
  };
  useEffect(() => {
    updateScrollArrows();
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener('scroll', updateScrollArrows);
    const observer = new ResizeObserver(updateScrollArrows);
    observer.observe(el);
    return () => { el.removeEventListener('scroll', updateScrollArrows); observer.disconnect(); };
  }, [categories, channels, openCategoryId]);

  if (!channels.length && !categories.length) return null;

  const go = (id) => {
    if (id !== currentChannelId) navigate(`/channels/${id}`);
  };

  const scrollBy = (delta) => scrollRef.current?.scrollBy({ left: delta, behavior: 'smooth' });

  const categoryHasUnread = (cat) => (cat.channels || []).some((ch) => isChannelUnread(ch, channelReadAt, user.id));
  const categoryContainsCurrent = (cat) => (cat.channels || []).some((ch) => ch.id === currentChannelId);
  const categoryMentionCount = (cat) => (cat.channels || []).reduce((sum, ch) => sum + (ch.unreadMentions || 0), 0);

  return (
    <div className="channel-tabs-wrap">
      {canScrollLeft && (
        <button type="button" className="channel-tabs-arrow left" onClick={() => scrollBy(-160)}>‹</button>
      )}
      <div className="channel-tabs" ref={scrollRef}>
        {channels.map((ch) => {
          const unread = isChannelUnread(ch, channelReadAt, user.id);
          const active = ch.id === currentChannelId;
          return (
            <button
              type="button" key={ch.id}
              className={`channel-tab ${active ? 'active' : ''} ${unread ? 'unread' : ''}`}
              onClick={() => go(ch.id)}
            >
              <ChannelTypeIcon type={ch.type} />
              <span className="truncate">{ch.name}</span>
              {ch.unreadMentions > 0 && (
                <span className="mention-badge">{ch.unreadMentions > 99 ? '99+' : ch.unreadMentions}</span>
              )}
              {!(ch.unreadMentions > 0) && unread && <span className="unread-dot" />}
            </button>
          );
        })}
        {categories.map((cat) => {
          if (!cat.channels?.length) return null;
          const unread = categoryHasUnread(cat);
          const active = categoryContainsCurrent(cat);
          const isOpen = openCategoryId === cat.id;
          const mentions = categoryMentionCount(cat);
          return (
            <div key={cat.id} className={`channel-tab-category-group ${isOpen ? 'open' : ''}`}>
              <button
                type="button"
                className={`channel-tab channel-tab-category ${active ? 'active' : ''} ${unread ? 'unread' : ''} ${isOpen ? 'open' : ''}`}
                onClick={() => setOpenCategoryId(isOpen ? null : cat.id)}
              >
                <span className="truncate">{cat.name}</span>
                {mentions > 0 && <span className="mention-badge">{mentions > 99 ? '99+' : mentions}</span>}
                {!(mentions > 0) && unread && <span className="unread-dot" />}
                <span className="channel-tab-category-caret">▾</span>
              </button>
              {isOpen && cat.channels.map((ch) => {
                const chUnread = isChannelUnread(ch, channelReadAt, user.id);
                const chActive = ch.id === currentChannelId;
                return (
                  <button
                    type="button" key={ch.id}
                    className={`channel-tab channel-tab-in-category ${chActive ? 'active' : ''} ${chUnread ? 'unread' : ''}`}
                    onClick={() => go(ch.id)}
                  >
                    <ChannelTypeIcon type={ch.type} />
                    <span className="truncate">{ch.name}</span>
                    {ch.unreadMentions > 0 && (
                      <span className="mention-badge">{ch.unreadMentions > 99 ? '99+' : ch.unreadMentions}</span>
                    )}
                    {!(ch.unreadMentions > 0) && chUnread && <span className="unread-dot" />}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
      {canScrollRight && (
        <button type="button" className="channel-tabs-arrow right" onClick={() => scrollBy(160)}>›</button>
      )}
    </div>
  );
}
