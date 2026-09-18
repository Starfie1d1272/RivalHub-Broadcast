import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const cs2AssetsPublicDir = '../../packages/cs2-assets/generated/public';

export default defineConfig({
  plugins: [react()],
  publicDir: cs2AssetsPublicDir,
  server: {
    proxy: {
      '/debug/runtime': 'http://127.0.0.1:3000',
      '/local/v1': {
        target: 'http://127.0.0.1:3000',
        ws: true,
      },
    },
  },
});
