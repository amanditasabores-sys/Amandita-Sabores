import React, { useState, useEffect } from 'react';
import { store } from '../../services/store';
import { User, CashRegisterShift } from '../../types';
import { CashRegisterManager } from '../admin/CashRegisterManager';
import { FinancialReports } from '../admin/FinancialReports';
import { PointOfSale } from '../admin/PointOfSale';
import { AmanditaLogo } from '../common/AmanditaLogo';
import { 
  Vault, 
  LogOut, 
  CheckCircle2, 
  AlertCircle,
  BarChart3,
  Store,
  Clock
} from 'lucide-react';

interface CashierScreenProps {
  currentUser: User | null;
  onLogout: () => void;
}

export const CashierScreen: React.FC<CashierScreenProps> = ({ currentUser, onLogout }) => {
  const [currentShift, setCurrentShift] = useState<CashRegisterShift | null>(() => store.getCurrentCashShift());
  const [cashSyncState, setCashSyncState] = useState(() => store.getCashShiftSyncState());
  const [activeTab, setActiveTab] = useState<'caixa' | 'relatorios' | 'pdv'>('caixa');
  const [currentTime, setCurrentTime] = useState(
    new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  );

  const allowedModules = currentUser?.allowedModules || ['caixa'];
  const hasReportsPermission = allowedModules.includes('relatorios');
  const hasPdvPermission = allowedModules.includes('pdv') || 
    currentUser?.role === 'ADMINISTRADOR' || 
    currentUser?.role === 'GERENTE' || 
    currentUser?.username === 'admin';

  const refreshData = () => {
    setCurrentShift(store.getCurrentCashShift());
    setCashSyncState(store.getCashShiftSyncState());
  };

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));
    }, 10000);

    const handleSync = () => refreshData();
    window.addEventListener('gestaofood_state_changed', handleSync);
    return () => {
      clearInterval(timer);
      window.removeEventListener('gestaofood_state_changed', handleSync);
    };
  }, []);

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-[#0F2342] pb-24 lg:pb-12">
      {/* Top Header - Dedicated Caixa UI */}
      <header className="bg-[#0F2342] text-white shadow-sm sticky top-0 z-30 border-b border-white/10">
        <div className="max-w-7xl mx-auto px-3 sm:px-5 lg:px-6 py-2 sm:py-2.5 flex items-center justify-between gap-2 sm:gap-4">
          {/* Brand & Caixa Status */}
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <div className="shrink-0">
              <AmanditaLogo variant="icon" size="sm" theme="dark" className="sm:w-10 sm:h-10" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <h1 className="font-bold text-sm sm:text-base tracking-tight text-white truncate">
                  Controle de Caixa
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
                {cashSyncState.status === 'SYNCING' || cashSyncState.status === 'IDLE' ? (
                  <span className="text-amber-300 font-semibold flex items-center gap-1 truncate">
                    <Clock className="w-3 h-3 animate-pulse shrink-0" />
                    Sincronizando caixa...
                  </span>
                ) : cashSyncState.status === 'ERROR' ? (
                  <span className="text-rose-300 font-semibold flex items-center gap-1 truncate">
                    <AlertCircle className="w-3 h-3 shrink-0" />
                    Falha ao sincronizar caixa
                  </span>
                ) : currentShift && currentShift.status === 'ABERTO' ? (
                  <span className="text-emerald-300 font-semibold flex items-center gap-1 truncate tabular-nums">
                    <CheckCircle2 className="w-3 h-3 shrink-0" />
                    Turno aberto (R$ {currentShift.initialBalance.toFixed(2)})
                  </span>
                ) : (
                  <span className="text-amber-300 font-semibold flex items-center gap-1 truncate">
                    <AlertCircle className="w-3 h-3 shrink-0" />
                    Caixa fechado
                  </span>
                )}
              </p>
            </div>
          </div>

          {/* User Profile & Logout */}
          <div className="flex items-center gap-2 shrink-0">
            {hasPdvPermission && (
              <button
                onClick={() => {
                  const url = new URL(window.location.href);
                  url.searchParams.set('view', 'admin');
                  window.history.pushState({}, '', url.toString());
                  window.dispatchEvent(new PopStateEvent('popstate'));
                  window.dispatchEvent(new CustomEvent('switch_to_pdv'));
                }}
                className="px-2.5 sm:px-3 py-1.5 bg-[#1B365D] hover:bg-[#25477A] text-slate-100 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 border border-white/15 whitespace-nowrap shrink-0 cursor-pointer"
                title="Retornar à tela principal do PDV / Painel de Controle"
              >
                <Store className="w-3.5 h-3.5 text-[#FB923C] shrink-0" />
                <span className="hidden sm:inline">PDV / Painel</span>
              </button>
            )}
            <div className="flex items-center gap-2 pl-2 border-l border-white/15">
              <div className="text-right hidden md:block">
                <p className="text-xs font-bold text-white leading-tight truncate max-w-[140px]">
                  {currentUser?.name || currentUser?.username || 'Operador de Caixa'}
                </p>
                <p className="text-[11px] text-slate-300 font-medium leading-tight">
                  Frente de Caixa
                </p>
              </div>
              <button
                onClick={onLogout}
                className="px-2.5 sm:px-3 py-1.5 bg-white/10 hover:bg-rose-500/20 text-slate-200 hover:text-rose-200 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 border border-white/10 whitespace-nowrap cursor-pointer"
                title="Sair do Caixa"
              >
                <LogOut className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden sm:inline">Sair</span>
              </button>
            </div>
          </div>
        </div>

        {/* Navigation Tabs (only shown if operator has extra permitted modules) */}
        {(hasReportsPermission || hasPdvPermission) && (
          <div className="max-w-7xl mx-auto px-3 sm:px-5 lg:px-6">
            <div className="flex items-center gap-1 overflow-x-auto no-scrollbar border-t border-white/10 py-1.5">
              <button
                onClick={() => setActiveTab('caixa')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition whitespace-nowrap shrink-0 cursor-pointer ${
                  activeTab === 'caixa'
                    ? 'bg-[#EA580C] text-white shadow-xs'
                    : 'text-slate-300 hover:text-white hover:bg-[#1B365D]'
                }`}
              >
                <Vault className="w-3.5 h-3.5 shrink-0" />
                <span>Fluxo de Caixa</span>
              </button>

              {hasPdvPermission && (
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
              )}

              {hasReportsPermission && (
                <button
                  onClick={() => setActiveTab('relatorios')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition whitespace-nowrap shrink-0 cursor-pointer ${
                    activeTab === 'relatorios'
                      ? 'bg-[#EA580C] text-white shadow-xs'
                      : 'text-slate-300 hover:text-white hover:bg-[#1B365D]'
                  }`}
                >
                  <BarChart3 className="w-3.5 h-3.5 shrink-0" />
                  <span>Relatórios Financeiros</span>
                </button>
              )}
            </div>
          </div>
        )}
      </header>

      {/* Main Cashier Content */}
      <main className="max-w-7xl mx-auto px-3 sm:px-5 lg:px-6 pt-3 sm:pt-5">
        {activeTab === 'caixa' && <CashRegisterManager onStateChanged={refreshData} />}
        {activeTab === 'pdv' && hasPdvPermission && (
          <PointOfSale currentUser={currentUser} onOrderCreated={refreshData} />
        )}
        {activeTab === 'relatorios' && hasReportsPermission && (
          <FinancialReports orders={store.getOrders()} />
        )}
      </main>
    </div>
  );
};
