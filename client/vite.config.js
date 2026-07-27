import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  root: path.resolve(process.cwd(), 'client'),
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4173',
      '/uploads': 'http://localhost:4173'
    }
  },
  build: {
    outDir: path.resolve(process.cwd(), 'client/dist'),
    emptyOutDir: true
  }
});
