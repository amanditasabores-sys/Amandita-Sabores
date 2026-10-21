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
  const [activeTab, setActiveTab] = useState<'caixa' | 'relatorios' | 'pdv'>('caixa');
  const [currentTime, setCurrentTime] = useState(
    new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  );

  const allowedModules = currentUser?.allowedModules || ['caixa'];
  const hasReportsPermission = allowedModules.includes('relatorios');
  const hasPdvPermission = allowedModules.includes('pdv');

  const refreshData = () => {
    setCurrentShift(store.getCurrentCashShift());
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
    <div className="min-h-screen bg-[#FAF7F2] text-[#2C1810] pb-16">
      {/* Top Header - Dedicated Caixa UI */}
      <header className="bg-gradient-to-r from-[#2C1810] via-[#3D2314] to-[#2C1810] text-white shadow-md sticky top-0 z-30 border-b border-[#C86D3B]/25">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3">
          {/* Brand & Caixa Status */}
          <div className="flex items-center gap-3">
            <AmanditaLogo variant="icon" size="md" theme="dark" />
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-black text-base tracking-tight text-white flex items-center gap-1.5">
                  <Vault className="w-5 h-5 text-emerald-400" />
                  <span>Controle de Caixa</span>
                </h1>
                <span className="px-2 py-0.5 rounded-full text-[9px] font-extrabold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 uppercase tracking-wider">
                  OPERADOR DE CAIXA
                </span>
              </div>
              <p className="text-xs text-[#D9C7B8] flex items-center gap-2">
                <span className="font-mono text-amber-300 font-bold flex items-center gap-1">
                  <Clock className="w-3 h-3 text-amber-400" />
                  {currentTime}
                </span>
                <span>·</span>
                {currentShift && currentShift.status === 'ABERTO' ? (
                  <span className="text-emerald-400 font-bold flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" />
                    Turno Aberto (R$ {currentShift.initialBalance.toFixed(2)})
                  </span>
                ) : (
                  <span className="text-amber-400 font-semibold flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />
                    Caixa Fechado
                  </span>
                )}
              </p>
            </div>
          </div>

          {/* User Profile & Logout */}
          <div className="flex items-center gap-3">
            <div className="text-right hidden sm:block">
              <p className="text-xs font-black text-white leading-tight">
                {currentUser?.name || currentUser?.username || 'Operador de Caixa'}
              </p>
              <p className="text-[10px] text-[#D9C7B8] uppercase font-bold tracking-wider">
                Frente de Caixa
              </p>
            </div>
            <button
              onClick={onLogout}
              className="px-3 py-1.5 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 hover:text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 border border-rose-500/30 cursor-pointer"
              title="Sair do Caixa"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sair</span>
            </button>
          </div>
        </div>

        {/* Navigation Tabs (only shown if operator has extra permitted modules) */}
        {(hasReportsPermission || hasPdvPermission) && (
          <div className="max-w-7xl mx-auto px-4 sm:px-6">
            <div className="flex items-center gap-1 overflow-x-auto border-t border-[#4A2E1F] pt-1.5 pb-1.5">
              <button
                onClick={() => setActiveTab('caixa')}
                className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                  activeTab === 'caixa'
                    ? 'bg-gradient-to-r from-[#C86D3B] via-[#B85D2A] to-[#721C24] text-white shadow-xs'
                    : 'text-[#D9C7B8] hover:text-white hover:bg-white/10'
                }`}
              >
                <Vault className="w-4 h-4" />
                <span>Fluxo de Caixa</span>
              </button>

              {hasPdvPermission && (
                <button
                  onClick={() => setActiveTab('pdv')}
                  className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                    activeTab === 'pdv'
                      ? 'bg-gradient-to-r from-[#C86D3B] via-[#B85D2A] to-[#721C24] text-white shadow-xs'
                      : 'text-[#D9C7B8] hover:text-white hover:bg-white/10'
                  }`}
                >
                  <Store className="w-4 h-4" />
                  <span>PDV Balcão</span>
                </button>
              )}

              {hasReportsPermission && (
                <button
                  onClick={() => setActiveTab('relatorios')}
                  className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                    activeTab === 'relatorios'
                      ? 'bg-gradient-to-r from-[#C86D3B] via-[#B85D2A] to-[#721C24] text-white shadow-xs'
                      : 'text-[#D9C7B8] hover:text-white hover:bg-white/10'
                  }`}
                >
                  <BarChart3 className="w-4 h-4" />
                  <span>Relatórios Financeiros</span>
                </button>
              )}
            </div>
          </div>
        )}
      </header>

      {/* Main Cashier Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 pt-6">
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
