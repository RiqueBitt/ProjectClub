import { useCallback, useEffect, useRef, useState } from 'react';
import { qrLoginStart, qrLoginPoll, qrLoginExchange } from '../../api/endpoints';
import { AuthAlert, apiError } from './AuthFields.jsx';

// "Entrar com o celular" (Fase 5) — lado do computador.
// 1) pede um QR ao servidor (o segredo que troca por sessão fica SÓ aqui,
//    na memória desta tela — nunca vai no QR nem no armazenamento local);
// 2) consulta o estado a cada 2s;
// 3) quando o celular aprova, troca o segredo por uma sessão normal (mesmo
//    cookie/refresh do login com senha) e chama onDone(data).
const POLL_MS = 2000;

const STATUS_TEXT = {
  PENDING: 'Aponte a câmera do celular para o QR Code.',
  SCANNED: 'QR lido! Confirme no celular tocando em "Aprovar".',
  APPROVED: 'Aprovado! Entrando…',
};

export default function QrLoginPanel({ onDone, onCancel }) {
  const [pairing, setPairing] = useState(null); // { qrDataUrl, expiresAt }
  const [status, setStatus] = useState('LOADING');
  const [error, setError] = useState('');
  const [left, setLeft] = useState(0);
  const secretRef = useRef(null);
  const aliveRef = useRef(true);
  const exchangingRef = useRef(false);

  const start = useCallback(async () => {
    setError(''); setStatus('LOADING'); setPairing(null);
    secretRef.current = null; exchangingRef.current = false;
    try {
      const data = await qrLoginStart();
      if (!aliveRef.current) return;
      secretRef.current = data.secret;
      setPairing({ qrDataUrl: data.qrDataUrl, expiresAt: data.expiresAt });
      setStatus('PENDING');
    } catch (err) {
      if (!aliveRef.current) return;
      setStatus('ERROR');
      setError(apiError(err, 'Não foi possível gerar o QR Code agora.'));
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    start();
    return () => { aliveRef.current = false; secretRef.current = null; };
  }, [start]);

  // Contagem regressiva (só visual — quem manda é o servidor).
  useEffect(() => {
    if (!pairing?.expiresAt) return undefined;
    const tick = () => setLeft(Math.max(0, Math.round((new Date(pairing.expiresAt).getTime() - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [pairing?.expiresAt]);

  const exchange = useCallback(async () => {
    if (exchangingRef.current || !secretRef.current) return;
    exchangingRef.current = true;
    setStatus('APPROVED');
    try {
      const data = await qrLoginExchange(secretRef.current);
      secretRef.current = null;
      if (aliveRef.current) onDone?.(data);
    } catch (err) {
      secretRef.current = null;
      if (!aliveRef.current) return;
      setStatus('ERROR');
      setError(apiError(err, 'Não foi possível entrar. Gere um novo QR Code e tente de novo.'));
    }
  }, [onDone]);

  // Consulta o estado enquanto estiver esperando.
  useEffect(() => {
    if (status !== 'PENDING' && status !== 'SCANNED') return undefined;
    let timer = null;
    const poll = async () => {
      const secret = secretRef.current;
      if (!secret) return;
      try {
        const r = await qrLoginPoll(secret);
        if (!aliveRef.current || secretRef.current !== secret) return;
        if (r.status === 'APPROVED') { exchange(); return; }
        if (r.status !== status) setStatus(r.status);
        if (r.status === 'PENDING' || r.status === 'SCANNED') timer = setTimeout(poll, POLL_MS);
      } catch (err) {
        if (!aliveRef.current) return;
        const code = err?.response?.data?.code;
        if (code === 'invalid') setStatus('EXPIRED');
        else timer = setTimeout(poll, POLL_MS * 2); // rede instável: tenta de novo mais devagar
      }
    };
    timer = setTimeout(poll, POLL_MS);
    return () => clearTimeout(timer);
  }, [status, exchange]);

  const waiting = status === 'PENDING' || status === 'SCANNED';
  const mm = String(Math.floor(left / 60));
  const ss = String(left % 60).padStart(2, '0');

  return (
    <div className="pc-qr">
      <div className={`pc-qr-frame${status === 'SCANNED' ? ' is-scanned' : ''}${waiting ? '' : ' is-dim'}`}>
        {pairing?.qrDataUrl && (status !== 'EXPIRED' && status !== 'DENIED' && status !== 'ERROR')
          ? <img src={pairing.qrDataUrl} alt="QR Code para entrar com o celular" width={220} height={220} />
          : <div className="pc-qr-placeholder" aria-hidden="true">{status === 'LOADING' ? <span className="pc-spinner" /> : '⟳'}</div>}
      </div>

      <div className="pc-qr-status" role="status" aria-live="polite">
        {STATUS_TEXT[status] && <p>{STATUS_TEXT[status]}</p>}
        {status === 'EXPIRED' && <p>Este QR Code expirou. Gere um novo para tentar de novo.</p>}
        {status === 'DENIED' && <p>O acesso foi recusado no celular.</p>}
        {waiting && left > 0 && <span className="pc-qr-timer">Expira em {mm}:{ss}</span>}
      </div>

      <AuthAlert>{error}</AuthAlert>

      <ol className="pc-qr-steps">
        <li>No celular, aponte a câmera para o QR Code e abra o link (abre o Project Club no navegador).</li>
        <li>Se pedir, entre na sua conta no celular.</li>
        <li>Confira os dados do computador e toque em <b>Aprovar</b>.</li>
      </ol>

      {(status === 'EXPIRED' || status === 'DENIED' || status === 'ERROR') && (
        <button type="button" className="pc-btn pc-btn-primary" onClick={start}>Gerar novo QR Code</button>
      )}
      <button type="button" className="pc-btn pc-btn-ghost" onClick={onCancel}>Entrar com senha</button>
    </div>
  );
}
