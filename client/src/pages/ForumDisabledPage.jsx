import { useNavigate } from 'react-router-dom';
import { EmptyState } from '../components/PagesKit.jsx';

// Tela de /comunidades, /forum/… e /posts/… enquanto o Fórum está desligado
// no código (utils/features.js → forum). Nenhum pedido à API do Fórum sai
// daqui; temas, posts, votos e comentários continuam guardados no banco.
export default function ForumDisabledPage() {
  const navigate = useNavigate();
  return (
    <div className="pk-page forum-disabled-page">
      <div className="pk-inner">
        <EmptyState
          icon="doc"
          title="Em breve"
          text="O Fórum está temporariamente desativado. Os temas, posts e comentários continuam guardados — avisaremos quando ele voltar!"
          action={(
            <button type="button" className="pk-btn primary" onClick={() => navigate('/inicio')}>
              Ir para o Início
            </button>
          )}
        />
      </div>
    </div>
  );
}
