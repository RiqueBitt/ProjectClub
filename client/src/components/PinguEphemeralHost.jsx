import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSocket } from '../context/SocketContext.jsx';
import { usePinguEphemeral, handlePinguEphemeral, closePinguPanel } from '../utils/pinguEphemeral';
import '../styles/pingu.css';

// Cartão flutuante com as respostas do Pingu que só você vê (resumo do que
// perdeu, avisos dos comandos). Também escuta o socket 'pingu:ephemeral'
// e entrega as traduções pra mensagem certa (Message.jsx).
export default function PinguEphemeralHost() {
  const { socket } = useSocket() || {};
  const panel = usePinguEphemeral((s) => s.panel);
  const navigate = useNavigate();

  useEffect(() => {
    if (!socket) return undefined;
    socket.on('pingu:ephemeral', handlePinguEphemeral);
    return () => { socket.off('pingu:ephemeral', handlePinguEphemeral); };
  }, [socket]);

  useEffect(() => {
    if (!panel) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') closePinguPanel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panel]);

  if (!panel) return null;
  // Endereços /wiki/... no texto viram links.
  const renderLine = (line, i) => {
    const parts = line.split(/(\/wiki\/[a-z0-9-]+)/g);
    return (
      <p key={i}>
        {parts.map((p, j) => (/^\/wiki\/[a-z0-9-]+$/.test(p)
          ? <a key={j} href={p} onClick={(e) => { e.preventDefault(); navigate(p); }}>{p}</a>
          : p))}
      </p>
    );
  };

  return (
    <aside className="pingu-eph" role="status" aria-live="polite">
      <header className="pingu-eph-head">
        <span className="pingu-eph-icon" aria-hidden="true">🐧</span>
        <div className="pingu-eph-titles">
          <strong>{panel.title || 'Pingu'}</strong>
          <span>Só você está vendo isto</span>
        </div>
        <button type="button" className="pingu-eph-close" onClick={closePinguPanel} aria-label="Fechar" title="Fechar (Esc)">×</button>
      </header>
      <div className="pingu-eph-body">
        {panel.loading && <p className="pingu-eph-wait"><span className="pingu-eph-dots" aria-hidden="true"><i /><i /><i /></span> O Pingu está lendo as mensagens… pode levar alguns segundos.</p>}
        {!panel.loading && panel.error && <p className="pingu-eph-error">{panel.error}</p>}
        {!panel.loading && !panel.error && String(panel.text || '').split('\n').filter(Boolean).map(renderLine)}
      </div>
    </aside>
  );
}
