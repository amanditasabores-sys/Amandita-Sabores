import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

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
    plugins: [react(), tailwindcss()],
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
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
