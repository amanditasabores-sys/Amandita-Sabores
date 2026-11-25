import React, { useState, useEffect, useMemo } from 'react';
import { store } from '../../services/store';
import { soundService } from '../../services/audio';
import { Order, User, AppModule } from '../../types';
import { PointOfSale } from './PointOfSale';
import { LiveOrdersKanban } from './LiveOrdersKanban';
import { KitchenDisplaySystem } from './KitchenDisplaySystem';
import { FinancialReports } from './FinancialReports';
import { MenuManagement } from './MenuManagement';
import { MovementAuditLog } from './MovementAuditLog';
import { QrCodeManager } from './QrCodeManager';
import { CashRegisterManager } from './CashRegisterManager';
import { StoreSettings } from './StoreSettings';
import { StaffManager } from './StaffManager';
import { AmanditaLogo } from '../common/AmanditaLogo';
import { FloatingOrderAlert } from '../common/FloatingOrderAlert';
import { 
  ShoppingBag, 
  ChefHat, 
  BarChart3, 
  UtensilsCrossed, 
  History, 
  QrCode, 
  Volume2, 
  VolumeX, 
  LogOut, 
  Bell, 
  ExternalLink,
  Vault,
  Settings,
  Users,
  Store,
  Layers
} from 'lucide-react';

interface AdminDashboardProps {
  currentUser: User | null;
  onLogout: () => void;
  onNavigateToView: (view: 'cardapio' | 'entregador') => void;
}

