import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  base: mode === 'production' ? '/statcan-assistant/' : '/',
  server: {
    port: 5178,
  },
}));
