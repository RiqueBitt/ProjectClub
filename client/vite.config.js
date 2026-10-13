import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';

// Versão do CONTEÚDO (o site) — muda a cada build. O app Android abre o
// site ao vivo, então é isso que diz "qual conteúdo está rodando" (ver
// docs/android-updates.md). WEB_VERSION permite fixar de fora (CI).
function webVersion() {
  if (process.env.WEB_VERSION) return process.env.WEB_VERSION;
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  let stamp = `${d.getUTCFullYear()}.${p(d.getUTCMonth() + 1)}.${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
  try {
    const sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    if (/^[0-9a-f]{4,12}$/.test(sha)) stamp += `-${sha}`;
  } catch { /* sem git (ex.: deploy por zip) — fica só a data */ }
  return stamp;
}
const WEB_VERSION = webVersion();

// Grava dist/version.json — o servidor lê pra responder GET /api/mobile/update.
const versionFilePlugin = () => ({
  name: 'pc-version-file',
  apply: 'build',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ web: WEB_VERSION }) });
  },
});

export default defineConfig({
  plugins: [react(), versionFilePlugin()],
  define: { __WEB_VERSION__: JSON.stringify(WEB_VERSION) },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/uploads': 'http://localhost:3000',
      '/socket.io': { target: 'http://localhost:3000', ws: true },
    },
  },
  // Nos testes de tela (PW_E2E=1) não há servidor na porta 3000: sem o
  // proxy, o preview não enche o log de "ws proxy error" a cada tentativa
  // de reconexão do socket. Fora dos testes, continua igual ao server.
  ...(process.env.PW_E2E ? { preview: { proxy: {} } } : {}),
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        // Splits third-party libraries into their own chunk(s), separate
        // from the app's own code — react/react-dom/react-router-dom
        // together (they change together, rarely on their own), and
        // everything else third-party into a general vendor chunk. This is
        // what actually fixes the ">500kB chunk" warning: the app's own
        // code was never the bulk of that one huge bundle, the vendored
        // libraries bundled inline with it were. Splitting also means a
        // browser that already has the vendor chunk cached (unchanged
        // dependencies) only needs to re-download the app chunk after a
        // deploy, not everything.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('/react-router-dom/') || id.includes('/react-router/')) return 'vendor-router';
          // react/react-dom/scheduler NÃO são separados num chunk próprio: o
          // use-sync-external-store (zustand) faz require('react') em CommonJS,
          // e um react em chunk separado quebrava o carregamento ("setting
          // Children" / dep circular). Deixá-lo no "vendor" geral (sempre
          // carregado no início de qualquer jeito) resolve, sem custo real.
          if (id.includes('socket.io-client') || id.includes('engine.io-client')) return 'vendor-socket';
          // Item pedido ("web demora pra carregar página"): o SDK do
          // Agora (chamada de voz) sozinho é responsável pela maior parte
          // do que virava um único pacote de quase 2MB antes — e ele
          // NUNCA é necessário só pra navegar pelo chat/feeds/perfil. Ter
          // ele num pacote PRÓPRIO (em vez de dentro do "vendor" geral)
          // só ajuda se também for carregado sob demanda (ver import()
          // dinâmico em VoiceContext.jsx) — os dois juntos é o que faz a
          // pessoa parar de baixar esses ~500kB comprimidos toda vez que
          // só quer ver uma mensagem.
          if (id.includes('agora-rtc-sdk-ng')) return 'vendor-agora';
          // Demais provedores da cadeia de voz (LiveKit, Stream, Daily,
          // TRTC): cada SDK num pacote PRÓPRIO e carregado SÓ sob demanda
          // (import() dinâmico em client/src/voice/*Engine.js). Assim eles
          // NUNCA entram no bundle inicial — a cadeia só baixa o SDK do
          // provedor que de fato for usado numa chamada, e quem só navega
          // pelo chat/feeds não paga por nenhum deles.
          if (id.includes('livekit-client')) return 'vendor-livekit';
          if (id.includes('@stream-io/video-client')) return 'vendor-getstream';
          if (id.includes('@daily-co/daily-js')) return 'vendor-daily';
          if (id.includes('trtc-sdk-v5')) return 'vendor-trtc';
          // Lista de emojis (~400 KB): só baixa quando o seletor abre.
          if (id.includes('unicode-emoji-json')) return 'vendor-emoji';
          return 'vendor';
        },
      },
    },
  },
});
