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
  Sparkles,
  User as UserIcon,
  AlertCircle,
  Eye,
  EyeOff
} from 'lucide-react';
import { ConfirmModal } from './components/common/ConfirmModal';
import { FirebaseStatusModal } from './components/admin/FirebaseStatusModal';
import { PWAInstallButton } from './components/common/PWAInstallButton';
import { PWAInstallBanner } from './components/common/PWAInstallBanner';

export type AppView = 'admin' | 'cardapio' | 'entregador' | 'producao' | 'caixa' | 'atendente' | 'rastreio';

export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(() => store.getCurrentUser());
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isFirebaseModalOpen, setIsFirebaseModalOpen] = useState(false);
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false);
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

  // Employee inline login state
  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginLoading, setLoginLoading] = useState(false);

  const handleInlineLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    setLoginLoading(true);

    if (!loginIdentifier.trim() || !loginPassword.trim()) {
      setLoginError('Por favor, informe seu usuário ou e-mail e senha.');
      setLoginLoading(false);
      return;
    }

    const res = await store.login(loginIdentifier, loginPassword);
    setLoginLoading(false);

    if (res.success && res.user) {
      setCurrentUser(res.user);
      navigateTo(getDefaultViewForRole(res.user.role));
    } else {
      setLoginError(res.message);
    }
  };

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

    // Unauthenticated visitors have NO permission for internal modules
    if (!user) return false;

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

  const handleResetSampleData = () => {
    setIsResetConfirmOpen(true);
  };

  const executeResetSampleData = () => {
    store.resetToSampleData();
    setIsResetConfirmOpen(false);
    window.location.reload();
  };

  // Only Administrator or Gerente can see the global navigation toolbar,
  // and NEVER on public customer views (cardapio or rastreio)
  const isGlobalToolbarVisible = Boolean(
    currentUser && 
    (currentUser.role === 'ADMINISTRADOR' || currentUser.role === 'GERENTE' || currentUser.username === 'admin') &&
    currentView !== 'cardapio' &&
    currentView !== 'rastreio'
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
              {/* 1. Admin */}
              <button
                onClick={() => navigateTo('admin')}
                className={`px-2 sm:px-2.5 py-1 rounded-lg font-bold flex items-center gap-1 sm:gap-1.5 transition text-[11px] shrink-0 cursor-pointer ${
                  currentView === 'admin'
                    ? 'bg-gradient-to-r from-[#C86D3B] to-[#721C24] text-white shadow-xs'
                    : 'text-[#D9C7B8] hover:text-white hover:bg-white/10'
                }`}
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                <span><span className="hidden sm:inline">Painel </span>Admin</span>
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

              {/* 7. Firebase Cloud Status */}
              <button
                onClick={() => setIsFirebaseModalOpen(true)}
                title="Status do Cloud Firestore & Migração de Dados"
                className="px-2 py-1 rounded-lg font-bold flex items-center gap-1 sm:gap-1.5 transition text-[11px] shrink-0 cursor-pointer bg-amber-500/20 text-[#FFCA28] hover:bg-amber-500/30 border border-[#FFCA28]/40"
              >
                <Flame className="w-3.5 h-3.5 text-[#FFCA28]" />
                <span className="hidden sm:inline">Firebase</span>
              </button>

              {/* Reset data */}
              <button
                onClick={handleResetSampleData}
                title="Restaurar dados iniciais da Amandita Sabores"
                className="p-1 text-[#D9C7B8] hover:text-white hover:bg-white/10 rounded-lg ml-0.5 shrink-0 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>

              {/* PWA Install Button */}
              <PWAInstallButton variant="subtle" />
            </div>
          </div>
        </aside>
      )}

      {/* STAFF PREVIEW HELPER BAR (ONLY VISIBLE TO LOGGED IN STAFF PREVIEWING THE PUBLIC MENU) */}
      {currentUser && (currentUser.role === 'ADMINISTRADOR' || currentUser.role === 'GERENTE' || currentUser.username === 'admin') && currentView === 'cardapio' && (
        <aside aria-label="Aviso de Pré-visualização Staff" className="sticky top-0 z-50 w-full bg-[#1F100B] text-white border-b border-amber-600/40 px-3 py-1.5 text-xs flex items-center justify-between shadow-md">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span className="font-bold text-amber-300">Modo de Visualização do Cardápio Público</span>
            <span className="text-[#D9C7B8] hidden sm:inline text-[11px]">· Sessão ativa: {currentUser.name || currentUser.username} ({currentUser.role})</span>
          </div>
          <button
            onClick={() => navigateTo('admin')}
            className="px-2.5 py-1 bg-gradient-to-r from-[#C86D3B] to-[#721C24] text-white rounded-lg font-bold text-[11px] hover:opacity-95 transition cursor-pointer flex items-center gap-1.5"
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Voltar ao Painel ADM</span>
          </button>
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
              <div className="bg-[#FFFDF9] rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-xl border border-[#E8DFD5]">
                <div className="text-center mb-5">
                  <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-[#C86D3B]/10 text-[#C86D3B] flex items-center justify-center mx-auto mb-3 font-bold border border-[#C86D3B]/20">
                    <ShieldCheck className="w-7 h-7 sm:w-8 sm:h-8" />
                  </div>
                  <h2 className="text-xl sm:text-2xl font-black text-[#2C1810]">Acesso do Colaborador</h2>
                  <p className="text-xs text-[#8C5E47] mt-1.5 leading-relaxed">
                    Amandita Sabores · Faça login com seu usuário e senha autorizados para acessar seu módulo de trabalho.
                  </p>
                </div>

                {loginError && (
                  <div className="mb-4 p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs flex items-center gap-2 animate-in fade-in">
                    <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                    <span>{loginError}</span>
                  </div>
                )}

                <form onSubmit={handleInlineLogin} className="space-y-3.5">
                  <div>
                    <label className="block text-xs font-bold text-[#3D2314] uppercase tracking-wider mb-1">
                      Usuário ou E-mail
                    </label>
                    <div className="relative">
                      <UserIcon className="w-4 h-4 text-[#8C5E47] absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={loginIdentifier}
                        onChange={(e) => setLoginIdentifier(e.target.value)}
                        placeholder="Ex: admin, caixa, cozinha..."
                        className="w-full pl-10 pr-4 py-2.5 bg-white border border-[#E8DFD5] rounded-xl text-sm text-[#2C1810] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#C86D3B]/40 focus:border-[#C86D3B] transition"
                        autoFocus
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-[#3D2314] uppercase tracking-wider mb-1">
                      Senha
                    </label>
                    <div className="relative">
                      <Lock className="w-4 h-4 text-[#8C5E47] absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={loginPassword}
                        onChange={(e) => setLoginPassword(e.target.value)}
                        placeholder="Sua senha secreta"
                        className="w-full pl-10 pr-10 py-2.5 bg-white border border-[#E8DFD5] rounded-xl text-sm text-[#2C1810] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#C86D3B]/40 focus:border-[#C86D3B] transition"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-[#3D2314] p-1 transition cursor-pointer"
                        title={showPassword ? 'Ocultar senha' : 'Ver senha'}
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loginLoading}
                    className="w-full py-3 bg-gradient-to-r from-[#C86D3B] via-[#B85D2A] to-[#721C24] hover:opacity-95 text-white font-bold rounded-xl text-sm transition flex items-center justify-center gap-2 cursor-pointer shadow-xs disabled:opacity-50"
                  >
                    <LogIn className="w-4 h-4 text-white" />
                    <span>{loginLoading ? 'Validando Acesso...' : 'Entrar no Sistema'}</span>
                  </button>
                </form>

                <div className="mt-5 pt-4 border-t border-[#E8DFD5] text-center">
                  <button
                    type="button"
                    onClick={() => navigateTo('cardapio')}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#8C5E47] hover:text-[#C86D3B] transition cursor-pointer"
                  >
                    <UtensilsCrossed className="w-3.5 h-3.5" />
                    <span>Acessar Cardápio Digital Público do Cliente →</span>
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

      {/* PWA MOBILE INSTALL BANNER */}
      <PWAInstallBanner />
    </div>
  );
}
