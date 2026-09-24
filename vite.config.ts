import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';

export default defineConfig({
  plugins: [wasm()],
  build: { target: 'esnext', chunkSizeWarningLimit: 2500 },
  optimizeDeps: { exclude: ['@dimforge/rapier2d'] },
  worker: { format: 'es', plugins: () => [wasm()] },
});
