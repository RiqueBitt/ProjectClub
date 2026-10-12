import { useNavigate } from 'react-router-dom';
import { EmptyState } from '../components/PagesKit.jsx';

// Tela de /cartas enquanto a Guerra das Cartas está desligada no código
// (utils/features.js → cardsWar). Vale pra qualquer link antigo — convite de
// sala (?sala=), partida (?partida=), aba (?aba=) — sem quebrar nada: nenhum
// pedido à API do jogo é feito daqui. Coleções e progresso ficam guardados.
export default function CardsDisabledPage() {
  const navigate = useNavigate();
  return (
    <div className="pk-page cards-disabled-page">
      <div className="pk-inner">
        <EmptyState
          icon="cards"
          title="Em breve"
          text="O Guerra das Cartas está temporariamente desativado. Suas cartas, baralhos e progresso continuam guardados — avisaremos quando ele voltar!"
          action={(
            <button type="button" className="pk-btn primary" onClick={() => navigate('/economia')}>
              Ir para a Economia
            </button>
          )}
        />
      </div>
    </div>
  );
}
