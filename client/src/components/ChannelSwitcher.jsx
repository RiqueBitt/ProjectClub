import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore, isChannelUnread } from '../store/useStore';
import { useAuth } from '../context/AuthContext.jsx';
import ChannelTypeIcon from './ChannelTypeIcon.jsx';

// Navegação entre os chats disponíveis, fica bem onde antes aparecia o
// dropdown com nome/descrição do canal (ver ChatWindow.jsx).
//
// BUG CORRIGIDO ("os canais ficam um na frente do outro sem saber qual
// categoria são"): antes, TODOS os canais (soltos + de dentro de
// categorias) eram achatados numa fileira única de abas, sem nenhuma
// indicação de categoria. Agora as CATEGORIAS aparecem como abas de
// nível superior — clicar numa abre um menu logo abaixo com só os
// canais dela; canais que não têm categoria nenhuma continuam
// aparecendo direto como aba, já que não tem o que agrupar.
//
// BUG CORRIGIDO ("não tem rolagem lateral pra ver os outros canais"):
// a rolagem em si já existia (overflow-x: auto), só a BARRA em si
// ficava escondida de propósito (scrollbar-width: none) — sem nenhum
// indício visual de que dava pra rolar. Setas ◀ ▶ aparecem só quando
// há conteúdo cortado de cada lado, e escondem sozinhas quando não.
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
  }, [categories, channels]);

  // Fecha o menu de categoria aberta se clicar fora dele.
  useEffect(() => {
    if (!openCategoryId) return;
    const onDocClick = () => setOpenCategoryId(null);
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [openCategoryId]);

  if (!channels.length && !categories.length) return null;

  const go = (id) => {
    setOpenCategoryId(null);
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
            <div key={cat.id} className="channel-tab-category-wrap">
              <button
                type="button"
                className={`channel-tab channel-tab-category ${active ? 'active' : ''} ${unread ? 'unread' : ''} ${isOpen ? 'open' : ''}`}
                onClick={(e) => { e.stopPropagation(); setOpenCategoryId(isOpen ? null : cat.id); }}
              >
                <span className="truncate">{cat.name}</span>
                {mentions > 0 && <span className="mention-badge">{mentions > 99 ? '99+' : mentions}</span>}
                {!(mentions > 0) && unread && <span className="unread-dot" />}
                <span className="channel-tab-category-caret">▾</span>
              </button>
              {isOpen && (
                <div className="channel-tab-category-menu" onClick={(e) => e.stopPropagation()}>
                  {cat.channels.map((ch) => {
                    const chUnread = isChannelUnread(ch, channelReadAt, user.id);
                    const chActive = ch.id === currentChannelId;
                    return (
                      <button
                        type="button" key={ch.id}
                        className={`channel-tab-category-item ${chActive ? 'active' : ''} ${chUnread ? 'unread' : ''}`}
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
              )}
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