type TabKey = 
  | 'pdv' 
  | 'kanban' 
  | 'kds' 
  | 'caixa' 
  | 'reports' 
  | 'menu' 
  | 'usuarios' 
  | 'audit' 
  | 'qrcodes' 
  | 'settings';

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ currentUser, onLogout, onNavigateToView }) => {
  const [orders, setOrders] = useState<Order[]>(() => store.getOrders());
  const [isSoundActive, setIsSoundActive] = useState(() => soundService.isEnabled());
  const [newOrderNotice, setNewOrderNotice] = useState<Order | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));

  const config = store.getRestaurantConfig();

  // All system tabs mapped to module permission keys
  const allTabs: { id: TabKey; moduleKey: AppModule; label: string; icon: React.ComponentType<{ className?: string }>; badgeCount?: number }[] = [
    { id: 'pdv', moduleKey: 'pdv', label: 'PDV Balcão', icon: Store },
    { id: 'kanban', moduleKey: 'kanban', label: 'Gestão de Pedidos', icon: Layers, badgeCount: orders.filter((o) => o.status === 'NOVO').length },
    { id: 'kds', moduleKey: 'kds', label: 'Cozinha / KDS', icon: ChefHat, badgeCount: orders.filter((o) => o.status === 'EM_PREPARO').length },
    { id: 'caixa', moduleKey: 'caixa', label: 'Controle de Caixa', icon: Vault },
    { id: 'reports', moduleKey: 'relatorios', label: 'Relatórios & DRE', icon: BarChart3 },
    { id: 'menu', moduleKey: 'menu', label: 'Cardápio Digital', icon: UtensilsCrossed },
    { id: 'usuarios', moduleKey: 'usuarios', label: 'Equipe & Acessos', icon: Users },
    { id: 'audit', moduleKey: 'auditoria', label: 'Auditoria de Ações', icon: History },
    { id: 'qrcodes', moduleKey: 'qrcodes', label: 'QR Codes & Links', icon: QrCode },
    { id: 'settings', moduleKey: 'configuracoes', label: 'Configurações Loja', icon: Settings },
  ];

  // Filter tabs by current user's authorized modules, strict cash authority, and ADMINISTRADOR-only staff management
  const allowedTabs = useMemo(() => {
    if (!currentUser) return allTabs;
    const canManageCash = store.canUserManageCash();
    const canManageUsers = currentUser.role === 'ADMINISTRADOR' && store.canUserManageUsers();
    const roleSafeTabs = allTabs.filter((tab) => {
      if (tab.id === 'caixa' && !canManageCash) return false;
      if (tab.id === 'usuarios' && !canManageUsers) return false;
      return true;
    });
    if (currentUser.role === 'ADMINISTRADOR') return roleSafeTabs;
    const modules = currentUser.allowedModules || ['pdv', 'kanban'];
    return roleSafeTabs.filter((tab) => modules.includes(tab.moduleKey));
  }, [currentUser, allTabs]);

  const [activeTab, setActiveTab] = useState<TabKey>(() => {
    return allowedTabs.length > 0 ? allowedTabs[0].id : 'pdv';
  });

  // Ensure active tab is within allowed tabs if permissions change
  useEffect(() => {
    if (!allowedTabs.some((t) => t.id === activeTab) && allowedTabs.length > 0) {
      setActiveTab(allowedTabs[0].id);
    }
  }, [allowedTabs, activeTab]);

  const refreshOrders = () => {
    setOrders(store.getOrders());
  };

  useEffect(() => {
    // Clock
    const timer = setInterval(() => {
      setCurrentTime(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));
    }, 10000);

    // Event listener for state changes across tabs
    const handleStateChange = (event: Event) => {
      const custom = event as CustomEvent;
      refreshOrders();

      if (custom.detail?.type === 'ORDER_CREATED') {
        setNewOrderNotice(custom.detail.payload as Order);
        setTimeout(() => setNewOrderNotice(null), 6000);
      }
    };

    const handleSwitchToPdv = () => {
      setActiveTab('pdv');
    };

    window.addEventListener('gestaofood_state_changed', handleStateChange);
    window.addEventListener('switch_to_pdv', handleSwitchToPdv);
    return () => {
      clearInterval(timer);
      window.removeEventListener('gestaofood_state_changed', handleStateChange);
      window.removeEventListener('switch_to_pdv', handleSwitchToPdv);
    };
  }, []);

  const toggleSound = () => {
    const next = !isSoundActive;
    soundService.setEnabled(next);
    setIsSoundActive(next);
    if (next) {
      soundService.playSuccessTone();
    }
  };

  const testAlertSound = () => {
    soundService.playNewOrderAlert();
  };

  // Metrics summary for top bar
  const activeOrdersCount = orders.filter((o) => o.status !== 'ENTREGUE' && o.status !== 'CANCELADO').length;
  const newOrdersCount = orders.filter((o) => o.status === 'NOVO').length;

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-[#0F2342] pb-24 lg:pb-12">
      {/* Top Main Navigation Bar */}
      <header className="bg-[#0F2342] text-white shadow-sm sticky top-0 z-30 border-b border-white/10">
        <div className="max-w-7xl mx-auto px-3 sm:px-5 lg:px-6 py-2 sm:py-2.5 flex items-center justify-between gap-2 sm:gap-4">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <div className="shrink-0">
              <AmanditaLogo variant="icon" size="sm" theme="dark" className="sm:w-10 sm:h-10" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <h1 className="font-bold text-sm sm:text-base tracking-tight text-white truncate">
                  {config.name}
                </h1>
                {store.getAuthSessionMode() === 'local_contingency' && (
                  <span
                    className="text-[11px] font-semibold text-amber-300 shrink-0 whitespace-nowrap"
                    title="Firebase não configurado neste dispositivo"
                  >
                    · Contingência local
                  </span>
                )}
              </div>
              <p className="text-[11px] sm:text-xs text-slate-300 flex items-center gap-1.5 sm:gap-2 truncate">
                <span className="font-mono tabular-nums text-[#FB923C] font-semibold shrink-0">{currentTime}</span>
                <span className="text-slate-500" aria-hidden="true">·</span>
                <span className="shrink-0 tabular-nums">{activeOrdersCount} ativos</span>
                {newOrdersCount > 0 && (
                  <>
                    <span className="text-slate-500" aria-hidden="true">·</span>
                    <span className="text-[#FB923C] font-bold flex items-center gap-1 shrink-0 tabular-nums">
                      <Bell className="w-3 h-3 animate-bounce" />
                      {newOrdersCount} novos
                    </span>
                  </>
                )}
              </p>
            </div>
          </div>

          {/* Quick shortcuts and Audio toggles */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {/* Audio Alert Toggle & Test Button */}
            <div className="flex items-center gap-0.5 bg-[#1B365D] p-1 rounded-xl border border-white/10">
              <button
                onClick={toggleSound}
                className={`p-1.5 rounded-lg transition cursor-pointer ${
                  isSoundActive ? 'text-[#FB923C] bg-[#EA580C]/20' : 'text-slate-400 hover:text-white'
                }`}
                title={isSoundActive ? 'Som ativado (clique para silenciar)' : 'Som desativado (clique para ativar)'}
              >
                {isSoundActive ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
              </button>
              <button
                onClick={testAlertSound}
                className="hidden sm:inline-flex px-2 py-1 text-[11px] font-semibold text-slate-200 hover:text-white rounded-lg hover:bg-white/10 transition whitespace-nowrap cursor-pointer"
                title="Tocar som de campainha de teste"
              >
                Testar Som
              </button>
            </div>

            {/* Quick return to PDV / Balcão if in other tabs */}
            {activeTab !== 'pdv' && allowedTabs.some((t) => t.id === 'pdv') && (
              <button
                onClick={() => setActiveTab('pdv')}
                className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 bg-[#EA580C] hover:bg-[#C2410C] text-white rounded-xl text-xs font-bold transition shadow-2xs whitespace-nowrap shrink-0 cursor-pointer"
                title="Retornar diretamente à tela principal do PDV Balcão"
              >
                <Store className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden sm:inline">Voltar ao PDV</span>
                <span className="sm:hidden">PDV</span>
              </button>
            )}

            {/* Quick Link buttons to Client Menu and Driver Portal */}
            <button
              onClick={() => onNavigateToView('cardapio')}
              className="hidden lg:flex items-center gap-1.5 px-3 py-1.5 bg-[#1B365D] hover:bg-[#25477A] text-slate-100 rounded-xl text-xs font-semibold border border-white/15 transition whitespace-nowrap shrink-0 cursor-pointer"
            >
              <span>Cardápio</span>
              <ExternalLink className="w-3 h-3 opacity-70" />
            </button>

            <button
              onClick={() => onNavigateToView('entregador')}
              className="hidden lg:flex items-center gap-1.5 px-3 py-1.5 bg-[#1B365D] hover:bg-[#25477A] text-slate-100 rounded-xl text-xs font-semibold border border-white/15 transition whitespace-nowrap shrink-0 cursor-pointer"
            >
              <span>Entregador</span>
              <ExternalLink className="w-3 h-3 opacity-70" />
            </button>

            {/* User Profile & Logout */}
            <div className="flex items-center gap-2 pl-2 border-l border-white/15">
              <div className="text-right hidden md:block">
                <p className="text-xs font-bold text-white leading-tight truncate max-w-[140px]">
                  {currentUser?.name || currentUser?.username || 'admin'}
                </p>
                <p className="text-[11px] text-slate-300 font-medium leading-tight">
                  {currentUser?.role || 'ADMINISTRADOR'}
                </p>
              </div>
              <button
                onClick={onLogout}
                className="p-2 text-slate-300 hover:text-rose-300 hover:bg-white/10 rounded-xl transition cursor-pointer"
                title="Sair da sessão"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="max-w-7xl mx-auto px-3 sm:px-5 lg:px-6 w-full max-w-full overflow-hidden">
          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar border-t border-white/10 py-1.5">
            {allowedTabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;

              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition whitespace-nowrap cursor-pointer shrink-0 ${
                    isActive
                      ? 'bg-[#EA580C] text-white shadow-xs'
                      : 'text-slate-300 hover:text-white hover:bg-[#1B365D]'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  <span>{tab.label}</span>
                  {tab.badgeCount !== undefined && tab.badgeCount > 0 && (
                    <span className={`px-1.5 py-0.5 rounded-md text-[10px] font-bold leading-none tabular-nums ${
                      isActive ? 'bg-white text-[#0F2342]' : 'bg-[#EA580C] text-white'
                    }`}>
                      {tab.badgeCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      {/* NEW ORDER SOUND & VISUAL ALERT BANNER */}
      {newOrderNotice && (
        <div className="max-w-7xl mx-auto px-3 sm:px-5 lg:px-6 pt-3 animate-in slide-in-from-top-3">
          <div className="bg-[#0F2342] text-white p-3.5 sm:p-4 rounded-2xl shadow-lg border border-[#EA580C]/50 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-[#EA580C] text-white flex items-center justify-center shrink-0">
                <Bell className="w-4 h-4 animate-bounce" />
              </div>
              <div className="min-w-0">
                <span className="text-[11px] font-semibold text-[#FB923C] block">
                  Novo pedido recebido
                </span>
                <p className="text-sm font-bold truncate">
                  {newOrderNotice.orderNumber} · {newOrderNotice.customer.name} ({newOrderNotice.items.length} itens)
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => {
                  store.silenceAllAlerts();
                  setActiveTab('kanban');
                  setNewOrderNotice(null);
                }}
                className="px-3.5 py-1.5 bg-[#EA580C] hover:bg-[#C2410C] text-white rounded-xl text-xs font-bold transition shadow-xs whitespace-nowrap cursor-pointer"
              >
                Abrir Pedidos
              </button>
              <button
                onClick={() => {
                  store.silenceAllAlerts();
                  setNewOrderNotice(null);
                }}
                className="text-slate-300 hover:text-white p-1.5 cursor-pointer"
              >
                ✕
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Tab Content */}
      <main className="max-w-7xl mx-auto px-3 sm:px-5 lg:px-6 pt-3 sm:pt-5">
        {activeTab === 'pdv' && (
          <PointOfSale
            currentUser={currentUser}
            onOrderCreated={refreshOrders}
            onNavigateToCaixa={() => setActiveTab('caixa')}
          />
        )}

        {activeTab === 'kanban' && (
          <LiveOrdersKanban orders={orders} onOrderUpdated={refreshOrders} currentUser={currentUser} />
        )}

        {activeTab === 'kds' && (
          <KitchenDisplaySystem orders={orders} onOrderUpdated={refreshOrders} />
        )}

        {activeTab === 'caixa' && (
          <CashRegisterManager onStateChanged={refreshOrders} />
        )}

        {activeTab === 'reports' && (
          <FinancialReports orders={orders} />
        )}

        {activeTab === 'menu' && (
          <MenuManagement />
        )}

        {activeTab === 'usuarios' && (
          <StaffManager />
        )}

        {activeTab === 'audit' && (
          <MovementAuditLog orders={orders} />
        )}

        {activeTab === 'qrcodes' && (
          <QrCodeManager onNavigateToView={onNavigateToView} />
        )}

        {activeTab === 'settings' && (
          <StoreSettings currentUser={currentUser} onNavigateToPdv={() => setActiveTab('pdv')} />
        )}
      </main>

      {/* Floating alert for incoming customer menu orders */}
      <FloatingOrderAlert onOpenOrder={(order) => setActiveTab('kanban')} />
    </div>
  );
};
