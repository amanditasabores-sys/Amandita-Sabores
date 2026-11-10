import React, { useState, useEffect } from 'react';
import { store } from '../../services/store';
import { Order, User, DeliveryShift, DeliveryShiftSummary } from '../../types';
import { formatCurrency, formatTime, formatDateTime } from '../../utils/formatters';
import { AmanditaLogo } from '../common/AmanditaLogo';
import {
  Bike,
  Users,
  Clock,
  CheckCircle,
  AlertTriangle,
  ArrowLeft,
  LogOut,
  Search,
  Filter,
  UserCheck,
  UserX,
  Phone,
  MessageSquare,
  Shield,
  ShieldCheck,
  Calendar,
  History,
  RotateCcw,
  Lock,
  Unlock,
  ChevronRight,
  MapPin,
  ExternalLink,
  Edit3,
  FileText,
  AlertCircle,
  X,
  Plus,
  Check
} from 'lucide-react';

interface DeliverySupervisorDashboardProps {
  currentUser?: User | null;
  adminUser?: User | null;
  onBackToAdmin?: () => void;
  onLogout?: () => void;
  initialOrderId?: string;
}

export const DeliverySupervisorDashboard: React.FC<DeliverySupervisorDashboardProps> = ({
  currentUser,
  adminUser,
  onBackToAdmin,
  onLogout,
  initialOrderId
}) => {
  const supervisorUser = currentUser || adminUser;
  const permissions = store.getDeliveryPermissions(supervisorUser);

  const [activeTab, setActiveTab] = useState<'entregadores' | 'entregas' | 'fechamento'>('entregas');
  const [orders, setOrders] = useState<Order[]>(() => store.getOrders());
  const [drivers, setDrivers] = useState<User[]>(() => store.getDeliveryDrivers());
  const [currentShift, setCurrentShift] = useState<DeliveryShift | null>(() => store.getCurrentDeliveryShift());
  const [shiftHistory, setShiftHistory] = useState<DeliveryShift[]>(() => store.getDeliveryShiftHistory());

  // Filters & selection
  const [deliveryFilter, setDeliveryFilter] = useState<'todas' | 'aguardando' | 'em_rota' | 'prontas' | 'concluidas' | 'pendencias_anteriores'>('todas');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDriver, setSelectedDriver] = useState<User | null>(null);

  // Modals
  const [assignModalOrder, setAssignModalOrder] = useState<Order | null>(() => {
    if (initialOrderId) {
      return store.getOrderById(initialOrderId) || null;
    }
    return null;
  });
  const [selectedNewDriverId, setSelectedNewDriverId] = useState<string>('');
  const [reassignReason, setReassignReason] = useState<string>('');

  const [occurrenceModalOrder, setOccurrenceModalOrder] = useState<Order | null>(null);
  const [occurrenceNote, setOccurrenceNote] = useState<string>('');

  const [isCloseShiftModalOpen, setIsCloseShiftModalOpen] = useState(false);
  const [closeShiftNotes, setCloseShiftNotes] = useState('');

  const [isOpenShiftModalOpen, setIsOpenShiftModalOpen] = useState(false);
  const [openShiftNotes, setOpenShiftNotes] = useState('');

  const [isShiftHistoryModalOpen, setIsShiftHistoryModalOpen] = useState(false);

  const loadData = () => {
    setOrders(store.getOrders());
    setDrivers(store.getDeliveryDrivers());
    setCurrentShift(store.getCurrentDeliveryShift());
    setShiftHistory(store.getDeliveryShiftHistory());
  };

  useEffect(() => {
    loadData();
    const handleUpdate = () => loadData();
    window.addEventListener('gestaofood_state_changed', handleUpdate);
    return () => window.removeEventListener('gestaofood_state_changed', handleUpdate);
  }, []);

  // Today reference date in local format
  const todayStr = new Date().toISOString().slice(0, 10);

  // Filter deliveries (DELIVERY fulfillment only)
  const deliveryOrders = orders.filter((o) => o.fulfillmentType === 'DELIVERY');

  // Today's deliveries
  const todayDeliveryOrders = deliveryOrders.filter((o) => {
    const orderDate = (o.createdAt || '').slice(0, 10);
    return orderDate === todayStr;
  });

  // Prior pending deliveries (created before today and not finalized)
  const priorPendingDeliveries = deliveryOrders.filter((o) => {
    const orderDate = (o.createdAt || '').slice(0, 10);
    return orderDate < todayStr && o.status !== 'ENTREGUE' && o.status !== 'CANCELADO';
  });

  // KPIs - Strictly consider only users with role ENTREGADOR
  const driverUsers = drivers.filter((d) => d.role?.toUpperCase() === 'ENTREGADOR');
  const totalDriversCount = driverUsers.length;
  const activeDrivers = driverUsers.filter((d) => d.status === 'ATIVO');
  const inactiveDrivers = driverUsers.filter((d) => d.status === 'DESATIVADO' || d.status === 'BLOQUEADO');

  // In-transit orders for active driver mapping
  const inTransitOrders = deliveryOrders.filter((o) => o.status === 'EM_ROTA');
  const occupiedDriverIds = new Set(
    inTransitOrders
      .map((o) => o.deliveryPersonId || o.deliveryPerson?.id)
      .filter(Boolean) as string[]
  );

  const availableDrivers = activeDrivers.filter((d) => !occupiedDriverIds.has(d.id));
  const busyDrivers = activeDrivers.filter((d) => occupiedDriverIds.has(d.id));

  // Delivery status counts
  const completedToday = todayDeliveryOrders.filter((o) => o.status === 'ENTREGUE');
  const inTransitToday = todayDeliveryOrders.filter((o) => o.status === 'EM_ROTA');
  const readyToday = todayDeliveryOrders.filter((o) => o.status === 'PRONTO');
  const pendingToday = todayDeliveryOrders.filter((o) => ['NOVO', 'EM_PREPARO', 'PRONTO'].includes(o.status));
  const unassignedDeliveries = deliveryOrders.filter(
    (o) => o.status !== 'ENTREGUE' && o.status !== 'CANCELADO' && !o.deliveryPersonId && !o.deliveryPerson
  );

  // Late or occurrence deliveries
  const lateOrOccurrenceDeliveries = deliveryOrders.filter((o) => {
    if (o.status === 'ENTREGUE' || o.status === 'CANCELADO') return false;
    const minutesElapsed = Math.floor((Date.now() - new Date(o.createdAt).getTime()) / 60000);
    const isLate = minutesElapsed > (o.estimatedDeliveryMinutes || 45);
    const hasOccurrence = o.movements.some((m) => m.notes?.includes('[OCORRÊNCIA]'));
    const hasReassignment = (o.deliveryAssignmentHistory?.length || 0) > 1;
    return isLate || hasOccurrence || hasReassignment;
  });

  // Driver metrics calculation helper
  const getDriverMetrics = (driver: User) => {
    const driverId = driver.id;
    const cleanDriverName = (driver.name || driver.username).toLowerCase().replace(/entregador\s*/g, '').trim();

    const isMatch = (ord: Order) => {
      if (ord.deliveryPersonId && (ord.deliveryPersonId === driverId || ord.deliveryPersonId === `driver-${driverId}`)) return true;
      if (ord.deliveryPerson?.id && (ord.deliveryPerson.id === driverId || ord.deliveryPerson.id === `driver-${driverId}`)) return true;
      const orderDriverName = (ord.deliveryPerson?.name || ord.deliveryPersonName || '').toLowerCase().replace(/entregador\s*/g, '').trim();
      return orderDriverName && cleanDriverName && (orderDriverName === cleanDriverName || orderDriverName.includes(cleanDriverName) || cleanDriverName.includes(orderDriverName));
    };

    const assignedToday = todayDeliveryOrders.filter(isMatch);
    const completed = assignedToday.filter((o) => o.status === 'ENTREGUE');
    const inTransit = assignedToday.filter((o) => o.status === 'EM_ROTA');
    const pending = assignedToday.filter((o) => ['PRONTO', 'EM_PREPARO', 'NOVO'].includes(o.status));
    const allTimeAssigned = deliveryOrders.filter(isMatch);

    return {
      assignedTodayCount: assignedToday.length,
      completedCount: completed.length,
      inTransitCount: inTransit.length,
      pendingCount: pending.length,
      totalAllTime: allTimeAssigned.length,
      isBusy: inTransit.length > 0,
      activeOrders: deliveryOrders.filter((o) => isMatch(o) && o.status !== 'ENTREGUE' && o.status !== 'CANCELADO'),
      recentHistory: allTimeAssigned.slice(0, 10)
    };
  };

  // Filtered deliveries list
  const filteredDeliveries = deliveryOrders.filter((o) => {
    // Tab filter
    if (deliveryFilter === 'aguardando') {
      if (o.status === 'ENTREGUE' || o.status === 'CANCELADO' || o.deliveryPerson || o.deliveryPersonId) return false;
    } else if (deliveryFilter === 'em_rota') {
      if (o.status !== 'EM_ROTA') return false;
    } else if (deliveryFilter === 'prontas') {
      if (o.status !== 'PRONTO') return false;
    } else if (deliveryFilter === 'concluidas') {
      if (o.status !== 'ENTREGUE') return false;
    } else if (deliveryFilter === 'pendencias_anteriores') {
      const orderDate = (o.createdAt || '').slice(0, 10);
      if (!(orderDate < todayStr && o.status !== 'ENTREGUE' && o.status !== 'CANCELADO')) return false;
    }

    // Text search
    if (searchQuery.trim()) {
      const term = searchQuery.toLowerCase().trim();
      const numMatch = o.orderNumber.toLowerCase().includes(term);
      const custMatch = o.customer.name.toLowerCase().includes(term);
      const driverMatch = (o.deliveryPerson?.name || o.deliveryPersonName || '').toLowerCase().includes(term);
      const addrMatch = `${o.customer.address?.street || ''} ${o.customer.address?.neighborhood || ''}`.toLowerCase().includes(term);
      return numMatch || custMatch || driverMatch || addrMatch;
    }

    return true;
  });

  // Handler: Assign or Reassign Delivery
  const handleConfirmAssignment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!assignModalOrder) return;

    const targetDriver = activeDrivers.find((d) => d.id === selectedNewDriverId);
    if (!targetDriver && selectedNewDriverId !== '__UNASSIGN__') {
      alert('Por favor, selecione um entregador ativo.');
      return;
    }

    const supervisorName = supervisorUser?.name || supervisorUser?.username || 'Supervisão';

    if (selectedNewDriverId === '__UNASSIGN__') {
      store.assignDeliveryPerson(assignModalOrder.id, null, supervisorName, reassignReason || 'Desvinculado pela supervisão');
    } else if (targetDriver) {
      store.assignDeliveryPerson(
        assignModalOrder.id,
        {
          id: targetDriver.id,
          name: targetDriver.name || targetDriver.username,
          phone: targetDriver.phone || ''
        },
        supervisorName,
        reassignReason || undefined
      );
    }

    setAssignModalOrder(null);
    setSelectedNewDriverId('');
    setReassignReason('');
    loadData();
  };

  // Handler: Add Occurrence Note
  const handleSaveOccurrence = (e: React.FormEvent) => {
    e.preventDefault();
    if (!occurrenceModalOrder || !occurrenceNote.trim()) return;

    const supervisorName = supervisorUser?.name || supervisorUser?.username || 'Supervisão';
    store.addOrderOccurrence(occurrenceModalOrder.id, occurrenceNote.trim(), supervisorName);

    setOccurrenceModalOrder(null);
    setOccurrenceNote('');
    loadData();
  };

  // Handler: Open Shift
  const handleOpenShift = (e: React.FormEvent) => {
    e.preventDefault();
    const supervisorData = {
      userId: supervisorUser?.id || 'admin',
      userName: supervisorUser?.name || supervisorUser?.username || 'Administrador',
      userRole: supervisorUser?.role || 'ADMINISTRADOR'
    };

    const res = store.openDeliveryShift(supervisorData, openShiftNotes.trim() || undefined);
    if (res.success) {
      setIsOpenShiftModalOpen(false);
      setOpenShiftNotes('');
      loadData();
    } else {
      alert(res.message);
    }
  };

  // Handler: Close Shift
  const handleCloseShift = (e: React.FormEvent) => {
    e.preventDefault();
    const supervisorData = {
      userId: supervisorUser?.id || 'admin',
      userName: supervisorUser?.name || supervisorUser?.username || 'Administrador',
      userRole: supervisorUser?.role || 'ADMINISTRADOR'
    };

    const totalDeliveredAmount = completedToday.reduce((sum, o) => sum + (o.totalAmount || 0), 0);

    const summary: DeliveryShiftSummary = {
      totalDeliveries: todayDeliveryOrders.length,
      completedDeliveries: completedToday.length,
      inTransitDeliveries: inTransitToday.length,
      pendingDeliveries: pendingToday.length,
      unassignedDeliveries: unassignedDeliveries.length,
      totalAmount: totalDeliveredAmount,
      activeDriversCount: activeDrivers.length
    };

    const res = store.closeDeliveryShift(supervisorData, summary, closeShiftNotes.trim() || undefined);
    if (res.success) {
      setIsCloseShiftModalOpen(false);
      setCloseShiftNotes('');
      loadData();
    } else {
      alert(res.message);
    }
  };

  // Handler: Reopen Shift
  const handleReopenShift = () => {
    if (!confirm('Deseja realmente reabrir o movimento diário de entregas?')) return;
    const supervisorData = {
      userId: supervisorUser?.id || 'admin',
      userName: supervisorUser?.name || supervisorUser?.username || 'Administrador',
      userRole: supervisorUser?.role || 'ADMINISTRADOR'
    };
    const res = store.reopenDeliveryShift(supervisorData);
    if (res.success) {
      loadData();
    } else {
      alert(res.message);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 pb-16 font-sans">
      {/* TOP HEADER */}
      <header className="bg-slate-900/90 backdrop-blur border-b border-slate-800 sticky top-0 z-30 shadow-lg">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 py-2.5 sm:py-3.5 flex items-center justify-between gap-3 flex-wrap">
          {/* Logo & Supervisor Identity */}
          <div className="flex items-center gap-3 min-w-0">
            <AmanditaLogo variant="icon" size="sm" theme="dark" />
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 text-slate-950 flex items-center justify-center font-bold shadow-md shrink-0">
              <ShieldCheck className="w-5 h-5 sm:w-6 sm:h-6" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-sm sm:text-base font-black tracking-tight text-white truncate">
                  Painel de Supervisão de Entregas
                </h1>
                <span className="px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 text-[10px] font-mono font-bold border border-blue-500/30">
                  SUPERVISÃO GERAL
                </span>
                {currentShift && currentShift.status === 'ABERTO' ? (
                  <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px] font-mono font-bold border border-emerald-500/30 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    MOVIMENTO ABERTO
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 text-[10px] font-mono font-bold border border-rose-500/30">
                    MOVIMENTO FECHADO
                  </span>
                )}
              </div>
              <p className="text-[11px] sm:text-xs text-slate-400 truncate mt-0.5">
                Supervisor: <span className="text-amber-200 font-semibold">{supervisorUser?.name || supervisorUser?.username || 'Administrador'}</span>
                <span className="text-slate-500 ml-1">({supervisorUser?.role || 'ADMINISTRADOR'})</span>
              </p>
            </div>
          </div>

          {/* Top Actions */}
          <div className="flex items-center gap-2 shrink-0">
            {/* Shift History Modal button */}
            {permissions.canViewShiftHistory && (
              <button
                onClick={() => setIsShiftHistoryModalOpen(true)}
                className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold transition border border-slate-700 cursor-pointer"
                title="Histórico dos Fechamentos Anteriores"
              >
                <History className="w-3.5 h-3.5 text-amber-400" />
                <span className="hidden md:inline">Histórico de Fechamentos</span>
              </button>
            )}

            {/* Shift Open / Close button */}
            {currentShift && currentShift.status === 'ABERTO' ? (
              permissions.canCloseDailyShift && (
                <button
                  onClick={() => setIsCloseShiftModalOpen(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-600/30 hover:bg-rose-600/40 text-rose-200 border border-rose-500/40 rounded-xl text-xs font-bold transition cursor-pointer"
                  title="Encerrar Movimento Diário de Entregas"
                >
                  <Lock className="w-3.5 h-3.5" />
                  <span>Fechar Movimento</span>
                </button>
              )
            ) : (
              permissions.canOpenDailyShift && (
                <button
                  onClick={() => setIsOpenShiftModalOpen(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition shadow cursor-pointer"
                  title="Abrir Novo Movimento Diário de Entregas"
                >
                  <Unlock className="w-3.5 h-3.5" />
                  <span>Abrir Movimento</span>
                </button>
              )
            )}

            {/* Back to Admin (Exclusive to Administrator or Gerente) */}
            {onBackToAdmin && (
              <button
                onClick={onBackToAdmin}
                className="flex items-center gap-1.5 px-3 py-1.5 sm:py-2 bg-gradient-to-r from-[#C86D3B] to-[#721C24] hover:opacity-95 text-white rounded-xl text-xs font-bold transition shadow cursor-pointer"
                title="Retornar à Administração"
              >
                <ArrowLeft className="w-4 h-4" />
                <span className="hidden sm:inline">Voltar à Administração</span>
              </button>
            )}

            {/* Logout */}
            {onLogout && (
              <button
                onClick={onLogout}
                className="flex items-center gap-1.5 px-2.5 py-1.5 sm:py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl text-xs font-bold transition border border-slate-700 cursor-pointer"
                title="Sair do Sistema"
              >
                <LogOut className="w-3.5 h-3.5 text-rose-400" />
                <span className="hidden sm:inline">Sair</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* SUPERVISOR BANNER NOTIFICATION */}
      <div className="max-w-7xl mx-auto px-4 pt-3">
        <div className="p-3 bg-gradient-to-r from-blue-950/70 via-slate-900 to-indigo-950/70 border border-blue-800/40 rounded-2xl flex items-center justify-between gap-3 text-xs shadow-sm">
          <div className="flex items-center gap-2.5 text-blue-200">
            <Shield className="w-4 h-4 text-blue-400 shrink-0" />
            <div>
              <span className="font-bold text-blue-300">Modo de Supervisão Ativo:</span>
              <span className="text-slate-300 ml-1.5">
                Você possui visão panorâmica de todos os entregadores e rotas. Administradores não recebem nem assumem entregas automaticamente.
              </span>
            </div>
          </div>
          {priorPendingDeliveries.length > 0 && (
            <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[11px] font-bold">
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>{priorPendingDeliveries.length} pendências de dias anteriores</span>
            </div>
          )}
        </div>
      </div>

      {/* DRIVER ASSIGNMENT SYSTEM STATUS BANNER */}
      <div className="max-w-7xl mx-auto px-4 pt-2.5">
        {activeDrivers.length === 0 ? (
          <div className="p-3 bg-rose-950/60 border border-rose-800/50 rounded-2xl flex items-center justify-between gap-3 text-xs shadow-sm">
            <div className="flex items-center gap-2.5 text-rose-200">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              <div>
                <strong className="text-rose-300">Nenhum entregador ativo disponível no momento.</strong>
                <span className="text-rose-100/90 ml-1.5">
                  Os pedidos permanecerão aguardando atribuição até que um entregador seja ativado ou atribuído manualmente.
                </span>
              </div>
            </div>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30 whitespace-nowrap">
              0 Ativos
            </span>
          </div>
        ) : activeDrivers.length === 1 ? (
          <div className="p-3 bg-emerald-950/50 border border-emerald-800/40 rounded-2xl flex items-center justify-between gap-3 text-xs shadow-sm">
            <div className="flex items-center gap-2.5 text-emerald-200">
              <Check className="w-4 h-4 text-emerald-400 shrink-0" />
              <div>
                <strong className="text-emerald-300">Atribuição Automática Ativa:</strong>
                <span className="text-emerald-100/90 ml-1.5">
                  Existe apenas 1 entregador ativo ({activeDrivers[0].name || activeDrivers[0].username}). Os novos pedidos delivery são atribuídos automaticamente a ele.
                </span>
              </div>
            </div>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 whitespace-nowrap">
              Auto-Atribuição Ativa
            </span>
          </div>
        ) : (
          <div className="p-3 bg-indigo-950/50 border border-indigo-800/40 rounded-2xl flex items-center justify-between gap-3 text-xs shadow-sm">
            <div className="flex items-center gap-2.5 text-indigo-200">
              <Users className="w-4 h-4 text-indigo-400 shrink-0" />
              <div>
                <strong className="text-indigo-300">Atribuição Manual Disponível:</strong>
                <span className="text-indigo-100/90 ml-1.5">
                  Existem {activeDrivers.length} entregadores ativos cadastrados. A supervisão pode escolher qual entregador ficará responsável por cada entrega.
                </span>
              </div>
            </div>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 whitespace-nowrap">
              {activeDrivers.length} Entregadores Ativos
            </span>
          </div>
        )}
      </div>

      {/* KPI METRICS OVERVIEW */}
      <section aria-label="Métricas de Supervisão" className="max-w-7xl mx-auto px-4 pt-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
          {/* 1. Total Entregadores */}
          <div className="bg-slate-900/90 border border-slate-800 p-3.5 rounded-2xl shadow-sm">
            <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
              <span>Entregadores</span>
              <Users className="w-4 h-4 text-amber-400" />
            </div>
            <p className="text-xl font-black text-white">{totalDriversCount}</p>
            <p className="text-[10px] text-slate-400 mt-0.5">
              <span className="text-emerald-400 font-bold">{activeDrivers.length} ativos</span> · <span className="text-slate-500">{inactiveDrivers.length} inativos</span>
            </p>
          </div>

          {/* 2. Disponíveis vs Ocupados */}
          <div className="bg-slate-900/90 border border-slate-800 p-3.5 rounded-2xl shadow-sm">
            <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
              <span>Status Equipe</span>
              <Bike className="w-4 h-4 text-blue-400" />
            </div>
            <p className="text-xl font-black text-emerald-400">{availableDrivers.length} <span className="text-xs font-normal text-slate-400">livres</span></p>
            <p className="text-[10px] text-slate-400 mt-0.5">
              <span className="text-indigo-400 font-bold">{busyDrivers.length} em rota</span> · {availableDrivers.length} prontos
            </p>
          </div>

          {/* 3. Total Entregas Hoje */}
          <div className="bg-slate-900/90 border border-slate-800 p-3.5 rounded-2xl shadow-sm">
            <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
              <span>Entregas do Dia</span>
              <Calendar className="w-4 h-4 text-orange-400" />
            </div>
            <p className="text-xl font-black text-white">{todayDeliveryOrders.length}</p>
            <p className="text-[10px] text-slate-400 mt-0.5">
              <span className="text-emerald-400 font-bold">{completedToday.length} entregues</span>
            </p>
          </div>

          {/* 4. Em Andamento */}
          <div className="bg-slate-900/90 border border-slate-800 p-3.5 rounded-2xl shadow-sm">
            <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
              <span>Em Rota Agora</span>
              <Clock className="w-4 h-4 text-indigo-400" />
            </div>
            <p className="text-xl font-black text-indigo-300">{inTransitToday.length}</p>
            <p className="text-[10px] text-slate-400 mt-0.5">
              {readyToday.length} prontas na cozinha
            </p>
          </div>

          {/* 5. Aguardando Atribuição */}
          <div className={`border p-3.5 rounded-2xl shadow-sm ${
            unassignedDeliveries.length > 0
              ? 'bg-amber-950/30 border-amber-500/40'
              : 'bg-slate-900/90 border-slate-800'
          }`}>
            <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
              <span>Sem Motoboy</span>
              <AlertCircle className={`w-4 h-4 ${unassignedDeliveries.length > 0 ? 'text-amber-400 animate-pulse' : 'text-slate-500'}`} />
            </div>
            <p className={`text-xl font-black ${unassignedDeliveries.length > 0 ? 'text-amber-400' : 'text-white'}`}>
              {unassignedDeliveries.length}
            </p>
            <p className="text-[10px] text-slate-400 mt-0.5">
              {unassignedDeliveries.length > 0 ? 'Requer atribuição' : 'Todas atribuídas'}
            </p>
          </div>

          {/* 6. Atrasadas / Ocorrências */}
          <div className={`border p-3.5 rounded-2xl shadow-sm ${
            lateOrOccurrenceDeliveries.length > 0
              ? 'bg-rose-950/30 border-rose-500/40'
              : 'bg-slate-900/90 border-slate-800'
          }`}>
            <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
              <span>Ocorrências</span>
              <AlertTriangle className={`w-4 h-4 ${lateOrOccurrenceDeliveries.length > 0 ? 'text-rose-400 animate-pulse' : 'text-slate-500'}`} />
            </div>
            <p className={`text-xl font-black ${lateOrOccurrenceDeliveries.length > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
              {lateOrOccurrenceDeliveries.length}
            </p>
            <p className="text-[10px] text-slate-400 mt-0.5">
              {lateOrOccurrenceDeliveries.length > 0 ? 'Atrasadas ou com nota' : 'Fluxo pontual'}
            </p>
          </div>
        </div>
      </section>

      {/* TABS NAVIGATION */}
      <div className="max-w-7xl mx-auto px-4 pt-5">
        <div className="flex items-center justify-between border-b border-slate-800 pb-2 flex-wrap gap-2">
          <nav aria-label="Navegação de Supervisão" className="flex items-center gap-1.5 sm:gap-2">
            <button
              onClick={() => setActiveTab('entregas')}
              className={`px-3.5 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition flex items-center gap-2 cursor-pointer ${
                activeTab === 'entregas'
                  ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/10'
                  : 'text-slate-400 hover:text-white hover:bg-slate-900'
              }`}
            >
              <Bike className="w-4 h-4" />
              <span>Gerenciamento de Entregas</span>
              <span className="px-1.5 py-0.2 rounded-md bg-black/20 text-[11px] font-mono">
                {deliveryOrders.filter((o) => o.status !== 'ENTREGUE' && o.status !== 'CANCELADO').length}
              </span>
            </button>

            <button
              onClick={() => setActiveTab('entregadores')}
              className={`px-3.5 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition flex items-center gap-2 cursor-pointer ${
                activeTab === 'entregadores'
                  ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/10'
                  : 'text-slate-400 hover:text-white hover:bg-slate-900'
              }`}
            >
              <Users className="w-4 h-4" />
              <span>Equipe de Entregadores</span>
              <span className="px-1.5 py-0.2 rounded-md bg-black/20 text-[11px] font-mono">
                {drivers.length}
              </span>
            </button>

            <button
              onClick={() => setActiveTab('fechamento')}
              className={`px-3.5 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition flex items-center gap-2 cursor-pointer ${
                activeTab === 'fechamento'
                  ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/10'
                  : 'text-slate-400 hover:text-white hover:bg-slate-900'
              }`}
            >
              <Lock className="w-4 h-4" />
              <span>Movimento Diário & Histórico</span>
            </button>
          </nav>

          {/* Quick Search */}
          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar pedido, cliente, entregador..."
              className="w-full pl-9 pr-3 py-1.5 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* MAIN CONTENT AREA */}
      <main className="max-w-7xl mx-auto px-4 pt-4">
        {/* ============================================================== */}
        {/* TAB 1: GERENCIAMENTO DE ENTREGAS */}
        {/* ============================================================== */}
        {activeTab === 'entregas' && (
          <div className="space-y-4">
            {/* Delivery Sub-Filters */}
            <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none py-1">
              <button
                onClick={() => setDeliveryFilter('todas')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition shrink-0 cursor-pointer ${
                  deliveryFilter === 'todas'
                    ? 'bg-slate-800 text-white border border-slate-700'
                    : 'text-slate-400 hover:text-white hover:bg-slate-900'
                }`}
              >
                Todas ({deliveryOrders.length})
              </button>
              <button
                onClick={() => setDeliveryFilter('aguardando')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition shrink-0 cursor-pointer ${
                  deliveryFilter === 'aguardando'
                    ? 'bg-amber-500 text-slate-950 font-black'
                    : 'text-amber-400/90 hover:text-amber-300 hover:bg-amber-950/30'
                }`}
              >
                Aguardando Atribuição ({unassignedDeliveries.length})
              </button>
              <button
                onClick={() => setDeliveryFilter('prontas')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition shrink-0 cursor-pointer ${
                  deliveryFilter === 'prontas'
                    ? 'bg-emerald-600 text-white'
                    : 'text-emerald-400/90 hover:text-emerald-300 hover:bg-emerald-950/30'
                }`}
              >
                Prontas para Entrega ({readyToday.length})
              </button>
              <button
                onClick={() => setDeliveryFilter('em_rota')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition shrink-0 cursor-pointer ${
                  deliveryFilter === 'em_rota'
                    ? 'bg-indigo-600 text-white'
                    : 'text-indigo-400/90 hover:text-indigo-300 hover:bg-indigo-950/30'
                }`}
              >
                Em Rota ({inTransitToday.length})
              </button>
              <button
                onClick={() => setDeliveryFilter('concluidas')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition shrink-0 cursor-pointer ${
                  deliveryFilter === 'concluidas'
                    ? 'bg-emerald-700 text-white'
                    : 'text-slate-400 hover:text-white hover:bg-slate-900'
                }`}
              >
                Concluídas ({completedToday.length})
              </button>
              {priorPendingDeliveries.length > 0 && (
                <button
                  onClick={() => setDeliveryFilter('pendencias_anteriores')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition shrink-0 cursor-pointer ${
                    deliveryFilter === 'pendencias_anteriores'
                      ? 'bg-rose-600 text-white'
                      : 'text-rose-400 hover:text-rose-300 hover:bg-rose-950/30 border border-rose-500/30'
                  }`}
                >
                  Pendências Anteriores ({priorPendingDeliveries.length})
                </button>
              )}
            </div>

            {/* Orders Grid */}
            {filteredDeliveries.length === 0 ? (
              <div className="bg-slate-900/60 border border-slate-800 rounded-3xl p-12 text-center text-slate-400">
                <Bike className="w-12 h-12 mx-auto mb-3 text-slate-600" />
                <p className="text-base font-bold text-white">Nenhuma entrega encontrada para este filtro.</p>
                <p className="text-xs text-slate-500 mt-1">Ajuste o filtro acima ou aguarde novos pedidos de delivery.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
                {filteredDeliveries.map((order) => {
                  const isAssigned = Boolean(order.deliveryPerson || order.deliveryPersonId);
                  const isLate = Math.floor((Date.now() - new Date(order.createdAt).getTime()) / 60000) > (order.estimatedDeliveryMinutes || 45);
                  const isPriorDay = (order.createdAt || '').slice(0, 10) < todayStr;
                  const hasOccurrence = order.movements.some((m) => m.notes?.includes('[OCORRÊNCIA]'));
                  const address = order.customer.address;
                  const addressText = address
                    ? `${address.street || ''}, ${address.number || 'S/N'}${address.neighborhood ? ` - ${address.neighborhood}` : ''}${address.city ? ` (${address.city})` : ''}`
                    : 'Endereço não informado';

                  return (
                    <div
                      key={order.id}
                      className={`bg-slate-900/90 rounded-2xl border p-4 shadow-sm flex flex-col justify-between transition hover:border-slate-700 ${
                        isPriorDay && order.status !== 'ENTREGUE'
                          ? 'border-rose-500/50 bg-rose-950/10'
                          : unassignedDeliveries.includes(order)
                          ? 'border-amber-500/40 bg-amber-950/10'
                          : 'border-slate-800'
                      }`}
                    >
                      {/* Top Order Badge & Info */}
                      <div>
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-base font-black text-white font-mono">
                                {order.orderNumber}
                              </span>
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                order.status === 'ENTREGUE'
                                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                  : order.status === 'EM_ROTA'
                                  ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                                  : order.status === 'PRONTO'
                                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                  : 'bg-slate-800 text-slate-300 border border-slate-700'
                              }`}>
                                {order.status === 'EM_ROTA'
                                  ? 'Em Rota'
                                  : order.status === 'ENTREGUE'
                                  ? 'Entregue'
                                  : order.status === 'PRONTO'
                                  ? 'Pronto'
                                  : order.status === 'EM_PREPARO'
                                  ? 'Em Preparo'
                                  : 'Novo'}
                              </span>
                              {isPriorDay && order.status !== 'ENTREGUE' && (
                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/40">
                                  Dia Anterior ({order.createdAt.slice(0, 10)})
                                </span>
                              )}
                              {isLate && order.status !== 'ENTREGUE' && (
                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 flex items-center gap-0.5">
                                  <Clock className="w-3 h-3" /> Atrasado
                                </span>
                              )}
                            </div>
                            <span className="text-[11px] text-slate-400 font-mono mt-0.5 block">
                              Criado às {formatTime(order.createdAt)} ({formatDateTime(order.createdAt).split(' ')[0]})
                            </span>
                          </div>

                          <span className="text-sm font-black text-amber-400 font-mono">
                            {formatCurrency(order.totalAmount)}
                          </span>
                        </div>

                        {/* Customer Info */}
                        <div className="bg-slate-950/60 rounded-xl p-2.5 border border-slate-800/80 mb-3 space-y-1 text-xs">
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-white">{order.customer.name}</span>
                            {order.customer.phone && (
                              <span className="text-slate-400 font-mono text-[11px]">{order.customer.phone}</span>
                            )}
                          </div>
                          <p className="text-[11px] text-slate-300 flex items-start gap-1 leading-snug">
                            <MapPin className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                            <span className="line-clamp-2">{addressText}</span>
                          </p>
                        </div>

                        {/* Current Driver Assigned */}
                        <div className="bg-slate-800/50 rounded-xl p-2.5 border border-slate-800 mb-3 text-xs">
                          <span className="text-[10px] text-slate-400 uppercase tracking-wider font-bold block mb-1">
                            Entregador Responsável:
                          </span>
                          {isAssigned ? (
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <div className="w-6 h-6 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center font-bold">
                                  <Bike className="w-3.5 h-3.5" />
                                </div>
                                <div>
                                  <p className="font-bold text-white text-xs leading-none">
                                    {order.deliveryPerson?.name || order.deliveryPersonName}
                                  </p>
                                  {order.deliveryPerson?.phone && (
                                    <p className="text-[10px] text-slate-400 font-mono mt-0.5">{order.deliveryPerson.phone}</p>
                                  )}
                                </div>
                              </div>
                              <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[10px] font-bold">
                                Atribuído
                              </span>
                            </div>
                          ) : (
                            <div className="flex items-center justify-between gap-2 text-amber-300">
                              <span className="text-xs font-semibold flex items-center gap-1">
                                <AlertTriangle className="w-3.5 h-3.5" /> Aguardando Atribuição
                              </span>
                              <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 text-[10px] font-bold">
                                Sem Motoboy
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Occurrences & Assignment History */}
                        {(order.deliveryAssignmentHistory?.length || 0) > 1 && (
                          <div className="mb-2 text-[10px] text-amber-300/90 bg-amber-500/10 px-2 py-1 rounded-lg border border-amber-500/20">
                            Reatribuído {(order.deliveryAssignmentHistory?.length || 1) - 1}x pela supervisão
                          </div>
                        )}
                        {hasOccurrence && (
                          <div className="mb-2 text-[10px] text-rose-300 bg-rose-500/10 px-2 py-1 rounded-lg border border-rose-500/20 flex items-center gap-1">
                            <AlertCircle className="w-3 h-3 text-rose-400" /> Possui ocorrência registrada
                          </div>
                        )}
                      </div>

                      {/* Supervisor Actions */}
                      <div className="pt-2 border-t border-slate-800 flex items-center justify-between gap-2 flex-wrap">
                        {permissions.canAssignDeliveries && (
                          <button
                            onClick={() => {
                              setAssignModalOrder(order);
                              setSelectedNewDriverId(order.deliveryPersonId || order.deliveryPerson?.id || '');
                              setReassignReason('');
                            }}
                            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                              isAssigned
                                ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
                                : 'bg-amber-500 hover:bg-amber-400 text-slate-950 font-black'
                            }`}
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            <span>{isAssigned ? 'Reatribuir' : 'Atribuir Entregador'}</span>
                          </button>
                        )}

                        <button
                          onClick={() => {
                            setOccurrenceModalOrder(order);
                            setOccurrenceNote('');
                          }}
                          className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold transition border border-slate-700 cursor-pointer"
                          title="Registrar Ocorrência / Nota"
                        >
                          <FileText className="w-3.5 h-3.5 text-amber-400" />
                        </button>

                        {order.customer.phone && (
                          <a
                            href={`https://wa.me/55${order.customer.phone.replace(/\D/g, '')}`}
                            target="_blank"
                            rel="noreferrer"
                            className="p-1.5 bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-300 border border-emerald-500/40 rounded-xl text-xs transition"
                            title="WhatsApp do Cliente"
                          >
                            <MessageSquare className="w-3.5 h-3.5" />
                          </a>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ============================================================== */}
        {/* TAB 2: EQUIPE DE ENTREGADORES */}
        {/* ============================================================== */}
        {activeTab === 'entregadores' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-white">Lista de Entregadores Cadastrados</h2>
                <p className="text-xs text-slate-400">
                  Consulte a situação em tempo real, pedidos em andamento e histórico de cada motoboy.
                </p>
              </div>
              <span className="text-xs font-mono text-amber-400 bg-slate-900 px-3 py-1.5 rounded-xl border border-slate-800">
                {activeDrivers.length} ativos / {drivers.length} total
              </span>
            </div>

            {drivers.length === 0 ? (
              <div className="bg-slate-900/60 border border-slate-800 rounded-3xl p-12 text-center text-slate-400">
                <Users className="w-12 h-12 mx-auto mb-3 text-slate-600" />
                <p className="text-base font-bold text-white">Nenhum entregador cadastrado no sistema.</p>
                <p className="text-xs text-slate-500 mt-1">
                  Cadastre entregadores no módulo administrativo de Equipe & Permissões com perfil ENTREGADOR.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
                {drivers.map((driver) => {
                  const metrics = getDriverMetrics(driver);
                  const isInactive = driver.status === 'DESATIVADO' || driver.status === 'BLOQUEADO';
                  const isBusy = metrics.isBusy;

                  return (
                    <div
                      key={driver.id}
                      className={`bg-slate-900/90 rounded-2xl border p-4 shadow-sm flex flex-col justify-between transition hover:border-slate-700 ${
                        isInactive
                          ? 'border-slate-800 opacity-60'
                          : isBusy
                          ? 'border-indigo-500/40 bg-indigo-950/10'
                          : 'border-emerald-500/30'
                      }`}
                    >
                      <div>
                        {/* Driver Header */}
                        <div className="flex items-start justify-between gap-2 mb-3">
                          <div className="flex items-center gap-2.5">
                            <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold ${
                              isInactive
                                ? 'bg-slate-800 text-slate-500'
                                : isBusy
                                ? 'bg-indigo-500/20 text-indigo-400'
                                : 'bg-emerald-500/20 text-emerald-400'
                            }`}>
                              <Bike className="w-5 h-5" />
                            </div>
                            <div>
                              <h3 className="font-bold text-white text-sm leading-tight">
                                {driver.name || driver.username}
                              </h3>
                              <p className="text-[11px] text-slate-400 font-mono">
                                @{driver.username} {driver.phone ? `· ${driver.phone}` : ''}
                              </p>
                            </div>
                          </div>

                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            isInactive
                              ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                              : isBusy
                              ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                              : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                          }`}>
                            {isInactive ? 'Inativo' : isBusy ? 'Em Rota' : 'Disponível'}
                          </span>
                        </div>

                        {/* Driver KPI Grid */}
                        <div className="grid grid-cols-4 gap-1.5 p-2.5 bg-slate-950/70 rounded-xl border border-slate-800/80 mb-3 text-center">
                          <div>
                            <span className="text-[10px] text-slate-400 block">Hoje</span>
                            <span className="text-xs font-black text-white">{metrics.assignedTodayCount}</span>
                          </div>
                          <div>
                            <span className="text-[10px] text-emerald-400 block">Feitas</span>
                            <span className="text-xs font-black text-emerald-400">{metrics.completedCount}</span>
                          </div>
                          <div>
                            <span className="text-[10px] text-indigo-400 block">Em Rota</span>
                            <span className="text-xs font-black text-indigo-400">{metrics.inTransitCount}</span>
                          </div>
                          <div>
                            <span className="text-[10px] text-amber-400 block">Pendente</span>
                            <span className="text-xs font-black text-amber-400">{metrics.pendingCount}</span>
                          </div>
                        </div>

                        {/* Contact Shortcuts */}
                        <div className="flex items-center gap-2 mb-3 text-xs">
                          {driver.phone && (
                            <>
                              <a
                                href={`tel:${driver.phone.replace(/\D/g, '')}`}
                                className="flex-1 py-1.5 px-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl font-semibold flex items-center justify-center gap-1.5 border border-slate-700 transition"
                              >
                                <Phone className="w-3.5 h-3.5 text-emerald-400" />
                                <span>Ligar</span>
                              </a>
                              <a
                                href={`https://wa.me/55${driver.phone.replace(/\D/g, '')}`}
                                target="_blank"
                                rel="noreferrer"
                                className="flex-1 py-1.5 px-2 bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-200 rounded-xl font-semibold flex items-center justify-center gap-1.5 border border-emerald-500/40 transition"
                              >
                                <MessageSquare className="w-3.5 h-3.5" />
                                <span>WhatsApp</span>
                              </a>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Consult details button */}
                      <button
                        onClick={() => setSelectedDriver(driver)}
                        className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-amber-400 font-bold rounded-xl text-xs transition border border-slate-700 flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <span>Ver Entregas deste Entregador</span>
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ============================================================== */}
        {/* TAB 3: MOVIMENTO DIÁRIO & FECHAMENTO */}
        {/* ============================================================== */}
        {activeTab === 'fechamento' && (
          <div className="space-y-5">
            {/* Current Daily Shift Status Box */}
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-xl">
              <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-black text-white">Movimento Diário de Entregas</h2>
                    {currentShift && currentShift.status === 'ABERTO' ? (
                      <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-xs font-bold border border-emerald-500/40">
                        ABERTO HOJE
                      </span>
                    ) : (
                      <span className="px-2.5 py-0.5 rounded-full bg-rose-500/20 text-rose-300 text-xs font-bold border border-rose-500/40">
                        FECHADO
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400 mt-1">
                    Controle de turnos diários de entregas, fechamento de caixa de motoboys e prestação de contas.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  {currentShift && currentShift.status === 'ABERTO' ? (
                    permissions.canCloseDailyShift && (
                      <button
                        onClick={() => setIsCloseShiftModalOpen(true)}
                        className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-xl text-xs transition shadow cursor-pointer flex items-center gap-1.5"
                      >
                        <Lock className="w-4 h-4" />
                        <span>Fechar Movimento Diário</span>
                      </button>
                    )
                  ) : (
                    <div className="flex items-center gap-2">
                      {permissions.canOpenDailyShift && (
                        <button
                          onClick={() => setIsOpenShiftModalOpen(true)}
                          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs transition shadow cursor-pointer flex items-center gap-1.5"
                        >
                          <Unlock className="w-4 h-4" />
                          <span>Abrir Novo Movimento</span>
                        </button>
                      )}
                      {permissions.canReopenDailyShift && currentShift && (
                        <button
                          onClick={handleReopenShift}
                          className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-amber-400 font-bold rounded-xl text-xs transition border border-slate-700 cursor-pointer flex items-center gap-1.5"
                          title="Reabrir Movimento Anterior"
                        >
                          <RotateCcw className="w-4 h-4" />
                          <span>Reabrir</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Shift Details Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 p-4 bg-slate-950/70 rounded-2xl border border-slate-800/80 text-xs">
                <div>
                  <span className="text-slate-400 block text-[11px]">Data de Referência:</span>
                  <span className="font-bold text-white font-mono text-sm">{currentShift?.date || todayStr}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[11px]">Aberto por:</span>
                  <span className="font-bold text-white">
                    {currentShift?.openedBy?.userName || 'Administrador'} ({currentShift?.openedBy?.userRole || 'ADMIN'})
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[11px]">Horário de Abertura:</span>
                  <span className="font-bold text-white font-mono">
                    {currentShift?.openedAt ? formatDateTime(currentShift.openedAt) : '--'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[11px]">Entregas Concluídas Hoje:</span>
                  <span className="font-bold text-emerald-400 font-mono text-sm">
                    {completedToday.length} de {todayDeliveryOrders.length} pedidos
                  </span>
                </div>
              </div>

              {/* Strict Notice regarding closed shift and pending orders */}
              <div className="mt-4 p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-xs text-amber-200/90 flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div className="leading-relaxed">
                  <span className="font-bold text-amber-300">Regra de Fechamento de Entregas:</span>
                  <span className="ml-1">
                    O encerramento do movimento diário não apaga pedidos, não altera datas originais e não marca entregas pendentes como concluídas.
                    Qualquer entrega não concluída permanecerá no sistema como pendência de dia anterior para apuração e continuidade.
                  </span>
                </div>
              </div>
            </div>

            {/* Closed Shifts History Section */}
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-xl">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <History className="w-4 h-4 text-amber-400" />
                  <span>Histórico de Fechamentos Anteriores</span>
                </h3>
                <span className="text-xs text-slate-400">{shiftHistory.length} fechamentos registrados</span>
              </div>

              {shiftHistory.length === 0 ? (
                <p className="text-xs text-slate-500 italic text-center py-6">
                  Nenhum fechamento registrado no histórico até o momento.
                </p>
              ) : (
                <div className="space-y-2.5">
                  {shiftHistory.map((shift) => (
                    <div
                      key={shift.id}
                      className="p-3.5 bg-slate-950/70 border border-slate-800 rounded-xl flex items-center justify-between gap-3 text-xs flex-wrap"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-black text-white font-mono text-sm">
                            Turno {shift.date}
                          </span>
                          <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px] font-bold">
                            FECHADO
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          Fechado por {shift.closedBy?.userName || 'Supervisão'} em {shift.closedAt ? formatDateTime(shift.closedAt) : '--'}
                        </p>
                        {shift.notes && (
                          <p className="text-[11px] text-amber-300/80 mt-1 italic">Obs: {shift.notes}</p>
                        )}
                      </div>

                      {shift.summary && (
                        <div className="flex items-center gap-4 text-right">
                          <div>
                            <span className="text-[10px] text-slate-400 block">Concluídas</span>
                            <span className="font-bold text-emerald-400 font-mono">
                              {shift.summary.completedDeliveries} / {shift.summary.totalDeliveries}
                            </span>
                          </div>
                          <div>
                            <span className="text-[10px] text-slate-400 block">Total Entregue</span>
                            <span className="font-bold text-white font-mono">
                              {formatCurrency(shift.summary.totalAmount)}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* ============================================================== */}
      {/* MODAL: ASSIGN / REASSIGN DELIVERY PERSON */}
      {/* ============================================================== */}
      {assignModalOrder && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-6 max-w-lg w-full shadow-2xl relative">
            <button
              onClick={() => {
                setAssignModalOrder(null);
                setSelectedNewDriverId('');
                setReassignReason('');
              }}
              className="absolute right-4 top-4 text-slate-400 hover:text-white p-1"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2.5 mb-4">
              <div className="w-9 h-9 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center font-bold">
                <Bike className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">
                  {assignModalOrder.deliveryPerson ? 'Reatribuir Entrega' : 'Atribuir Entregador'}
                </h3>
                <p className="text-xs text-slate-400 font-mono">
                  Pedido {assignModalOrder.orderNumber} · {assignModalOrder.customer.name}
                </p>
              </div>
            </div>

            <form onSubmit={handleConfirmAssignment} className="space-y-4">
              {/* Current Driver status */}
              <div className="p-3 bg-slate-950/70 border border-slate-800 rounded-xl text-xs space-y-1">
                <span className="text-[10px] text-slate-400 uppercase tracking-wider font-bold block">
                  Responsável Atual:
                </span>
                <p className="font-bold text-white">
                  {assignModalOrder.deliveryPerson?.name || assignModalOrder.deliveryPersonName || 'Nenhum entregador atribuído (Aguardando Atribuição)'}
                </p>
              </div>

              {/* Select New Driver */}
              <div>
                <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1.5">
                  Selecione o Novo Entregador Responsável:
                </label>
                <select
                  value={selectedNewDriverId}
                  onChange={(e) => setSelectedNewDriverId(e.target.value)}
                  className="w-full px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:ring-1 focus:ring-amber-500"
                  required
                >
                  <option value="">-- Escolha um entregador ativo --</option>
                  {activeDrivers.map((driver) => {
                    const metrics = getDriverMetrics(driver);
                    return (
                      <option key={driver.id} value={driver.id}>
                        {driver.name || driver.username} {metrics.isBusy ? '(Em Rota)' : '(Disponível)'}
                      </option>
                    );
                  })}
                  <option value="__UNASSIGN__">-- Remover atribuição (Deixar Aguardando Atribuição) --</option>
                </select>
              </div>

              {/* Reassignment Reason */}
              <div>
                <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1.5">
                  Motivo da Atribuição / Reatribuição (Opcional):
                </label>
                <input
                  type="text"
                  value={reassignReason}
                  onChange={(e) => setReassignReason(e.target.value)}
                  placeholder="Ex: Redistribuição de rota, moto furou pneu, etc."
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                />
              </div>

              {/* Assignment Audit History */}
              {(assignModalOrder.deliveryAssignmentHistory?.length || 0) > 0 && (
                <div className="pt-2 border-t border-slate-800">
                  <span className="text-[10px] text-slate-400 uppercase tracking-wider font-bold block mb-1.5">
                    Histórico de Alterações de Responsável:
                  </span>
                  <div className="space-y-1.5 max-h-28 overflow-y-auto pr-1">
                    {assignModalOrder.deliveryAssignmentHistory?.map((h, i) => (
                      <div key={i} className="text-[11px] p-2 bg-slate-950/80 rounded-lg border border-slate-800/80">
                        <div className="flex items-center justify-between text-slate-400">
                          <span>Por: <strong className="text-white">{h.assignedBy}</strong></span>
                          <span className="font-mono">{formatDateTime(h.assignedAt)}</span>
                        </div>
                        <p className="text-amber-300 mt-0.5">
                          {h.previousDriverName ? `De: ${h.previousDriverName}` : 'Inicial'} → {h.newDriverName || 'Desvinculado'}
                          {h.reason ? ` (${h.reason})` : ''}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Buttons */}
              <div className="pt-3 border-t border-slate-800 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setAssignModalOrder(null);
                    setSelectedNewDriverId('');
                    setReassignReason('');
                  }}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-xl text-xs font-black transition cursor-pointer shadow"
                >
                  Salvar Atribuição
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL: ADD ORDER OCCURRENCE */}
      {/* ============================================================== */}
      {occurrenceModalOrder && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-6 max-w-md w-full shadow-2xl relative">
            <button
              onClick={() => { setOccurrenceModalOrder(null); setOccurrenceNote(''); }}
              className="absolute right-4 top-4 text-slate-400 hover:text-white p-1"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2 mb-3">
              <AlertCircle className="w-5 h-5 text-amber-400" />
              <h3 className="text-base font-bold text-white">
                Registrar Ocorrência no Pedido {occurrenceModalOrder.orderNumber}
              </h3>
            </div>

            <form onSubmit={handleSaveOccurrence} className="space-y-3.5">
              <p className="text-xs text-slate-400">
                Adicione notas sobre intercorrências na rota (ex: cliente não atende, portaria bloqueada, etc.).
              </p>

              <div>
                <textarea
                  value={occurrenceNote}
                  onChange={(e) => setOccurrenceNote(e.target.value)}
                  placeholder="Descreva a ocorrência..."
                  rows={3}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                  required
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => { setOccurrenceModalOrder(null); setOccurrenceNote(''); }}
                  className="px-4 py-2 bg-slate-800 text-slate-300 rounded-xl text-xs font-bold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-amber-500 text-slate-950 rounded-xl text-xs font-black shadow"
                >
                  Registrar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL: CLOSE SHIFT */}
      {/* ============================================================== */}
      {isCloseShiftModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-6 max-w-lg w-full shadow-2xl relative">
            <button
              onClick={() => setIsCloseShiftModalOpen(false)}
              className="absolute right-4 top-4 text-slate-400 hover:text-white p-1"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2.5 mb-4">
              <div className="w-9 h-9 rounded-xl bg-rose-500/20 text-rose-400 flex items-center justify-center font-bold">
                <Lock className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Fechamento do Movimento Diário</h3>
                <p className="text-xs text-slate-400">Data: {currentShift?.date || todayStr}</p>
              </div>
            </div>

            <form onSubmit={handleCloseShift} className="space-y-4">
              {/* Summary of current shift */}
              <div className="p-3.5 bg-slate-950/70 rounded-2xl border border-slate-800 text-xs space-y-2">
                <div className="flex justify-between">
                  <span className="text-slate-400">Total de Entregas Hoje:</span>
                  <span className="font-bold text-white font-mono">{todayDeliveryOrders.length}</span>
                </div>
                <div className="flex justify-between text-emerald-400">
                  <span>Entregas Concluídas:</span>
                  <span className="font-bold font-mono">{completedToday.length}</span>
                </div>
                <div className="flex justify-between text-amber-400">
                  <span>Entregas Ainda Pendentes:</span>
                  <span className="font-bold font-mono">{pendingToday.length}</span>
                </div>
                <div className="flex justify-between pt-2 border-t border-slate-800 text-sm">
                  <span className="font-bold text-white">Total Faturado em Entregas:</span>
                  <span className="font-black text-amber-400 font-mono">
                    {formatCurrency(completedToday.reduce((sum, o) => sum + (o.totalAmount || 0), 0))}
                  </span>
                </div>
              </div>

              {/* Explicit Safety Notice */}
              <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-xs text-amber-200/90 leading-relaxed">
                <strong>Importante:</strong> O fechamento do movimento registra o relatório consolidado deste turno.
                Pedidos pendentes <strong>não serão apagados nem alterados</strong> e continuarão disponíveis como pendências para o próximo turno.
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1.5">
                  Observações do Fechamento (Opcional):
                </label>
                <textarea
                  value={closeShiftNotes}
                  onChange={(e) => setCloseShiftNotes(e.target.value)}
                  placeholder="Ex: Prestação de contas realizada com todos os motoboys..."
                  rows={2}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                />
              </div>

              <div className="pt-3 border-t border-slate-800 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsCloseShiftModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 text-slate-300 rounded-xl text-xs font-bold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold shadow"
                >
                  Confirmar Fechamento
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL: OPEN SHIFT */}
      {/* ============================================================== */}
      {isOpenShiftModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-6 max-w-md w-full shadow-2xl relative">
            <button
              onClick={() => setIsOpenShiftModalOpen(false)}
              className="absolute right-4 top-4 text-slate-400 hover:text-white p-1"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2.5 mb-3">
              <Unlock className="w-5 h-5 text-emerald-400" />
              <h3 className="text-base font-bold text-white">Abrir Movimento Diário de Entregas</h3>
            </div>

            <form onSubmit={handleOpenShift} className="space-y-3.5">
              <p className="text-xs text-slate-400">
                Inicie um novo turno para controle de entregas do dia ({todayStr}).
              </p>

              <div>
                <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1.5">
                  Observações de Abertura (Opcional):
                </label>
                <input
                  type="text"
                  value={openShiftNotes}
                  onChange={(e) => setOpenShiftNotes(e.target.value)}
                  placeholder="Ex: Turno almoço e jantar..."
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsOpenShiftModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 text-slate-300 rounded-xl text-xs font-bold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold shadow"
                >
                  Abrir Movimento
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL: DRIVER DETAILS & LINKED ORDERS */}
      {/* ============================================================== */}
      {selectedDriver && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-6 max-w-2xl w-full shadow-2xl relative max-h-[90vh] flex flex-col">
            <button
              onClick={() => setSelectedDriver(null)}
              className="absolute right-4 top-4 text-slate-400 hover:text-white p-1"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center font-bold">
                <Bike className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">
                  {selectedDriver.name || selectedDriver.username}
                </h3>
                <p className="text-xs text-slate-400 font-mono">
                  @{selectedDriver.username} {selectedDriver.phone ? `· ${selectedDriver.phone}` : ''}
                </p>
              </div>
            </div>

            {/* Driver Linked Orders List */}
            <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
              <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                Entregas Vinculadas a Este Entregador:
              </h4>

              {(() => {
                const driverMetrics = getDriverMetrics(selectedDriver);
                const linkedOrders = driverMetrics.recentHistory;

                if (linkedOrders.length === 0) {
                  return (
                    <p className="text-xs text-slate-500 italic text-center py-8">
                      Nenhuma entrega vinculada a este entregador até o momento.
                    </p>
                  );
                }

                return linkedOrders.map((ord) => (
                  <div
                    key={ord.id}
                    className="p-3 bg-slate-950/80 border border-slate-800 rounded-xl flex items-center justify-between gap-3 text-xs"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white font-mono">{ord.orderNumber}</span>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          ord.status === 'ENTREGUE'
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : ord.status === 'EM_ROTA'
                            ? 'bg-indigo-500/20 text-indigo-300'
                            : 'bg-amber-500/20 text-amber-300'
                        }`}>
                          {ord.status}
                        </span>
                      </div>
                      <p className="text-slate-300 mt-0.5">{ord.customer.name}</p>
                      <p className="text-[10px] text-slate-400 font-mono">
                        {formatDateTime(ord.createdAt)} · {formatCurrency(ord.totalAmount)}
                      </p>
                    </div>

                    <button
                      onClick={() => {
                        setSelectedDriver(null);
                        setAssignModalOrder(ord);
                        setSelectedNewDriverId(ord.deliveryPersonId || '');
                      }}
                      className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-amber-400 rounded-lg text-xs font-semibold border border-slate-700 cursor-pointer"
                    >
                      Reatribuir
                    </button>
                  </div>
                ));
              })()}
            </div>

            <div className="pt-4 border-t border-slate-800 flex justify-end">
              <button
                onClick={() => setSelectedDriver(null)}
                className="px-4 py-2 bg-slate-800 text-slate-300 rounded-xl text-xs font-bold"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL: SHIFT HISTORY */}
      {/* ============================================================== */}
      {isShiftHistoryModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-6 max-w-xl w-full shadow-2xl relative max-h-[85vh] flex flex-col">
            <button
              onClick={() => setIsShiftHistoryModalOpen(false)}
              className="absolute right-4 top-4 text-slate-400 hover:text-white p-1"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2 mb-4">
              <History className="w-5 h-5 text-amber-400" />
              <h3 className="text-base font-bold text-white">Histórico dos Fechamentos de Entregas</h3>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
              {shiftHistory.length === 0 ? (
                <p className="text-xs text-slate-500 italic text-center py-8">
                  Nenhum fechamento registrado no histórico.
                </p>
              ) : (
                shiftHistory.map((shift) => (
                  <div key={shift.id} className="p-3 bg-slate-950/80 border border-slate-800 rounded-xl text-xs space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-white font-mono text-sm">Turno {shift.date}</span>
                      <span className="text-slate-400 font-mono text-[11px]">
                        {shift.closedAt ? formatDateTime(shift.closedAt) : '--'}
                      </span>
                    </div>
                    <p className="text-slate-400">
                      Fechado por: <strong className="text-white">{shift.closedBy?.userName || 'Supervisão'}</strong>
                    </p>
                    {shift.summary && (
                      <p className="text-emerald-400 font-mono">
                        Concluídas: {shift.summary.completedDeliveries} / {shift.summary.totalDeliveries} pedidos (Faturamento: {formatCurrency(shift.summary.totalAmount)})
                      </p>
                    )}
                    {shift.notes && <p className="text-slate-500 italic mt-0.5">Obs: {shift.notes}</p>}
                  </div>
                ))
              )}
            </div>

            <div className="pt-3 border-t border-slate-800 flex justify-end">
              <button
                onClick={() => setIsShiftHistoryModalOpen(false)}
                className="px-4 py-2 bg-slate-800 text-slate-300 rounded-xl text-xs font-bold"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
