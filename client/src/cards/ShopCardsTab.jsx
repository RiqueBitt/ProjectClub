import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import PacksTab from './PacksShop.jsx';
import { Icon, UI } from './CardView.jsx';
import { cardsHome, errMsg } from './api';

// Categoria "Cartas" da Loja: pacotes do Jogo de Cartas com o mesmo saldo da Loja.
export default function ShopCardsTab({ onWallet }) {
  const navigate = useNavigate();
  const [home, setHome] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { cardsHome().then(setHome).catch((e) => setErr(errMsg(e, 'Não foi possível abrir as cartas.'))); }, []);
  if (err) return <p className="tcg-error">{err}</p>;
  if (!home) return <p className="tcg-empty">Carregando…</p>;
  return (
    <div className="shop-cards-tab">
      <div className="tcg-starter" style={{ marginTop: 0, marginBottom: 18 }}>
        <span className="tcg-starter-icon"><Icon d={UI.deck} size={28} /></span>
        <div>
          <strong>Pacotes de cartas da Arena</strong>
          <p>{home.starterAvailable ? 'Você ainda pode pegar o pacote inicial grátis na Arena!' : `Você tem ${home.collection.distinct} cartas diferentes. Use-as nos baralhos e duelos.`}</p>
        </div>
        <button type="button" className="tcg-btn primary" onClick={() => navigate('/cartas')}>Abrir a Arena</button>
      </div>
      <PacksTab home={home} onOpened={(w) => { if (w) { setHome((h) => ({ ...h, wallet: w })); onWallet?.(w); } }} />
    </div>
  );
}
