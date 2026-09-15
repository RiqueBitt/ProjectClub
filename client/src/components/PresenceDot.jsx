import { STATUS_COLOR } from '../utils/status';

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
export default function PresenceDot({ status, className = '', large, title, style }) {
  const color = STATUS_COLOR[status] || STATUS_COLOR.OFFLINE;
  return (
    <span
      className={`status-dot status-dot-${(status || 'offline').toLowerCase()} ${large ? 'large' : ''} ${className}`}
      style={{ '--presence-color': color, ...style }}
      title={title}
    />
  );
}
