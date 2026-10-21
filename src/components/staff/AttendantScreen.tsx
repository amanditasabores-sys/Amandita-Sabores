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
    <div className="min-h-screen bg-[#FAF7F2] text-[#2C1810] pb-16">
      {/* Top Header - Dedicated Atendente UI */}
      <header className="bg-gradient-to-r from-[#2C1810] via-[#3D2314] to-[#2C1810] text-white shadow-md sticky top-0 z-30 border-b border-[#C86D3B]/25">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3">
          {/* Brand & Atendente Tag */}
          <div className="flex items-center gap-3">
            <AmanditaLogo variant="icon" size="md" theme="dark" />
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-black text-base tracking-tight text-white flex items-center gap-1.5">
                  <Store className="w-5 h-5 text-[#E89255]" />
                  <span>Atendimento & Balcão</span>
                </h1>
                <span className="px-2 py-0.5 rounded-full text-[9px] font-extrabold bg-[#C86D3B]/25 text-[#E89255] border border-[#C86D3B]/40 uppercase tracking-wider">
                  ATENDENTE
                </span>
              </div>
              <p className="text-xs text-[#D9C7B8] flex items-center gap-2">
                <span className="font-mono text-amber-300 font-bold flex items-center gap-1">
                  <Clock className="w-3 h-3 text-amber-400" />
                  {currentTime}
                </span>
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
                className={`p-1.5 rounded-lg transition cursor-pointer ${
                  isSoundActive ? 'text-[#E89255] bg-[#C86D3B]/20' : 'text-slate-400 hover:text-white'
                }`}
                title={isSoundActive ? 'Som ativado' : 'Som desativado'}
              >
                {isSoundActive ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
              </button>
              <button
                onClick={testAlertSound}
                className="px-2 py-1 text-[11px] font-semibold text-[#D9C7B8] hover:text-white rounded-lg hover:bg-white/10 transition cursor-pointer"
                title="Tocar som de campainha de teste"
              >
                Testar Som
              </button>
            </div>

            {/* User Profile & Logout */}
            <div className="flex items-center gap-2 pl-2 border-l border-[#4A2E1F]">
              <div className="text-right hidden sm:block">
                <p className="text-xs font-black text-white leading-tight">
                  {currentUser?.name || currentUser?.username || 'Atendente'}
                </p>
                <p className="text-[10px] text-[#D9C7B8] uppercase font-bold tracking-wider">
                  Atendimento & PDV
                </p>
              </div>
              <button
                onClick={onLogout}
                className="px-3 py-1.5 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 hover:text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 border border-rose-500/30 cursor-pointer"
                title="Sair do Atendimento"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Sair</span>
              </button>
            </div>
          </div>
        </div>

        {/* Navigation Tabs - Strictly limited to authorized modules (PDV and Kanban) */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex items-center gap-1 overflow-x-auto border-t border-[#4A2E1F] pt-1.5 pb-1.5">
            <button
              onClick={() => setActiveTab('pdv')}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
                activeTab === 'pdv'
                  ? 'bg-gradient-to-r from-[#C86D3B] via-[#B85D2A] to-[#721C24] text-white shadow-sm'
                  : 'text-[#D9C7B8] hover:text-white hover:bg-white/10'
              }`}
            >
              <Store className="w-4 h-4" />
              <span>PDV Balcão</span>
            </button>

            <button
              onClick={() => setActiveTab('kanban')}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
                activeTab === 'kanban'
                  ? 'bg-gradient-to-r from-[#C86D3B] via-[#B85D2A] to-[#721C24] text-white shadow-sm'
                  : 'text-[#D9C7B8] hover:text-white hover:bg-white/10'
              }`}
            >
              <Layers className="w-4 h-4" />
              <span>Gestão de Pedidos</span>
              {newOrdersCount > 0 && (
                <span className="w-4 h-4 bg-amber-400 text-slate-950 rounded-full text-[9px] font-black flex items-center justify-center">
                  {newOrdersCount}
                </span>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 pt-6">
        {activeTab === 'pdv' && (
          <PointOfSale currentUser={currentUser} onOrderCreated={refreshOrders} />
        )}
        {activeTab === 'kanban' && (
          <LiveOrdersKanban
            orders={orders}
            onOrderUpdated={refreshOrders}
          />
        )}
      </main>

      {/* New Order Alert Floating Toast */}
      <FloatingOrderAlert onOpenOrder={() => setActiveTab('kanban')} />
    </div>
  );
};
