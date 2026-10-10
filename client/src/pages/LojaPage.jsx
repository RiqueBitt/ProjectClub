import { useNavigate } from 'react-router-dom';
import '../styles/socialx.css';

// Canal em destaque "Loja" — ainda vazio, só a tela de "Em breve".
const ICONS = {
  bag: 'M5 8h14l-1 12H6L5 8zM9 8V6a3 3 0 0 1 6 0v2',
  coin: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM9.5 9.5a2.5 2 0 0 1 5 0c0 2.5-5 1.5-5 4a2.5 2 0 0 0 5 0M12 6v2M12 16v2',
  sparkle: 'M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2 2-5Z',
  gift: 'M4 11h16v9H4zM3 7h18v4H3zM12 7v13M12 7S10 3 7.5 4 9 7 12 7ZM12 7s2-4 4.5-3S15 7 12 7Z',
};
function Ico({ name, size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ICONS[name]} /></svg>
  );
}

export default function LojaPage() {
  const navigate = useNavigate();
  return (
    <div className="sx-page">
      <div className="sx-inner">
        <section className="sx-soon">
          <span className="sx-soon-icon"><Ico name="bag" size={40} /></span>
          <span className="sx-soon-chip">Em breve</span>
          <h1>Loja</h1>
          <p>Estamos preparando a loja da comunidade. Logo você vai poder trocar suas moedas por itens exclusivos pro seu perfil.</p>
          <div className="sx-soon-grid">
            <div className="sx-soon-card"><Ico name="sparkle" size={22} />Itens de perfil<span>Molduras, efeitos e fundos</span></div>
            <div className="sx-soon-card"><Ico name="coin" size={22} />Use suas moedas<span>As que você já ganha no app</span></div>
            <div className="sx-soon-card"><Ico name="gift" size={22} />Presentes<span>Mande algo pra um amigo</span></div>
          </div>
          <button type="button" className="sx-btn ghost" style={{ marginTop: 12 }} onClick={() => navigate('/economia')}>Ver minhas moedas</button>
        </section>
      </div>
    </div>
  );
}
