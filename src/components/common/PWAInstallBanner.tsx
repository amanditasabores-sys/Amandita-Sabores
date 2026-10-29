import React, { useState, useEffect } from 'react';
import { usePWAInstall } from '../../hooks/usePWAInstall';
import { Download, X, Sparkles, Smartphone } from 'lucide-react';

export const PWAInstallBanner: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, isAndroid, install } = usePWAInstall();
  const [isDismissed, setIsDismissed] = useState(false);
  const [showIOSModal, setShowIOSModal] = useState(false);

  useEffect(() => {
    const dismissed = sessionStorage.getItem('pwa_banner_dismissed');
    if (dismissed === 'true') {
      setIsDismissed(true);
    }
  }, []);

  // Do NOT show if already running as installed standalone app or if dismissed by user
  if (isInstalled || isDismissed) {
    return null;
  }

  // Show banner if install prompt is ready OR on mobile devices (Android/iOS)
  const shouldShow = isInstallable || isAndroid || isIOS;
  if (!shouldShow) {
    return null;
  }

  const handleDismiss = () => {
    setIsDismissed(true);
    sessionStorage.setItem('pwa_banner_dismissed', 'true');
  };

  const handleInstallClick = async () => {
    if (isInstallable) {
      await install();
    } else {
      setShowIOSModal(true);
    }
  };

  return (
    <>
      <div className="fixed bottom-3 left-3 right-3 sm:left-auto sm:right-4 sm:max-w-md z-40 bg-[#1F100B] text-white p-3.5 rounded-2xl shadow-2xl border border-[#C86D3B]/40 flex items-center justify-between gap-3 animate-slideUp">
        <div className="flex items-center gap-3 shrink-0">
          <img
            src="/pwa-192x192.png"
            alt="Amandita Sabores"
            className="w-10 h-10 rounded-xl shadow-xs border border-amber-500/30"
          />
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-black text-[#FFCA28] tracking-wide">Amandita Sabores</span>
              <span className="text-[10px] bg-amber-500/20 text-[#FFCA28] px-1.5 py-0.2 rounded-full font-bold">App</span>
            </div>
            <p className="text-[11px] text-[#D9C7B8] leading-tight mt-0.5">
              Instale o app para acesso rápido e pedidos sem navegador!
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={handleInstallClick}
            className="px-3 py-1.5 bg-gradient-to-r from-[#C86D3B] to-[#E87A36] hover:brightness-110 text-white font-black text-xs rounded-xl shadow-xs transition flex items-center gap-1.5 cursor-pointer active:scale-95"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Instalar</span>
          </button>
          <button
            type="button"
            onClick={handleDismiss}
            className="p-1.5 text-[#D9C7B8] hover:text-white hover:bg-white/10 rounded-lg transition"
            aria-label="Dispensar aviso de instalação"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* iOS Modal */}
      {showIOSModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-fadeIn">
          <div className="bg-white rounded-2xl max-w-sm w-full p-5 shadow-2xl border border-slate-200 text-slate-900 relative">
            <button
              type="button"
              onClick={() => setShowIOSModal(false)}
              className="absolute top-4 right-4 p-1.5 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 transition"
              aria-label="Fechar"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-3 mb-4">
              <img
                src="/pwa-192x192.png"
                alt="Amandita Sabores"
                className="w-12 h-12 rounded-xl shadow-xs border border-amber-500/20"
              />
              <div>
                <h3 className="text-sm font-black text-slate-900">Instalar Amandita Sabores</h3>
                <p className="text-xs text-slate-500">Adicione à tela inicial do seu celular</p>
              </div>
            </div>

            <div className="space-y-3 bg-amber-50/60 p-3.5 rounded-xl border border-amber-200/60 text-xs text-slate-700">
              <div className="flex items-start gap-2.5">
                <div className="w-6 h-6 rounded-lg bg-amber-500/20 text-amber-900 flex items-center justify-center shrink-0 font-bold text-xs mt-0.5">
                  1
                </div>
                <div>
                  No Safari, toque no botão de <strong className="font-semibold text-slate-900">Compartilhar</strong> (ícone do quadrado com seta para cima).
                </div>
              </div>

              <div className="flex items-start gap-2.5">
                <div className="w-6 h-6 rounded-lg bg-amber-500/20 text-amber-900 flex items-center justify-center shrink-0 font-bold text-xs mt-0.5">
                  2
                </div>
                <div>
                  Role para baixo e selecione <strong className="font-semibold text-slate-900">"Adicionar à Tela de Início"</strong>.
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowIOSModal(false)}
              className="mt-4 w-full py-2.5 bg-[#1F100B] hover:bg-[#331C13] text-white font-bold rounded-xl text-xs transition"
            >
              Entendido
            </button>
          </div>
        </div>
      )}
    </>
  );
};
