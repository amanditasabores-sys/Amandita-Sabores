import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve('.'), '');

  // Resolve Firebase variables from process.env (Vercel) or .env file
  const firebaseApiKey = process.env.VITE_FIREBASE_API_KEY || env.VITE_FIREBASE_API_KEY || '';
  const firebaseAppId = process.env.VITE_FIREBASE_APP_ID || env.VITE_FIREBASE_APP_ID || '';
  const firebaseProjectId = process.env.VITE_FIREBASE_PROJECT_ID || env.VITE_FIREBASE_PROJECT_ID || 'amandita-sabores';
  const firebaseAuthDomain = process.env.VITE_FIREBASE_AUTH_DOMAIN || env.VITE_FIREBASE_AUTH_DOMAIN || 'amandita-sabores.firebaseapp.com';
  const firebaseStorageBucket = process.env.VITE_FIREBASE_STORAGE_BUCKET || env.VITE_FIREBASE_STORAGE_BUCKET || 'amandita-sabores.firebasestorage.app';
  const firebaseMessagingSenderId = process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || env.VITE_FIREBASE_MESSAGING_SENDER_ID || '';
  const initialAdminEmail = process.env.VITE_INITIAL_ADMIN_EMAIL || env.VITE_INITIAL_ADMIN_EMAIL || 'dvrmercadinho@gmail.com';

  const buildTime = new Date().toISOString();

  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        injectRegister: 'auto',
        includeAssets: [
          'favicon.ico',
          'favicon-32x32.png',
          'apple-touch-icon.png',
          'icon.svg',
          'icon-maskable.svg',
          'pwa-192x192.png',
          'pwa-512x512.png',
          'pwa-maskable-512x512.png',
          'manifest.json',
        ],
        manifest: {
          id: '/',
          name: 'Amandita Sabores',
          short_name: 'Amandita',
          description: 'Amandita Sabores: Cardápio digital oficial, pedidos via WhatsApp, PDV balcão, produção na cozinha KDS e entregas.',
          start_url: '/',
          scope: '/',
          display: 'standalone',
          orientation: 'portrait-primary',
          theme_color: '#1F100B',
          background_color: '#FAF7F2',
          lang: 'pt-BR',
          categories: ['food', 'shopping', 'business'],
          icons: [
            {
              src: '/pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-maskable-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
          navigateFallback: '/index.html',
          importScripts: ['/push-worker.js'],
          maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
          // Strictly avoid intercepting backend APIs and internal routes
          navigateFallbackDenylist: [/^\/api\//, /^\/__/],
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'gstatic-fonts-cache',
                expiration: {
                  maxEntries: 20,
                  maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: /^https:\/\/images\.unsplash\.com\/.*/i,
              handler: 'StaleWhileRevalidate',
              options: {
                cacheName: 'unsplash-images-cache',
                expiration: {
                  maxEntries: 60,
                  maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              // Do NOT cache API endpoints
              urlPattern: /^\/api\/.*/i,
              handler: 'NetworkOnly',
            },
            {
              // Do NOT cache Firebase real-time sync endpoints
              urlPattern: /^https:\/\/(firestore|identitytoolkit|securetoken)\.googleapis\.com\/.*/i,
              handler: 'NetworkOnly',
            },
          ],
        },
        devOptions: {
          enabled: true,
          type: 'module',
        },
      }),
    ],
    define: {
      '__APP_BUILD_TIME__': JSON.stringify(buildTime),
      'import.meta.env.VITE_FIREBASE_API_KEY': JSON.stringify(firebaseApiKey),
      'import.meta.env.VITE_FIREBASE_APP_ID': JSON.stringify(firebaseAppId),
      'import.meta.env.VITE_FIREBASE_PROJECT_ID': JSON.stringify(firebaseProjectId),
      'import.meta.env.VITE_FIREBASE_AUTH_DOMAIN': JSON.stringify(firebaseAuthDomain),
      'import.meta.env.VITE_FIREBASE_STORAGE_BUCKET': JSON.stringify(firebaseStorageBucket),
      'import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID': JSON.stringify(firebaseMessagingSenderId),
      'import.meta.env.VITE_INITIAL_ADMIN_EMAIL': JSON.stringify(initialAdminEmail),
    },
    resolve: {
      alias: {
        '@': path.resolve('.'),
      },
    },
    server: {
      host: '0.0.0.0',
      port: 3000,
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
