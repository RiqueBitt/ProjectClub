import { useEffect, useRef } from 'react';
import { useStore } from '../store/useStore';

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
    <div className="notice-toast-stack" role="status" aria-live="polite">
      {notices.map((n) => {
        const kind = n.kind || kindOf(n.message);
        return (
          <div key={n.id} className={`notice-toast nt-${kind}`}>
            <span className="nt-icon" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={ICONS[kind]} /></svg>
            </span>
            <span className="notice-toast-text">{n.message}</span>
            {n.action && (
              <button
                type="button"
                className="notice-toast-action"
                onClick={() => { n.action.onClick(); dismissNotice(n.id); }}
              >
                {n.action.label}
              </button>
            )}
            <button type="button" className="nt-close" aria-label="Fechar aviso" onClick={() => dismissNotice(n.id)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
            </button>
            <span className="nt-timer" aria-hidden="true" />
          </div>
        );
      })}
    </div>
  );
}

// Tipo do aviso (cor + ícone) deduzido do texto quando quem chamou
// pushNotice não informou — evita mexer nas dezenas de chamadas existentes.
const ICONS = {
  error: 'M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
  success: 'M22 11.1V12a10 10 0 1 1-5.9-9.1M22 4 12 14l-3-3',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM12 16v-4M12 8h.01',
};
function kindOf(message = '') {
  const m = String(message).toLowerCase();
  if (/não foi possível|nao foi possivel|erro|falh|inválid|negad|limite|grande demais|sem permissão/.test(m)) return 'error';
  if (/salv|aplicad|atualizad|enviad|criad|pronto|sucesso|concluíd|instalad|ativad|!$/.test(m)) return 'success';
  return 'info';
}
