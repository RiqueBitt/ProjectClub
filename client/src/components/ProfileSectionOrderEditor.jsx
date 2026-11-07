import { useState } from 'react';
import { PROFILE_SECTION_LABELS, DISABLED_PROFILE_SECTIONS, parseProfileSectionOrder } from '../utils/profileSections';

// Item pedido: "sistema igual da Steam" — aba "Colunas" nas
// Configurações, pra reordenar as seções do próprio perfil. Botões de
// mover pra cima/baixo em vez de arrastar-e-soltar de propósito: mais
// simples de usar corretamente numa tela pequena (celular) e não
// precisa de nenhuma biblioteca nova só pra isso. Item pedido depois:
// "pode desativar qualquer uma também" — checkbox de mostrar/ocultar
// ao lado de cada uma, sem precisar remover ela da lista de ordem
// (assim, se a pessoa reativar depois, ela volta pro mesmo lugar).
//
// Item pedido depois: desativar algumas seções GLOBALMENTE (ver
// DISABLED_PROFILE_SECTIONS) sem apagar nada do sistema — esse editor
// só trabalha com as seções que NÃO estão nessa lista, pra não
// mostrar um controle de "mostrar/ocultar" pra algo que já está
// desligado pra todo mundo (confuso, e as setas de mover não fariam
// nada visível se o item vizinho fosse um item desativado invisível).
// As desativadas ficam preservadas do jeito que estavam no JSON
// salvo, sem o editor nem tocar nelas.
export default function ProfileSectionOrderEditor({ value, onChange }) {
  const [fullOrder, setFullOrder] = useState(() => parseProfileSectionOrder(value));
  const enabledOrder = fullOrder.filter((item) => !DISABLED_PROFILE_SECTIONS.includes(item.key));

  // Troca dois itens de lugar DENTRO da lista completa (que inclui as
  // desativadas, preservadas do jeito que estavam) — localizando pelo
  // key em vez de índice, já que o índice visível (na lista filtrada)
  // não bate com o índice real no array completo.
  const swapByKey = (keyA, keyB) => {
    const next = [...fullOrder];
    const idxA = next.findIndex((item) => item.key === keyA);
    const idxB = next.findIndex((item) => item.key === keyB);
    if (idxA === -1 || idxB === -1) return;
    [next[idxA], next[idxB]] = [next[idxB], next[idxA]];
    setFullOrder(next);
    onChange(JSON.stringify(next));
  };

  const move = (visibleIndex, direction) => {
    const targetIndex = visibleIndex + direction;
    if (targetIndex < 0 || targetIndex >= enabledOrder.length) return;
    swapByKey(enabledOrder[visibleIndex].key, enabledOrder[targetIndex].key);
  };

  const toggleHidden = (key) => {
    const next = fullOrder.map((item) => (item.key === key ? { ...item, hidden: !item.hidden } : item));
    setFullOrder(next);
    onChange(JSON.stringify(next));
  };

  return (
    <div className="profile-section-order-editor">
      <p className="dim" style={{ fontSize: 13, marginBottom: 10 }}>
        Escolha a ordem em que as seções aparecem no seu perfil, e desative as que não quiser mostrar — igual a Steam deixa organizar a vitrine do seu perfil.
      </p>
      <ul className="profile-section-order-list">
        {enabledOrder.map((item, i) => (
          <li key={item.key} className={`profile-section-order-item ${item.hidden ? 'hidden' : ''}`}>
            <label className="checkbox-row profile-section-order-visibility">
              <input type="checkbox" checked={!item.hidden} onChange={() => toggleHidden(item.key)} title={item.hidden ? 'Mostrar seção' : 'Ocultar seção'} />
            </label>
            <span className="truncate">{PROFILE_SECTION_LABELS[item.key]}</span>
            <div className="profile-section-order-buttons">
              <button type="button" disabled={i === 0} onClick={() => move(i, -1)} title="Mover pra cima">↑</button>
              <button type="button" disabled={i === enabledOrder.length - 1} onClick={() => move(i, 1)} title="Mover pra baixo">↓</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
