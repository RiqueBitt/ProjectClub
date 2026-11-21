import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getRecap, errText } from '../api/community';
import { useAuth } from '../context/AuthContext.jsx';
import { EmptyState, Ico, Skeleton } from '../components/PagesKit.jsx';
import UserAvatar from '../components/UserAvatar.jsx';
import { fmt, useFlash } from '../components/community/CommunityBits.jsx';
import '../styles/community4.css';

// "Sua retrospectiva de outubro": cartão do mês (gerado no dia 1º pelo
// servidor) com mensagens, call, Fórum, XP e conquistas — dá pra baixar
// como imagem ou compartilhar o resumo. Também mostra a prévia do mês atual.

const RARITY_LABEL = { COMMON: 'Comum', RARE: 'Rara', EPIC: 'Épica', LEGENDARY: 'Lendária' };

function hoursText(min) {
  if (!min) return '0 min';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}min` : `${h}h`;
}

function summaryText(name, r) {
  const parts = [
    `Minha retrospectiva de ${r.monthName} no Project Club:`,
    `${fmt(r.messages)} mensagens`,
    `${hoursText(r.voiceMinutes)} em call`,
    `${fmt(r.forumPosts)} posts no Fórum`,
    `${fmt(r.xp)} XP`,
    `${fmt(r.achievementsCount)} conquista(s)`,
  ];
  if (r.topPercent) parts.push(`Entre os ${r.topPercent}% mais ativos!`);
  return `${parts[0]}\n${parts.slice(1).join(' · ')}\n— ${name}`;
}

// Desenha o cartão num <canvas> (1080x1350) pra baixar como PNG.
function downloadCard(name, r) {
  const W = 1080; const H = 1350;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const brand = getComputedStyle(document.documentElement).getPropertyValue('--brand').trim() || '#5865f2';
  const grad = g.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, brand); grad.addColorStop(1, '#1b1d2a');
  g.fillStyle = grad; g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(255,255,255,.08)';
  for (let i = 0; i < 6; i += 1) { g.beginPath(); g.arc(W * (0.15 + 0.15 * i), 160 + (i % 2) * 90, 120 - i * 12, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = '#fff';
  g.font = '600 40px system-ui, sans-serif';
  g.fillText('Project Club', 80, 120);
  g.font = '800 82px system-ui, sans-serif';
  g.fillText(`Retrospectiva de ${r.monthName}`, 80, 300, W - 160);
  g.font = '500 44px system-ui, sans-serif';
  g.fillText(name, 80, 370, W - 160);
  const tiles = [
    [fmt(r.messages), 'mensagens'], [hoursText(r.voiceMinutes), 'em call'],
    [fmt(r.forumPosts), 'posts no Fórum'], [fmt(r.xp), 'XP ganho'],
    [fmt(r.reactions), 'reações'], [fmt(r.achievementsCount), 'conquistas'],
  ];
  tiles.forEach(([v, label], i) => {
    const x = 80 + (i % 2) * 470; const y = 460 + Math.floor(i / 2) * 230;
    g.fillStyle = 'rgba(255,255,255,.12)';
    g.beginPath(); g.roundRect ? g.roundRect(x, y, 440, 200, 28) : g.rect(x, y, 440, 200); g.fill();
    g.fillStyle = '#fff'; g.font = '800 72px system-ui, sans-serif'; g.fillText(v, x + 36, y + 110, 380);
    g.font = '500 34px system-ui, sans-serif'; g.fillStyle = 'rgba(255,255,255,.8)'; g.fillText(label, x + 36, y + 165, 380);
  });
  g.fillStyle = '#fff'; g.font = '700 42px system-ui, sans-serif';
  if (r.topPercent) g.fillText(`Entre os ${r.topPercent}% mais ativos do mês`, 80, 1220, W - 160);
  const a = document.createElement('a');
  a.download = `retrospectiva-${r.monthKey}.png`;
  a.href = c.toDataURL('image/png');
  a.click();
}

function Tile({ icon, value, label }) {
  return (
    <div className="c4-recap-tile">
      <Ico name={icon} size={20} />
      <strong>{value}</strong>
      <small>{label}</small>
    </div>
  );
}

export default function RetrospectivaPage() {
  const { mes } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [flash, show] = useFlash();
  useEffect(() => { setData(null); getRecap(mes).then(setData).catch((e) => setError(errText(e))); }, [mes]);
  const r = data?.recap;
  const name = user?.displayName || 'Eu';
  const text = useMemo(() => (r ? summaryText(name, r) : ''), [r, name]);

  const share = async () => {
    if (navigator.share) { try { await navigator.share({ title: `Retrospectiva de ${r.monthName}`, text }); return; } catch { /* cancelado */ } }
    try { await navigator.clipboard.writeText(text); show('Resumo copiado! É só colar onde quiser.'); } catch { show('Não deu pra copiar.', 'bad'); }
  };

  return (
    <div className="pk-page c4-page">
      <div className="pk-inner narrow">
        {error && <EmptyState icon="calendar" title="Não deu pra carregar" text={error} />}
        {!data && !error && <Skeleton rows={2} height={220} />}
        {data && !r && (
          <EmptyState icon="calendar" title="Sua primeira retrospectiva está chegando" text="No dia 1º de cada mês a gente junta tudo que você fez no mês anterior. Enquanto isso, veja como está este mês aqui embaixo." />
        )}
        {r && (
          <article className="c4-recap" aria-label={`Retrospectiva de ${r.monthName}`}>
            <header>
              <UserAvatar user={user} size={56} />
              <div>
                <small>Sua retrospectiva de</small>
                <h1>{r.monthName}</h1>
              </div>
            </header>
            {r.topPercent && <p className="c4-recap-badge"><Ico name="trophy" size={16} /> Entre os {r.topPercent}% mais ativos do mês</p>}
            <div className="c4-recap-grid">
              <Tile icon="chat" value={fmt(r.messages)} label="mensagens" />
              <Tile icon="volume" value={hoursText(r.voiceMinutes)} label="em call" />
              <Tile icon="news" value={fmt(r.forumPosts)} label="posts no Fórum" />
              <Tile icon="bolt" value={fmt(r.xp)} label="XP ganho" />
              <Tile icon="heart" value={fmt(r.reactions)} label="reações" />
              <Tile icon="trophy" value={fmt(r.achievementsCount)} label="conquistas" />
            </div>
            {r.achievements?.length > 0 && (
              <div className="c4-recap-ach">
                <small>Conquistas do mês</small>
                <ul>{r.achievements.map((a) => <li key={a.key}><Ico name="star" size={14} /> {a.name} <em>{RARITY_LABEL[a.rarity] || ''}</em></li>)}</ul>
              </div>
            )}
            <footer>
              <button type="button" className="pk-btn" onClick={() => downloadCard(name, r)}><Ico name="download" size={16} /> Baixar imagem</button>
              <button type="button" className="pk-btn primary" onClick={share}><Ico name="mail" size={16} /> Compartilhar</button>
            </footer>
          </article>
        )}
        {data?.months?.length > 1 && (
          <div className="pk-filters" role="group" aria-label="Outros meses">
            {data.months.map((m) => (
              <button key={m.monthKey} type="button" className={`pk-filter ${r?.monthKey === m.monthKey ? 'active' : ''}`} onClick={() => navigate(`/retrospectiva/${m.monthKey}`)}>
                {m.monthName} {m.monthKey.slice(0, 4)}
              </button>
            ))}
          </div>
        )}
        {data?.current && (
          <section className="pk-card c4-card">
            <h3 className="pk-section-title"><Ico name="clock" size={18} /> Este mês até agora ({data.current.monthName})</h3>
            <div className="c4-stats">
              <div><strong>{fmt(data.current.messages)}</strong><small>mensagens</small></div>
              <div><strong>{hoursText(data.current.voiceMinutes)}</strong><small>em call</small></div>
              <div><strong>{fmt(data.current.forumPosts)}</strong><small>posts</small></div>
              <div><strong>{fmt(data.current.xp)}</strong><small>XP</small></div>
            </div>
          </section>
        )}
      </div>
      {flash}
    </div>
  );
}
