import { useNavigate } from 'react-router-dom';
import { CardView, Icon, UI } from './CardView.jsx';
import { BoardBackdrop } from './BoardScene.jsx';
import '../styles/cards.css';

// Banner da Arena de Cartas no Início (pra ninguém precisar procurar o
// jogo dentro de Mini-Jogos). As cartas são só vitrine.
const SHOW = [
  { id: 's1', name: 'Fênix Rubra', element: 'FOGO', rarity: 'LENDARIA', cost: 6, attack: 6, health: 5, ability: 'GRITO_DANO', abilityValue: 3 },
  { id: 's2', name: 'Guardiã do Recife', element: 'AGUA', rarity: 'EPICA', cost: 4, attack: 3, health: 6, ability: 'GUARDA' },
  { id: 's3', name: 'Lâmina Sombria', element: 'SOMBRA', rarity: 'RARA', cost: 3, attack: 4, health: 2, ability: 'FURTIVO' },
];

export default function ArenaPromo() {
  const navigate = useNavigate();
  return (
    <section className="tcg-promo" aria-label="Arena de Cartas">
      <BoardBackdrop board={{ theme: 'abismo', dim: 20 }} />
      <div className="tcg-promo-text">
        <span className="tcg-promo-kicker"><Icon d={UI.star} size={13} />Jogo de cartas do Project Club</span>
        <h2>Arena de Cartas</h2>
        <p>Colecione cartas, abra pacotes, monte seu baralho e batalhe contra bots e amigos. Novos jogadores ganham um pacote de boas-vindas!</p>
        <div className="tcg-promo-actions">
          <button type="button" className="tcg-btn primary tcg-btn-xl" onClick={() => navigate('/cartas')}><Icon d={UI.sword} />Jogar agora</button>
          <button type="button" className="tcg-btn ghost" onClick={() => navigate('/cartas?aba=colecao')}>Ver coleção</button>
        </div>
      </div>
      <div className="tcg-promo-fan" aria-hidden="true">
        {SHOW.map((c, i) => <div key={c.id} className="tcg-promo-card" style={{ '--i': i - 1 }}><CardView card={c} size="sm" tilt={false} /></div>)}
      </div>
    </section>
  );
}
