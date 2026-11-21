import { useEffect, useState } from 'react';
import { api } from '../api/client';
import '../styles/integrations.css';

// Status ao vivo do servidor de Minecraft da comunidade (Painel →
// Integrações). Some sozinho se a equipe desligou.
export default function MinecraftStatusCard() {
  const [st, setSt] = useState(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () => api.get('/integrations/minecraft').then(({ data }) => { if (alive) setSt(data.status); }).catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  if (!st?.enabled || !st.host) return null;
  const address = st.port && st.port !== 25565 ? `${st.host}:${st.port}` : st.host;
  const copy = () => { navigator.clipboard?.writeText(address).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); }).catch(() => {}); };
  return (
    <div className="mc-card" aria-live="polite">
      <span className={`mc-dot${st.online ? ' on' : ''}`} aria-hidden="true" />
      <span className="mc-text">
        <strong>{st.name || 'Minecraft'} {st.online ? `· ${st.players.online}/${st.players.max} jogando agora` : '· fora do ar'}</strong>
        <span title={st.players?.sample?.join(', ') || ''}>{st.online ? (st.players.sample?.length ? st.players.sample.slice(0, 6).join(', ') : st.motd || address) : address}</span>
      </span>
      <button type="button" className="mc-copy" onClick={copy}>{copied ? 'Copiado!' : `Copiar IP`}</button>
    </div>
  );
}
