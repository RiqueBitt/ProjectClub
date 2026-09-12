import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore, isChannelUnread, useMyRoleIds } from '../store/useStore';
import { useAuth } from '../context/AuthContext.jsx';
import ChannelTypeIcon from './ChannelTypeIcon.jsx';
import ChannelSidebar from './ChannelSidebar.jsx';

// Navegação entre os chats disponíveis, fica bem onde antes aparecia o
// dropdown com nome/descrição do canal (ver ChatWindow.jsx).
//
// BUG CORRIGIDO ("canais ficam um na frente do outro sem saber qual
// categoria são"): antes, TODOS os canais (soltos + de dentro de
// categorias) eram achatados numa fileira única, sem nenhuma indicação
// de categoria. Categorias agora aparecem como abas de nível superior.
//
// Item pedido: "deixe as categorias normal, mas os canais em vez de
// aparecerem do lado dela, faça aparecer numa barrinha onde fica o
// nome do canal que você está" — os canais de uma categoria aberta
// não ficam mais NESTA barra (ver a versão anterior no histórico do
// git para a expansão inline que veio antes) — aparecem no cabeçalho
// do chat, no lugar do título (ver ChatWindow.jsx), no lugar de
// empurrar o layout desta barra pro lado. openCategoryId agora vive
// no store global (useStore), não mais como estado local — os dois
// componentes (esta barra, que abre/fecha, e o cabeçalho do chat, que
// mostra os canais) são irmãos, nenhum é pai do outro.
//
// BUG CORRIGIDO ("não tem rolagem lateral pra ver os outros canais"):
// a rolagem em si já existia, só sem nenhum indício visual — setas
// próprias (ver .channel-tabs-arrow) substituem a barra nativa
// escondida, aparecendo só quando há conteúdo cortado de cada lado.
export default function ChannelSwitcher({ currentChannelId }) {
  const { user } = useAuth();
  const myRoleIds = useMyRoleIds(user.id);
  const navigate = useNavigate();
  const categories = useStore((s) => s.categories);
  const channels = useStore((s) => s.channels);
  const channelReadAt = useStore((s) => s.channelReadAt);
  const openCategoryId = useStore((s) => s.openCategoryId);
  const setOpenCategoryId = useStore((s) => s.setOpenCategoryId);
  // Item pedido: "em aparência adicione uma nova opção de layout, a
  // opção normal e a opção de layout discord — o layout discord faz
  // os canais/categorias ficarem num popover no canto da tela, aberto
  // por um ícone" — layoutStyle 'discord' troca as abas horizontais
  // (o comportamento de sempre, abaixo) por um botão único que abre
  // o ChannelSidebar clássico (a lista vertical completa de canais/
  // categorias, ver o arquivo) flutuando por cima do resto da tela,
  // em vez de empurrar o layout como uma coluna fixa faria.
  const layoutStyle = useStore((s) => s.layoutStyle);
  const [discordPopoverOpen, setDiscordPopoverOpen] = useState(false);
  const discordPopoverRef = useRef(null);
  useEffect(() => {
    if (!discordPopoverOpen) return;
    const onClickOutside = (e) => {
      if (discordPopoverRef.current && !discordPopoverRef.current.contains(e.target)) setDiscordPopoverOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [discordPopoverOpen]);
  // Fecha sozinho ao trocar de canal (clicar num canal dentro do
  // popover já navega — sem isso, ficaria aberto por cima da tela
  // nova sem motivo).
  useEffect(() => { setDiscordPopoverOpen(false); }, [currentChannelId]);

  const currentChannel = [...channels, ...categories.flatMap((c) => c.channels || [])].find((ch) => ch.id === currentChannelId);

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

  // Sair do canal atual (ex: trocando pra outro fora dessa categoria,
  // ou voltando pra tela inicial) fecha a categoria aberta sozinho —
  // sem isso, o cabeçalho continuaria travado mostrando os canais da
  // categoria antiga mesmo depois de já ter saído dela. Clicar num
  // canal já fecha via go() abaixo — este efeito cobre os outros
  // jeitos de sair (voltar pelo navegador, clicar em outro lugar do
  // app que muda currentChannelId sem passar por go()).
  useEffect(() => {
    const stillInOpenCategory = categories
      .find((c) => c.id === openCategoryId)
      ?.channels?.some((ch) => ch.id === currentChannelId);
    if (openCategoryId && !stillInOpenCategory) setOpenCategoryId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentChannelId]);

  if (!channels.length && !categories.length) return null;

  const go = (id) => {
    setOpenCategoryId(null);
    if (id !== currentChannelId) navigate(`/channels/${id}`);
  };

  const scrollBy = (delta) => scrollRef.current?.scrollBy({ left: delta, behavior: 'smooth' });

  const categoryHasUnread = (cat) => (cat.channels || []).some((ch) => isChannelUnread(ch, channelReadAt, user.id, myRoleIds));
  const categoryContainsCurrent = (cat) => (cat.channels || []).some((ch) => ch.id === currentChannelId);
  const categoryMentionCount = (cat) => (cat.channels || []).reduce((sum, ch) => sum + (ch.unreadMentions || 0), 0);

  if (layoutStyle === 'discord') {
    const anyUnread = channels.some((ch) => isChannelUnread(ch, channelReadAt, user.id, myRoleIds)) || categories.some(categoryHasUnread);
    return (
      <div className="channel-tabs-wrap discord-layout-switcher" ref={discordPopoverRef}>
        <button
          type="button"
          className={`discord-layout-trigger ${anyUnread ? 'unread' : ''}`}
          onClick={() => setDiscordPopoverOpen((v) => !v)}
        >
          {currentChannel && <ChannelTypeIcon type={currentChannel.type} />}
          <span className="truncate">{currentChannel?.name || 'Canais'}</span>
          <span className="discord-layout-trigger-caret">{discordPopoverOpen ? '▴' : '▾'}</span>
        </button>
        {discordPopoverOpen && (
          <div className="discord-layout-popover">
            <ChannelSidebar />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="channel-tabs-wrap">
      {canScrollLeft && (
        <button type="button" className="channel-tabs-arrow left" onClick={() => scrollBy(-160)}>‹</button>
      )}
      <div className="channel-tabs" ref={scrollRef}>
        {channels.map((ch) => {
          const unread = isChannelUnread(ch, channelReadAt, user.id, myRoleIds);
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
            <button
              type="button" key={cat.id}
              className={`channel-tab channel-tab-category ${active ? 'active' : ''} ${unread ? 'unread' : ''} ${isOpen ? 'open' : ''}`}
              onClick={() => setOpenCategoryId(isOpen ? null : cat.id)}
            >
              <span className="truncate">{cat.name}</span>
              {mentions > 0 && <span className="mention-badge">{mentions > 99 ? '99+' : mentions}</span>}
              {!(mentions > 0) && unread && <span className="unread-dot" />}
              <span className="channel-tab-category-caret">▾</span>
            </button>
          );
        })}
      </div>
      {canScrollRight && (
        <button type="button" className="channel-tabs-arrow right" onClick={() => scrollBy(160)}>›</button>
      )}
    </div>
  );
}
