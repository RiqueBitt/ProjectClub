// Métricas leves do processo, pra diagnosticar instabilidade na VPS sem
// depender do painel da hospedagem: a cada 5 min (e logo depois do boot)
// escreve UMA linha com memória (RSS, heap, memória externa/buffers),
// atraso do event loop (p50/p99/máx), sockets conectados e uptime.
// Nada de dado pessoal, token ou senha — só números do processo.
// Também avisa quando o atraso do event loop passa de 500 ms (servidor
// travado) ou a RSS chega perto do limite do container.
const { monitorEventLoopDelay } = require('perf_hooks');

const MB = 1024 * 1024;
const fmt = (n) => `${Math.round(n / MB)}MB`;

function startRuntimeMetrics({ io, intervalMs = 5 * 60 * 1000, containerMb = Number(process.env.CONTAINER_MEMORY_MB) || 0, log = console.log } = {}) {
  const loop = monitorEventLoopDelay({ resolution: 20 });
  loop.enable();
  let peakRss = 0;
  const sample = (label = 'métricas') => {
    const m = process.memoryUsage();
    peakRss = Math.max(peakRss, m.rss);
    const p50 = loop.percentile(50) / 1e6;
    const p99 = loop.percentile(99) / 1e6;
    const max = loop.max / 1e6;
    loop.reset();
    const sockets = io?.engine?.clientsCount ?? 0;
    const line = `[${label}] rss=${fmt(m.rss)} (pico ${fmt(peakRss)}) heap=${fmt(m.heapUsed)}/${fmt(m.heapTotal)} externo=${fmt(m.external)} buffers=${fmt(m.arrayBuffers)} `
      + `loop p50=${p50.toFixed(1)}ms p99=${p99.toFixed(1)}ms max=${max.toFixed(0)}ms sockets=${sockets} uptime=${Math.round(process.uptime() / 60)}min`;
    log(line);
    if (max > 500) log(`[métricas] ATENÇÃO: event loop travou ${max.toFixed(0)}ms (servidor ocupado demais)`);
    if (containerMb && m.rss > containerMb * MB * 0.85) log(`[métricas] ATENÇÃO: RSS ${fmt(m.rss)} passou de 85% do container (${containerMb}MB)`);
    return { rss: m.rss, heapUsed: m.heapUsed, external: m.external, p99, max, sockets };
  };
  const boot = setTimeout(() => sample('métricas boot+2min'), 2 * 60 * 1000);
  const timer = setInterval(() => sample(), intervalMs);
  boot.unref?.(); timer.unref?.();
  return { sample, stop: () => { clearTimeout(boot); clearInterval(timer); loop.disable(); } };
}

module.exports = { startRuntimeMetrics };
