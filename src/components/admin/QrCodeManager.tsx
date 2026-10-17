import React, { useState, useEffect } from 'react';
import { generateQRCodeDataUrl } from '../../utils/qrcode';
import { buildAppUrl } from '../../utils/url';
import { store } from '../../services/store';
import { CustomerMenu } from '../menu/CustomerMenu';
import { DeliveryPortal } from '../delivery/DeliveryPortal';
import { 
  QrCode, 
  Copy, 
  Check, 
  Download, 
  Share2, 
  Bike, 
  UtensilsCrossed, 
  Globe, 
  Smartphone, 
  Eye, 
  Info, 
  X, 
  ArrowLeft 
} from 'lucide-react';

interface QrCodeManagerProps {
  onNavigateToView?: (view: 'cardapio' | 'entregador') => void;
}

export const QrCodeManager: React.FC<QrCodeManagerProps> = ({ onNavigateToView }) => {
  const currentOrigin = typeof window !== 'undefined' ? window.location.origin : '';
  const preOrigin = currentOrigin.replace('ais-dev-', 'ais-pre-');

  // URL mode selector
  const [urlMode, setUrlMode] = useState<'current' | 'pre' | 'custom'>('current');
  const [customDomain, setCustomDomain] = useState('');

  // Mobile Simulator state
  const [simulatingView, setSimulatingView] = useState<'cardapio' | 'entregador' | null>(null);

  // Effective Base URL
  const effectiveBaseUrl = urlMode === 'current' 
    ? currentOrigin 
    : urlMode === 'pre' 
    ? preOrigin 
    : (customDomain.trim() || currentOrigin);

  const menuUrl = buildAppUrl('cardapio', undefined, effectiveBaseUrl);
  const deliveryUrl = buildAppUrl('entregador', undefined, effectiveBaseUrl);

  const [menuQrData, setMenuQrData] = useState<string>('');
  const [deliveryQrData, setDeliveryQrData] = useState<string>('');
  const [copiedMenu, setCopiedMenu] = useState(false);
  const [copiedDelivery, setCopiedDelivery] = useState(false);

  useEffect(() => {
    generateQRCodeDataUrl(menuUrl, { width: 400, margin: 2 }).then(setMenuQrData);
    generateQRCodeDataUrl(deliveryUrl, { width: 400, margin: 2 }).then(setDeliveryQrData);
  }, [menuUrl, deliveryUrl]);

  const copyToClipboard = (text: string, isMenu: boolean) => {
    navigator.clipboard.writeText(text);
    if (isMenu) {
      setCopiedMenu(true);
      setTimeout(() => setCopiedMenu(false), 2000);
    } else {
      setCopiedDelivery(true);
      setTimeout(() => setCopiedDelivery(false), 2000);
    }
  };

  const downloadQrCode = (dataUrl: string, filename: string) => {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const shareMenuWhatsApp = () => {
    const text = encodeURIComponent(`🍔 Conheça nosso cardápio digital e faça seu pedido direto pelo link:\n${menuUrl}\n\nEntregamos rapidinho na sua casa!`);
    window.open(`https://wa.me/?text=${text}`, '_blank');
  };

  const shareDeliveryWhatsApp = () => {
    const text = encodeURIComponent(`🛵 Link de acesso exclusivo da equipe de entregadores / motoboys:\n${deliveryUrl}\n\nAcesse para bipar o QR Code dos pedidos e iniciar a rota!`);
    window.open(`https://wa.me/?text=${text}`, '_blank');
  };

  return (
    <div className="space-y-6">
      {/* Information Guide Card */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-xs space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-amber-500/10 text-amber-700 flex items-center justify-center font-bold">
              <Info className="w-4 h-4" />
            </div>
            <h3 className="text-base font-bold text-slate-900">Como Acessar e Testar o Cardápio e o Portal do Entregador</h3>
          </div>
          <span className="px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1.5">
            <Globe className="w-3.5 h-3.5 text-emerald-600" />
            <span>Servidor Conectado</span>
          </span>
        </div>

        <div className="p-3.5 bg-blue-50/70 border border-blue-200 rounded-xl text-xs text-blue-900 leading-relaxed space-y-2">
          <p>
            <strong>📱 Teste Imediato (Sem Erro de Permissão ou 404):</strong> No ambiente de desenvolvimento do Google AI Studio, as abas externas podem ser bloqueadas pelas regras de segurança da nuvem Google.
          </p>
          <p>
            Utilize os botões <strong>"Abrir no App"</strong> ou <strong>"Simulador de Celular"</strong> abaixo para usar o cardápio e o portal do entregador diretamente na tela com 100% de funcionamento!
          </p>
        </div>

        {/* Domain Mode */}
        <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-700">Origem do Link:</span>
            <div className="flex gap-1 bg-slate-100 p-1 rounded-lg">
              <button
                onClick={() => setUrlMode('current')}
                className={`px-2.5 py-1 rounded text-xs font-semibold ${
                  urlMode === 'current' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                }`}
              >
                Servidor Local Ativo
              </button>
              {currentOrigin.includes('ais-dev-') && (
                <button
                  onClick={() => setUrlMode('pre')}
                  className={`px-2.5 py-1 rounded text-xs font-semibold ${
                    urlMode === 'pre' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                  }`}
                >
                  Servidor Compartilhado (ais-pre)
                </button>
              )}
              <button
                onClick={() => setUrlMode('custom')}
                className={`px-2.5 py-1 rounded text-xs font-semibold ${
                  urlMode === 'custom' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                }`}
              >
                Personalizado
              </button>
            </div>
          </div>

          {urlMode === 'custom' && (
            <input
              type="text"
              value={customDomain}
              onChange={(e) => setCustomDomain(e.target.value)}
              placeholder="https://meusite.com.br"
              className="px-2.5 py-1 bg-slate-50 border border-slate-200 rounded-lg text-xs"
            />
          )}
        </div>
      </div>

      {/* Two Columns: Menu QR Code vs Driver QR Code */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* 1. CARDAPIO DIGITAL QR CODE */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs flex flex-col justify-between space-y-4">
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-700 flex items-center justify-center font-bold">
                  <UtensilsCrossed className="w-5 h-5" />
                </div>
                <div>
                  <span className="text-[10px] font-bold text-amber-700 uppercase tracking-wider">Acesso dos Clientes</span>
                  <h4 className="text-lg font-extrabold text-slate-900">Cardápio Digital</h4>
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setSimulatingView('cardapio')}
                  className="px-2.5 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-xl text-xs font-bold transition flex items-center gap-1 shadow-xs cursor-pointer"
                  title="Abrir simulador de smartphone na tela"
                >
                  <Smartphone className="w-3.5 h-3.5" />
                  <span>Simular Celular</span>
                </button>
                {onNavigateToView && (
                  <button
                    onClick={() => onNavigateToView('cardapio')}
                    className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-semibold transition flex items-center gap-1"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>Tela Cheia</span>
                  </button>
                )}
              </div>
            </div>

            <p className="text-xs text-slate-500 leading-relaxed">
              Disponibilize nas mesas, imprima para o balcão ou envie aos clientes pelo WhatsApp.
            </p>

            {/* QR Image */}
            <div className="my-4 p-4 bg-slate-50 rounded-2xl border border-slate-200/80 flex flex-col items-center">
              {menuQrData ? (
                <img
                  src={menuQrData}
                  alt="QR Code Cardápio"
                  className="w-44 h-44 rounded-xl shadow-xs border border-white"
                />
              ) : (
                <div className="w-44 h-44 bg-slate-200 animate-pulse rounded-xl" />
              )}
              <span className="text-[11px] text-slate-400 mt-2 font-mono">
                QR Code gerado para o Cardápio
              </span>
            </div>

            {/* URL Display with internal open button */}
            <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono text-slate-700 flex items-center justify-between gap-2">
              <span className="truncate flex-1">{menuUrl}</span>
              <button
                onClick={() => onNavigateToView && onNavigateToView('cardapio')}
                className="px-2 py-0.5 bg-slate-200 hover:bg-slate-300 rounded text-[11px] font-sans font-semibold text-slate-800 shrink-0"
              >
                Abrir
              </button>
            </div>
          </div>

          {/* Action buttons */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2">
            <button
              onClick={() => copyToClipboard(menuUrl, true)}
              className="py-2.5 px-3 bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold rounded-xl text-xs flex items-center justify-center gap-1.5 transition"
            >
              {copiedMenu ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedMenu ? 'Copiado!' : 'Copiar Link'}</span>
            </button>

            <button
              onClick={() => downloadQrCode(menuQrData, 'qrcode_cardapio.png')}
              className="py-2.5 px-3 bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold rounded-xl text-xs flex items-center justify-center gap-1.5 transition"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Baixar PNG</span>
            </button>

            <button
              onClick={shareMenuWhatsApp}
              className="py-2.5 px-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 transition shadow-xs"
            >
              <Share2 className="w-3.5 h-3.5" />
              <span>WhatsApp</span>
            </button>
          </div>
        </div>

        {/* 2. PORTAL DO ENTREGADOR QR CODE */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs flex flex-col justify-between space-y-4">
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-700 flex items-center justify-center font-bold">
                  <Bike className="w-5 h-5" />
                </div>
                <div>
                  <span className="text-[10px] font-bold text-indigo-700 uppercase tracking-wider">Acesso da Logística</span>
                  <h4 className="text-lg font-extrabold text-slate-900">Portal do Entregador</h4>
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setSimulatingView('entregador')}
                  className="px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition flex items-center gap-1 shadow-xs cursor-pointer"
                  title="Abrir simulador de smartphone na tela"
                >
                  <Smartphone className="w-3.5 h-3.5" />
                  <span>Simular Celular</span>
                </button>
                {onNavigateToView && (
                  <button
                    onClick={() => onNavigateToView('entregador')}
                    className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-semibold transition flex items-center gap-1"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>Tela Cheia</span>
                  </button>
                )}
              </div>
            </div>

            <p className="text-xs text-slate-500 leading-relaxed">
              Cole no mural de expedição da cozinha ou envie para a equipe de motoboys.
            </p>

            {/* QR Image */}
            <div className="my-4 p-4 bg-slate-50 rounded-2xl border border-slate-200/80 flex flex-col items-center">
              {deliveryQrData ? (
                <img
                  src={deliveryQrData}
                  alt="QR Code Entregador"
                  className="w-44 h-44 rounded-xl shadow-xs border border-white"
                />
              ) : (
                <div className="w-44 h-44 bg-slate-200 animate-pulse rounded-xl" />
              )}
              <span className="text-[11px] text-slate-400 mt-2 font-mono">
                QR Code para o celular do motoboy
              </span>
            </div>

            {/* URL Display with internal open button */}
            <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono text-slate-700 flex items-center justify-between gap-2">
              <span className="truncate flex-1">{deliveryUrl}</span>
              <button
                onClick={() => onNavigateToView && onNavigateToView('entregador')}
                className="px-2 py-0.5 bg-slate-200 hover:bg-slate-300 rounded text-[11px] font-sans font-semibold text-slate-800 shrink-0"
              >
                Abrir
              </button>
            </div>
          </div>

          {/* Action buttons */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2">
            <button
              onClick={() => copyToClipboard(deliveryUrl, false)}
              className="py-2.5 px-3 bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold rounded-xl text-xs flex items-center justify-center gap-1.5 transition"
            >
              {copiedDelivery ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedDelivery ? 'Copiado!' : 'Copiar Link'}</span>
            </button>

            <button
              onClick={() => downloadQrCode(deliveryQrData, 'qrcode_entregador.png')}
              className="py-2.5 px-3 bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold rounded-xl text-xs flex items-center justify-center gap-1.5 transition"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Baixar PNG</span>
            </button>

            <button
              onClick={shareDeliveryWhatsApp}
              className="py-2.5 px-3 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 transition shadow-xs"
            >
              <Share2 className="w-3.5 h-3.5" />
              <span>WhatsApp</span>
            </button>
          </div>
        </div>
      </div>

      {/* INTERACTIVE MOBILE PHONE SIMULATOR MODAL */}
      {simulatingView && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
          <div className="relative flex flex-col items-center">
            {/* Top Toolbar */}
            <div className="mb-3 flex items-center justify-between w-full max-w-[420px] px-2 text-white">
              <span className="text-xs font-bold flex items-center gap-1.5">
                <Smartphone className="w-4 h-4 text-amber-400" />
                {simulatingView === 'cardapio' ? 'Simulador de Celular: Cardápio do Cliente' : 'Simulador de Celular: Portal do Entregador'}
              </span>
              <button
                onClick={() => setSimulatingView(null)}
                className="p-1.5 bg-white/20 hover:bg-white/30 rounded-full text-white transition"
                title="Fechar simulador"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Smartphone Case Frame */}
            <div className="w-[390px] h-[740px] bg-slate-950 rounded-[44px] p-3 shadow-2xl border-4 border-slate-700 relative overflow-hidden flex flex-col">
              {/* Dynamic Island / Speaker notch */}
              <div className="w-28 h-4 bg-slate-900 rounded-full mx-auto mb-2 shrink-0 flex items-center justify-center">
                <div className="w-3 h-3 rounded-full bg-slate-800 mr-2" />
                <div className="w-2 h-2 rounded-full bg-slate-800" />
              </div>

              {/* Screen Area */}
              <div className="flex-1 rounded-[32px] overflow-y-auto bg-white text-slate-900 scrollbar-none relative">
                {simulatingView === 'cardapio' ? (
                  <CustomerMenu />
                ) : (
                  <DeliveryPortal />
                )}
              </div>

              {/* Bottom Home Indicator Bar */}
              <div className="w-32 h-1 bg-white/30 rounded-full mx-auto mt-2 shrink-0" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
