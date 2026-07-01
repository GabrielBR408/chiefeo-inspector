import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Base public path. '/' for standalone Vercel deploy (chiefeo-inspector.vercel.app).
// If this app is ever proxied onto the chiefeotool.com hub under a sub-path,
// set VITE_BASE (e.g. '/inspector/') so built asset URLs resolve there.
const base = process.env.VITE_BASE || '/'

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'icons/icon-180.png'],
      manifest: {
        name: 'ChiefEO Inspector',
        short_name: 'Inspector',
        description: 'Talk-and-photo AI property inspection reports.',
        theme_color: '#1c2a3a',
        background_color: '#f4f5f7',
        display: 'standalone',
        start_url: base,
        scope: base,
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
        ]
      }
    })
  ]
})
