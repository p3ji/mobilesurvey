import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/mobilesurvey-runtime/',
  plugins: [react()],
  server: {
    port: 5174,
  },
});
