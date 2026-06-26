import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  base: mode === 'production' ? '/mobilesurvey/respondent/' : '/',
  plugins: [react()],
  server: {
    port: 5174,
  },
}));
