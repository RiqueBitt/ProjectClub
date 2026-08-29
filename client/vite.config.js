import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/uploads': 'http://localhost:3000',
      '/socket.io': { target: 'http://localhost:3000', ws: true },
    },
  },
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
          if (id.includes('react-router-dom')) return 'vendor-router';
          if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('scheduler')) return 'vendor-react';
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
          return 'vendor';
        },
      },
    },
  },
});
