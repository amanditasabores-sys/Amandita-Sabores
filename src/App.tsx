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
import { UnifiedLoginScreen } from './components/auth/UnifiedLoginScreen';
import { pushNotificationService } from './services/pushNotification';
import { 
  UtensilsCrossed, 
  Bike, 
  ChefHat, 
  Vault, 
  Store, 
  ShieldAlert, 
  X 
} from 'lucide-react';

export type AppView = 'admin' | 'cardapio' | 'entregador' | 'producao' | 'caixa' | 'atendente' | 'rastreio';

export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(() => store.getCurrentUser());
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [securityNotice, setSecurityNotice] = useState<string | null>(null);

  // Current view detection from URL query parameters (main domain defaults to employee access)
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
    // Check initial URL parameters for public views
    if (typeof window !== 'undefined') {
      const search = window.location.search.toLowerCase();
      const hash = window.location.hash.toLowerCase();
      const pathname = window.location.pathname.toLowerCase();
      if (search.includes('view=cardapio') || hash.includes('cardapio') || pathname.includes('/cardapio')) {
        return 'cardapio';
      }
      if (search.includes('view=rastreio') || hash.includes('rastreio') || pathname.includes('/rastreio')) {
        return 'rastreio';
      }
    }
    // Default main domain: employee access & login
    return 'admin';
  });

  const [selectedOrderId, setSelectedOrderId] = useState<string>('');
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

    // Unauthenticated visitors have NO permission for internal modules
    if (!user) return false;

    // Inactive or blocked users are rejected
    if (user.status === 'DESATIVADO' || user.status === 'BLOQUEADO') {
      return false;
    }

    const role = user.role?.toUpperCase();
    if (role === 'ADMINISTRADOR' || role === 'GERENTE' || user.username === 'admin') {
      return true; // Full access across all modules
    }

    if (view === 'entregador') {
      if (role === 'ENTREGADOR') return true;
      const perms = store.getDeliveryPermissions(user);
      return Boolean(perms.canViewDeliveryDashboard);
    }

    // Delivery drivers cannot access internal administrative modules (PDV, Caixa, Cozinha, etc.)
    if (role === 'ENTREGADOR') return false;
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
    if (activeUser) {
      setCurrentUser((prev) => (!prev || prev.id !== activeUser.id ? activeUser : prev));
    }
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
        if (viewParam !== 'admin') {
          setSecurityNotice('Acesso restrito. Faça login com suas credenciais de colaborador para acessar este módulo.');
          const url = new URL(window.location.href);
          url.searchParams.set('view', 'admin');
          window.history.replaceState({}, '', url.toString());
        }
      }
    } else if (activeUser) {
      setCurrentView(getDefaultViewForRole(activeUser.role));
    } else {
      // Main domain access without parameter: presents employee system access / login
      setCurrentView('admin');
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
      const activeUser = store.getCurrentUser();
      if (activeUser) {
        const fresh = store.getUserById(activeUser.id) || activeUser;
        if (fresh.status === 'DESATIVADO' || fresh.status === 'BLOQUEADO') {
          store.logout();
          setCurrentUser(null);
          setSecurityNotice('Sua conta de colaborador foi desativada ou bloqueada pela administração.');
        } else {
          setCurrentUser(fresh);
        }
      } else {
        setCurrentUser(null);
      }
    };

    window.addEventListener('popstate', handlePopState);
    window.addEventListener('hashchange', handleHashChange);
    window.addEventListener('gestaofood_state_changed', handleStateChanged);

    const deactivationPoll = setInterval(handleStateChanged, 4000);

    return () => {
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('hashchange', handleHashChange);
      window.removeEventListener('gestaofood_state_changed', handleStateChanged);
      clearInterval(deactivationPoll);
    };
  }, []);

  // Ensure real-time Firestore synchronization whenever staff is active or viewing staff screens
  useEffect(() => {
    const isStaffView = ['admin', 'atendente', 'producao', 'caixa', 'entregador'].includes(currentView);
    if (currentUser && isStaffView) {
      store.ensureFirebaseAuthForStaff().then(() => {
        store.initStaffFirestoreSync();
      }).catch(() => {});

      // Sincroniza inscrição de notificações push se o navegador já tiver permissão
      if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
        pushNotificationService.requestAndSubscribe(currentUser.role).catch(() => {});
      }
    }
  }, [currentUser, currentView]);

  const navigateTo = (
    view: AppView, 
    orderId?: string,
    trackingCode?: string
  ) => {
    const activeUser = store.getCurrentUser();
    if (activeUser) {
      setCurrentUser((prev) => (!prev || prev.id !== activeUser.id ? activeUser : prev));
    }
    if (!isViewAllowedForUser(view, activeUser)) {
      if (activeUser) {
        const allowed = getDefaultViewForRole(activeUser.role);
        setCurrentView(allowed);
        setSecurityNotice(`Acesso negado: seu perfil de ${activeUser.role} não possui permissão para acessar este módulo.`);
        return;
      }
      if (view !== 'admin') {
        setCurrentView('admin');
        setSecurityNotice('Acesso restrito. Faça login com suas credenciais de colaborador para acessar.');
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
    navigateTo('admin');
  };

  // Only Administrator or Gerente can see the global navigation toolbar,
  // and NEVER on customer views (cardapio/rastreio) or driver portal (entregador)
  const isGlobalToolbarVisible = Boolean(
    currentUser && 
    (currentUser.role === 'ADMINISTRADOR' || currentUser.role === 'GERENTE' || currentUser.username === 'admin') &&
    currentView !== 'cardapio' &&
    currentView !== 'rastreio' &&
    currentView !== 'entregador'
  );

  return (
    <div className="min-h-screen w-full max-w-full bg-[#FAF7F2] text-[#2C1810] font-sans">
      {/* GLOBAL VIEW SWITCHER / PREVIEW ASSISTANT TOOLBAR (RESTRICTED TO ADMINISTRATOR ONLY) */}
      {isGlobalToolbarVisible && (
        <aside aria-label="Seletor de Ambiente" className="sticky top-0 z-50 w-full max-w-full bg-[#1F100B] text-white border-b border-[#4A2E1F] shadow-md overflow-hidden">
          <div className="w-full max-w-7xl mx-auto px-2.5 sm:px-4 py-1.5 flex items-center justify-between gap-1.5 sm:gap-3 text-xs">
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="font-black tracking-wider text-[#E89255] font-serif text-[11px] sm:text-[12px] flex items-center gap-1">
                <span>AMANDITA</span>
                <span className="hidden xs:inline">SABORES</span>
              </span>
              <span className="text-[#6B4B3E] hidden md:inline">|</span>
              <span className="text-[#D9C7B8] hidden md:inline text-[11px]">Navegação Rápida (Admin):</span>
            </div>

            <div className="flex items-center gap-1 sm:gap-2 overflow-x-auto scrollbar-none py-0.5 min-w-0 flex-1 justify-end">
              {/* 1. Botão de retorno ao PDV / Painel de Controle */}
              <button
                onClick={() => {
                  navigateTo('admin');
                  window.dispatchEvent(new CustomEvent('switch_to_pdv'));
                }}
                className={`px-2.5 sm:px-3 py-1 rounded-lg font-bold flex items-center gap-1.5 transition text-[11px] shrink-0 cursor-pointer ${
                  currentView === 'admin'
                    ? 'bg-gradient-to-r from-[#C86D3B] to-[#721C24] text-white shadow-xs'
                    : 'bg-emerald-600/30 text-emerald-200 hover:text-white hover:bg-emerald-600/50 border border-emerald-500/40'
                }`}
                title="Retornar diretamente à tela principal do PDV / Painel de Controle"
              >
                <Store className="w-3.5 h-3.5 text-[#E89255]" />
                <span>PDV / Painel de Controle</span>
              </button>

              {/* 2. Customer Menu */}
              <button
                onClick={() => navigateTo('cardapio')}
                className={`px-2 sm:px-2.5 py-1 rounded-lg font-bold flex items-center gap-1 sm:gap-1.5 transition text-[11px] shrink-0 cursor-pointer ${
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
                className={`px-2 sm:px-2.5 py-1 rounded-lg font-bold flex items-center gap-1 sm:gap-1.5 transition text-[11px] shrink-0 cursor-pointer ${
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
                className={`px-2 sm:px-2.5 py-1 rounded-lg font-bold flex items-center gap-1 sm:gap-1.5 transition text-[11px] shrink-0 cursor-pointer ${
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
                className={`px-2 sm:px-2.5 py-1 rounded-lg font-bold flex items-center gap-1 sm:gap-1.5 transition text-[11px] shrink-0 cursor-pointer ${
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
                className={`px-2 sm:px-2.5 py-1 rounded-lg font-bold flex items-center gap-1 sm:gap-1.5 transition text-[11px] shrink-0 cursor-pointer ${
                  currentView === 'entregador'
                    ? 'bg-[#C86D3B] text-white shadow-xs'
                    : 'text-[#D9C7B8] hover:text-white hover:bg-white/10'
                }`}
              >
                <Bike className="w-3.5 h-3.5" />
                <span>Entregas</span>
              </button>
            </div>
          </div>
        </aside>
      )}

      {/* VIEW 1: CLIENT PUBLIC MENU (TRULY INDEPENDENT FROM ADMIN SESSION) */}
      {currentView === 'cardapio' && (
        <CustomerMenu
          onNavigateToTracking={(orderId, trackingCode) => navigateTo('rastreio', orderId, trackingCode)}
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

      {/* UNIFIED AUTHENTICATION FOR ALL UNLOGGED ACCESS (EXCEPT PUBLIC CARDÁPIO & RASTREIO) */}
      {!currentUser && currentView !== 'cardapio' && currentView !== 'rastreio' && (
        <UnifiedLoginScreen
          initialNotice={securityNotice}
          onLoginSuccess={(loggedUser) => {
            setCurrentUser(loggedUser);
            setSecurityNotice(null);
            const targetView = getDefaultViewForRole(loggedUser.role);
            navigateTo(targetView);
          }}
          onNavigateToCustomerMenu={() => navigateTo('cardapio')}
        />
      )}

      {/* VIEW 6: PORTAL DO ENTREGADOR (SESSÃO UNIFICADA: ENTREGADOR OU MODO SUPERVISÃO ADMIN) */}
      {currentUser && currentView === 'entregador' && (
        <DeliveryPortal
          initialOrderId={selectedOrderId || undefined}
          currentUser={currentUser}
          adminUser={(currentUser.role === 'ADMINISTRADOR' || currentUser.role === 'GERENTE') ? currentUser : null}
          onBackToAdmin={
            (currentUser.role === 'ADMINISTRADOR' || currentUser.role === 'GERENTE' || store.getDeliveryPermissions(currentUser).canViewDeliveryDashboard)
              ? () => navigateTo('admin')
              : undefined
          }
          onLogout={handleLogout}
        />
      )}

      {/* VIEW 7: PAINEL ADMINISTRATIVO (ADMIN OU GERENTE) */}
      {currentUser && currentView === 'admin' && (
        <AdminDashboard
          currentUser={currentUser}
          onLogout={handleLogout}
          onNavigateToView={(v) => navigateTo(v)}
        />
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
    </div>
  );
}
