import { useEffect, useMemo, useRef, useState } from 'react';
import { searchMessages } from '../api/endpoints';
import { useStore } from '../store/useStore';
import { channelFilterQuery, completeChannelFilter, matchChannelsForFilter } from '../utils/searchFilters';
import { formatMessageTime } from '../utils/formatTime';
import UserAvatar from './UserAvatar.jsx';
import ChatIcon from './ChatIcons.jsx';

// Busca dentro do canal/conversa aberto (Ctrl+F ou a lupa do cabeçalho).
// Usa o endpoint que já existia (GET /messages/search, mínimo 2 letras,
// até 50 resultados mais recentes). Digitar já busca (com um pequeno
// atraso); ↑/↓ escolhem, Enter pula até a mensagem, Esc fecha.
// Enquanto aberta, os trechos encontrados nas mensagens carregadas ficam
// marcados (CSS Custom Highlight API — sem mexer no DOM das mensagens).

const MIN_CHARS = 2;
const PLACEHOLDER = 'Buscar neste chat';
const LABEL_CLOSE = 'Fechar busca';
const HINT_MIN = 'Digite pelo menos 2 letras.';
const HINT_EMPTY = 'Nenhuma mensagem encontrada.';
const HINT_ERROR = 'Não deu pra buscar agora. Tente de novo.';
const HINT_LOADING = 'Buscando…';
const LABEL_ATTACHMENT = 'Anexo';
const LABEL_KEYS = '↑↓ para escolher · Enter para ir · Esc para fechar';
const HIGHLIGHT_NAME = 'chat-search-hit';
const HINT_FILTERS = 'Filtros: de:@nome · tem:arquivo|imagem|link|video · antes:AAAA-MM-DD · depois:AAAA-MM-DD · em:#canal (ou in:#canal) · fixada:';
const LABEL_CHANNELS = 'Buscar no canal';
const LABEL_MORE = 'Carregar mais';

// Filtros (from:/has:/before:/after:, e as versões em português) saem do
// texto usado no destaque — o servidor é quem interpreta (ver
// parseSearchQuery no messageController).
const FILTER_TOKEN_RE = /(^|\s)(from|has|before|after|in|pinned|de|tem|antes|depois|em|fixada|fixado):(?:"[^"]*"?|\S*)/gi;
function textPart(q) { return q.replace(FILTER_TOKEN_RE, ' ').replace(/\s+/g, ' ').trim(); }
function hasFilters(q) { FILTER_TOKEN_RE.lastIndex = 0; const r = FILTER_TOKEN_RE.test(q); FILTER_TOKEN_RE.lastIndex = 0; return r; }

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Remove acentos pra comparar "nao" com "não" no destaque local.
function fold(s) {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// Trecho do texto em volta do primeiro acerto, com o termo marcado.
function Snippet({ text, query }) {
  if (!text) return <i className="chat-search-attach">{LABEL_ATTACHMENT}</i>;
  const q = query.trim();
  const folded = fold(text);
  const idx = q ? folded.indexOf(fold(q)) : -1;
  let start = 0;
  if (idx > 50) start = idx - 40;
  const piece = (start > 0 ? '…' : '') + text.slice(start, start + 180);
  if (!q) return <>{piece}</>;
  const re = new RegExp(`(${escapeRegExp(q)})`, 'ig');
  const parts = piece.split(re);
  return (
    <>
      {parts.map((p, i) => (i % 2 === 1 ? <mark key={i}>{p}</mark> : <span key={i}>{p}</span>))}
    </>
  );
}

// Marca o termo nas mensagens já carregadas da lista (só onde o navegador
// suporta CSS.highlights — nos outros, a lista de resultados basta).
function useInListHighlight(listRef, query, active, refreshKey) {
  useEffect(() => {
    const supported = typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight !== 'undefined';
    if (!supported) return undefined;
    const q = fold(query.trim());
    if (!active || q.length < MIN_CHARS || !listRef.current) {
      CSS.highlights.delete(HIGHLIGHT_NAME);
      return undefined;
    }
    const ranges = [];
    const nodes = listRef.current.querySelectorAll('.message-content');
    nodes.forEach((node) => {
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      let t = walker.nextNode();
      while (t && ranges.length < 400) {
        const value = fold(t.nodeValue);
        // fold() mantém o mesmo tamanho só quando não há acento combinado;
        // se mudar o tamanho, compara sem dobrar acentos.
        const same = value.length === t.nodeValue.length;
        const hay = same ? value : t.nodeValue.toLowerCase();
        const needle = same ? q : query.trim().toLowerCase();
        let i = hay.indexOf(needle);
        while (i !== -1) {
          const r = new Range();
          r.setStart(t, i);
          r.setEnd(t, i + needle.length);
          ranges.push(r);
          i = hay.indexOf(needle, i + needle.length);
        }
        t = walker.nextNode();
      }
    });
    CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(...ranges));
    return () => { CSS.highlights.delete(HIGHLIGHT_NAME); };
  }, [listRef, query, active, refreshKey]);
}

