import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// base './' → funciona en Capacitor (assets relativos desde el bundle nativo)
// y en la mayoría de hosts estáticos. Para GitHub Pages en subruta de proyecto,
// cambiar a '/<nombre-repo>/'.
export default defineConfig({
  // GitHub Pages sirve el proyecto bajo /<nombre-repo>/. Para otro host estático
  // (Netlify/Vercel) o Capacitor, volver a base: './'.
  base: '/la-union-app/',
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Distribuidora LA UNIÓN',
        short_name: 'LA UNIÓN',
        description: 'Plataforma logística: Vendedor, Repartidor y Administrador.',
        theme_color: '#0C0C0C',
        background_color: '#0C0C0C',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,csv,woff2}'],
      },
    }),
  ],
})
