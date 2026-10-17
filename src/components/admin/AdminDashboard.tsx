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

  // Filter tabs by current user's authorized modules
  const allowedTabs = useMemo(() => {
    if (!currentUser) return allTabs;
    if (currentUser.username === 'admin' || currentUser.role === 'ADMINISTRADOR') return allTabs;
    const modules = currentUser.allowedModules || ['pdv', 'kanban'];
    return allTabs.filter((tab) => modules.includes(tab.moduleKey));
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

    window.addEventListener('gestaofood_state_changed', handleStateChange);
    return () => {
      clearInterval(timer);
      window.removeEventListener('gestaofood_state_changed', handleStateChange);
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
    <div className="min-h-screen bg-[#FAF7F2] text-[#2C1810] pb-16">
      {/* Top Main Navigation Bar */}
      <header className="bg-gradient-to-r from-[#2C1810] via-[#3D2314] to-[#2C1810] text-white shadow-md sticky top-0 z-30 border-b border-[#C86D3B]/25">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <AmanditaLogo variant="icon" size="md" theme="dark" />
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-black text-base tracking-tight text-white">{config.name}</h1>
                <span className="px-2 py-0.5 rounded-full text-[9px] font-extrabold bg-[#C86D3B]/25 text-[#E89255] border border-[#C86D3B]/40 uppercase tracking-wider">
                  PAINEL DE GESTÃO
                </span>
              </div>
              <p className="text-xs text-[#D9C7B8] flex items-center gap-2">
                <span className="font-mono text-amber-300 font-bold">{currentTime}</span>
                <span>·</span>
                <span>{activeOrdersCount} pedidos ativos</span>
                {newOrdersCount > 0 && (
                  <>
                    <span>·</span>
                    <span className="text-[#E89255] font-black flex items-center gap-1">
                      <Bell className="w-3 h-3 animate-bounce" />
                      {newOrdersCount} novos
                    </span>
                  </>
                )}
              </p>
            </div>
          </div>

          {/* Quick shortcuts and Audio toggles */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* Audio Alert Toggle & Test Button */}
            <div className="flex items-center gap-1 bg-[#1F100B] p-1 rounded-xl border border-[#4A2E1F]">
              <button
                onClick={toggleSound}
                className={`p-1.5 rounded-lg transition ${
                  isSoundActive ? 'text-[#E89255] bg-[#C86D3B]/20' : 'text-slate-400 hover:text-white'
                }`}
                title={isSoundActive ? 'Som ativado (clique para silenciar)' : 'Som desativado (clique para ativar)'}
              >
                {isSoundActive ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
              </button>
              <button
                onClick={testAlertSound}
                className="px-2 py-1 text-[11px] font-semibold text-[#D9C7B8] hover:text-white rounded-lg hover:bg-white/10 transition"
                title="Tocar som de campainha de teste"
              >
                Testar Som
              </button>
            </div>

            {/* Quick Link buttons to Client Menu and Driver Portal */}
            <button
              onClick={() => onNavigateToView('cardapio')}
              className="hidden md:flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-emerald-700 to-emerald-600 hover:opacity-95 text-white rounded-xl text-xs font-bold transition shadow-2xs"
            >
              <span>Cardápio WhatsApp</span>
              <ExternalLink className="w-3 h-3 opacity-70" />
            </button>

            <button
              onClick={() => onNavigateToView('entregador')}
              className="hidden md:flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-[#C86D3B] to-[#721C24] hover:opacity-95 text-white rounded-xl text-xs font-bold transition shadow-2xs"
            >
              <span>Portal Entregador</span>
              <ExternalLink className="w-3 h-3 opacity-70" />
            </button>

            {/* User Profile & Logout */}
            <div className="flex items-center gap-2 pl-2 border-l border-[#4A2E1F]">
              <div className="text-right hidden sm:block">
                <p className="text-xs font-black text-white leading-tight">
                  {currentUser?.name || currentUser?.username || 'admin'}
                </p>
                <p className="text-[10px] text-[#D9C7B8] uppercase font-bold tracking-wider">
                  {currentUser?.role || 'ADMINISTRADOR'}
                </p>
              </div>
              <button
                onClick={onLogout}
                className="p-2 text-[#D9C7B8] hover:text-rose-400 hover:bg-white/10 rounded-xl transition"
                title="Sair da sessão"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex items-center gap-1 overflow-x-auto border-t border-[#4A2E1F] pt-1.5 pb-1.5 scrollbar-thin">
            {allowedTabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;

              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition whitespace-nowrap cursor-pointer ${
                    isActive
                      ? 'bg-gradient-to-r from-[#C86D3B] via-[#B85D2A] to-[#721C24] text-white shadow-sm'
                      : 'text-[#D9C7B8] hover:text-white hover:bg-white/10'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span>{tab.label}</span>
                  {tab.badgeCount !== undefined && tab.badgeCount > 0 && (
                    <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-black ${
                      isActive ? 'bg-white text-[#721C24]' : 'bg-[#C86D3B] text-white'
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
        <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-4 animate-in slide-in-from-top-3">
          <div className="bg-gradient-to-r from-[#C86D3B] to-[#721C24] text-white p-4 rounded-2xl shadow-lg border border-[#C86D3B]/40 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-white/20 text-white flex items-center justify-center font-bold">
                <Bell className="w-5 h-5 animate-bounce" />
              </div>
              <div>
                <span className="text-[10px] font-mono font-bold uppercase tracking-wider block text-amber-200">
                  NOVO PEDIDO CHEGANDO!
                </span>
                <p className="text-sm font-extrabold">
                  {newOrderNotice.orderNumber} · {newOrderNotice.customer.name} ({newOrderNotice.items.length} itens)
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => { 
                  store.silenceAllAlerts();
                  setActiveTab('kanban'); 
                  setNewOrderNotice(null); 
                }}
                className="px-3.5 py-1.5 bg-white text-[#721C24] rounded-xl text-xs font-black hover:bg-amber-100 transition shadow-xs cursor-pointer"
              >
                Abrir Pedidos
              </button>
              <button
                onClick={() => {
                  store.silenceAllAlerts();
                  setNewOrderNotice(null);
                }}
                className="text-white/80 hover:text-white p-1 cursor-pointer"
              >
                ✕
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Tab Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 pt-6">
        {activeTab === 'pdv' && (
          <PointOfSale
            currentUser={currentUser}
            onOrderCreated={refreshOrders}
            onNavigateToCaixa={() => setActiveTab('caixa')}
          />
        )}

        {activeTab === 'kanban' && (
          <LiveOrdersKanban orders={orders} onOrderUpdated={refreshOrders} />
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
          <StoreSettings />
        )}
      </main>

      {/* Floating alert for incoming customer menu orders */}
      <FloatingOrderAlert onOpenOrder={(order) => setActiveTab('kanban')} />
    </div>
  );
};
