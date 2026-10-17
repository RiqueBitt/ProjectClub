// Engine de mídia RESERVA (Jitsi) — mesma "interface" conceitual que o
// caminho do Agora no VoiceContext: join, leave, mute, câmera, tela. Em vez
// de SFU + faixas locais, embute uma conferência do Jitsi (IFrame External
// API) e TRADUZ os eventos dela pro mesmo estado de UI que o app já
// renderiza (ver jitsiMapping.js).
//
// O que o Jitsi FAZ bem aqui: áudio/vídeo/tela reais entre todos, dentro do
// iframe (o próprio iframe toca o áudio e mostra o grid). O que DEGRADA
// (documentado em docs/voice-fallback.md): volume por pessoa, ensurdecer
// (mutar quem chega), apertar-pra-falar e escolha de microfone pela nossa
// UI — coisas que dependiam de faixas locais do Agora.
//
// O NÓ (getNode) é um <div> que o engine cria e mantém vivo
// independentemente de qual tela React está montada — assim o áudio
// continua tocando mesmo quando a pessoa sai da tela da chamada (janelinha/
// segundo plano). O VoiceChannelView só "pega emprestado" esse nó pra
// mostrar enquanto a tela está aberta, e devolve ao sair.

import { loadJitsiApi } from './loadJitsiApi.js';
import { mapJitsiEvent, buildJitsiOptions, JITSI_LISTENED_EVENTS } from './jitsiMapping.js';

export class JitsiEngine {
  constructor({ domain, callbacks = {} }) {
    this.domain = domain;
    this.cb = callbacks;
    this.api = null;
    this.myId = null;
    this.disposed = false;
    this.node = typeof document !== 'undefined' ? document.createElement('div') : null;
    if (this.node) {
      this.node.className = 'vc-jitsi-frame';
      this.node.style.width = '100%';
      this.node.style.height = '100%';
    }
    this._handlers = [];
  }

  getNode() { return this.node; }

  async join({ room, jwt, displayName, startMuted = false }) {
    const JitsiMeetExternalAPI = await loadJitsiApi(this.domain);
    if (this.disposed) return;
    const options = buildJitsiOptions({ room, jwt, displayName, parentNode: this.node, startMuted });
    const api = new JitsiMeetExternalAPI(this.domain, options);
    this.api = api;

    // Um único despachante: cada evento vira uma "ação" pura (mapJitsiEvent)
    // e é aplicada no estado via callbacks. Guardamos os handlers pra poder
    // remover no dispose.
    JITSI_LISTENED_EVENTS.forEach((event) => {
      const handler = (payload) => this._apply(event, payload);
      api.addListener(event, handler);
      this._handlers.push([event, handler]);
    });
  }

  _apply(event, payload) {
    if (this.disposed) return;
    const action = mapJitsiEvent(event, payload || {}, { myParticipantId: this.myId });
    switch (action.kind) {
      case 'joined':
        this.myId = action.myId;
        this.cb.onJoined?.(action.myId);
        break;
      case 'left':
        this.cb.onLeft?.();
        break;
      case 'dominant':
        this.cb.onLocalSpeaking?.(action.isMe);
        break;
      case 'self-mute':
        this.cb.onSelfMute?.(action.muted);
        break;
      case 'self-camera':
        this.cb.onSelfCamera?.(action.on);
        break;
      case 'self-screen':
        this.cb.onSelfScreen?.(action.on);
        break;
      case 'participant':
        this.cb.onParticipant?.(action.id, action.present, action.displayName);
        break;
      case 'error':
        this.cb.onError?.(action.event, action.payload);
        break;
      default:
        break;
    }
  }

  _exec(cmd, ...args) {
    try { this.api?.executeCommand?.(cmd, ...args); } catch { /* iframe já foi */ }
  }

  // ---- Comandos (dirigidos pela NOSSA barra de controles) ----
  // Jitsi alterna; passamos o estado DESEJADO e só mandamos o comando se
  // precisa trocar, pra não "desfazer" sem querer.
  setMicEnabled(enabled) {
    // enabled=true => quero falar => garantir NÃO-mutado.
    // O evento audioMuteStatusChanged confirma o estado real depois.
    this._toggleToDesired('isAudioMuted', 'toggleAudio', !enabled);
  }

  setCamera(on) { this._toggleToDesired('isVideoMuted', 'toggleVideo', !on); }

  setScreen(on) {
    // Não há getter confiável de "compartilhando" no External API; só
    // alternamos e confiamos no evento screenSharingStatusChanged pro estado.
    this._exec('toggleShareScreen');
    void on;
  }

  async _toggleToDesired(getter, command, desiredMuted) {
    try {
      const api = this.api;
      if (!api) return;
      const current = typeof api[getter] === 'function' ? await api[getter]() : null;
      if (current === null || current !== desiredMuted) this._exec(command);
    } catch {
      // Sem getter nessa versão: alterna assim mesmo (melhor que travar).
      this._exec(command);
    }
  }

  hangup() { this._exec('hangup'); }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    try {
      this._handlers.forEach(([event, handler]) => this.api?.removeListener?.(event, handler));
    } catch { /* ok */ }
    this._handlers = [];
    try { this.api?.dispose?.(); } catch { /* ok */ }
    this.api = null;
    try { this.node?.parentNode?.removeChild(this.node); } catch { /* ok */ }
  }
}

export default JitsiEngine;
