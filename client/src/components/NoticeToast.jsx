import { useEffect, useRef } from 'react';
import { useStore } from '../store/useStore';
import cancelIcon from '../assets/icons/cancel.png';

// Dismissible toast queue for moderation notices (timeout applied, warning
// received, anti-raid alert). Rendered at the app-shell root so it's
// visible regardless of which page/modal is currently open.
//
// BUG CORRIGIDO ("o menuzinho de baixando atualizações fica ali cobrindo
// a tela e atrapalhando"): o useEffect antigo criava um timer novo pra
// TODA a lista inteira sempre que ELA MUDAVA (não só quando uma
// notificação NOVA chegava) — e o cleanup CANCELAVA os timers antigos
// no processo. Isso significa que cada notificação nova reiniciava o
// relógio de 8s de TODAS as outras que já estavam na tela, não só da
// dela mesma. Se algum fluxo gerar notificações em sequência rápida
// (o processo de atualização do app é um exemplo real — "baixando a
// atualização" seguido de "autorize instalar apps de fontes
// desconhecidas" pouco depois), as notificações mais antigas nunca
// chegavam a completar seus 8 segundos, ficando "presas" na tela por
// bem mais tempo do que deveriam. Agora cada notificação agenda seu
// PRÓPRIO timer assim que é criada (scheduledIdsRef guarda quais ids já
// têm um agendado, pra não duplicar se o componente re-renderizar por
// outro motivo) — nunca é afetada pelas notificações vizinhas.
export default function NoticeToast() {
  const notices = useStore((s) => s.notices);
  const dismissNotice = useStore((s) => s.dismissNotice);
  const scheduledIdsRef = useRef(new Set());

  useEffect(() => {
    const scheduledIds = scheduledIdsRef.current;
    for (const n of notices) {
      if (scheduledIds.has(n.id)) continue;
      scheduledIds.add(n.id);
      setTimeout(() => { dismissNotice(n.id); scheduledIds.delete(n.id); }, 8000);
    }
    // Limpa ids de notificações que já sumiram por outro motivo (fechadas
    // manualmente antes do timer disparar), pra não vazar memória.
    const currentIds = new Set(notices.map((n) => n.id));
    for (const id of scheduledIds) { if (!currentIds.has(id)) scheduledIds.delete(id); }
  }, [notices, dismissNotice]);

  if (notices.length === 0) return null;

  return (
    <div className="notice-toast-stack">
      {notices.map((n) => (
        <div key={n.id} className="notice-toast">
          <span className="notice-toast-text">{n.message}</span>
          {n.action && (
            <button
              className="notice-toast-action"
              onClick={() => { n.action.onClick(); dismissNotice(n.id); }}
            >
              {n.action.label}
            </button>
          )}
          <button className="icon-btn-small" onClick={() => dismissNotice(n.id)}><img className="ui-icon-sm" src={cancelIcon} alt="x" /></button>
        </div>
      ))}
    </div>
  );
}
