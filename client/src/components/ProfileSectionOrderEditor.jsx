import { useState } from 'react';
import { PROFILE_SECTION_LABELS, parseProfileSectionOrder } from '../utils/profileSections';

// Item pedido: "sistema igual da Steam" — aba "Colunas" nas
// Configurações, pra reordenar as seções do próprio perfil. Botões de
// mover pra cima/baixo em vez de arrastar-e-soltar de propósito: mais
// simples de usar corretamente numa tela pequena (celular) e não
// precisa de nenhuma biblioteca nova só pra isso. Item pedido depois:
// "pode desativar qualquer uma também" — checkbox de mostrar/ocultar
// ao lado de cada uma, sem precisar remover ela da lista de ordem
// (assim, se a pessoa reativar depois, ela volta pro mesmo lugar).
export default function ProfileSectionOrderEditor({ value, onChange }) {
  const [order, setOrder] = useState(() => parseProfileSectionOrder(value));

  const move = (index, direction) => {
    const target = index + direction;
    if (target < 0 || target >= order.length) return;
    const next = [...order];
    [next[index], next[target]] = [next[target], next[index]];
    setOrder(next);
    onChange(JSON.stringify(next));
  };

  const toggleHidden = (index) => {
    const next = order.map((item, i) => (i === index ? { ...item, hidden: !item.hidden } : item));
    setOrder(next);
    onChange(JSON.stringify(next));
  };

  return (
    <div className="profile-section-order-editor">
      <p className="dim" style={{ fontSize: 13, marginBottom: 10 }}>
        Escolha a ordem em que as seções aparecem no seu perfil, e desative as que não quiser mostrar — igual a Steam deixa organizar a vitrine do seu perfil.
      </p>
      <ul className="profile-section-order-list">
        {order.map((item, i) => (
          <li key={item.key} className={`profile-section-order-item ${item.hidden ? 'hidden' : ''}`}>
            <label className="checkbox-row profile-section-order-visibility">
              <input type="checkbox" checked={!item.hidden} onChange={() => toggleHidden(i)} title={item.hidden ? 'Mostrar seção' : 'Ocultar seção'} />
            </label>
            <span className="truncate">{PROFILE_SECTION_LABELS[item.key]}</span>
            <div className="profile-section-order-buttons">
              <button type="button" disabled={i === 0} onClick={() => move(i, -1)} title="Mover pra cima">↑</button>
              <button type="button" disabled={i === order.length - 1} onClick={() => move(i, 1)} title="Mover pra baixo">↓</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
