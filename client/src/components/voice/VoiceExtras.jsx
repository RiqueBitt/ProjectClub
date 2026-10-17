import { useEffect, useRef, useState } from 'react';
import { getPreferredMicId } from '../../utils/audioDevices';
import '../../styles/voice-extras.css';

// Extras do canal de voz: teste de microfone no lobby (antes de entrar),
// aviso "microfone sem som" dentro da chamada e bolinha de qualidade da
// conexão por pessoa (dados do engine de mídia, via VoiceContext).

const SILENT_WARN_MS = 10000;

// ---------- Teste de microfone (lobby) ----------
// Abre o mic só enquanto o teste está ligado e mede o nível com um
// AnalyserNode. Fecha tudo ao parar, ao sair da tela ou ao entrar.
export function MicTest({ stopSignal }) {
  const [state, setState] = useState('idle'); // idle | starting | on | error
  const [error, setError] = useState('');
  const [level, setLevel] = useState(0);
  const [heard, setHeard] = useState(false);
  const [startedAt, setStartedAt] = useState(0);
  const [now, setNow] = useState(0);
  const resRef = useRef(null); // { stream, ctx, raf }

  const stop = () => {
    const r = resRef.current;
    resRef.current = null;
    if (r) {
      cancelAnimationFrame(r.raf);
      r.stream.getTracks().forEach((t) => t.stop());
      r.ctx.close().catch(() => {});
    }
    setState('idle');
    setLevel(0);
  };

  useEffect(() => stop, []);
  useEffect(() => { if (stopSignal) stop(); }, [stopSignal]);
  // Relógio só pra dica "não estamos ouvindo nada" depois de 3s.
  useEffect(() => {
    if (state !== 'on') return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [state]);

  const start = async () => {
    setError('');
    setHeard(false);
    setState('starting');
    try {
      const micId = getPreferredMicId();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: micId ? { deviceId: { exact: micId } } : true })
        .catch(() => navigator.mediaDevices.getUserMedia({ audio: true }));
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioCtx();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);
      const res = { stream, ctx, raf: 0 };
      let last = 0;
      const loop = (t) => {
        if (resRef.current !== res) return;
        if (t - last > 60) {
          last = t;
          analyser.getByteTimeDomainData(buf);
          let peak = 0;
          for (let i = 0; i < buf.length; i += 1) peak = Math.max(peak, Math.abs(buf[i] - 128));
          const pct = Math.min(100, Math.round((peak / 128) * 160));
          setLevel(pct);
          if (pct > 6) setHeard(true);
        }
        res.raf = requestAnimationFrame(loop);
      };
      resRef.current = res;
      res.raf = requestAnimationFrame(loop);
      setStartedAt(Date.now());
      setNow(Date.now());
      setState('on');
    } catch (err) {
      setState('error');
      setError(err?.name === 'NotAllowedError'
        ? 'O navegador bloqueou o microfone. Libere o acesso no cadeado da barra de endereço.'
        : 'Não encontramos nenhum microfone funcionando.');
    }
  };

  const quiet = state === 'on' && !heard && now - startedAt > 3000;

  return (
    <div className="vx-mictest">
      {state === 'on' ? (
        <>
          <div className="vx-meter" role="meter" aria-label="Nível do microfone" aria-valuemin={0} aria-valuemax={100} aria-valuenow={level}>
            <span className="vx-meter-fill" style={{ width: `${level}%` }} />
          </div>
          <p className={`vx-mictest-hint${quiet ? ' is-warn' : ''}`}>
            {quiet ? 'Não estamos ouvindo nada. Confira o microfone escolhido nas Configurações de voz.' : heard ? 'Seu microfone está funcionando.' : 'Fale alguma coisa…'}
          </p>
          <button type="button" className="vx-btn" onClick={stop}>Parar teste</button>
        </>
      ) : (
        <>
          <button type="button" className="vx-btn" onClick={start} disabled={state === 'starting'}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3ZM5 11a7 7 0 0 0 14 0M12 18v3" />
            </svg>
            {state === 'starting' ? 'Abrindo microfone…' : 'Testar microfone'}
          </button>
          {error && <p className="vx-mictest-hint is-warn">{error}</p>}
        </>
      )}
    </div>
  );
}

// ---------- Aviso "microfone sem som" (dentro da chamada) ----------
// Liga quando o mic está ativo e o medidor de nível (VoiceContext) não
// mede nenhum som há >10s. Sem medidor (getMicLastSoundAt null), desligado.
export function MicSilentWarning({ voice }) {
  const { muted, micMissing, call } = voice;
  const armedAtRef = useRef(Date.now());
  const [silent, setSilent] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  // Começa a contar de novo ao entrar ou ao desmutar.
  useEffect(() => { armedAtRef.current = Date.now(); setSilent(false); setDismissed(false); }, [muted, call?.channelId]);

  // O objeto do contexto muda a cada render — guarda o getter num ref pra
  // não reiniciar o intervalo toda hora.
  const getSoundAtRef = useRef(voice.getMicLastSoundAt);
  getSoundAtRef.current = voice.getMicLastSoundAt;
  useEffect(() => {
    if (muted || micMissing) { setSilent(false); return undefined; }
    const t = setInterval(() => {
      const since = Math.max(armedAtRef.current, getSoundAtRef.current?.() || 0);
      setSilent(!!getSoundAtRef.current && Date.now() - since > SILENT_WARN_MS);
    }, 2000);
    return () => clearInterval(t);
  }, [muted, micMissing]);

  if (!silent || dismissed) return null;
  return (
    <div className="vx-silent" role="status">
      <span className="vx-silent-dot" aria-hidden="true" />
      <span>Microfone sem som há mais de 10 segundos. Confira se o microfone certo está escolhido nas Configurações de voz.</span>
      <button type="button" className="vx-silent-close" onClick={() => setDismissed(true)} aria-label="Fechar aviso">×</button>
    </div>
  );
}

// ---------- Qualidade da conexão ----------
// Escala: 0 desconhecida, 1 excelente, 2 boa, 3 ok, 4 ruim, 5 muito ruim, 6 caiu.
const QUALITY = {
  1: ['good', 'Conexão excelente'],
  2: ['good', 'Conexão boa'],
  3: ['ok', 'Conexão razoável'],
  4: ['bad', 'Conexão ruim'],
  5: ['bad', 'Conexão muito ruim'],
  6: ['bad', 'Sem conexão'],
};
export function QualityDot({ quality }) {
  const q = QUALITY[quality];
  if (!q) return null;
  return <span className={`vx-q vx-q-${q[0]}`} title={q[1]} aria-label={q[1]} role="img" />;
}
