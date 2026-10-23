// BUG CORRIGIDO — "no PC não sai áudio nenhum do microfone, mas no
// celular funciona normal, e o PC continua ouvindo os outros
// normalmente": esse padrão específico (getUserMedia() dá certo, SEM
// nenhum erro/exceção, a permissão do site aparece concedida, a chamada
// conecta e o PC recebe áudio dos outros de boa) é a assinatura clássica
// do sistema operacional bloqueando o acesso ao microfone GLOBALMENTE
// para o navegador — não é algo que o site pediu e foi negado, é uma
// configuração de privacidade do próprio Windows/macOS que existe FORA
// do navegador:
//   Windows: Configurações > Privacidade e segurança > Microfone >
//     "Acesso ao microfone" e principalmente "Permitir que os aplicativos
//     de área de trabalho acessem seu microfone" desligado — isso corta o
//     Chrome/Edge (que rodam como app de área de trabalho) mesmo com a
//     permissão do site em https://.../ toda verde.
//   macOS: Ajustes do Sistema > Privacidade e Segurança > Microfone > o
//     navegador precisa estar marcado na lista.
// Quando isso acontece, o navegador não recebe NENHUM sinal de erro — ele
// entrega uma MediaStreamTrack válida, "ao vivo", só que ela carrega
// silêncio puro o tempo todo. Todo o resto do pipeline (RNNoise, os
// RTCPeerConnections, o addTrack) funciona perfeitamente com essa faixa,
// porque do ponto de vista do WebRTC não há erro nenhum — só não existe
// áudio de verdade dentro dela. Isso é indistinguível de "ninguém está
// falando" olhando só o código de chamada; só dá pra pegar isso medindo o
// nível de energia do sinal por um tempo e vendo que ele NUNCA sai do
// zero absoluto (silêncio real de sala sempre tem algum ruído de fundo
// mínimo — é isso que diferencia dos dois casos).
//
// Roda em paralelo, não bloqueia a entrada na chamada — só avisa a
// pessoa com um caminho concreto pra resolver, em vez da chamada
// simplesmente "não funcionar" sem explicação nenhuma.
const SILENCE_CHECK_MS = 3000;
// 0-255 (escala do AnalyserNode) — bem abaixo de qualquer ruído de sala
// real (ventilador, respiração, ruído elétrico do próprio circuito do
// microfone), pega especificamente silêncio digital "perfeito demais pra
// ser real", que é a marca registrada de um microfone bloqueado no SO.
const SILENCE_LEVEL_THRESHOLD = 2;

// BUG CORRIGIDO — "testar microfone nas Configurações funciona (a
// barrinha sobe), mas a chamada continua sem mandar áudio nenhum": em
// alguns PCs (certas interfaces de áudio USB, cabos de áudio virtuais,
// alguns headsets Bluetooth em modo hands-free), pedir o microfone COM
// echoCancellation/noiseSuppression/autoGainControl (que é como
// acquireMicStream, em VoiceContext.jsx, sempre tentava primeiro) não
// lança nenhum erro — o navegador entrega uma MediaStreamTrack "ao vivo"
// e válida, só que ela nunca carrega áudio real, só silêncio puro. O
// teste de microfone das Configurações nunca pega isso porque ele pede
// só "audio: true" simples, sem nenhuma dessas constraints — capta áudio
// de verdade no MESMO PC, daí a barrinha subir normalmente ali enquanto
// a chamada (que até agora só reagia a ERROS do getUserMedia, nunca a
// "deu certo mas veio mudo") continuava sem mandar nada. Esta função
// mede o nível de sinal de um stream por um intervalo curto e devolve se
// veio áudio de verdade — usada por acquireMicStream para descartar uma
// tentativa "muda" e cair pra próxima constraint mais simples ANTES de
// aceitar o microfone pra chamada, em vez de só avisar depois que a
// pessoa já entrou (mudo) na chamada.
export function probeSignal(stream, ms = 700, threshold = SILENCE_LEVEL_THRESHOLD) {
  return new Promise((resolve) => {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx || !stream?.getAudioTracks().length) { resolve(true); return; }
      const ctx = new AudioCtx();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      let maxSeen = 0;
      const poll = setInterval(() => {
        try {
          analyser.getByteFrequencyData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) sum += data[i];
          const avg = sum / data.length;
          if (avg > maxSeen) maxSeen = avg;
        } catch { /* um tick ruim não deve derrubar o resto */ }
      }, 100);
      setTimeout(() => {
        clearInterval(poll);
        try { source.disconnect(); analyser.disconnect(); ctx.close().catch(() => {}); } catch { /* já desconectado */ }
        resolve(maxSeen > threshold);
      }, ms);
    } catch {
      // Qualquer falha ao medir (não deveria travar a captura por causa
      // disso) conta como "sinal ok" — deixa acquireMicStream aceitar a
      // faixa normalmente, sem bloquear a chamada por causa do próprio
      // diagnóstico.
      resolve(true);
    }
  });
}

// Observa `rawStream` por alguns segundos; chama `onSilentDetected()' uma
// única vez se o microfone nunca produzir nenhum sinal acima do limiar de
// silêncio digital. Devolve uma função de limpeza — chame-a se a pessoa
// sair da chamada/trocar de microfone antes do check terminar, para não
// segurar um AudioContext extra aberto à toa nem disparar o aviso depois
// que já não faz mais sentido.
export function watchForSilentMic(rawStream, onSilentDetected) {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx || !rawStream?.getAudioTracks().length) return () => {};
    const ctx = new AudioCtx();
    const source = ctx.createMediaStreamSource(rawStream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    let maxSeen = 0;
    let done = false;

    const poll = setInterval(() => {
      try {
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        const avg = sum / data.length;
        if (avg > maxSeen) maxSeen = avg;
      } catch { /* um tick ruim não deve derrubar o resto */ }
    }, 150);

    const cleanup = () => {
      clearInterval(poll);
      clearTimeout(timer);
      try { source.disconnect(); analyser.disconnect(); ctx.close().catch(() => {}); } catch { /* já desconectado */ }
    };

    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      cleanup();
      if (maxSeen <= SILENCE_LEVEL_THRESHOLD) onSilentDetected();
    }, SILENCE_CHECK_MS);

    return () => { if (!done) { done = true; cleanup(); } };
  } catch {
    return () => {};
  }
}
