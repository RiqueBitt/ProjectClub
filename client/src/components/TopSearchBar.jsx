import InboxPopover from './InboxPopover.jsx';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ITEMS, STAFF_ITEM, ACTIVITY_NAV_ICON, canOpenStaffPanel } from './MainSidebar.jsx';
import { useStore, isChannelUnread, isConversationUnread, useMyRoleIds } from '../store/useStore';
import { useAuth } from '../context/AuthContext.jsx';
import { usePopoverCoordination } from '../utils/popoverCoordinator';
import logoIcon from '../assets/icons/logo-project-club.png';
import searchIcon from '../assets/icons/nav-search.png';
import notificationsIcon from '../assets/icons/nav-notifications.png';
import settingsIcon from '../assets/icons/settings.png';
import { useQuickSearch, QuickResults, quickSearchKeys } from './QuickSwitcher.jsx';

export const DONATE_URL = 'https://livepix.gg/projectclubr';
const svg = (d) => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
import { startManualDrag } from './TitleBar.jsx';
import { isChannelPath, isDmPath } from '../utils/prettyLinks';

// Barra de topo — logo + busca + atalhos + notificações + Configurações.
// (Criar post, foto de perfil, YouTube, Música e Filmes saíram daqui a
// pedido: YouTube e Música ficam só dentro das calls — Assistir juntos.)
// Título da seção atual, mostrado no centro da barra no layout
// "Normal 2.0" (igual ao topo do Discord): a seção do menu em que a
// pessoa está (Comunidade no chat, Feeds, Social...).
function useSectionTitle() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  // No chat, o nome do canal já aparece no cabeçalho do próprio chat;
  // aqui fica a seção (Comunidade), como no topo do Discord.
  if (pathname === '/' || isChannelPath(pathname)) {
    const item = ITEMS.find((i) => i.to === '/');
    return { icon: item.icon, label: t(item.labelKey) };
  }
  if (isDmPath(pathname)) return { label: t('nav.amigos') };
  if (pathname === '/notifications') return { label: 'Notificações' };
  if (pathname === '/search') return { label: 'Busca' };
  const item = [...ITEMS, STAFF_ITEM].find((i) => i.to !== '/' && i.match(pathname));
  return item ? { icon: item.icon, label: t(item.labelKey, item.label) } : null;
}

