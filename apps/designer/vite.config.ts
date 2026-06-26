import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Base path only applies to the production (GitHub Pages) build; dev serves at root so the hub's
// cross-app links work locally.
export default defineConfig(({ mode }) => ({
  base: mode === 'production' ? '/mobilesurvey/' : '/',
  plugins: [react()],
  server: {
    port: 5173,
  },
}));
