import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import AuthLayout from './AuthLayout.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { qrLoginScan, qrLoginApprove, qrLoginDeny } from '../api/endpoints';
import { AuthAlert, apiError } from '../components/auth/AuthFields.jsx';

// /entrar-qr?c=... — lado do CELULAR do "Entrar com o celular" (Fase 5).
// Quem abre precisa estar logado; vê qual aparelho está pedindo e só então
// aprova (ou recusa). O código sai da barra de endereço assim que é lido.
const CODE_RE = /^[A-Za-z0-9_-]{43}$/;

export default function QrApprovePage() {
  const { user, loading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [code] = useState(() => {
    const c = new URLSearchParams(location.search).get('c') || '';
    return CODE_RE.test(c) ? c : '';
  });
  const [info, setInfo] = useState(null);
  const [phase, setPhase] = useState('loading'); // loading | confirm | approved | denied | error
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState(0);
  const scannedRef = useRef(false);

  // Sem login: guarda pra onde voltar e manda pro login (o LoginPage só
  // aceita voltar pra esta tela, com um código no formato certo).
  // (Gravado já na renderização — idempotente — pra estar salvo antes do
  // <Navigate> trocar de tela.)
  const needsLogin = !loading && !user;
  if (needsLogin && code) {
    try { sessionStorage.setItem('pc-after-login', `/entrar-qr?c=${code}`); } catch { /* sem storage */ }
  }

  useEffect(() => {
    if (loading || !user || scannedRef.current) return;
    scannedRef.current = true;
    // Tira o código da URL (histórico/compartilhar a aba não levam ele junto).
    if (location.search) navigate('/entrar-qr', { replace: true });
    if (!code) { setPhase('error'); setError('Link inválido. Gere um novo QR Code no computador.'); return; }
    qrLoginScan(code)
      .then((d) => { setInfo(d); setPhase('confirm'); })
      .catch((err) => { setPhase('error'); setError(apiError(err, 'Não foi possível ler este QR Code.')); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user]);

  useEffect(() => {
    if (!info?.expiresAt || phase !== 'confirm') return undefined;
    const tick = () => {
      const s = Math.max(0, Math.round((new Date(info.expiresAt).getTime() - Date.now()) / 1000));
      setLeft(s);
      if (s === 0) { setPhase('error'); setError('Este QR Code expirou. Gere um novo no computador.'); }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [info?.expiresAt, phase]);

  if (needsLogin) return <Navigate to="/login" replace />;
  if (loading) return null;

  const decide = async (approve) => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      await (approve ? qrLoginApprove(code) : qrLoginDeny(code));
      setPhase(approve ? 'approved' : 'denied');
    } catch (err) {
      setPhase('error');
      setError(apiError(err, 'Não foi possível concluir. Gere um novo QR Code no computador.'));
    } finally { setBusy(false); }
  };

  const when = info?.requestedAt ? new Date(info.requestedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';

  return (
    <AuthLayout
      title={phase === 'approved' ? 'Acesso aprovado' : phase === 'denied' ? 'Acesso recusado' : 'Entrar no computador?'}
      subtitle={phase === 'confirm' ? 'Um computador quer entrar na sua conta usando o QR Code.' : ''}
      showcase={false}
      characters={false}
      footer={<Link to="/inicio">Voltar ao Project Club</Link>}
    >
      <div className="pc-form pc-qr-approve">
        {phase === 'loading' && <p className="pc-qr-muted"><span className="pc-spinner" aria-hidden="true" /> Conferindo o QR Code…</p>}

        {phase === 'confirm' && info && (
          <>
            <div className="pc-qr-warning" role="alert">
              <strong>Só aprove se você está na frente desse computador agora.</strong>
              <p>
                Se alguém te mandou este link ou QR Code (por mensagem, e-mail, &quot;suporte&quot;, sorteio…), toque em
                {' '}<b>Recusar</b>: quem aprovar entrega a sua conta para aquele computador.
              </p>
            </div>
            <dl className="pc-qr-details">
              <div><dt>Aparelho</dt><dd>{info.device}</dd></div>
              <div><dt>Rede</dt><dd>{info.network || 'Desconhecida'}</dd></div>
              {when && <div><dt>Pedido às</dt><dd>{when}</dd></div>}
              <div><dt>Vai entrar como</dt><dd>{info.account?.displayName} <span className="pc-qr-muted">@{info.account?.username}</span></dd></div>
            </dl>
            {left > 0 && <p className="pc-qr-muted">Expira em {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</p>}
            <button type="button" className="pc-btn pc-btn-primary" disabled={busy} onClick={() => decide(true)}>
              {busy ? <span className="pc-spinner" aria-hidden="true" /> : null} Aprovar
            </button>
            <button type="button" className="pc-btn pc-btn-ghost" disabled={busy} onClick={() => decide(false)}>Recusar</button>
          </>
        )}

        {phase === 'approved' && (
          <AuthAlert tone="info">Pronto! O computador vai entrar na sua conta em instantes. Se não foi você, abra Configurações → Segurança e saia desse dispositivo.</AuthAlert>
        )}
        {phase === 'denied' && <AuthAlert tone="info">Tudo certo: o computador não entrou na sua conta.</AuthAlert>}
        {phase === 'error' && <AuthAlert>{error}</AuthAlert>}
      </div>
    </AuthLayout>
  );
}
