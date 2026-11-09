import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * Build APARTE del ARM de WhatsApp (arm.dist-at.com, plan 41 paso 4; 09/11/2026; antes "CRM").
 *
 * No es una segunda página de `vite.config.js` a propósito: ese config mete `VitePWA` (service
 * worker y manifest "DisT-At") y `legacy` (target es2015 + polyfills para las tablets con WebView
 * Chrome 79) en todo lo que compila. El CRM es de escritorio, en navegadores nuevos, y no tiene que
 * instalarse como app ni registrar un service worker que después pise al de app.dist-at.com.
 * Con un config propio la app de los teléfonos no cambia ni un byte.
 *
 *   npm run dev:crm     → http://localhost:5174/crm.html (contra la API de .env.local)
 *   npm run build:crm   → dist-crm/ (se sube al proyecto de Pages de arm.dist-at.com)
 */
export default defineConfig({
  base: '/',
  define: { global: 'globalThis' },
  plugins: [react(), tailwindcss()],
  server: { port: 5174, strictPort: true, open: false },
  build: {
    outDir: 'dist-crm',
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: { input: { index: 'crm.html' } },
  },
})
