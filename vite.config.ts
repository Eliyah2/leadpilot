import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

const API_PORT = (() => {
  const sf = Number(process.env.SF_PORT);
  if (Number.isInteger(sf) && sf > 0) return String(sf);
  const p = Number(process.env.PORT);
  return Number.isInteger(p) && p > 0 ? String(p) : '4400';
})();

export default defineConfig({
  root: path.resolve(import.meta.dirname, 'client'),
  plugins: [react(), tailwindcss()],
  build: {
    outDir: path.resolve(import.meta.dirname, 'client/dist'),
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    port: Number(process.env.CLIENT_PORT || 5173),
    strictPort: false,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${API_PORT}`,
        changeOrigin: true,
      },
      '/media': {
        target: `http://127.0.0.1:${API_PORT}`,
        changeOrigin: true,
      },
    },
  },
});
