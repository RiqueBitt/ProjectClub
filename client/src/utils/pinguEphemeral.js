// Respostas do Pingu que só a própria pessoa vê (resumo do que perdeu,
// tradução de mensagem). O pedido vai por HTTP e o servidor responde 202
// na hora; o resultado chega depois pelo socket pessoal 'pingu:ephemeral'
// (ver server/src/routes/pingu.js). Nada disso é postado no canal.
import { create } from 'zustand';
import { requestPinguSummary, requestPinguTranslation } from '../api/endpoints';

// Sem resposta em 3 min (ex.: servidor reiniciou): desiste com aviso.
const GIVE_UP_MS = 3 * 60 * 1000;
const OFFLINE = 'O Pingu está offline agora. Tenta de novo mais tarde! 🐧';

export const usePinguEphemeral = create(() => ({
  // Painel flutuante (resumo / aviso): { kind, title, text, error, loading, channelId }
  panel: null,
  // Traduções por mensagem: { [messageId]: { loading, text, error, target } }
  translations: {},
  // Pedidos esperando resposta: { [requestId]: { kind, messageId?, channelId? } }
  pending: {},
}));

const set = (fn) => usePinguEphemeral.setState(fn);
const errorText = (e) => e?.response?.data?.error || (e?.response?.status === 503 ? OFFLINE : 'Não deu pra falar com o Pingu agora.');

const LANG_LABEL = { 'pt-BR': 'português', en: 'inglês', es: 'espanhol', fr: 'francês', de: 'alemão', it: 'italiano', ja: 'japonês' };
export const langLabel = (l) => LANG_LABEL[l] || l || '';

function watch(requestId, info) {
  set((s) => ({ pending: { ...s.pending, [requestId]: info } }));
  setTimeout(() => {
    if (!usePinguEphemeral.getState().pending[requestId]) return;
    handlePinguEphemeral({ requestId, ...info, error: 'O Pingu demorou demais pra responder. Tenta de novo daqui a pouco.' });
  }, GIVE_UP_MS);
}

export function closePinguPanel() { set({ panel: null }); }

/** "Resumir o que perdi" — `since` = última leitura que o app conhecia ao abrir o canal. */
export async function requestSummary(channelId, { since = null, channelName = '' } = {}) {
  const title = channelName ? `Resumo de #${channelName}` : 'Resumo do que você perdeu';
  set({ panel: { kind: 'summary', title, loading: true, channelId } });
  try {
    const r = await requestPinguSummary(channelId, since || null);
    if (r?.requestId) watch(r.requestId, { kind: 'summary', channelId, title });
  } catch (e) {
    set({ panel: { kind: 'summary', title, error: errorText(e), channelId } });
  }
}

/** "Traduzir com o Pingu" — idioma do app vai junto (se a mensagem já for pt-BR). */
export async function requestTranslation(message, lang) {
  const id = message.id;
  set((s) => ({ translations: { ...s.translations, [id]: { loading: true } } }));
  try {
    const r = await requestPinguTranslation(id, lang);
    if (r?.text) set((s) => ({ translations: { ...s.translations, [id]: { text: r.text, target: r.target } } }));
    else if (r?.requestId) watch(r.requestId, { kind: 'translate', messageId: id, target: r.target });
  } catch (e) {
    set((s) => ({ translations: { ...s.translations, [id]: { error: errorText(e) } } }));
  }
}

export function hideTranslation(messageId) {
  set((s) => {
    const next = { ...s.translations };
    delete next[messageId];
    return { translations: next };
  });
}

/** Chegou do socket (ou desistiu por tempo). */
export function handlePinguEphemeral(payload) {
  if (!payload) return;
  const st = usePinguEphemeral.getState();
  const info = payload.requestId ? st.pending[payload.requestId] : null;
  if (payload.requestId) {
    if (!info) return; // já tratado (ou de outra aba antiga)
    set((s) => {
      const pending = { ...s.pending };
      delete pending[payload.requestId];
      return { pending };
    });
  }
  const kind = payload.kind || info?.kind;
  if (kind === 'translate') {
    const id = payload.messageId || info?.messageId;
    if (!id) return;
    set((s) => ({ translations: { ...s.translations, [id]: payload.error ? { error: payload.error } : { text: payload.text, target: payload.target || info?.target } } }));
    return;
  }
  // Resumo (inclusive o "@pingu resume" escrito no canal) e avisos.
  // Pingu Turbo: avisos dos comandos (ajuda, lembrete, enquete) trazem o próprio título.
  const title = info?.title || payload.title || (kind === 'summary' ? 'Resumo do que você perdeu' : 'Pingu');
  set({ panel: { kind: kind || 'info', title, text: payload.text || '', error: payload.error || '', channelId: payload.channelId || info?.channelId } });
}
