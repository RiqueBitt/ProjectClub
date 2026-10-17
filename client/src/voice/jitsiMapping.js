// Tradução PURA de eventos da Jitsi IFrame External API para "ações" que o
// VoiceContext aplica no MESMO estado de UI que os outros engines alimentam
// (falando, mudo, câmera, tela, participante entrou/saiu, saiu da chamada).
// Sem DOM, sem React — testável com eventos simulados
// (client/test/voice-provider.test.mjs).
//
// Contexto importante: a lista de participantes, nomes, avatares, anel de
// "falando" dos OUTROS e o indicador de mudo dos outros já chegam pela
// NOSSA sinalização via Socket.IO (voice:join/state/speaking), independente
// do provedor de mídia. Então, no Jitsi, o essencial que precisamos
// traduzir é o MEU estado local (pra espelhar na UI e reemitir pros outros
// pelo socket) + começo/fim da conferência. Os eventos de participante do
// Jitsi (ids aleatórios do domínio público) são usados só como reforço.

// Nomes de evento da External API: ver modules/API/external/external_api.js
// no fonte de referência do Jitsi.
export function mapJitsiEvent(event, payload = {}, ctx = {}) {
  const myId = ctx.myParticipantId;
  switch (event) {
    case 'videoConferenceJoined':
      // payload: { roomName, id, displayName }
      return { kind: 'joined', myId: payload.id ?? null };

    case 'videoConferenceLeft':
    case 'readyToClose':
      return { kind: 'left' };

    case 'dominantSpeakerChanged':
      // payload: { id }. Só sabemos QUEM é o dominante — usamos pra espelhar
      // o MEU "falando". (Limitação aceita: indicador de fala por pessoa no
      // Jitsi é mais grosseiro que o dos SFUs.)
      return { kind: 'dominant', id: payload.id ?? null, isMe: !!myId && payload.id === myId };

    case 'audioMuteStatusChanged':
      // payload: { muted }
      return { kind: 'self-mute', muted: !!payload.muted };

    case 'videoMuteStatusChanged':
      // payload: { muted } — câmera. muted=false => câmera ligada.
      return { kind: 'self-camera', on: payload.muted === false };

    case 'screenSharingStatusChanged':
      // payload: { on, details }
      return { kind: 'self-screen', on: !!payload.on };

    case 'participantJoined':
      // payload: { id, displayName }
      return { kind: 'participant', id: payload.id ?? null, present: true, displayName: payload.displayName || null };

    case 'participantLeft':
      // payload: { id }
      return { kind: 'participant', id: payload.id ?? null, present: false };

    case 'errorOccurred':
    case 'cameraError':
    case 'micError':
      return { kind: 'error', event, payload };

    default:
      return { kind: 'ignore', event };
  }
}

// Config do iframe: conferência "enxuta" — sem pré-tela, sem pedir nome,
// sem barra de ferramentas própria (quem controla mudo/câmera/tela/sair é
// a NOSSA barra, via comandos). Mantém só o grid de vídeo/tela.
export function buildJitsiOptions({ room, jwt, displayName, parentNode, startMuted }) {
  return {
    roomName: room,
    parentNode,
    jwt: jwt || undefined,
    width: '100%',
    height: '100%',
    userInfo: { displayName: displayName || 'Membro' },
    configOverwrite: {
      prejoinPageEnabled: false,
      prejoinConfig: { enabled: false },
      startWithAudioMuted: !!startMuted,
      startWithVideoMuted: true,
      disableDeepLinking: true,
      disableThirdPartyRequests: true,
      enableWelcomePage: false,
      // Sem barra do Jitsi: a UI é a nossa. Deixa só o palco de vídeo.
      toolbarButtons: [],
      notifications: [],
      disablePolls: true,
      disableReactions: true,
    },
    interfaceConfigOverwrite: {
      TOOLBAR_BUTTONS: [],
      SHOW_JITSI_WATERMARK: false,
      SHOW_WATERMARK_FOR_GUESTS: false,
      DISABLE_JOIN_LEAVE_NOTIFICATIONS: true,
      HIDE_DEEP_LINKING_LOGO: true,
      MOBILE_APP_PROMO: false,
    },
  };
}

// Eventos que o engine precisa escutar (pra não registrar um por um na mão).
export const JITSI_LISTENED_EVENTS = [
  'videoConferenceJoined',
  'videoConferenceLeft',
  'readyToClose',
  'dominantSpeakerChanged',
  'audioMuteStatusChanged',
  'videoMuteStatusChanged',
  'screenSharingStatusChanged',
  'participantJoined',
  'participantLeft',
  'errorOccurred',
];
