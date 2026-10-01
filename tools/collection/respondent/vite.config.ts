import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  base: mode === 'production' ? (process.env.VITE_RUNTIME_BASE_PATH ?? '/respondent/') : '/',
  plugins: [react()],
  server: {
    port: 5174,
  },
}));
