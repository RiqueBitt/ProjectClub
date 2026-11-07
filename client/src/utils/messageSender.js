import { useStore } from '../store/useStore';
import { sendMessage } from '../api/endpoints';
import { setRetry, clearRetry, setCancel, getCancel, clearCancel } from './chatComposerBus';
import { classifySendError, enqueueSend, dequeueSend, flushSendQueue, hasQueuedFor } from './sendQueue';

// Envio de uma mensagem otimista (a que já aparece na lista antes do
// servidor responder). Vive fora do ChatWindow de propósito: trocar de
// canal no meio de um upload ou com mensagens na fila offline não perde
// nada — tudo é aplicado no store pela sala (roomKey).
//
//  - Sem conexão / servidor fora (deploy): "Enviando quando a conexão
//    voltar…" e reenvio automático, na ordem (utils/sendQueue.js).
//  - Recusada pelo servidor (4xx): "Não foi enviada" + "Tentar de novo".
//  - Toda tentativa usa o MESMO nonce (o servidor não duplica).
//  - Com anexos: progresso real do upload (porcentagem) e cancelar.

const patch = (roomKey, id, p) => useStore.getState().patchMessage(roomKey, id, p);

// buildForm(): monta o FormData (pode ser async — ex.: esperar a compressão
// das fotos). trackUpload: mostra progresso/cancelar (envio com anexos).
export function deliverMessage({ roomKey, optimisticId, buildForm, trackUpload = false }) {
  const attempt = async () => {
    patch(roomKey, optimisticId, { pending: true, failed: false, queued: false, ...(trackUpload ? { upload: { pct: 0 } } : {}) });
    const controller = trackUpload && typeof AbortController !== 'undefined' ? new AbortController() : null;
    if (controller) setCancel(optimisticId, () => controller.abort());
    let lastPct = -1;
    try {
      const fd = await buildForm();
      const opts = controller ? {
        signal: controller.signal,
        onUploadProgress: (e) => {
          const pct = e.total ? Math.min(100, Math.round((e.loaded / e.total) * 100)) : null;
          if (pct === lastPct) return;
          lastPct = pct;
          patch(roomKey, optimisticId, { upload: { pct, loaded: e.loaded, total: e.total || null } });
        },
      } : {};
      const { message } = await sendMessage(fd, opts);
      clearCancel(optimisticId);
      clearRetry(optimisticId);
      useStore.getState().resolveOptimisticMessage(roomKey, optimisticId, message);
      return 'ok';
    } catch (err) {
      clearCancel(optimisticId);
      const kind = classifySendError(err);
      if (kind === 'canceled') {
        discardOptimistic(roomKey, optimisticId);
        return 'ok';
      }
      if (kind === 'retry') {
        patch(roomKey, optimisticId, { pending: false, failed: false, queued: true, upload: null });
        // "Tentar de novo" numa mensagem na fila: tenta a fila agora (na ordem).
        setRetry(optimisticId, () => { flushSendQueue(); });
        enqueueSend(optimisticId, attempt, roomKey);
        return 'retry';
      }
      dequeueSend(optimisticId);
      patch(roomKey, optimisticId, { pending: false, failed: true, queued: false, upload: null });
      setRetry(optimisticId, () => { attempt(); });
      const serverMsg = err?.response?.data?.error;
      if (serverMsg) useStore.getState().pushNotice(serverMsg);
      return 'fail';
    }
  };

  // Já tem mensagem desta sala esperando a conexão: entra no fim da fila
  // (nunca passa na frente das mais antigas).
  if (hasQueuedFor(roomKey)) {
    patch(roomKey, optimisticId, { pending: false, queued: true });
    setRetry(optimisticId, () => { flushSendQueue(); });
    enqueueSend(optimisticId, attempt, roomKey);
    flushSendQueue();
    return;
  }
  attempt();
}

// "Descartar" / cancelar: tira da fila, cancela o upload e apaga da lista.
export function discardOptimistic(roomKey, id) {
  const cancel = getCancel(id);
  clearCancel(id);
  clearRetry(id);
  dequeueSend(id);
  try { cancel?.(); } catch { /* já terminou */ }
  useStore.getState().removeMessage(roomKey, id);
}
