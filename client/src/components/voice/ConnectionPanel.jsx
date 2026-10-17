import { useEffect, useRef, useState } from 'react';
import { QUALITY_LABELS } from './CallIcons.jsx';
import { sparklinePath, PING_WINDOW_MS } from '../../voice/connectionStats.js';

// Painel "Qualidade da conexão" (clique no sinal da barra de chamada):
// ping com gráfico dos últimos ~60s, perda de pacotes, jitter, bitrate de
// envio/recebimento, codec, resolução/FPS da tela (se transmitindo) e qual
// provedor/servidor de voz está em uso. Lê as estatísticas a cada 2s SÓ
// enquanto está aberto; provedor sem estatísticas mostra o que tiver.

const POLL_MS = 2000;
const SPARK_W = 260;
const SPARK_H = 44;

const dash = '—';
const fmt = (v, unit, digits = 0) => (v == null || !Number.isFinite(v) ? dash : `${digits ? v.toFixed(digits) : Math.round(v)}${unit ? ` ${unit}` : ''}`);
const fmtKbps = (v) => (v == null ? dash : v >= 1000 ? `${(v / 1000).toFixed(1)} Mbps` : `${v} kbps`);
const lossTone = (v) => (v == null ? '' : v >= 5 ? 'is-bad' : v >= 2 ? 'is-ok' : 'is-good');
const pingTone = (v) => (v == null ? '' : v >= 350 ? 'is-bad' : v >= 180 ? 'is-ok' : 'is-good');

export default function ConnectionPanel({ voice, quality, onClose, anchorRef }) {
  const [stats, setStats] = useState(null);
  const [, setTick] = useState(0);
  const panelRef = useRef(null);
  const getStatsRef = useRef(voice.getConnectionStats);
  getStatsRef.current = voice.getConnectionStats;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    let alive = true;
    const read = async () => {
      try {
        const s = await getStatsRef.current?.();
        if (alive) setStats(s || null);
      } catch { /* provedor saiu no meio — tenta no próximo tick */ }
      if (alive) setTick((n) => n + 1);
    };
    read();
    const t = setInterval(read, POLL_MS);
    return () => { alive = false; clearInterval(t); };
  }, []);

  // Fecha ao clicar fora (o próprio botão do sinal alterna) ou com Esc.
  useEffect(() => {
    const onDown = (e) => {
      if (panelRef.current?.contains(e.target) || anchorRef?.current?.contains(e.target)) return;
      onCloseRef.current?.();
    };
    const onKey = (e) => { if (e.key === 'Escape') { onCloseRef.current?.(); anchorRef?.current?.focus?.(); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown, { passive: true });
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [anchorRef]);

  const now = Date.now();
  const history = (voice.getPingHistory?.() || []).filter((p) => now - p.t <= PING_WINDOW_MS);
  const path = sparklinePath(history, SPARK_W, SPARK_H, now);
  const tok = path ? path.split(' ') : [];
  const area = path ? `${path} L ${tok[tok.length - 2]} ${SPARK_H} L ${tok[1]} ${SPARK_H} Z` : '';
  const values = history.map((p) => p.v);
  const minPing = values.length ? Math.min(...values) : null;
  const maxPing = values.length ? Math.max(...values) : null;
  const ping = stats?.rttMs ?? voice.myRtt ?? null;

  // Tela: o que está SAINDO de verdade (medido) ou, sem medição, o que foi
  // escolhido em "Transmitir tela".
  let screenText = null;
  if (voice.screenOn) {
    const sc = stats?.screen;
    if (sc?.width) screenText = `${sc.width}×${sc.height}${sc.fps ? ` · ${sc.fps} FPS` : ''}`;
    else if (voice.screenQuality) screenText = `${voice.screenQuality.quality} · ${voice.screenQuality.frameRate} FPS (escolhido)`;
    else screenText = 'Medindo…';
  }
  const codecs = [stats?.audioCodec, stats?.videoCodec].filter(Boolean).join(' / ') || dash;

  return (
    <div className="cb-conn" ref={panelRef} role="dialog" aria-label="Qualidade da conexão">
      <div className="cb-conn-head">
        <span className="cb-conn-title">Conexão de voz</span>
        <span className="cb-conn-chip">{QUALITY_LABELS[quality] || QUALITY_LABELS[0]}</span>
      </div>

      <div className="cb-conn-spark">
        <div className="cb-conn-spark-top">
          <span className="cb-conn-spark-label">Ping</span>
          <span className={`cb-conn-spark-value ${pingTone(ping)}`}>{ping == null ? dash : <>{ping}<small> ms</small></>}</span>
        </div>
        <svg
          className="cb-conn-svg" viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} preserveAspectRatio="none" role="img"
          aria-label={values.length ? `Ping nos últimos 60 segundos: mínimo ${minPing} ms, máximo ${maxPing} ms` : 'Ainda medindo o ping'}
        >
          {area && <path d={area} className="cb-conn-area" />}
          {path && <path d={path} className="cb-conn-line" vectorEffect="non-scaling-stroke" />}
        </svg>
        <div className="cb-conn-spark-foot">
          <span>últimos 60 s</span>
          {values.length > 1 && <span>mín {minPing} · máx {maxPing} ms</span>}
        </div>
      </div>

      <dl className="cb-conn-grid">
        <div><dt>Perda de pacotes</dt><dd className={lossTone(stats?.lossPct)}>{fmt(stats?.lossPct, '%', stats?.lossPct != null && stats.lossPct < 10 ? 1 : 0)}</dd></div>
        <div><dt>Jitter</dt><dd>{fmt(stats?.jitterMs, 'ms', stats?.jitterMs != null && stats.jitterMs < 10 ? 1 : 0)}</dd></div>
        <div><dt>Envio</dt><dd>{fmtKbps(stats?.outKbps)}</dd></div>
        <div><dt>Recebimento</dt><dd>{fmtKbps(stats?.inKbps)}</dd></div>
        <div className="is-wide"><dt>Codec</dt><dd>{codecs}</dd></div>
        {screenText && <div className="is-wide"><dt>Sua tela</dt><dd>{screenText}</dd></div>}
      </dl>

      <div className="cb-conn-foot">
        <span><span className="cb-conn-dim">Provedor</span> {voice.providerLabel || stats?.providerLabel || dash}</span>
        {stats?.server && <span className="truncate"><span className="cb-conn-dim">Servidor</span> {stats.server}</span>}
      </div>
      {stats && !stats.supported && (
        <p className="cb-conn-note">Este provedor não informa estatísticas detalhadas — mostrando só o ping.</p>
      )}
    </div>
  );
}