export default function TopSearchBar() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [inboxOpen, setInboxOpen] = useState(false);
  const layoutStyle = useStore((s) => s.layoutStyle);
  const sectionTitle = useSectionTitle();
  const { user } = useAuth();
  const myRoleIds = useMyRoleIds(user?.id);
  const [q, setQ] = useState('');
  const categories = useStore((s) => s.categories);
  const mobileChannelListOpen = useStore((s) => s.mobileChannelListOpen);
  // BUG CORRIGIDO ("abro o menu de gif/emoji/figurinhas e clico pra
  // abrir a barra lateral de categorias e fica sobrepondo"): essa
  // gaveta mobile de canais/categorias (mobileChannelListOpen, aberta
  // pelo ☰ abaixo) também vivia fora do coordenador global de
  // popovers (o mesmo já usado pelo seletor de emoji/GIF/figurinha do
  // composer em ChatWindow.jsx, pela barrinha de categorias do
  // cabeçalho em ChannelSwitcher.jsx, pelo menu de status logo
  // abaixo, etc — ver popoverCoordinator.js), por ser um valor solto
  // no store global em vez de um useState local. Registrando aqui do
  // mesmo jeito: abrir esta gaveta agora fecha qualquer popover
  // coordenado que estivesse aberto (o seletor de emoji/GIF/figurinha
  // inclusive), e abrir QUALQUER um deles fecha esta gaveta.
  usePopoverCoordination(mobileChannelListOpen, () => useStore.getState().closeMobileChannelList());
  const channels = useStore((s) => s.channels);
  const channelReadAt = useStore((s) => s.channelReadAt);
  const conversations = useStore((s) => s.conversations);
  const friends = useStore((s) => s.friends);

  const allChannels = [...channels, ...categories.flatMap((c) => c.channels || [])];
  const unreadChannels = allChannels.filter((ch) => isChannelUnread(ch, channelReadAt, user.id, myRoleIds)).length;
  const unreadConversations = conversations.filter((c) => isConversationUnread(c, user.id)).length;
  const pendingIncoming = friends.filter((f) => f.status === 'PENDING' && f.isIncoming).length;
  const notifBadge = unreadChannels + unreadConversations + pendingIncoming;

  // ---- Busca unificada: este campo É a busca rápida (antigo Ctrl+K) ----
  // Digitou → menu de resultados rápidos logo abaixo (canais, voz,
  // conversas, pessoas — inclusive do servidor —, páginas, configurações);
  // a última linha (e Enter sem nada destacado) abre a busca completa.
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const formRef = useRef(null);
  const inputRef = useRef(null);
  const resultsRef = useRef(null);
  const closeSearch = () => { setSearchOpen(false); setActiveIndex(-1); };
  const { groups: qsGroups, flat: qsFlat, choose: qsChoose } = useQuickSearch(q, {
    active: searchOpen,
    onDone: () => { closeSearch(); setQ(''); inputRef.current?.blur(); },
  });
  useEffect(() => { setActiveIndex(-1); }, [q]);
  useEffect(() => {
    resultsRef.current?.querySelector('.qs-item.active')?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);
  // Fecha ao clicar fora.
  useEffect(() => {
    if (!searchOpen) return undefined;
    const onDown = (e) => { if (!formRef.current?.contains(e.target)) closeSearch(); };
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  }, [searchOpen]);

  const goFullSearch = () => {
    const term = q.trim();
    closeSearch();
    inputRef.current?.blur();
    navigate(term ? `/search?q=${encodeURIComponent(term)}` : '/search');
  };
  const submitSearch = (e) => {
    e.preventDefault();
    if (qsFlat[activeIndex]) qsChoose(qsFlat[activeIndex]);
    else goFullSearch();
  };
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '');

  return (
    <div className="top-search-bar" onMouseDown={(e) => { if (e.target === e.currentTarget) startManualDrag(e); }}>
      {/* Item pedido: menu principal virando gaveta de verdade no
          celular — esse botão só aparece em telas estreitas (≤600px,
          ver .mobile-nav-toggle no CSS) e abre/fecha a barra de
          navegação como uma gaveta lateral, em vez dela ficar sempre
          ocupando espaço fixo na tela.
          BUG CORRIGIDO ("no mobile existem 2 botões"): havia um
          segundo botão só pra abrir a lista de canais (dentro de
          MainApp.jsx), redundante com este — removido, e este botão
          único agora abre os dois juntos (barra principal + lista de
          canais/categorias, ver toggleMobileChannelList). */}
      {/* Item pedido: "colocar a seta de abrir e fechar a comunidade
          no mobile" — o ☰ ficava igual sempre, sem indicar se um
          clique ia abrir ou fechar a gaveta. Agora o próprio ícone
          muda (☰ fechado → ✕ aberto), servindo de seta visual de
          abrir/fechar, igual o botão de colapsar da sidebar no
          desktop já faz. */}
      {/* Item pedido: "mude o # pra três barrinhas pra mostrar canais
          E categorias" — o "#" sozinho dava a entender que era só
          canal de texto; voltou pro ☰, que já representa "abrir a
          navegação" (canais + categorias) sem sugerir um tipo
          específico de conteúdo. */}
      <button
        type="button"
        className="mobile-nav-toggle"
        onClick={() => useStore.getState().toggleMobileChannelList()}
        aria-label={mobileChannelListOpen ? 'Fechar menu' : 'Abrir canais e categorias'}
      >
        {mobileChannelListOpen ? '✕' : '☰'}
      </button>
      <button type="button" className="top-search-bar-brand" onClick={() => navigate('/')} aria-label="Project Club: ir para a comunidade">
        <img className="top-search-bar-logo" src={logoIcon} alt="" />
        <span className="top-search-bar-brand-name">Project Club</span>
      </button>

      {layoutStyle === 'normal2' && sectionTitle && (
        <div className="n2-top-title" aria-live="polite">
          {sectionTitle.icon && <span className="n2-top-title-icon" style={{ WebkitMaskImage: `url(${sectionTitle.icon})`, maskImage: `url(${sectionTitle.icon})` }} aria-hidden="true" />}
          <span className="truncate">{sectionTitle.label}</span>
        </div>
      )}

      <form className={`top-search-bar-form${searchOpen ? ' is-open' : ''}`} onSubmit={submitSearch} ref={formRef} role="search">
        <div className="top-search-bar-input-wrap">
          <span className="top-search-bar-input-icon top-search-bar-icon-mask" style={{ WebkitMaskImage: `url(${searchIcon})`, maskImage: `url(${searchIcon})` }} />
          <input
            ref={inputRef}
            className="top-search-bar-input"
            value={q}
            onChange={(e) => { setQ(e.target.value); setSearchOpen(true); }}
            onFocus={() => setSearchOpen(true)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeSearch(); e.currentTarget.blur(); return; }
              if (!searchOpen) setSearchOpen(true);
              quickSearchKeys(e, { flat: qsFlat, activeIndex, setActiveIndex, choose: qsChoose, onEnterNone: goFullSearch });
            }}
            placeholder="Buscar em Project Club"
            aria-label="Buscar em Project Club"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={searchOpen}
            aria-controls="tsb-results"
            aria-activedescendant={qsFlat[activeIndex] ? `tsb-${qsFlat[activeIndex].key}` : undefined}
            enterKeyHint="search"
            autoComplete="off"
            spellCheck={false}
          />
          {!searchOpen && !q && <kbd className="top-search-bar-kbd" aria-hidden="true">{isMac ? '⌘K' : 'Ctrl K'}</kbd>}
        </div>
        {searchOpen && (
          <div className="top-search-dropdown">
            <QuickResults groups={qsGroups} flat={qsFlat} activeIndex={activeIndex} setActiveIndex={setActiveIndex} choose={qsChoose} listRef={resultsRef} idPrefix="tsb" />
            <div className="qs-footer top-search-dropdown-footer">
              <span><kbd>↑</kbd><kbd>↓</kbd> navegar</span>
              <span><kbd>Enter</kbd> abrir</span>
              <span className="qs-footer-tip"><b>#</b> canais · <b>@</b> pessoas · <b>!</b> voz · <b>&gt;</b> páginas</span>
            </div>
          </div>
        )}
      </form>

      <div className="top-search-bar-actions">
        {/* Celular: a barra de busca não cabe, então a lupa abre a MESMA
            busca em tela cheia (QuickSwitcher.jsx). */}
        <button type="button" className="top-search-bar-icon-btn top-search-mobile-btn" title="Buscar" aria-label="Buscar em Project Club" onClick={() => useStore.getState().setQuickSwitcherOpen(true)}>
          <span className="top-search-bar-icon-mask" style={{ WebkitMaskImage: `url(${searchIcon})`, maskImage: `url(${searchIcon})`, width: 18, height: 18 }} />
        </button>
        <a className="top-search-bar-icon-btn top-donate-btn" href={DONATE_URL} target="_blank" rel="noreferrer" title="Apoiar o Project Club (doação)" aria-label="Apoiar o Project Club">
          {svg('M12 20.5s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.7c0 5.6-7.5 10.2-7.5 10.2z')}
        </a>
        <button type="button" className="top-search-bar-icon-btn" title="Atividade dos amigos" aria-label="Atividade dos amigos" onClick={() => navigate('/atividade')}>
          <span className="top-search-bar-icon-mask" style={{ WebkitMaskImage: `url("${ACTIVITY_NAV_ICON}")`, maskImage: `url("${ACTIVITY_NAV_ICON}")`, width: 19, height: 19 }} />
        </button>
        <span className="top-inbox-wrap">
          <button type="button" className={`top-search-bar-icon-btn top-inbox-btn${inboxOpen ? ' active' : ''}`} title="Caixa de Entrada" aria-label="Caixa de Entrada" aria-expanded={inboxOpen} onClick={() => setInboxOpen((v) => !v)}>
            {svg('M3 13h5l2 3h4l2-3h5M5 5h14l2 8v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6z')}
          </button>
          {inboxOpen && <InboxPopover onClose={() => setInboxOpen(false)} />}
        </span>
        <button type="button" className="top-search-bar-icon-btn" title="Notificações" aria-label={notifBadge > 0 ? `Notificações (${notifBadge > 99 ? 'mais de 99' : notifBadge} novas)` : 'Notificações'} onClick={() => navigate('/notifications')}>
          <span className="top-search-bar-icon-mask top-search-bar-notif-icon" style={{ WebkitMaskImage: `url(${notificationsIcon})`, maskImage: `url(${notificationsIcon})` }} />
          {notifBadge > 0 && <span className="top-search-bar-badge">{notifBadge > 99 ? '99+' : notifBadge}</span>}
        </button>
        {/* Item pedido: engrenagem de Configurações, do lado do sino de
            notificações, no cabeçalho. */}
        <button type="button" className="top-search-bar-icon-btn" title="Configurações" aria-label="Configurações" onClick={() => useStore.getState().openSettings()}>
          <span className="top-search-bar-icon-mask" style={{ WebkitMaskImage: `url(${settingsIcon})`, maskImage: `url(${settingsIcon})`, width: 18, height: 18 }} />
        </button>
        {/* Painel da staff — logo à direita da engrenagem, só pra quem o
            servidor reconhece como ADMIN (platformRole vem de /api/auth/me,
            lido do banco; a rota /api/admin/* também exige ADMIN no
            servidor via requirePlatformAdmin — esconder o botão é só
            conveniência, nunca a proteção). */}
        {canOpenStaffPanel(user) && (
          <button type="button" className={`top-search-bar-icon-btn top-staff-panel-btn${pathname.startsWith('/admin') ? ' active' : ''}`} title="Painel" aria-label="Painel da staff" onClick={() => navigate('/admin')}>
            <span className="top-search-bar-icon-mask" style={{ WebkitMaskImage: `url(${STAFF_ITEM.icon})`, maskImage: `url(${STAFF_ITEM.icon})`, width: 18, height: 18 }} />
          </button>
        )}

        {/* Foto de perfil saiu da barra superior (pedido): o perfil e o
            status continuam no painel do usuário da barra lateral e na
            aba "Você" do celular. */}
      </div>
    </div>
  );
}
