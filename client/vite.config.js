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
          return 'vendor';
        },
      },
    },
  },
});
