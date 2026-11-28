// Gravador dos Clipes (roda na janela escondida clips/recorder.html).
// O processo principal (clipsManager.js) chama window.clipRecorder.start()
// com as opções já decididas (tela/janela escolhida lá, no
// setDisplayMediaRequestHandler da sessão desta janela). Os pedaços do
// MediaRecorder (~1 s cada) vão pro principal, que guarda só os últimos
// ~30 s na memória (clipBuffer.js). Nada é gravado em disco aqui e nada
// sai do computador.
(() => {
  const bridge = window.clipBridge;
  let stream = null;
  let recorder = null;
  let queue = Promise.resolve();
  let generation = 0;

  const report = (state) => { try { bridge.state(state); } catch { /* principal fechando */ } };

  function pickMime(list, audio) {
    for (const m of list || []) {
      if (!audio && m.includes('opus')) continue;
      try { if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) return m; } catch { /* segue */ }
    }
    return '';
  }

  function stopTracks() {
    if (stream) for (const t of stream.getTracks()) { try { t.stop(); } catch { /* já parou */ } }
    stream = null;
  }

  async function stop() {
    generation += 1;
    const r = recorder;
    recorder = null;
    if (r && r.state !== 'inactive') { try { r.stop(); } catch { /* já parou */ } }
    stopTracks();
  }

  async function start(opts) {
    await stop();
    const my = generation;
    const o = opts || {};
    try {
      const video = {
        width: { ideal: o.width, max: o.width },
        height: { ideal: o.height, max: o.height },
        frameRate: { ideal: o.fps, max: o.fps },
      };
      let s;
      try {
        s = await navigator.mediaDevices.getDisplayMedia({ video, audio: !!o.audio });
      } catch (err) {
        // Plano B (só vídeo): API antiga do Chromium com o id da fonte
        // escolhida pelo principal — sem som, de propósito.
        if (!o.sourceId) throw err;
        s = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: o.sourceId, maxWidth: o.width, maxHeight: o.height, maxFrameRate: o.fps } },
        });
      }
      if (my !== generation) { for (const t of s.getTracks()) t.stop(); return; }
      stream = s;
      // Som que não foi pedido nunca entra no clipe.
      if (!o.audio) for (const t of stream.getAudioTracks()) { t.stop(); stream.removeTrack(t); }
      const hasAudio = stream.getAudioTracks().length > 0;
      const mimeType = pickMime(o.mimeTypes, hasAudio);
      if (!mimeType) throw new Error('Nenhum formato de vídeo WebM disponível neste computador.');
      const options = {
        mimeType,
        videoBitsPerSecond: o.videoBitsPerSecond,
        // Quadro-chave a cada 2 s: o clipe sempre começa perto dos 30 s pedidos.
        videoKeyFrameIntervalDuration: 2000,
      };
      if (hasAudio) options.audioBitsPerSecond = o.audioBitsPerSecond;
      const rec = new MediaRecorder(stream, options);
      rec.ondataavailable = (e) => {
        if (!e.data || !e.data.size || my !== generation) return;
        // Em fila: os pedaços chegam no principal na mesma ordem.
        queue = queue.then(async () => { if (my === generation) bridge.chunk(await e.data.arrayBuffer()); }).catch(() => {});
      };
      rec.onerror = (e) => { report({ recording: false, error: String(e?.error?.message || 'Falha no gravador') }); stop(); };
      const track = stream.getVideoTracks()[0];
      if (track) track.onended = () => { if (my === generation) { report({ recording: false, error: 'source-ended' }); stop(); } };
      recorder = rec;
      rec.start(1000);
      report({ recording: true, mimeType, audio: hasAudio });
    } catch (err) {
      stopTracks();
      report({ recording: false, error: String(err?.message || err || 'Falha ao começar a gravar') });
    }
  }

  window.clipRecorder = { start, stop };
  report({ ready: true });
})();
