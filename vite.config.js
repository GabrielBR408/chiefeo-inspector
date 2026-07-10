import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Base public path. '/' for standalone Vercel deploy (chiefeo-inspector.vercel.app).
// If this app is ever proxied onto the chiefeotool.com hub under a sub-path,
// set VITE_BASE (e.g. '/inspector/') so built asset URLs resolve there.
const base = process.env.VITE_BASE || '/'

// Build stamp — rendered in the footer and attached to feedback events so a
// report can be tied to the exact deployed build. Vercel exposes the deployed
// commit as VERCEL_GIT_COMMIT_SHA at build time (read as a SPECIFIC
// process.env key — never spread import.meta.env into client code); local
// builds fall back to `git rev-parse`, then 'dev'.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
const commit = process.env.VERCEL_GIT_COMMIT_SHA
  ? process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7)
  : (() => { try { return execSync('git rev-parse --short=7 HEAD').toString().trim() } catch { return 'dev' } })()

export default defineConfig({
  base,
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __COMMIT_SHA__: JSON.stringify(commit)
  },
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
