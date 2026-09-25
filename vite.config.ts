import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';

export default defineConfig({
  // Relative asset URLs so the build works from any path (static hosting, subfolders).
  base: './',
  plugins: [wasm()],
  build: { target: 'esnext', chunkSizeWarningLimit: 2500 },
  optimizeDeps: { exclude: ['@dimforge/rapier2d'] },
  worker: { format: 'es', plugins: () => [wasm()] },
});
