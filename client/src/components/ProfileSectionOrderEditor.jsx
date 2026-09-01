import { useState } from 'react';
import { PROFILE_SECTION_LABELS, parseProfileSectionOrder } from '../utils/profileSections';

// Item pedido: "sistema igual da Steam" — aba "Colunas" nas
// Configurações, pra reordenar as seções do próprio perfil. Botões de
// mover pra cima/baixo em vez de arrastar-e-soltar de propósito: mais
// simples de usar corretamente numa tela pequena (celular) e não
// precisa de nenhuma biblioteca nova só pra isso.
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

  return (
    <div className="profile-section-order-editor">
      <p className="dim" style={{ fontSize: 13, marginBottom: 10 }}>
        Escolha a ordem em que as seções aparecem no seu perfil — igual a Steam deixa organizar a vitrine do seu perfil.
      </p>
      <ul className="profile-section-order-list">
        {order.map((key, i) => (
          <li key={key} className="profile-section-order-item">
            <span className="truncate">{PROFILE_SECTION_LABELS[key]}</span>
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
