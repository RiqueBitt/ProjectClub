import { proxyImage } from '../utils/imageProxy';

// Item pedido: "pingentes... mini imagens que podem ser colocadas pelo
// usuário ao lado do seu nome... exibida no Mini Perfil / Perfil
// Completo ou no Chat... mas não exibido na lista de usuários no canto
// direito — como no Discord quando cargos possuem imagem atrelada."
// Componente pequeno de propósito: cada um dos 3 lugares que usa isso
// (MiniProfileCard, UserProfileModal, Message) já tem seu próprio
// jeito de mostrar nome+tags ao lado, então isso só entra no meio
// dessa fileira já existente, sem layout próprio.
export default function PendantIcon({ user, size = 16 }) {
  // Item pedido: "o pingente é uma imagem à escolha do usuário, que
  // ele pega dos seus arquivos" — a imagem própria enviada tem
  // prioridade sobre o catálogo (na prática só um dos dois existe de
  // cada vez, já que escolher um limpa o outro — ver
  // pendantController.js — mas checar os dois aqui deixa o componente
  // correto de qualquer forma).
  const url = user?.customPendantUrl || user?.selectedPendant?.iconUrl;
  if (!url) return null;
  const label = user?.customPendantUrl ? 'Pingente' : user?.selectedPendant?.name;
  return (
    <img
      className="pendant-icon"
      src={proxyImage(url)}
      alt={label}
      title={label}
      style={{ width: size, height: size }}
    />
  );
}
