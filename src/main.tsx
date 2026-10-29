import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { registerSW } from 'virtual:pwa-register';

// Register PWA Service Worker
if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  const updateSW = registerSW({
    onNeedRefresh() {
      console.info('[PWA] Nova versão do Amandita Sabores disponível. Atualizando...');
      updateSW(true);
    },
    onOfflineReady() {
      console.info('[PWA] Amandita Sabores pronto para funcionamento offline e instalação!');
    },
    onRegistered(registration) {
      console.info('[PWA] Service Worker registrado com sucesso no escopo:', registration?.scope);
    },
    onRegisterError(error) {
      console.warn('[PWA] Erro ao registrar Service Worker:', error);
    },
  });
}

createRoot(document.getElementById('root')!).render(<App />);
