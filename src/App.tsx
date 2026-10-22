import React, { useState, useEffect } from 'react';
import { store } from './services/store';
import { User } from './types';
import { AdminDashboard } from './components/admin/AdminDashboard';
import { CustomerMenu } from './components/menu/CustomerMenu';
import { DeliveryPortal } from './components/delivery/DeliveryPortal';
import { OrderTrackingView } from './components/tracking/OrderTrackingView';
import { KitchenScreen } from './components/staff/KitchenScreen';
import { CashierScreen } from './components/staff/CashierScreen';
import { AttendantScreen } from './components/staff/AttendantScreen';
import { AuthModal } from './components/auth/AuthModal';
import { 
  ShieldCheck, 
  UtensilsCrossed, 
  Bike, 
  MapPin, 
  RotateCcw, 
  LogIn, 
  Flame,
  ChefHat,
  Vault,
  Store,
  ShieldAlert,
  X,
  Lock,
  Sparkles
} from 'lucide-react';
import { ConfirmModal } from './components/common/ConfirmModal';
import { FirebaseStatusModal } from './components/admin/FirebaseStatusModal';

export type AppView = 'admin' | 'cardapio' | 'entregador' | 'producao' | 'caixa' | 'atendente' | 'rastreio';

export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(() => store.getCurrentUser());
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isFirebaseModalOpen, setIsFirebaseModalOpen] = useState(false);
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false);
  const [securityNotice, setSecurityNotice] = useState<string | null>(null);

  // Current view detection from URL query parameters
  const [currentView, setCurrentView] = useState<AppView>(() => {
    const user = store.getCurrentUser();
    if (user) {
      const role = user.role?.toUpperCase();
      if (role === 'ENTREGADOR') return 'entregador';
      if (role === 'COZINHA') return 'producao';
      if (role === 'CAIXA') return 'caixa';
      if (role === 'ATENDENTE') return 'atendente';
      return 'admin';
    }
    return 'cardapio';
  });

  const [selectedOrderId, setSelectedOrderId] = useState<string>('ord-1002');
  const [selectedTrackingCode, setSelectedTrackingCode] = useState<string>('');

  const getDefaultViewForRole = (role?: string): AppView => {
    const norm = role?.toUpperCase();
    if (norm === 'ENTREGADOR') return 'entregador';
    if (norm === 'COZINHA') return 'producao';
    if (norm === 'CAIXA') return 'caixa';
    if (norm === 'ATENDENTE') return 'atendente';
    return 'admin';
  };

  const isViewAllowedForUser = (view: AppView, user: User | null): boolean => {
    // Public customer views
    if (view === 'cardapio' || view === 'rastreio') return true;

    // Unauthenticated visitors: only 'cardapio', 'rastreio' or 'admin' (which renders staff login)
    if (!user) return view === 'admin';

    const role = user.role?.toUpperCase();
    if (role === 'ADMINISTRADOR' || role === 'GERENTE' || user.username === 'admin') {
      return true; // Full access across all modules
    }

    if (role === 'ENTREGADOR') return view === 'entregador';
    if (role === 'COZINHA') return view === 'producao';
    if (role === 'CAIXA') return view === 'caixa';
    if (role === 'ATENDENTE') return view === 'atendente';

    return false;
  };

  const updateViewFromUrl = () => {
    const search = window.location.search;
    const hash = window.location.hash.toLowerCase();
    const pathname = window.location.pathname.toLowerCase();
    const params = new URLSearchParams(search);

    let viewParam = params.get('view') as AppView | null;
    let orderParam = params.get('pedido');
    let tkParam = params.get('tk') || params.get('token');

    // Check hash fallback (e.g. #/cardapio, #cardapio, #view=cardapio)
    if (!viewParam && hash) {
      if (hash.includes('cardapio')) viewParam = 'cardapio';
      else if (hash.includes('entregador')) viewParam = 'entregador';
      else if (hash.includes('producao') || hash.includes('kds') || hash.includes('cozinha')) viewParam = 'producao';
      else if (hash.includes('caixa')) viewParam = 'caixa';
      else if (hash.includes('atendente') || hash.includes('pdv')) viewParam = 'atendente';
      else if (hash.includes('rastreio')) viewParam = 'rastreio';
      else if (hash.includes('admin')) viewParam = 'admin';

      const hashParts = hash.replace(/^#\/?/, '').split('?');
      if (hashParts[1]) {
        const hashParams = new URLSearchParams(hashParts[1]);
        if (hashParams.get('pedido')) orderParam = hashParams.get('pedido');
        if (hashParams.get('tk')) tkParam = hashParams.get('tk');
      }
    }

    // Check pathname fallback (e.g. /cardapio or /entregador)
    if (!viewParam && pathname) {
      if (pathname.includes('cardapio')) viewParam = 'cardapio';
      else if (pathname.includes('entregador')) viewParam = 'entregador';
      else if (pathname.includes('producao') || pathname.includes('kds') || pathname.includes('cozinha')) viewParam = 'producao';
      else if (pathname.includes('caixa')) viewParam = 'caixa';
      else if (pathname.includes('atendente')) viewParam = 'atendente';
      else if (pathname.includes('rastreio')) viewParam = 'rastreio';
      else if (pathname.includes('admin')) viewParam = 'admin';
    }

    const activeUser = store.getCurrentUser();
    const validViews: AppView[] = ['admin', 'cardapio', 'entregador', 'producao', 'caixa', 'atendente', 'rastreio'];

    if (viewParam && validViews.includes(viewParam)) {
      if (isViewAllowedForUser(viewParam, activeUser)) {
        setCurrentView(viewParam);
      } else if (activeUser) {
        // Enforce strict RBAC: redirect user directly to their authorized profile view
        const targetView = getDefaultViewForRole(activeUser.role);
        setCurrentView(targetView);
        setSecurityNotice(`Acesso não autorizado: seu perfil de ${activeUser.role} foi direcionado à sua tela exclusiva.`);
        const url = new URL(window.location.href);
        url.searchParams.set('view', targetView);
        window.history.replaceState({}, '', url.toString());
      } else {
        // Unauthenticated visitor trying to access internal staff area
        setCurrentView('admin');
      }
    } else if (activeUser) {
      setCurrentView(getDefaultViewForRole(activeUser.role));
    } else {
      setCurrentView('cardapio');
    }

    if (orderParam) {
      setSelectedOrderId(orderParam);
    }
    if (tkParam) {
      setSelectedTrackingCode(tkParam);
    }
  };

  useEffect(() => {
    updateViewFromUrl();

    const handlePopState = () => updateViewFromUrl();
    const handleHashChange = () => updateViewFromUrl();

    const handleStateChanged = () => {
      const updatedUser = store.getCurrentUser();
      setCurrentUser(updatedUser);
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

  // Ensure real-time Firestore synchronization whenever staff is active or viewing staff screens
  useEffect(() => {
    const isStaffView = ['admin', 'atendente', 'producao', 'caixa', 'entregador'].includes(currentView);
    if (currentUser && isStaffView) {
      store.ensureFirebaseAuthForStaff().then(() => {
        store.initStaffFirestoreSync();
      }).catch(() => {});
    }
  }, [currentUser, currentView]);

  const navigateTo = (
    view: AppView, 
    orderId?: string,
    trackingCode?: string
  ) => {
    const activeUser = store.getCurrentUser();
    if (!isViewAllowedForUser(view, activeUser)) {
      if (activeUser) {
        const allowed = getDefaultViewForRole(activeUser.role);
        setCurrentView(allowed);
        setSecurityNotice(`Acesso negado: seu perfil de ${activeUser.role} não possui permissão para acessar este módulo.`);
        return;
      }
    }

    setCurrentView(view);
    if (orderId) {
      setSelectedOrderId(orderId);
    }
    if (trackingCode !== undefined) {
      setSelectedTrackingCode(trackingCode);
    }

    const url = new URL(window.location.href);
    url.searchParams.set('view', view);
    if (orderId) {
      url.searchParams.set('pedido', orderId);
    } else if (view !== 'rastreio') {
      url.searchParams.delete('pedido');
    }

    if (trackingCode) {
      url.searchParams.set('tk', trackingCode);
    } else if (view !== 'rastreio') {
      url.searchParams.delete('tk');
    }
    window.history.pushState({}, '', url.toString());
  };

  const handleLogout = () => {
    store.logout();
    setCurrentUser(null);
    navigateTo('cardapio');
  };

  const handleResetSampleData = () => {
    setIsResetConfirmOpen(true);
  };

  const executeResetSampleData = () => {
    store.resetToSampleData();
    setIsResetConfirmOpen(false);
    window.location.reload();
  };

  // Only Administrator or Gerente can see the global preview assistant toolbar
  const isGlobalToolbarVisible = Boolean(
    currentUser && (currentUser.role === 'ADMINISTRADOR' || currentUser.role === 'GERENTE' || currentUser.username === 'admin')
  );

  return (
    <div className="min-h-screen bg-[#FAF7F2] text-[#2C1810] font-sans">
      {/* GLOBAL VIEW SWITCHER / PREVIEW ASSISTANT TOOLBAR (RESTRICTED TO ADMINISTRATOR ONLY) */}
      {isGlobalToolbarVisible && (
        <aside aria-label="Seletor de Ambiente" className="sticky top-0 z-50 bg-[#1F100B] text-white border-b border-[#4A2E1F] shadow-md">
          <div className="max-w-7xl mx-auto px-4 py-1.5 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <span className="font-black tracking-wider text-[#E89255] font-serif text-[12px] flex items-center gap-1.5">
                <span>AMANDITA SABORES</span>
              </span>
              <span className="text-[#6B4B3E] hidden sm:inline">|</span>
              <span className="text-[#D9C7B8] hidden sm:inline text-[11px]">Navegação Rápida (Admin):</span>
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
                <span>Painel Admin</span>
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
                <span>Cardápio</span>
              </button>

              {/* 3. Atendente */}
              <button
                onClick={() => navigateTo('atendente')}
                className={`px-2.5 py-1 rounded-lg font-bold flex items-center gap-1.5 transition text-[11px] cursor-pointer ${
                  currentView === 'atendente'
                    ? 'bg-amber-600 text-white shadow-xs'
                    : 'text-[#D9C7B8] hover:text-white hover:bg-white/10'
                }`}
              >
                <Store className="w-3.5 h-3.5" />
                <span className="hidden md:inline">Atendente</span>
              </button>

              {/* 4. Cozinha */}
              <button
                onClick={() => navigateTo('producao')}
                className={`px-2.5 py-1 rounded-lg font-bold flex items-center gap-1.5 transition text-[11px] cursor-pointer ${
                  currentView === 'producao'
                    ? 'bg-rose-700 text-white shadow-xs'
                    : 'text-[#D9C7B8] hover:text-white hover:bg-white/10'
                }`}
              >
                <ChefHat className="w-3.5 h-3.5" />
                <span className="hidden md:inline">Cozinha</span>
              </button>

              {/* 5. Caixa */}
              <button
                onClick={() => navigateTo('caixa')}
                className={`px-2.5 py-1 rounded-lg font-bold flex items-center gap-1.5 transition text-[11px] cursor-pointer ${
                  currentView === 'caixa'
                    ? 'bg-emerald-700 text-white shadow-xs'
                    : 'text-[#D9C7B8] hover:text-white hover:bg-white/10'
                }`}
              >
                <Vault className="w-3.5 h-3.5" />
                <span className="hidden md:inline">Caixa</span>
              </button>

              {/* 6. Entregador */}
              <button
                onClick={() => navigateTo('entregador')}
                className={`px-2.5 py-1 rounded-lg font-bold flex items-center gap-1.5 transition text-[11px] cursor-pointer ${
                  currentView === 'entregador'
                    ? 'bg-[#C86D3B] text-white shadow-xs'
                    : 'text-[#D9C7B8] hover:text-white hover:bg-white/10'
                }`}
              >
                <Bike className="w-3.5 h-3.5" />
                <span>Entregas</span>
              </button>

              {/* 7. Firebase Cloud Status */}
              <button
                onClick={() => setIsFirebaseModalOpen(true)}
                title="Status do Cloud Firestore & Migração de Dados"
                className="px-2 py-1 rounded-lg font-bold flex items-center gap-1.5 transition text-[11px] cursor-pointer bg-amber-500/20 text-[#FFCA28] hover:bg-amber-500/30 border border-[#FFCA28]/40"
              >
                <Flame className="w-3.5 h-3.5 text-[#FFCA28]" />
                <span className="hidden sm:inline">Firebase</span>
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
      )}

      {/* VIEW 1: CLIENT PUBLIC MENU */}
      {currentView === 'cardapio' && (
        <CustomerMenu
          onNavigateToTracking={(orderId, trackingCode) => navigateTo('rastreio', orderId, trackingCode)}
          onNavigateToAdmin={() => navigateTo('admin')}
          onOpenStaffLogin={() => setIsAuthModalOpen(true)}
        />
      )}

      {/* VIEW 2: CLIENT ORDER TRACKING */}
      {currentView === 'rastreio' && (
        <OrderTrackingView
          orderId={selectedOrderId}
          trackingCode={selectedTrackingCode}
          onNavigateToMenu={() => navigateTo('cardapio')}
        />
      )}

      {/* VIEW 3: ATENDENTE (BALCÃO & GESTÃO DE PEDIDOS) */}
      {currentView === 'atendente' && (
        <AttendantScreen
          currentUser={currentUser}
          onLogout={handleLogout}
        />
      )}

      {/* VIEW 4: PRODUÇÃO & COZINHA (KDS) */}
      {currentView === 'producao' && (
        <KitchenScreen
          currentUser={currentUser}
          onLogout={handleLogout}
        />
      )}

      {/* VIEW 5: CAIXA (FLUXO DE CAIXA & FECHAMENTO) */}
      {currentView === 'caixa' && (
        <CashierScreen
          currentUser={currentUser}
          onLogout={handleLogout}
        />
      )}

      {/* VIEW 6: PORTAL DO ENTREGADOR */}
      {currentView === 'entregador' && (
        <DeliveryPortal
          initialOrderId={selectedOrderId}
          currentUser={currentUser}
          onLogout={handleLogout}
          onNavigateToAdmin={() => navigateTo('admin')}
        />
      )}

      {/* VIEW 7: PAINEL ADMINISTRATIVO (ADMIN OU LOGIN DE FUNCIONÁRIO) */}
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
                  Área restrita da Amandita Sabores. Faça login com seu usuário e senha autorizados pelo Administrador para ser direcionado à sua tela de trabalho.
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
                    onClick={async () => {
                      const res = await store.login('admin', '123456');
                      if (res.user) {
                        setCurrentUser(res.user);
                        navigateTo(getDefaultViewForRole(res.user.role));
                      }
                    }}
                    className="w-full py-2.5 bg-[#FAF7F2] hover:bg-[#F2EAE0] text-[#3D2314] font-bold rounded-xl text-xs transition border border-[#E8DFD5] cursor-pointer"
                  >
                    ⚡ Entrar Imediatamente como Administrador (Demo)
                  </button>
                  <button
                    onClick={() => navigateTo('cardapio')}
                    className="w-full py-2 text-xs font-semibold text-[#8C5E47] hover:text-[#2C1810] transition cursor-pointer"
                  >
                    ← Voltar ao Cardápio Digital Público
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* SECURITY ACCESS NOTICE TOAST */}
      {securityNotice && (
        <div className="fixed bottom-6 right-6 z-50 bg-[#2C1810] text-[#FAF7F2] p-4 rounded-2xl shadow-2xl border border-amber-500/40 flex items-center gap-3 text-xs max-w-md animate-in slide-in-from-bottom">
          <ShieldAlert className="w-5 h-5 text-amber-400 shrink-0" />
          <span className="font-medium flex-1">{securityNotice}</span>
          <button
            onClick={() => setSecurityNotice(null)}
            className="text-[#D9C7B8] hover:text-white p-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* FIREBASE STATUS & MIGRATION MODAL */}
      <FirebaseStatusModal
        isOpen={isFirebaseModalOpen}
        onClose={() => setIsFirebaseModalOpen(false)}
      />

      {/* AUTH MODAL */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        onSuccess={(user) => {
          setCurrentUser(user);
          setIsAuthModalOpen(false);
          navigateTo(getDefaultViewForRole(user.role));
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
