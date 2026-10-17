import React, { useState, useEffect } from 'react';
import { store } from './services/store';
import { User } from './types';
import { AdminDashboard } from './components/admin/AdminDashboard';
import { CustomerMenu } from './components/menu/CustomerMenu';
import { DeliveryPortal } from './components/delivery/DeliveryPortal';
import { OrderTrackingView } from './components/tracking/OrderTrackingView';
import { AuthModal } from './components/auth/AuthModal';
import { 
  ShieldCheck, 
  UtensilsCrossed, 
  Bike, 
  MapPin, 
  RotateCcw, 
  ChevronDown, 
  ChevronUp, 
  LogIn, 
  ExternalLink 
} from 'lucide-react';
import { ConfirmModal } from './components/common/ConfirmModal';

export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(() => store.getCurrentUser());
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false);
  const [isViewBarCollapsed, setIsViewBarCollapsed] = useState(false);

  // Current view detection from URL query parameters
  const [currentView, setCurrentView] = useState<'admin' | 'cardapio' | 'entregador' | 'rastreio'>('admin');
  const [selectedOrderId, setSelectedOrderId] = useState<string>('ord-1002');

  const updateViewFromUrl = () => {
    const search = window.location.search;
    const hash = window.location.hash.toLowerCase();
    const pathname = window.location.pathname.toLowerCase();
    const params = new URLSearchParams(search);

    let viewParam = params.get('view');
    let orderParam = params.get('pedido');

    // Check hash fallback (e.g. #/cardapio, #cardapio, #view=cardapio)
    if (!viewParam && hash) {
      if (hash.includes('cardapio')) viewParam = 'cardapio';
      else if (hash.includes('entregador')) viewParam = 'entregador';
      else if (hash.includes('rastreio')) viewParam = 'rastreio';
      else if (hash.includes('admin')) viewParam = 'admin';

      const hashParts = hash.replace(/^#\/?/, '').split('?');
      if (hashParts[1]) {
        const hashParams = new URLSearchParams(hashParts[1]);
        if (hashParams.get('pedido')) orderParam = hashParams.get('pedido');
      }
    }

    // Check pathname fallback (e.g. /cardapio or /entregador)
    if (!viewParam && pathname) {
      if (pathname.includes('cardapio')) viewParam = 'cardapio';
      else if (pathname.includes('entregador')) viewParam = 'entregador';
      else if (pathname.includes('rastreio')) viewParam = 'rastreio';
    }

    if (viewParam === 'cardapio' || viewParam === 'entregador' || viewParam === 'rastreio' || viewParam === 'admin') {
      setCurrentView(viewParam as typeof currentView);
    }
    if (orderParam) {
      setSelectedOrderId(orderParam);
    }
  };

  useEffect(() => {
    updateViewFromUrl();

    const handlePopState = () => {
      updateViewFromUrl();
    };

    const handleHashChange = () => {
      updateViewFromUrl();
    };

    const handleStateChanged = () => {
      setCurrentUser(store.getCurrentUser());
    };

    window.addEventListener('popstate', handlePopState);
    window.addEventListener('hashchange', handleHashChange);
    window.addEventListener('gestaofood_state_changed', handleStateChanged);

    return () => {
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('hashchange', handleHashChange);
      window.removeEventListener('gestaofood_state_changed', handleStateChanged);
    };
  }, []);

  const navigateTo = (view: 'admin' | 'cardapio' | 'entregador' | 'rastreio', orderId?: string) => {
    setCurrentView(view);
    if (orderId) {
      setSelectedOrderId(orderId);
    }

    const url = new URL(window.location.href);
    url.searchParams.set('view', view);
    if (orderId) {
      url.searchParams.set('pedido', orderId);
    } else if (view !== 'rastreio') {
      url.searchParams.delete('pedido');
    }
    window.history.pushState({}, '', url.toString());
  };

  const handleLogout = () => {
    store.logout();
    setCurrentUser(null);
  };

  const handleResetSampleData = () => {
    setIsResetConfirmOpen(true);
  };

  const executeResetSampleData = () => {
    store.resetToSampleData();
    setIsResetConfirmOpen(false);
    window.location.reload();
  };

  return (
    <div className="min-h-screen bg-[#FAF7F2] text-[#2C1810] font-sans">
      {/* GLOBAL VIEW SWITCHER / PREVIEW ASSISTANT TOOLBAR */}
      <aside aria-label="Seletor de Ambiente" className="sticky top-0 z-50 bg-[#1F100B] text-white border-b border-[#4A2E1F] shadow-md">
        <div className="max-w-7xl mx-auto px-4 py-1.5 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <span className="font-black tracking-wider text-[#E89255] font-serif text-[12px] flex items-center gap-1.5">
              <span>AMANDITA SABORES</span>
            </span>
            <span className="text-[#6B4B3E] hidden sm:inline">|</span>
            <span className="text-[#D9C7B8] hidden sm:inline text-[11px]">Navegação Rápida:</span>
          </div>

          <div className="flex items-center gap-1 sm:gap-2">
            {/* 1. Admin */}
            <button
              onClick={() => navigateTo('admin')}
              className={`px-2.5 py-1 rounded-lg font-bold flex items-center gap-1.5 transition text-[11px] cursor-pointer ${
                currentView === 'admin'
                  ? 'bg-gradient-to-r from-[#C86D3B] to-[#721C24] text-white shadow-xs'
                  : 'text-[#D9C7B8] hover:text-white hover:bg-white/10'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Painel Admin & PDV</span>
            </button>

            {/* 2. Customer Menu */}
            <button
              onClick={() => navigateTo('cardapio')}
              className={`px-2.5 py-1 rounded-lg font-bold flex items-center gap-1.5 transition text-[11px] cursor-pointer ${
                currentView === 'cardapio'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'text-[#D9C7B8] hover:text-white hover:bg-white/10'
              }`}
            >
              <UtensilsCrossed className="w-3.5 h-3.5" />
              <span>Cardápio WhatsApp</span>
            </button>

            {/* 3. Driver Portal */}
            <button
              onClick={() => navigateTo('entregador')}
              className={`px-2.5 py-1 rounded-lg font-bold flex items-center gap-1.5 transition text-[11px] cursor-pointer ${
                currentView === 'entregador'
                  ? 'bg-[#C86D3B] text-white shadow-xs'
                  : 'text-[#D9C7B8] hover:text-white hover:bg-white/10'
              }`}
            >
              <Bike className="w-3.5 h-3.5" />
              <span>Portal Entregador</span>
            </button>

            {/* 4. Tracking */}
            <button
              onClick={() => navigateTo('rastreio', selectedOrderId || 'ord-1002')}
              className={`px-2.5 py-1 rounded-lg font-bold flex items-center gap-1.5 transition text-[11px] cursor-pointer ${
                currentView === 'rastreio'
                  ? 'bg-purple-600 text-white shadow-xs'
                  : 'text-[#D9C7B8] hover:text-white hover:bg-white/10'
              }`}
            >
              <MapPin className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Rastreio Pedido</span>
            </button>

            {/* Reset data */}
            <button
              onClick={handleResetSampleData}
              title="Restaurar dados iniciais da Amandita Sabores"
              className="p-1 text-[#D9C7B8] hover:text-white hover:bg-white/10 rounded-lg ml-1 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </aside>

      {/* VIEW 1: ADMIN PANEL */}
      {currentView === 'admin' && (
        <>
          {currentUser ? (
            <AdminDashboard
              currentUser={currentUser}
              onLogout={handleLogout}
              onNavigateToView={(v) => navigateTo(v)}
            />
          ) : (
            <div className="min-h-[85vh] flex flex-col items-center justify-center p-4">
              <div className="bg-[#FFFDF9] rounded-3xl p-8 max-w-md w-full text-center shadow-xl border border-[#E8DFD5]">
                <div className="w-16 h-16 rounded-2xl bg-[#C86D3B]/10 text-[#C86D3B] flex items-center justify-center mx-auto mb-4 font-bold border border-[#C86D3B]/20">
                  <ShieldCheck className="w-8 h-8" />
                </div>
                <h2 className="text-2xl font-black text-[#2C1810]">Acesso do Colaborador</h2>
                <p className="text-xs text-[#8C5E47] mt-2 mb-6">
                  Área restrita da Amandita Sabores. Faça login com seu usuário e senha autorizados pelo Administrador.
                </p>
                <div className="space-y-3">
                  <button
                    onClick={() => setIsAuthModalOpen(true)}
                    className="w-full py-3 bg-gradient-to-r from-[#C86D3B] via-[#B85D2A] to-[#721C24] hover:opacity-95 text-white font-bold rounded-xl text-sm transition flex items-center justify-center gap-2 cursor-pointer shadow-xs"
                  >
                    <LogIn className="w-4 h-4 text-white" />
                    <span>Entrar no Sistema</span>
                  </button>
                  <button
                    onClick={() => {
                      const admin = store.getUsers()[0];
                      store.setCurrentUser(admin);
                      setCurrentUser(admin);
                    }}
                    className="w-full py-2.5 bg-[#FAF7F2] hover:bg-[#F2EAE0] text-[#3D2314] font-bold rounded-xl text-xs transition border border-[#E8DFD5] cursor-pointer"
                  >
                    ⚡ Entrar Imediatamente como Administrador (Demo)
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* VIEW 2: CUSTOMER DIGITAL MENU (WHATSAPP ACCESS) */}
      {currentView === 'cardapio' && (
        <CustomerMenu
          onNavigateToTracking={(orderId) => navigateTo('rastreio', orderId)}
          onNavigateToAdmin={() => navigateTo('admin')}
        />
      )}

      {/* VIEW 3: DELIVERY DRIVER PORTAL */}
      {currentView === 'entregador' && (
        <DeliveryPortal
          initialOrderId={selectedOrderId}
          onNavigateToAdmin={() => navigateTo('admin')}
        />
      )}

      {/* VIEW 4: CLIENT ORDER TRACKING VIEW */}
      {currentView === 'rastreio' && (
        <OrderTrackingView
          orderId={selectedOrderId}
          onNavigateToMenu={() => navigateTo('cardapio')}
        />
      )}

      {/* AUTH MODAL */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        onSuccess={(user) => {
          setCurrentUser(user);
          setIsAuthModalOpen(false);
        }}
      />

      {/* CONFIRM RESET SAMPLE DATA MODAL */}
      {isResetConfirmOpen && (
        <ConfirmModal
          isOpen={true}
          title="Restaurar Dados de Demonstração"
          message="Deseja restaurar todos os pedidos, cardápio e turnos de caixa para a demonstração inicial com pedidos recentes de exemplo? Quaisquer alterações não salvas serão reinicializadas."
          confirmLabel="Restaurar Dados Iniciais"
          cancelLabel="Cancelar"
          isDanger={true}
          onConfirm={executeResetSampleData}
          onCancel={() => setIsResetConfirmOpen(false)}
        />
      )}
    </div>
  );
}
