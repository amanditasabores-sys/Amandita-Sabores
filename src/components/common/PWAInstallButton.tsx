import React, { useState } from 'react';
import { usePWAInstall } from '../../hooks/usePWAInstall';
import { Download, Smartphone, Share2, PlusSquare, X, CheckCircle2 } from 'lucide-react';

interface PWAInstallButtonProps {
  className?: string;
  variant?: 'primary' | 'subtle' | 'compact';
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({
  className = '',
  variant = 'primary',
}) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSModal, setShowIOSModal] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);

  // If already installed as standalone PWA, suppress the button
  if (isInstalled) {
    return null;
  }

  // Handle click
  const handleClick = async () => {
    if (isInstallable) {
      setIsInstalling(true);
      await install();
      setIsInstalling(false);
    } else if (isIOS) {
      setShowIOSModal(true);
    } else {
      // In desktop Chrome or other browsers where prompt hasn't fired yet, show info modal
      setShowIOSModal(true);
    }
  };

  const getButtonStyles = () => {
    if (variant === 'compact') {
      return 'px-2.5 py-1.5 text-[11px] font-bold rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 flex items-center gap-1.5 transition shadow-xs cursor-pointer';
    }
    if (variant === 'subtle') {
      return 'px-3 py-1.5 text-xs font-bold rounded-xl bg-[#3A1E13] hover:bg-[#4A2E1F] text-[#FFCA28] border border-[#6B4B3E]/50 flex items-center gap-2 transition cursor-pointer';
    }
    return 'px-3.5 py-2 text-xs font-black rounded-xl bg-gradient-to-r from-[#C86D3B] to-[#E87A36] hover:brightness-110 text-white shadow-md flex items-center gap-2 transition active:scale-95 cursor-pointer';
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={isInstalling}
        title="Instalar Amandita Sabores no dispositivo"
        className={`${getButtonStyles()} ${className}`}
      >
        <Download className="w-3.5 h-3.5 shrink-0" />
        <span>{isInstalling ? 'Instalando...' : 'Instalar App'}</span>
      </button>

      {/* Guided Installation Modal (for iOS or browsers without direct prompt) */}
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
                  No seu navegador, toque no menu <strong className="font-semibold text-slate-900">Compartilhar</strong> ou nos <strong className="font-semibold text-slate-900">três pontinhos (⋮)</strong>.
                </div>
              </div>

              <div className="flex items-start gap-2.5">
                <div className="w-6 h-6 rounded-lg bg-amber-500/20 text-amber-900 flex items-center justify-center shrink-0 font-bold text-xs mt-0.5">
                  2
                </div>
                <div>
                  Selecione a opção <strong className="font-semibold text-slate-900">"Adicionar à Tela de Início"</strong> ou <strong className="font-semibold text-slate-900">"Instalar Aplicativo"</strong>.
                </div>
              </div>

              <div className="flex items-start gap-2.5">
                <div className="w-6 h-6 rounded-lg bg-emerald-500/20 text-emerald-900 flex items-center justify-center shrink-0 font-bold text-xs mt-0.5">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                </div>
                <div>
                  Pronto! O ícone oficial será adicionado à sua tela inicial como um app nativo.
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
