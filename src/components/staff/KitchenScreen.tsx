import React, { useState, useEffect } from 'react';
import { store } from '../../services/store';
import { soundService } from '../../services/audio';
import { Order, User } from '../../types';
import { KitchenDisplaySystem } from '../admin/KitchenDisplaySystem';
import { AmanditaLogo } from '../common/AmanditaLogo';
import { FloatingOrderAlert } from '../common/FloatingOrderAlert';
import { 
  ChefHat, 
  Volume2, 
  VolumeX, 
  LogOut, 
  Bell, 
  Clock,
  Flame,
  ShieldCheck
} from 'lucide-react';

interface KitchenScreenProps {
  currentUser: User | null;
  onLogout: () => void;
}

export const KitchenScreen: React.FC<KitchenScreenProps> = ({ currentUser, onLogout }) => {
  const [orders, setOrders] = useState<Order[]>(() => store.getOrders());
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

  const pendingKitchenOrders = orders.filter((o) => o.status === 'NOVO' || o.status === 'EM_PREPARO');
  const newOrdersCount = orders.filter((o) => o.status === 'NOVO').length;

  return (
    <div className="min-h-screen bg-[#1F100B] text-slate-100 pb-16">
      {/* Top Header - Dedicated Kitchen UI */}
      <header className="bg-gradient-to-r from-[#180C08] via-[#2C1810] to-[#180C08] text-white shadow-lg sticky top-0 z-30 border-b border-[#4A2E1F]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3">
          {/* Brand & KDS Tag */}
          <div className="flex items-center gap-3">
            <AmanditaLogo variant="icon" size="md" theme="dark" />
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-black text-base tracking-tight text-white flex items-center gap-1.5">
                  <ChefHat className="w-5 h-5 text-amber-400" />
                  <span>Cozinha & KDS</span>
                </h1>
                <span className="px-2 py-0.5 rounded-full text-[9px] font-extrabold bg-amber-500/20 text-amber-300 border border-amber-500/30 uppercase tracking-wider">
                  FILA DE PRODUÇÃO
                </span>
              </div>
              <p className="text-xs text-[#D9C7B8] flex items-center gap-2">
                <span className="font-mono text-amber-300 font-bold flex items-center gap-1">
                  <Clock className="w-3 h-3 text-amber-400" />
                  {currentTime}
                </span>
                <span>·</span>
                <span className="font-semibold">{pendingKitchenOrders.length} pedido(s) a preparar</span>
                {newOrdersCount > 0 && (
                  <>
                    <span>·</span>
                    <span className="text-amber-400 font-black flex items-center gap-1">
                      <Bell className="w-3 h-3 animate-bounce" />
                      {newOrdersCount} novos
                    </span>
                  </>
                )}
              </p>
            </div>
          </div>

          {/* Sound & Staff Controls */}
          <div className="flex items-center gap-3">
            {/* Audio Toggle */}
            <div className="flex items-center gap-1 bg-black/40 p-1 rounded-xl border border-white/10">
              <button
                onClick={toggleSound}
                className={`p-1.5 rounded-lg transition cursor-pointer ${
                  isSoundActive ? 'text-amber-400 bg-amber-500/20' : 'text-slate-400 hover:text-white'
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
                Testar Campainha
              </button>
            </div>

            {/* User Profile & Logout */}
            <div className="flex items-center gap-3 pl-3 border-l border-white/15">
              <div className="text-right hidden sm:block">
                <p className="text-xs font-black text-white leading-tight">
                  {currentUser?.name || currentUser?.username || 'Cozinha'}
                </p>
                <p className="text-[10px] text-amber-400 uppercase font-bold tracking-wider">
                  Produção / KDS
                </p>
              </div>
              <button
                onClick={onLogout}
                className="px-3 py-1.5 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 hover:text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 border border-rose-500/30 cursor-pointer"
                title="Sair da sessão da cozinha"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Sair</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main KDS Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 pt-6">
        <KitchenDisplaySystem orders={orders} onOrderUpdated={refreshOrders} />
      </main>

      {/* New Order Alert Floating Toast */}
      <FloatingOrderAlert onOpenOrder={() => refreshOrders()} />
    </div>
  );
};
