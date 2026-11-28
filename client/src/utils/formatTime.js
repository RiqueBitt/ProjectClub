import { useStore } from '../store/useStore';

// Item pedido: verificar se todos os toggles de Configurações têm efeito
// real. "Formato de horário" (12h/24h/auto) já existia na tela, salvava
// no banco, mas nenhum lugar da interface lia esse valor — todo lugar
// que mostrava hora usava toLocaleString/toLocaleTimeString direto,
// sempre no formato padrão do locale 'pt-BR' (24h), então escolher
// "12 horas" na tela nunca mudava nada de verdade em lugar nenhum.
//
// Centralizado aqui em vez de cada tela reimplementar a checagem —
// "auto" deixa o hour12 indefinido (o próprio Intl decide a partir do
// locale, comportamento de antes), "12h"/"24h" força explicitamente.
export function hour12Option() {
  const format = useStore.getState().userSettings?.timeFormat;
  if (format === '12h') return true;
  if (format === '24h') return false;
  return undefined; // "auto" (ou ainda não carregado) — deixa o locale decidir
}

// Dia+mês+hora — usado nas mensagens de chat (Message.jsx).
export function formatMessageTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: hour12Option() });
}

// Só hora — usado em chats de clã, suporte, etc.
export function formatTimeOnly(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: hour12Option() });
}

// Dia+mês+ano+hora — usado no rodapé de embed cards (link preview).
export function formatEmbedTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: hour12Option() });
}
