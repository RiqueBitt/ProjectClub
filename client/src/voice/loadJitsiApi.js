// Carrega o external_api.js do Jitsi sob demanda (lazy), do domínio
// configurado pelo servidor. Só baixa quando alguém REALMENTE cai no modo
// reserva — quem nunca usa voz (ou nunca fica sem o servidor próprio)
// jamais baixa nada do Jitsi.
//
// window.JitsiMeetExternalAPI é definido pelo script. Reaproveita a mesma
// promise por domínio (nunca injeta o script duas vezes).

const loaders = new Map();

export function loadJitsiApi(domain) {
  const host = String(domain || 'meet.jit.si').replace(/^https?:\/\//, '').replace(/\/+$/, '');
  if (typeof window !== 'undefined' && window.JitsiMeetExternalAPI) {
    return Promise.resolve(window.JitsiMeetExternalAPI);
  }
  if (loaders.has(host)) return loaders.get(host);

  const promise = new Promise((resolve, reject) => {
    if (typeof document === 'undefined') { reject(new Error('sem DOM')); return; }
    const src = `https://${host}/external_api.js`;
    // Já existe uma tag pra esse src (outra tentativa)? Reaproveita.
    const existing = document.querySelector(`script[data-jitsi-api="${host}"]`);
    const onReady = () => {
      if (window.JitsiMeetExternalAPI) resolve(window.JitsiMeetExternalAPI);
      else reject(new Error('external_api.js carregou mas JitsiMeetExternalAPI não apareceu'));
    };
    if (existing) {
      if (window.JitsiMeetExternalAPI) { onReady(); return; }
      existing.addEventListener('load', onReady, { once: true });
      existing.addEventListener('error', () => reject(new Error('falha ao carregar external_api.js')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.dataset.jitsiApi = host;
    script.addEventListener('load', onReady, { once: true });
    script.addEventListener('error', () => {
      loaders.delete(host); // deixa tentar de novo numa próxima
      reject(new Error('falha ao carregar external_api.js do Jitsi'));
    }, { once: true });
    document.head.appendChild(script);
  });
  loaders.set(host, promise);
  return promise;
}
