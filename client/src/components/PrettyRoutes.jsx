// Rotas dos links bonitos (ver utils/prettyLinks.js):
//
//   /canal/:ref          (antigo /channels/:id)       → chat do canal
//   /dm/:ref             (antigo /conversations/:id)  → conversa (DM 1:1 pelo @, grupo pelo slug)
//   /forum/:ref          (antigo /posts/:id)          → post do Fórum
//   /jogos/biblioteca/:ref                            → biblioteca de jogos (@ ou id)
//
// :ref pode ser o slug (atual ou antigo) OU o id. Primeiro procura no que
// já está carregado; se não achar, pergunta ao servidor (que aplica a mesma
// regra de acesso dos ids — canal privado sem acesso = "não encontrado").
// Achou: troca o endereço pelo bonito (replace, sem criar histórico).
// Endereço antigo que não deu pra resolver cai no comportamento de antes
// (a tela com o id, que mostra o próprio aviso de sem acesso/apagado).
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useStore } from '../store/useStore';
import ChatWindow from './ChatWindow.jsx';
import { findChannel, findConversation, findMemberUser, UUID_RE } from '../utils/prettyPaths';
import {
  channelPath, conversationPath, libraryPath, getPrettyLinksMe, resolveLinkRemote,
} from '../utils/prettyLinks';
import { createConversation } from '../api/endpoints';

// Resolve :ref → { id, path } (sync pelo store ou pelo servidor) e troca o
// endereço pelo bonito. status: 'ok' | 'loading' | 'missing'.
function usePrettyRef(kind, ref, localHit, localPath) {
  const location = useLocation();
  const navigate = useNavigate();
  const [remote, setRemote] = useState({ ref: null, link: undefined });
  const remoteNow = remote.ref === ref ? remote.link : undefined;

  useEffect(() => {
    if (localHit) return undefined;
    let alive = true;
    resolveLinkRemote(location.pathname).then((link) => {
      if (alive) setRemote({ ref, link: link && link.kind === kind ? link : null });
    });
    return () => { alive = false; };
  }, [kind, ref, !!localHit]); // eslint-disable-line react-hooks/exhaustive-deps

  // Renomearam o canal com ele aberto: o nome antigo some do store por um
  // instante (até o servidor dizer o novo) — segura o id que já valia pra
  // esse ref em vez de desmontar o chat.
  const last = useRef(null);
  if (localHit) last.current = { ref, id: String(localHit.id) };
  const held = !localHit && remoteNow === undefined && last.current?.ref === ref ? last.current.id : null;
  const id = localHit ? String(localHit.id) : remoteNow?.id || held || null;
  const canonical = localHit ? localPath : remoteNow?.path || null;
  useEffect(() => {
    if (canonical && canonical !== location.pathname) {
      navigate(`${canonical}${location.search}${location.hash}`, { replace: true });
    }
  }, [canonical, location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  const status = localHit || remoteNow || held ? 'ok' : remoteNow === null ? 'missing' : 'loading';
  return { id, status, remote: remoteNow, onCanonical: !canonical || canonical === location.pathname };
}

function RouteSpinner() {
  return <div className="route-loading-fallback"><div className="route-loading-spinner" /></div>;
}

export function LinkNotFound({ what = 'esse link' }) {
  const navigate = useNavigate();
  return (
    <div className="route-loading-fallback" style={{ flexDirection: 'column', gap: 12, textAlign: 'center', padding: 24 }}>
      <h3 style={{ margin: 0 }}>Link indisponível</h3>
      <p style={{ margin: 0, opacity: 0.8 }}>Não encontramos {what}. Ele pode ter sido apagado ou você não tem acesso.</p>
      <button type="button" className="btn-primary" onClick={() => navigate('/inicio', { replace: true })}>Ir para o Início</button>
    </div>
  );
}

const looksLikeId = (ref) => UUID_RE.test(String(ref || ''));

export function ChannelRoute({ legacy = false }) {
  const { ref } = useParams();
  const ch = useStore((s) => findChannel(s, ref));
  const { id, status, onCanonical } = usePrettyRef('channel', ref, ch, ch ? channelPath(ch) : null);
  if (status === 'ok' && (!legacy || onCanonical)) return <ChatWindow kind="channel" channelId={id} />;
  if (status === 'missing') {
    // Endereço com id: a tela de sempre (mostra "sem acesso"/"não existe").
    if (legacy || looksLikeId(ref)) return <ChatWindow kind="channel" channelId={ref} />;
    return <LinkNotFound what="esse canal" />;
  }
  return <RouteSpinner />;
}

export function DmRoute({ legacy = false }) {
  const { ref } = useParams();
  const navigate = useNavigate();
  const conv = useStore((s) => findConversation(s, ref, getPrettyLinksMe()));
  const { id, status, remote, onCanonical } = usePrettyRef('dm', ref, conv, conv ? conversationPath(conv) : null);
  // /dm/fulano sem conversa ainda: abre uma DM nova com a pessoa.
  const pendingUser = status === 'ok' && !id && remote?.userId ? remote.userId : null;
  const [dmError, setDmError] = useState(false);
  useEffect(() => {
    if (!pendingUser) return undefined;
    let alive = true;
    createConversation([pendingUser])
      .then(({ conversation }) => {
        if (!alive) return;
        useStore.getState().upsertConversation?.(conversation);
        navigate(conversationPath(conversation), { replace: true });
      })
      .catch(() => { if (alive) setDmError(true); });
    return () => { alive = false; };
  }, [pendingUser]); // eslint-disable-line react-hooks/exhaustive-deps
  if (dmError) return <LinkNotFound what="essa conversa" />;
  if (status === 'ok' && id && (!legacy || onCanonical)) return <ChatWindow kind="conversation" conversationId={id} />;
  if (status === 'missing') {
    if (legacy || looksLikeId(ref)) return <ChatWindow kind="conversation" conversationId={ref} />;
    return <LinkNotFound what="essa conversa" />;
  }
  return <RouteSpinner />;
}

export function PostRoute({ legacy = false, Page }) {
  const { ref } = useParams();
  const { id, status, onCanonical } = usePrettyRef('post', ref, null, null);
  if (status === 'ok' && (!legacy || onCanonical)) return <Page postId={id} />;
  // Sem resposta do servidor: a página tenta pelo próprio ref (o servidor
  // aceita id ou slug) e mostra o aviso dela se não existir.
  if (status === 'missing') return <Page postId={ref} />;
  return <RouteSpinner />;
}

export function LibraryRoute({ Page }) {
  const { ref } = useParams();
  const u = useStore((s) => findMemberUser(s, ref));
  const { id, status } = usePrettyRef('library', ref, u, u ? libraryPath(u) : null);
  if (status === 'ok') return <Page userId={id} />;
  if (status === 'missing') return <Page userId={ref} />;
  return <RouteSpinner />;
}
