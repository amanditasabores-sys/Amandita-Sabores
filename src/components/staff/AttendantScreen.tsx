import React, { useState, useEffect } from 'react';
import { store } from '../../services/store';
import { soundService } from '../../services/audio';
import { Order, User } from '../../types';
import { PointOfSale } from '../admin/PointOfSale';
import { LiveOrdersKanban } from '../admin/LiveOrdersKanban';
import { AmanditaLogo } from '../common/AmanditaLogo';
import { FloatingOrderAlert } from '../common/FloatingOrderAlert';
import { 
  Store, 
  Layers, 
  Volume2, 
  VolumeX, 
  LogOut, 
  Bell, 
  Clock 
} from 'lucide-react';

interface AttendantScreenProps {
  currentUser: User | null;
  onLogout: () => void;
}

export const AttendantScreen: React.FC<AttendantScreenProps> = ({ currentUser, onLogout }) => {
  const [orders, setOrders] = useState<Order[]>(() => store.getOrders());
  const [activeTab, setActiveTab] = useState<'pdv' | 'kanban'>('pdv');
  const [isSoundActive, setIsSoundActive] = useState(() => soundService.isEnabled());
  const [newOrderNotice, setNewOrderNotice] = useState<Order | null>(null);
  const [currentTime, setCurrentTime] = useState(
    new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  );

  const refreshOrders = () => {
    setOrders(store.getOrders());
  };

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));
    }, 10000);

    const handleStateChange = (event: Event) => {
      const custom = event as CustomEvent;
      refreshOrders();

      if (custom.detail?.type === 'ORDER_CREATED') {
        const order = custom.detail.payload as Order;
        setNewOrderNotice(order);
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

  const activeOrdersCount = orders.filter((o) => o.status !== 'ENTREGUE' && o.status !== 'CANCELADO').length;
  const newOrdersCount = orders.filter((o) => o.status === 'NOVO').length;

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-[#0F2342] pb-24 lg:pb-12">
      {/* Top Header - Dedicated Atendente UI */}
      <header className="bg-[#0F2342] text-white shadow-sm sticky top-0 z-30 border-b border-white/10">
        <div className="max-w-7xl mx-auto px-3 sm:px-5 lg:px-6 py-2 sm:py-2.5 flex items-center justify-between gap-2 sm:gap-4">
          {/* Brand & Atendente Tag */}
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <div className="shrink-0">
              <AmanditaLogo variant="icon" size="sm" theme="dark" className="sm:w-10 sm:h-10" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <h1 className="font-bold text-sm sm:text-base tracking-tight text-white truncate">
                  Atendimento & Balcão
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
                <span className="font-mono tabular-nums text-[#FB923C] font-semibold flex items-center gap-1 shrink-0">
                  <Clock className="w-3 h-3" />
                  {currentTime}
                </span>
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
                title={isSoundActive ? 'Som ativado' : 'Som desativado'}
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

            {/* Quick return to PDV if on kanban tab */}
            {activeTab !== 'pdv' && (
              <button
                onClick={() => setActiveTab('pdv')}
                className="px-2.5 sm:px-3 py-1.5 bg-[#EA580C] hover:bg-[#C2410C] text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                title="Retornar à tela principal do PDV"
              >
                <Store className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden sm:inline">Voltar ao PDV</span>
                <span className="sm:hidden">PDV</span>
              </button>
            )}

            {/* User Profile & Logout */}
            <div className="flex items-center gap-2 pl-2 border-l border-white/15">
              <div className="text-right hidden md:block">
                <p className="text-xs font-bold text-white leading-tight truncate max-w-[140px]">
                  {currentUser?.name || currentUser?.username || 'Atendente'}
                </p>
                <p className="text-[11px] text-slate-300 font-medium leading-tight">
                  Atendente
                </p>
              </div>
              <button
                onClick={onLogout}
                className="px-2.5 sm:px-3 py-1.5 bg-white/10 hover:bg-rose-500/20 text-slate-200 hover:text-rose-200 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 border border-white/10 whitespace-nowrap cursor-pointer"
                title="Sair do Atendimento"
              >
                <LogOut className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden sm:inline">Sair</span>
              </button>
            </div>
          </div>
        </div>

        {/* Navigation Tabs - Strictly limited to authorized modules (PDV and Kanban) */}
        <div className="max-w-7xl mx-auto px-3 sm:px-5 lg:px-6">
          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar border-t border-white/10 py-1.5">
            <button
              onClick={() => setActiveTab('pdv')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'pdv'
                  ? 'bg-[#EA580C] text-white shadow-xs'
                  : 'text-slate-300 hover:text-white hover:bg-[#1B365D]'
              }`}
            >
              <Store className="w-3.5 h-3.5 shrink-0" />
              <span>PDV Balcão</span>
            </button>

            <button
              onClick={() => setActiveTab('kanban')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'kanban'
                  ? 'bg-[#EA580C] text-white shadow-xs'
                  : 'text-slate-300 hover:text-white hover:bg-[#1B365D]'
              }`}
            >
              <Layers className="w-3.5 h-3.5 shrink-0" />
              <span>Gestão de Pedidos</span>
              {newOrdersCount > 0 && (
                <span className={`px-1.5 py-0.5 rounded-md text-[10px] font-bold leading-none tabular-nums ${
                  activeTab === 'kanban' ? 'bg-white text-[#0F2342]' : 'bg-[#EA580C] text-white'
                }`}>
                  {newOrdersCount}
                </span>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-3 sm:px-5 lg:px-6 pt-3 sm:pt-5">
        {activeTab === 'pdv' && (
          <PointOfSale currentUser={currentUser} onOrderCreated={refreshOrders} />
        )}
        {activeTab === 'kanban' && (
          <LiveOrdersKanban
            orders={orders}
            onOrderUpdated={refreshOrders}
            currentUser={currentUser}
          />
        )}
      </main>

      {/* New Order Alert Floating Toast */}
      <FloatingOrderAlert onOpenOrder={() => setActiveTab('kanban')} />
    </div>
  );
};
