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
  if (!user?.selectedPendant) return null;
  return (
    <img
      className="pendant-icon"
      src={proxyImage(user.selectedPendant.iconUrl)}
      alt={user.selectedPendant.name}
      title={user.selectedPendant.name}
      style={{ width: size, height: size }}
    />
  );
}
