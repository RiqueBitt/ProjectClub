import { setChatZoom, setInterfaceZoom } from '../api/endpoints';
import { trackSave } from './saveIndicator';

// Salvar o zoom na conta SÓ quando a pessoa mexe no controle, e só depois
// que ela para de mexer. Antes cada "tique" do slider (e cada tecla no
// campo de %) mandava um PATCH na hora — os logs mostraram
// /users/me/interface-zoom 13x e /chat-zoom 8x em 7 minutos. Agora:
// - espera 700ms sem mudança antes de salvar (arrastar o slider = 1 PATCH);
// - não manda nada se o valor final é o mesmo que já está salvo;
// - carregar/sincronizar o zoom (login, outro aparelho) nunca chama isso —
//   esses caminhos só mexem no store (AuthContext/useGlobalLiveRefresh).
const DELAY_MS = 700;

function makeSaver(request) {
  let timer = null;
  let pending = null;
  let saved = null; // último valor confirmado (ou conhecido) na conta
  const flush = () => {
    clearTimeout(timer);
    timer = null;
    if (pending === null) return;
    const value = pending;
    pending = null;
    if (saved !== null && Math.abs(saved - value) < 1e-6) return;
    const prevSaved = saved;
    saved = value;
    trackSave(request(value)).catch(() => { if (saved === value) saved = prevSaved; });
  };
  return {
    // Valor que já está na conta (vindo do login) — evita salvar igual.
    known(value) { if (saved === null && pending === null && Number.isFinite(value)) saved = value; },
    schedule(value) {
      if (!Number.isFinite(value)) return;
      pending = value;
      clearTimeout(timer);
      timer = setTimeout(flush, DELAY_MS);
    },
    flush,
  };
}

export const chatZoomSaver = makeSaver(setChatZoom);
export const interfaceZoomSaver = makeSaver(setInterfaceZoom);

// Fechou a aba/janela no meio da espera: salva na hora.
if (typeof window !== 'undefined') {
  const flushAll = () => { chatZoomSaver.flush(); interfaceZoomSaver.flush(); };
  window.addEventListener('pagehide', flushAll);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushAll(); });
}
