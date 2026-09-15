/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  // Relative base so the built app works whether it's served from a
  // domain root (Cloudflare Pages / Vercel / Netlify) or a GitHub Pages
  // project-site subpath (https://<user>.github.io/<repo>/) without
  // hardcoding a repo name — see docs/DEPLOYMENT.md.
  base: './',
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // Web Bluetooth/Serial only work from a real page load, not from
      // within a cached offline shell pretending to be "live" — but the
      // app shell (JS/CSS/icons) itself should still work offline once
      // visited once, per project brief section 4.
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        // The pipeline worker is fetched by URL at runtime (new Worker(new
        // URL(...))); make sure it's precached too so Simulation Mode
        // still works fully offline after the first visit.
        navigateFallbackDenylist: [/^\/api\//],
      },
      manifest: {
        name: 'BCI Hand Configurator',
        short_name: 'BCI Hand',
        description: 'Browser-based configurator for the Muse 2 blink-controlled prosthetic hand.',
        // Relative (not "/") so this resolves correctly under a GitHub
        // Pages project-site subpath as well as a domain root.
        start_url: '.',
        scope: '.',
        display: 'standalone',
        background_color: '#0b0d12',
        theme_color: '#0b0d12',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
