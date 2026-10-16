import { useStore } from '../store/useStore';
import { STATUS_COLOR, STATUS_LABEL } from '../utils/status';

// Item pedido: "a bolinha amarela do ausente transforme numa bolinha
// parecida com a lua... o não perturbe, dentro dela tenha uma linha
// reta... online mantenha normal e invisível também... deixe as
// bolinhas 0,5 vezes maior em todos os lugares" — componente único
// reaproveitado em todo canto que já mostrava um <span
// className="status-dot" style={{ background: STATUS_COLOR[x] }} />
// (12 arquivos diferentes) — trocar a forma de cada status num lugar
// só, em vez de mexer em cada um dos 12 separadamente.
//
// Item pedido: "escolher a cor de fundo da bolha que mostra os
// status (Preto/Cinza/Branco)" — `style` opcional permite quem chama
// (hoje só MiniProfileCard.jsx) sobrescrever a variável
// --status-bubble-border, sem precisar de nenhuma prop nova
// específica aqui — continua sendo o mesmo componente genérico de
// sempre pra todos os outros 11 lugares que não passam nada.
//
// "Está no celular": com `userId`, se a pessoa está Online e TODAS as
// conexões dela são de celular (app Android ou site no celular — o
// servidor manda `mobile` na presença), a bolinha vira um celular verde.
export default function PresenceDot({ status, userId, className = '', large, title, style }) {
  const mobile = useStore((s) => (userId ? !!s.presence[userId]?.mobile : false));
  const color = STATUS_COLOR[status] || STATUS_COLOR.OFFLINE;
  if (mobile && status === 'ONLINE') {
    return (
      <span
        className={`status-dot status-dot-mobile ${large ? 'large' : ''} ${className}`}
        style={{ '--presence-color': color, ...style }}
        title={title || 'Online no celular'}
        role="img"
        aria-label="Online no celular"
      >
        <svg viewBox="0 0 10 16" aria-hidden="true"><rect x="0.6" y="0.6" width="8.8" height="14.8" rx="2" fill="currentColor" /><rect x="2" y="2.4" width="6" height="9.2" rx="0.6" fill="var(--status-ring)" /><circle cx="5" cy="13.4" r="0.9" fill="var(--status-ring)" /></svg>
      </span>
    );
  }
  return (
    <span
      className={`status-dot status-dot-${(status || 'offline').toLowerCase()} ${large ? 'large' : ''} ${className}`}
      style={{ '--presence-color': color, ...style }}
      title={title}
      // Leitor de tela: o status em palavras (não depende da cor).
      role="img"
      aria-label={STATUS_LABEL[status] || STATUS_LABEL.OFFLINE}
    />
  );
}