export default function ChannelSearchPanel({ open, onClose, conversationId, channelId, listRef, messagesKey, onJump, focusToken }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [status, setStatus] = useState('idle'); // idle | loading | done | error
  const [nextCursor, setNextCursor] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const seqRef = useRef(0);
  const resultsRef = useRef(null);
  // em:#canal / in:#canal — sugere os canais (só os que a pessoa vê: a
  // lista da barra lateral já vem filtrada pela permissão).
  const categories = useStore((s) => s.categories);
  const looseChannels = useStore((s) => s.channels);
  const [suggestActive, setSuggestActive] = useState(0);
  const channelQuery = channelFilterQuery(query);
  const channelSuggestions = useMemo(() => {
    if (channelQuery === null) return [];
    const all = [...looseChannels, ...categories.flatMap((c) => (c.channels || []).map((ch) => ({ ...ch, _cat: c.name })))];
    return matchChannelsForFilter(all, channelQuery, 6);
  }, [channelQuery, looseChannels, categories]);
  useEffect(() => { setSuggestActive(0); }, [channelQuery]);
  const pickChannel = (ch) => {
    setQuery((q) => completeChannelFilter(q, ch.name));
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  // Trocou de sala: limpa tudo.
  useEffect(() => {
    setQuery(''); setResults([]); setStatus('idle'); setActive(0); setNextCursor(null);
  }, [conversationId, channelId]);

  // Abriu (ou Ctrl+F de novo com ela aberta): foca e seleciona o texto.
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.select(); });
    return () => cancelAnimationFrame(id);
  }, [open, focusToken]);

  // Busca enquanto digita, com atraso.
  useEffect(() => {
    if (!open) return undefined;
    const q = query.trim();
    if (q.length < MIN_CHARS && !hasFilters(q)) { setResults([]); setStatus('idle'); setNextCursor(null); return undefined; }
    setStatus('loading');
    const seq = ++seqRef.current;
    const t = setTimeout(() => {
      searchMessages({ conversationId, channelId, q })
        .then((d) => {
          if (seq !== seqRef.current) return;
          setResults(d?.messages || []);
          setNextCursor(d?.nextCursor || null);
          setActive(0);
          setStatus('done');
        })
        .catch(() => { if (seq === seqRef.current) setStatus('error'); });
    }, 300);
    return () => clearTimeout(t);
  }, [query, open, conversationId, channelId]);

  useInListHighlight(listRef, textPart(query), open, messagesKey);

  const loadMore = () => {
    if (!nextCursor || loadingMore) return;
    const seq = seqRef.current;
    setLoadingMore(true);
    searchMessages({ conversationId, channelId, q: query.trim(), cursor: nextCursor })
      .then((d) => {
        if (seq !== seqRef.current) return;
        setResults((prev) => {
          const seen = new Set(prev.map((m) => m.id));
          return [...prev, ...(d?.messages || []).filter((m) => !seen.has(m.id))];
        });
        setNextCursor(d?.nextCursor || null);
      })
      .catch(() => {})
      .finally(() => setLoadingMore(false));
  };

  // Mantém o item ativo visível ao navegar com as setas.
  useEffect(() => {
    const el = resultsRef.current?.querySelector(`[data-idx="${active}"]`);
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [active]);

  if (!open) return null;

  const pick = (m) => { if (m) onJump(m); };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); return; }
    if (channelSuggestions.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSuggestActive((i) => (i + 1) % channelSuggestions.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSuggestActive((i) => (i - 1 + channelSuggestions.length) % channelSuggestions.length); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pickChannel(channelSuggestions[Math.min(suggestActive, channelSuggestions.length - 1)]); return; }
    }
    if (!results.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => (i + 1) % results.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (i - 1 + results.length) % results.length); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(results[active]); }
  };

  const q = query.trim();
  const textQ = textPart(q);
  let hint = null;
  if (q.length > 0 && q.length < MIN_CHARS && !hasFilters(q)) hint = HINT_MIN;
  else if (status === 'loading' && results.length === 0) hint = HINT_LOADING;
  else if (status === 'error') hint = HINT_ERROR;
  else if (status === 'done' && results.length === 0) hint = HINT_EMPTY;

  return (
    <div className="search-panel chat-search" role="search">
      <form className="chat-search-field" onSubmit={(e) => { e.preventDefault(); pick(results[active]); }}>
        <ChatIcon name="search" size={16} className="chat-search-icon" />
        <input
          ref={inputRef}
          placeholder={PLACEHOLDER}
          aria-label={PLACEHOLDER}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
        {status === 'done' && results.length > 0 && (
          <span className="chat-search-count">{results.length}{nextCursor ? '+' : ''}</span>
        )}
        <button type="button" className="chat-search-close" onClick={onClose} aria-label={LABEL_CLOSE} title={LABEL_CLOSE}><ChatIcon name="close" size={14} /></button>
      </form>
      {channelSuggestions.length > 0 && (
        <ul className="chat-search-channels" role="listbox" aria-label={LABEL_CHANNELS}>
          {channelSuggestions.map((ch, i) => (
            <li key={ch.id} role="option" aria-selected={i === suggestActive}>
              <button
                type="button" className={`chat-search-channel ${i === suggestActive ? 'is-active' : ''}`}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setSuggestActive(i)}
                onClick={() => pickChannel(ch)}
              >
                <ChatIcon name="hash" size={14} />
                <span className="truncate">{ch.name}</span>
                {ch._cat && <small className="truncate">{ch._cat}</small>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {hint && <div className="chat-search-hint">{hint}</div>}
      {!q && <div className="chat-search-hint">{HINT_FILTERS}</div>}
      {results.length > 0 && (
        <ul className="chat-search-results" ref={resultsRef} role="listbox">
          {results.map((m, i) => (
            <li key={m.id} role="option" aria-selected={i === active}>
              <button
                type="button" data-idx={i}
                className={`chat-search-item ${i === active ? 'is-active' : ''}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(m)}
              >
                <UserAvatar user={m.author} size={28} />
                <span className="chat-search-item-body">
                  <span className="chat-search-item-meta">
                    <b className="truncate">{m.author?.displayName}</b>
                    {m.channel && m.channel.id !== channelId && <span className="chat-search-item-channel truncate">#{m.channel.name}</span>}
                    <span className="chat-search-item-time">{formatMessageTime(m.createdAt)}</span>
                  </span>
                  <span className="chat-search-item-text"><Snippet text={m.content} query={textQ} /></span>
                </span>
              </button>
            </li>
          ))}
          {nextCursor && (
            <li>
              <button type="button" className="chat-search-item chat-search-more" disabled={loadingMore} onClick={loadMore}>
                {loadingMore ? HINT_LOADING : LABEL_MORE}
              </button>
            </li>
          )}
        </ul>
      )}
      {results.length > 0 && <div className="chat-search-keys">{LABEL_KEYS}</div>}
    </div>
  );
}
