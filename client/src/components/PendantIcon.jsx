import { proxyImage } from '../utils/imageProxy';

// Pingente: imagem (ou GIF) enviada pela própria pessoa, mostrada ao lado
// do nome no chat, no miniperfil e no perfil completo (nunca na lista de
// membros). O catálogo de pingentes criado pela staff foi removido — só
// vale a imagem própria (customPendantUrl).
//
// Nitidez: a imagem aparece INTEIRA (object-fit: contain, sem cortar nem
// arredondar) e o navegador recebe o tamanho real de exibição, então não
// fica borrada nem "comida" nas bordas.
export default function PendantIcon({ user, size = 20 }) {
  const url = user?.customPendantUrl;
  if (!url) return null;
  return (
    <img
      className="pendant-icon"
      src={proxyImage(url)}
      alt="Pingente"
      title="Pingente"
      width={size}
      height={size}
      decoding="async"
      draggable={false}
      style={{ width: size, height: size }}
    />
  );
}
