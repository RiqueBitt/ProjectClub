import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// Cópia do navegador que vai DENTRO do app desktop (modo offline: abre
// quando o servidor do Project Club não responde). Saída em desktop/offline,
// carregada pelo app em pcapp://app/offline.html.
export default defineConfig({
  plugins: [react()],
  base: './',
  publicDir: false, // só o navegador: nada de mini-jogos, sons etc.
  build: {
    outDir: fileURLToPath(new URL('../desktop/offline', import.meta.url)),
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
    rollupOptions: { input: fileURLToPath(new URL('./offline.html', import.meta.url)) },
  },
});
