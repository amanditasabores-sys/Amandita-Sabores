import React, { useState, useEffect } from 'react';
import { store } from '../../services/store';
import { Order, User, DeliveryShift, DeliveryShiftSummary } from '../../types';
import { formatCurrency, formatTime, formatDateTime, formatAddressDetails, getFortalezaDateKey, formatFortalezaDateLabel } from '../../utils/formatters';
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

export function doesDeliveryBelongToDriver(ord: Order, driver: User): boolean {
  const driverId = driver.id;
  if (
    ord.deliveryPersonId &&
    (ord.deliveryPersonId === driverId || ord.deliveryPersonId === `driver-${driverId}`)
  ) {
    return true;
  }
  if (
    ord.deliveryPerson?.id &&
    (ord.deliveryPerson.id === driverId || ord.deliveryPerson.id === `driver-${driverId}`)
  ) {
    return true;
  }
  const cleanDriverName = (driver.name || driver.username || '')
    .toLowerCase()
    .replace(/entregador\s*/g, '')
    .trim();
  const orderDriverName = (ord.deliveryPerson?.name || ord.deliveryPersonName || '')
    .toLowerCase()
    .replace(/entregador\s*/g, '')
    .trim();
  return Boolean(
    orderDriverName &&
      cleanDriverName &&
      (orderDriverName === cleanDriverName ||
        orderDriverName.includes(cleanDriverName) ||
        cleanDriverName.includes(orderDriverName))
  );
}

export function getDriverDeliveriesForDate(
  deliveryOrders: Order[],
  driver: User,
  dateKey: string
): Order[] {
  const targetDateKey = dateKey || getFortalezaDateKey();
  return deliveryOrders
    .filter((ord) => {
      if (!doesDeliveryBelongToDriver(ord, driver)) return false;
      return getFortalezaDateKey(ord.createdAt) === targetDateKey;
    })
    .sort((a, b) => {
      const timeA = Date.parse(a.createdAt);
      const timeB = Date.parse(b.createdAt);
      const safeA = Number.isFinite(timeA) ? timeA : 0;
      const safeB = Number.isFinite(timeB) ? timeB : 0;
      return safeB - safeA;
    });
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
  const [driverHistoryDate, setDriverHistoryDate] = useState<string>(() => getFortalezaDateKey());

  // Modals
  const [assignModalOrder, setAssignModalOrder] = useState<Order | null>(() => {
    if (initialOrderId) {
      return store.getOrderById(initialOrderId) || null;
    }
    return null;
  });
  const [selectedNewDriverId, setSelectedNewDriverId] = useState<string>('');
  const [reassignReason, setReassignReason] = useState<string>('');
  const [isAssigning, setIsAssigning] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);

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

  // Today reference date in America/Fortaleza (UTC-3)
  const todayStr = getFortalezaDateKey();

  // Filter deliveries (DELIVERY fulfillment only)
  const deliveryOrders = orders.filter((o) => o.fulfillmentType === 'DELIVERY');

  // Today's deliveries
  const todayDeliveryOrders = deliveryOrders.filter((o) => {
    const orderDate = getFortalezaDateKey(o.createdAt);
    return orderDate === todayStr;
  });

  // Prior pending deliveries (created before today and not finalized)
  const priorPendingDeliveries = deliveryOrders.filter((o) => {
    const orderDate = getFortalezaDateKey(o.createdAt);
    return Boolean(orderDate) && orderDate < todayStr && o.status !== 'ENTREGUE' && o.status !== 'CANCELADO';
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
    const isMatch = (ord: Order) => doesDeliveryBelongToDriver(ord, driver);

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
      const orderDate = getFortalezaDateKey(o.createdAt);
      if (!(Boolean(orderDate) && orderDate < todayStr && o.status !== 'ENTREGUE' && o.status !== 'CANCELADO')) return false;
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
  const handleConfirmAssignment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assignModalOrder || isAssigning) return;

    const targetDriver = activeDrivers.find((d) => d.id === selectedNewDriverId);
    if (!targetDriver && selectedNewDriverId !== '__UNASSIGN__') {
      setAssignError('Por favor, selecione um entregador ativo.');
      return;
    }

    setIsAssigning(true);
    setAssignError(null);
    try {
      const supervisorName = supervisorUser?.name || supervisorUser?.username || 'Supervisão';
      const res = selectedNewDriverId === '__UNASSIGN__'
        ? await store.assignDeliveryPersonAsync(
            assignModalOrder.id,
            null,
            supervisorName,
            reassignReason || 'Desvinculado pela supervisão'
          )
        : await store.assignDeliveryPersonAsync(
            assignModalOrder.id,
            {
              id: targetDriver!.id,
              name: targetDriver!.name || targetDriver!.username,
              phone: targetDriver!.phone || ''
            },
            supervisorName,
            reassignReason || undefined
          );

      if (!res.synced && res.rejected) {
        setAssignError(res.error || 'Atribuição recusada pelo servidor. Verifique suas permissões.');
        loadData();
        return;
      }

      setAssignModalOrder(null);
      setSelectedNewDriverId('');
      setReassignReason('');
      setAssignError(null);
      loadData();
    } finally {
      setIsAssigning(false);
    }
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
    <div className="min-h-screen bg-[#F8FAFC] text-[#0F2342] pb-16 font-sans">
      {/* TOP COMPACT HEADER */}
      <header className="bg-[#0F2342] text-white border-b border-[#1B365D] sticky top-0 z-30 shadow-xs">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 py-2.5 sm:py-3 flex items-center justify-between gap-3 flex-wrap">
          {/* Logo & Supervisor Identity */}
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <AmanditaLogo variant="icon" size="sm" theme="dark" />
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-sm sm:text-base font-extrabold tracking-tight text-white truncate">
                  Supervisão de Entregas
                </h1>
                {currentShift && currentShift.status === 'ABERTO' ? (
                  <span className="text-[11px] font-mono font-bold text-emerald-300 whitespace-nowrap">
                    · Movimento aberto
                  </span>
                ) : (
                  <span className="text-[11px] font-mono font-bold text-rose-300 whitespace-nowrap">
                    · Movimento fechado
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-300 truncate">
                Supervisor: <span className="text-white font-semibold">{supervisorUser?.name || supervisorUser?.username || 'Administrador'}</span>
                <span className="text-slate-400 ml-1">({supervisorUser?.role || 'ADMINISTRADOR'})</span>
              </p>
            </div>
          </div>

          {/* Top Actions */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 flex-wrap">
            {/* Shift History Modal button */}
            {permissions.canViewShiftHistory && (
              <button
                type="button"
                onClick={() => setIsShiftHistoryModalOpen(true)}
                className="min-h-[38px] flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 bg-[#1B365D] hover:bg-[#24467A] text-white rounded-xl text-xs font-semibold transition border border-white/15 whitespace-nowrap cursor-pointer"
                title="Histórico dos Fechamentos Anteriores"
              >
                <History className="w-3.5 h-3.5 text-[#FB923C] shrink-0" />
                <span className="hidden md:inline">Histórico</span>
              </button>
            )}

            {/* Shift Open / Close button */}
            {currentShift && currentShift.status === 'ABERTO' ? (
              permissions.canCloseDailyShift && (
                <button
                  type="button"
                  onClick={() => setIsCloseShiftModalOpen(true)}
                  className="min-h-[38px] flex items-center gap-1.5 px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold transition whitespace-nowrap cursor-pointer"
                  title="Encerrar Movimento Diário de Entregas"
                >
                  <Lock className="w-3.5 h-3.5 shrink-0" />
                  <span>Fechar Movimento</span>
                </button>
              )
            ) : (
              permissions.canOpenDailyShift && (
                <button
                  type="button"
                  onClick={() => setIsOpenShiftModalOpen(true)}
                  className="min-h-[38px] flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition whitespace-nowrap cursor-pointer"
                  title="Abrir Novo Movimento Diário de Entregas"
                >
                  <Unlock className="w-3.5 h-3.5 shrink-0" />
                  <span>Abrir Movimento</span>
                </button>
              )
            )}

            {/* Back to Admin (Exclusive to Administrator or Gerente) */}
            {onBackToAdmin && (
              <button
                type="button"
                onClick={onBackToAdmin}
                className="min-h-[38px] flex items-center gap-1.5 px-3 py-1.5 bg-[#EA580C] hover:bg-[#C2410C] text-white rounded-xl text-xs font-bold transition shadow-xs whitespace-nowrap cursor-pointer"
                title="Retornar à Administração"
              >
                <ArrowLeft className="w-4 h-4 shrink-0" />
                <span className="hidden sm:inline">Voltar à Administração</span>
              </button>
            )}

            {/* Logout */}
            {onLogout && (
              <button
                type="button"
                onClick={onLogout}
                className="min-h-[38px] flex items-center gap-1.5 px-2.5 py-1.5 bg-white/10 hover:bg-rose-600 text-slate-200 hover:text-white rounded-xl text-xs font-semibold transition whitespace-nowrap cursor-pointer"
                title="Sair do Sistema"
                aria-label="Sair do Sistema"
              >
                <LogOut className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden sm:inline">Sair</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* SUPERVISOR BANNER NOTIFICATION */}
      <div className="max-w-7xl mx-auto px-3 sm:px-6 pt-3.5 space-y-2.5">
        <div className="p-3 bg-white border border-[#E2E8F0] rounded-2xl flex items-center justify-between gap-3 text-xs shadow-2xs flex-wrap">
          <div className="flex items-start sm:items-center gap-2.5 text-[#0F2342] min-w-0">
            <Shield className="w-4 h-4 text-[#1B365D] shrink-0 mt-0.5 sm:mt-0" />
            <div className="leading-relaxed">
              <span className="font-bold text-[#0F2342]">Modo de Supervisão Ativo:</span>
              <span className="text-slate-600 ml-1.5">
                Visão panorâmica de todos os entregadores e rotas. Administradores não recebem nem assumem entregas automaticamente.
              </span>
            </div>
          </div>
          {priorPendingDeliveries.length > 0 && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-amber-50 text-amber-800 border border-amber-200 text-xs font-bold shrink-0">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
              <span>{priorPendingDeliveries.length} pendências de dias anteriores</span>
            </div>
          )}
        </div>

        {/* DRIVER ASSIGNMENT SYSTEM STATUS BANNER */}
        {activeDrivers.length === 0 ? (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-2xl flex items-center justify-between gap-3 text-xs flex-wrap">
            <div className="flex items-start sm:items-center gap-2.5 text-rose-900">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5 sm:mt-0" />
              <div>
                <strong className="text-rose-900">Nenhum entregador ativo disponível no momento.</strong>
                <span className="text-rose-800 ml-1.5">
                  Os pedidos permanecerão aguardando atribuição até que um entregador seja ativado ou atribuído manualmente.
                </span>
              </div>
            </div>
            <span className="text-xs font-mono font-bold text-rose-700 whitespace-nowrap">
              0 ativos
            </span>
          </div>
        ) : activeDrivers.length === 1 ? (
          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-center justify-between gap-3 text-xs flex-wrap">
            <div className="flex items-start sm:items-center gap-2.5 text-emerald-900">
              <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5 sm:mt-0" />
              <div>
                <strong className="text-emerald-900">Atribuição Automática Ativa:</strong>
                <span className="text-emerald-800 ml-1.5">
                  Existe apenas 1 entregador ativo ({activeDrivers[0].name || activeDrivers[0].username}). Os novos pedidos delivery são atribuídos automaticamente a ele.
                </span>
              </div>
            </div>
            <span className="text-xs font-semibold text-emerald-700 whitespace-nowrap">
              Auto-atribuição ativa
            </span>
          </div>
        ) : (
          <div className="p-3 bg-white border border-[#E2E8F0] rounded-2xl flex items-center justify-between gap-3 text-xs flex-wrap">
            <div className="flex items-start sm:items-center gap-2.5 text-[#0F2342]">
              <Users className="w-4 h-4 text-[#1B365D] shrink-0 mt-0.5 sm:mt-0" />
              <div>
                <strong className="text-[#0F2342]">Atribuição Manual Disponível:</strong>
                <span className="text-slate-600 ml-1.5">
                  Existem {activeDrivers.length} entregadores ativos cadastrados. A supervisão pode escolher qual entregador ficará responsável por cada entrega.
                </span>
              </div>
            </div>
            <span className="text-xs font-mono font-bold text-[#1B365D] whitespace-nowrap">
              {activeDrivers.length} entregadores ativos
            </span>
          </div>
        )}
      </div>

      {/* KPI METRICS OVERVIEW */}
      <section aria-label="Métricas de Supervisão" className="max-w-7xl mx-auto px-3 sm:px-6 pt-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {/* 1. Total Entregadores */}
          <div className="bg-white border border-[#E2E8F0] p-3.5 rounded-2xl shadow-2xs">
            <div className="flex items-center justify-between text-slate-500 text-xs font-medium mb-1">
              <span>Entregadores</span>
              <Users className="w-4 h-4 text-[#1B365D]" />
            </div>
            <p className="text-xl font-extrabold text-[#0F2342] font-mono tabular-nums">{totalDriversCount}</p>
            <p className="text-[11px] text-slate-500 mt-0.5">
              <span className="text-emerald-700 font-semibold">{activeDrivers.length} ativos</span> · {inactiveDrivers.length} inativos
            </p>
          </div>

          {/* 2. Disponíveis vs Ocupados */}
          <div className="bg-white border border-[#E2E8F0] p-3.5 rounded-2xl shadow-2xs">
            <div className="flex items-center justify-between text-slate-500 text-xs font-medium mb-1">
              <span>Status Equipe</span>
              <Bike className="w-4 h-4 text-[#EA580C]" />
            </div>
            <p className="text-xl font-extrabold text-emerald-700 font-mono tabular-nums">
              {availableDrivers.length} <span className="text-xs font-sans font-medium text-slate-500">livres</span>
            </p>
            <p className="text-[11px] text-slate-500 mt-0.5">
              <span className="text-[#1B365D] font-semibold">{busyDrivers.length} em rota</span> · {availableDrivers.length} prontos
            </p>
          </div>

          {/* 3. Total Entregas Hoje */}
          <div className="bg-white border border-[#E2E8F0] p-3.5 rounded-2xl shadow-2xs">
            <div className="flex items-center justify-between text-slate-500 text-xs font-medium mb-1">
              <span>Entregas do Dia</span>
              <Calendar className="w-4 h-4 text-[#EA580C]" />
            </div>
            <p className="text-xl font-extrabold text-[#0F2342] font-mono tabular-nums">{todayDeliveryOrders.length}</p>
            <p className="text-[11px] text-slate-500 mt-0.5">
              <span className="text-emerald-700 font-semibold">{completedToday.length} entregues</span>
            </p>
          </div>

          {/* 4. Em Andamento */}
          <div className="bg-white border border-[#E2E8F0] p-3.5 rounded-2xl shadow-2xs">
            <div className="flex items-center justify-between text-slate-500 text-xs font-medium mb-1">
              <span>Em Rota Agora</span>
              <Clock className="w-4 h-4 text-[#1B365D]" />
            </div>
            <p className="text-xl font-extrabold text-[#1B365D] font-mono tabular-nums">{inTransitToday.length}</p>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {readyToday.length} prontas na cozinha
            </p>
          </div>

          {/* 5. Aguardando Atribuição */}
          <div className={`border p-3.5 rounded-2xl shadow-2xs ${
            unassignedDeliveries.length > 0
              ? 'bg-[#FFF7ED] border-[#FED7AA]'
              : 'bg-white border-[#E2E8F0]'
          }`}>
            <div className="flex items-center justify-between text-slate-600 text-xs font-medium mb-1">
              <span>Sem Motoboy</span>
              <AlertCircle className={`w-4 h-4 ${unassignedDeliveries.length > 0 ? 'text-[#EA580C]' : 'text-slate-400'}`} />
            </div>
            <p className={`text-xl font-extrabold font-mono tabular-nums ${unassignedDeliveries.length > 0 ? 'text-[#EA580C]' : 'text-[#0F2342]'}`}>
              {unassignedDeliveries.length}
            </p>
            <p className="text-[11px] text-slate-600 mt-0.5">
              {unassignedDeliveries.length > 0 ? 'Requer atribuição' : 'Todas atribuídas'}
            </p>
          </div>

          {/* 6. Atrasadas / Ocorrências */}
          <div className={`border p-3.5 rounded-2xl shadow-2xs ${
            lateOrOccurrenceDeliveries.length > 0
              ? 'bg-rose-50 border-rose-200'
              : 'bg-white border-[#E2E8F0]'
          }`}>
            <div className="flex items-center justify-between text-slate-600 text-xs font-medium mb-1">
              <span>Ocorrências</span>
              <AlertTriangle className={`w-4 h-4 ${lateOrOccurrenceDeliveries.length > 0 ? 'text-rose-600' : 'text-slate-400'}`} />
            </div>
            <p className={`text-xl font-extrabold font-mono tabular-nums ${lateOrOccurrenceDeliveries.length > 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
              {lateOrOccurrenceDeliveries.length}
            </p>
            <p className="text-[11px] text-slate-600 mt-0.5">
              {lateOrOccurrenceDeliveries.length > 0 ? 'Atrasadas ou com nota' : 'Fluxo pontual'}
            </p>
          </div>
        </div>
      </section>

      {/* TABS NAVIGATION */}
      <div className="max-w-7xl mx-auto px-3 sm:px-6 pt-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <nav aria-label="Navegação de Supervisão" className="flex items-center gap-1 p-1 bg-[#E2E8F0]/70 rounded-xl border border-[#E2E8F0] overflow-x-auto max-w-full">
            <button
              type="button"
              onClick={() => setActiveTab('entregas')}
              className={`min-h-[38px] px-3 sm:px-4 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                activeTab === 'entregas'
                  ? 'bg-[#0F2342] text-white shadow-2xs'
                  : 'text-[#475569] hover:text-[#0F2342]'
              }`}
            >
              <Bike className="w-4 h-4 shrink-0" />
              <span>Entregas</span>
              <span className="font-mono tabular-nums opacity-80">
                ({deliveryOrders.filter((o) => o.status !== 'ENTREGUE' && o.status !== 'CANCELADO').length})
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('entregadores')}
              className={`min-h-[38px] px-3 sm:px-4 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                activeTab === 'entregadores'
                  ? 'bg-[#0F2342] text-white shadow-2xs'
                  : 'text-[#475569] hover:text-[#0F2342]'
              }`}
            >
              <Users className="w-4 h-4 shrink-0" />
              <span>Entregadores</span>
              <span className="font-mono tabular-nums opacity-80">({drivers.length})</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('fechamento')}
              className={`min-h-[38px] px-3 sm:px-4 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                activeTab === 'fechamento'
                  ? 'bg-[#0F2342] text-white shadow-2xs'
                  : 'text-[#475569] hover:text-[#0F2342]'
              }`}
            >
              <Lock className="w-4 h-4 shrink-0" />
              <span>Movimento Diário</span>
            </button>
          </nav>

          {/* Quick Search */}
          <div className="relative w-full sm:w-72">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar pedido, cliente, entregador..."
              className="w-full min-h-[40px] pl-9 pr-8 py-2 bg-white border border-[#E2E8F0] rounded-xl text-xs sm:text-sm text-[#0F2342] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#EA580C]/20 focus:border-[#EA580C] transition"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-[#0F2342] p-1 cursor-pointer"
                aria-label="Limpar busca"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* MAIN CONTENT AREA */}
      <main className="max-w-7xl mx-auto px-3 sm:px-6 pt-4">
        {/* ============================================================== */}
        {/* TAB 1: GERENCIAMENTO DE ENTREGAS */}
        {/* ============================================================== */}
        {activeTab === 'entregas' && (
          <div className="space-y-4">
            {/* Delivery Sub-Filters */}
            <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none py-1">
              <button
                type="button"
                onClick={() => setDeliveryFilter('todas')}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition shrink-0 whitespace-nowrap cursor-pointer border ${
                  deliveryFilter === 'todas'
                    ? 'bg-[#0F2342] text-white border-[#0F2342]'
                    : 'bg-white text-slate-600 border-[#E2E8F0] hover:text-[#0F2342]'
                }`}
              >
                Todas ({deliveryOrders.length})
              </button>
              <button
                type="button"
                onClick={() => setDeliveryFilter('aguardando')}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition shrink-0 whitespace-nowrap cursor-pointer border ${
                  deliveryFilter === 'aguardando'
                    ? 'bg-[#EA580C] text-white border-[#EA580C]'
                    : 'bg-white text-[#C2410C] border-[#FED7AA] hover:bg-[#FFF7ED]'
                }`}
              >
                Aguardando Atribuição ({unassignedDeliveries.length})
              </button>
              <button
                type="button"
                onClick={() => setDeliveryFilter('prontas')}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition shrink-0 whitespace-nowrap cursor-pointer border ${
                  deliveryFilter === 'prontas'
                    ? 'bg-emerald-600 text-white border-emerald-600'
                    : 'bg-white text-emerald-700 border-emerald-200 hover:bg-emerald-50'
                }`}
              >
                Prontas para Entrega ({readyToday.length})
              </button>
              <button
                type="button"
                onClick={() => setDeliveryFilter('em_rota')}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition shrink-0 whitespace-nowrap cursor-pointer border ${
                  deliveryFilter === 'em_rota'
                    ? 'bg-[#1B365D] text-white border-[#1B365D]'
                    : 'bg-white text-[#1B365D] border-[#CBD5E1] hover:bg-slate-50'
                }`}
              >
                Em Rota ({inTransitToday.length})
              </button>
              <button
                type="button"
                onClick={() => setDeliveryFilter('concluidas')}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition shrink-0 whitespace-nowrap cursor-pointer border ${
                  deliveryFilter === 'concluidas'
                    ? 'bg-emerald-700 text-white border-emerald-700'
                    : 'bg-white text-slate-600 border-[#E2E8F0] hover:text-[#0F2342]'
                }`}
              >
                Concluídas ({completedToday.length})
              </button>
              {priorPendingDeliveries.length > 0 && (
                <button
                  type="button"
                  onClick={() => setDeliveryFilter('pendencias_anteriores')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition shrink-0 whitespace-nowrap cursor-pointer border ${
                    deliveryFilter === 'pendencias_anteriores'
                      ? 'bg-rose-600 text-white border-rose-600'
                      : 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100'
                  }`}
                >
                  Pendências Anteriores ({priorPendingDeliveries.length})
                </button>
              )}
            </div>

            {/* Orders Grid */}
            {filteredDeliveries.length === 0 ? (
              <div className="bg-white border border-[#E2E8F0] rounded-2xl p-10 text-center shadow-2xs">
                <Bike className="w-10 h-10 mx-auto mb-3 text-slate-400" />
                <p className="text-base font-bold text-[#0F2342]">Nenhuma entrega encontrada para este filtro.</p>
                <p className="text-xs text-slate-500 mt-1">Ajuste o filtro acima ou aguarde novos pedidos de delivery.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
                {filteredDeliveries.map((order) => {
                  const isAssigned = Boolean(order.deliveryPerson || order.deliveryPersonId);
                  const isLate = Math.floor((Date.now() - new Date(order.createdAt).getTime()) / 60000) > (order.estimatedDeliveryMinutes || 45);
                  const orderDateKey = getFortalezaDateKey(order.createdAt);
                  const isPriorDay = Boolean(orderDateKey) && orderDateKey < todayStr;
                  const hasOccurrence = order.movements.some((m) => m.notes?.includes('[OCORRÊNCIA]'));
                  const address = order.customer.address;
                  const addressText = address
                    ? formatAddressDetails(address).fullSingleLine
                    : 'Endereço não informado';

                  return (
                    <div
                      key={order.id}
                      className={`bg-white rounded-2xl border p-4 shadow-2xs flex flex-col justify-between transition ${
                        isPriorDay && order.status !== 'ENTREGUE'
                          ? 'border-rose-300'
                          : unassignedDeliveries.includes(order)
                          ? 'border-[#FDBA74]'
                          : 'border-[#E2E8F0]'
                      }`}
                    >
                      {/* Top Order Info */}
                      <div>
                        <div className="flex items-start justify-between gap-2 mb-2.5">
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-base font-extrabold text-[#0F2342] font-mono tabular-nums">
                                {order.orderNumber}
                              </span>
                              <span className={`text-xs font-bold ${
                                order.status === 'ENTREGUE'
                                  ? 'text-emerald-700'
                                  : order.status === 'EM_ROTA'
                                  ? 'text-[#1B365D]'
                                  : order.status === 'PRONTO'
                                  ? 'text-[#EA580C]'
                                  : 'text-slate-600'
                              }`}>
                                · {order.status === 'EM_ROTA'
                                  ? 'Em Rota'
                                  : order.status === 'ENTREGUE'
                                  ? 'Entregue'
                                  : order.status === 'PRONTO'
                                  ? 'Pronto'
                                  : order.status === 'EM_PREPARO'
                                  ? 'Em Preparo'
                                  : 'Novo'}
                              </span>
                            </div>
                            <span className="text-[11px] text-slate-500 font-mono tabular-nums mt-0.5 block">
                              Criado às {formatTime(order.createdAt)} ({formatDateTime(order.createdAt).split(' ')[0]})
                            </span>
                            {(isPriorDay || isLate) && order.status !== 'ENTREGUE' && (
                              <div className="flex items-center gap-2 flex-wrap mt-1 text-[11px] font-semibold text-rose-700">
                                {isPriorDay && <span>Dia anterior ({formatFortalezaDateLabel(order.createdAt)})</span>}
                                {isLate && (
                                  <span className="inline-flex items-center gap-1">
                                    <Clock className="w-3 h-3" /> Atrasado
                                  </span>
                                )}
                              </div>
                            )}
                          </div>

                          <span className="text-sm font-extrabold text-[#EA580C] font-mono tabular-nums shrink-0">
                            {formatCurrency(order.totalAmount)}
                          </span>
                        </div>

                        {/* Customer Info */}
                        <div className="bg-[#F8FAFC] rounded-xl p-3 border border-[#E2E8F0] mb-3 space-y-1 text-xs">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-bold text-[#0F2342] truncate">{order.customer.name}</span>
                            {order.customer.phone && (
                              <span className="text-slate-500 font-mono text-[11px] shrink-0">{order.customer.phone}</span>
                            )}
                          </div>
                          <p className="text-xs text-slate-600 flex items-start gap-1.5 leading-snug">
                            <MapPin className="w-3.5 h-3.5 text-[#EA580C] shrink-0 mt-0.5" />
                            <span className="line-clamp-2">{addressText}</span>
                          </p>
                        </div>

                        {/* Current Driver Assigned */}
                        <div className="bg-[#F8FAFC] rounded-xl p-3 border border-[#E2E8F0] mb-3 text-xs">
                          <span className="text-[11px] text-slate-500 font-semibold block mb-1.5">
                            Entregador Responsável
                          </span>
                          {isAssigned ? (
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2 min-w-0">
                                <div className="w-7 h-7 rounded-lg bg-[#FFF7ED] text-[#EA580C] border border-[#FED7AA] flex items-center justify-center shrink-0">
                                  <Bike className="w-3.5 h-3.5" />
                                </div>
                                <div className="min-w-0">
                                  <p className="font-bold text-[#0F2342] text-xs leading-tight truncate">
                                    {order.deliveryPerson?.name || order.deliveryPersonName}
                                  </p>
                                  {order.deliveryPerson?.phone && (
                                    <p className="text-[11px] text-slate-500 font-mono mt-0.5">{order.deliveryPerson.phone}</p>
                                  )}
                                </div>
                              </div>
                              <span className="text-[11px] font-bold text-emerald-700 shrink-0">
                                Atribuído
                              </span>
                            </div>
                          ) : (
                            <div className="flex items-center justify-between gap-2 text-[#C2410C]">
                              <span className="text-xs font-semibold flex items-center gap-1.5">
                                <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> Aguardando atribuição
                              </span>
                              <span className="text-[11px] font-bold shrink-0">Sem motoboy</span>
                            </div>
                          )}
                        </div>

                        {/* Occurrences & Assignment History */}
                        {(order.deliveryAssignmentHistory?.length || 0) > 1 && (
                          <div className="mb-2 text-[11px] text-amber-900 bg-amber-50 px-2.5 py-1.5 rounded-lg border border-amber-200">
                            Reatribuído {(order.deliveryAssignmentHistory?.length || 1) - 1}x pela supervisão
                          </div>
                        )}
                        {hasOccurrence && (
                          <div className="mb-2 text-[11px] text-rose-800 bg-rose-50 px-2.5 py-1.5 rounded-lg border border-rose-200 flex items-center gap-1.5">
                            <AlertCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" /> Possui ocorrência registrada
                          </div>
                        )}
                      </div>

                      {/* Supervisor Actions */}
                      <div className="pt-2.5 border-t border-[#E2E8F0] flex items-center justify-between gap-2 flex-wrap">
                        {permissions.canAssignDeliveries && (
                          <button
                            type="button"
                            onClick={() => {
                              setAssignModalOrder(order);
                              setSelectedNewDriverId(order.deliveryPersonId || order.deliveryPerson?.id || '');
                              setReassignReason('');
                            }}
                            className={`min-h-[38px] px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                              isAssigned
                                ? 'bg-[#F8FAFC] hover:bg-[#F1F5F9] text-[#0F2342] border border-[#E2E8F0]'
                                : 'bg-[#EA580C] hover:bg-[#C2410C] text-white shadow-2xs'
                            }`}
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            <span>{isAssigned ? 'Reatribuir' : 'Atribuir Entregador'}</span>
                          </button>
                        )}

                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setOccurrenceModalOrder(order);
                              setOccurrenceNote('');
                            }}
                            className="min-h-[38px] min-w-[38px] px-2.5 py-1.5 bg-[#F8FAFC] hover:bg-[#F1F5F9] text-[#0F2342] rounded-xl text-xs font-semibold transition border border-[#E2E8F0] cursor-pointer flex items-center justify-center"
                            title="Registrar Ocorrência / Nota"
                          >
                            <FileText className="w-4 h-4 text-[#1B365D]" />
                          </button>

                          {order.customer.phone && (
                            <a
                              href={`https://wa.me/55${order.customer.phone.replace(/\D/g, '')}`}
                              target="_blank"
                              rel="noreferrer"
                              className="min-h-[38px] min-w-[38px] p-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-xl text-xs transition flex items-center justify-center"
                              title="WhatsApp do Cliente"
                            >
                              <MessageSquare className="w-4 h-4" />
                            </a>
                          )}
                        </div>
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
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h2 className="text-base font-bold text-[#0F2342]">Lista de Entregadores Cadastrados</h2>
                <p className="text-xs text-slate-500">
                  Consulte a situação em tempo real, pedidos em andamento e histórico de cada motoboy.
                </p>
              </div>
              <span className="text-xs font-mono font-semibold text-[#1B365D] bg-white px-3 py-1.5 rounded-xl border border-[#E2E8F0]">
                {activeDrivers.length} ativos / {drivers.length} total
              </span>
            </div>

            {drivers.length === 0 ? (
              <div className="bg-white border border-[#E2E8F0] rounded-2xl p-10 text-center shadow-2xs">
                <Users className="w-10 h-10 mx-auto mb-3 text-slate-400" />
                <p className="text-base font-bold text-[#0F2342]">Nenhum entregador cadastrado no sistema.</p>
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
                      className={`bg-white rounded-2xl border p-4 shadow-2xs flex flex-col justify-between transition ${
                        isInactive
                          ? 'border-[#E2E8F0] opacity-65'
                          : isBusy
                          ? 'border-[#1B365D]/40'
                          : 'border-[#E2E8F0]'
                      }`}
                    >
                      <div>
                        {/* Driver Header */}
                        <div className="flex items-start justify-between gap-2 mb-3">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                              isInactive
                                ? 'bg-slate-100 text-slate-400'
                                : isBusy
                                ? 'bg-[#EFF6FF] text-[#1B365D]'
                                : 'bg-emerald-50 text-emerald-600'
                            }`}>
                              <Bike className="w-5 h-5" />
                            </div>
                            <div className="min-w-0">
                              <h3 className="font-bold text-[#0F2342] text-sm leading-tight truncate">
                                {driver.name || driver.username}
                              </h3>
                              <p className="text-[11px] text-slate-500 font-mono truncate">
                                @{driver.username} {driver.phone ? `· ${driver.phone}` : ''}
                              </p>
                            </div>
                          </div>

                          <span className={`text-xs font-bold shrink-0 ${
                            isInactive
                              ? 'text-rose-700'
                              : isBusy
                              ? 'text-[#1B365D]'
                              : 'text-emerald-700'
                          }`}>
                            {isInactive ? 'Inativo' : isBusy ? 'Em Rota' : 'Disponível'}
                          </span>
                        </div>

                        {/* Driver KPI Grid */}
                        <div className="grid grid-cols-4 gap-1.5 p-2.5 bg-[#F8FAFC] rounded-xl border border-[#E2E8F0] mb-3 text-center">
                          <div>
                            <span className="text-[10px] text-slate-500 block">Hoje</span>
                            <span className="text-xs font-extrabold text-[#0F2342] font-mono tabular-nums">{metrics.assignedTodayCount}</span>
                          </div>
                          <div>
                            <span className="text-[10px] text-emerald-700 block">Feitas</span>
                            <span className="text-xs font-extrabold text-emerald-700 font-mono tabular-nums">{metrics.completedCount}</span>
                          </div>
                          <div>
                            <span className="text-[10px] text-[#1B365D] block">Em Rota</span>
                            <span className="text-xs font-extrabold text-[#1B365D] font-mono tabular-nums">{metrics.inTransitCount}</span>
                          </div>
                          <div>
                            <span className="text-[10px] text-[#EA580C] block">Pendente</span>
                            <span className="text-xs font-extrabold text-[#EA580C] font-mono tabular-nums">{metrics.pendingCount}</span>
                          </div>
                        </div>

                        {/* Contact Shortcuts */}
                        <div className="flex items-center gap-2 mb-3 text-xs">
                          {driver.phone && (
                            <>
                              <a
                                href={`tel:${driver.phone.replace(/\D/g, '')}`}
                                className="flex-1 min-h-[38px] py-1.5 px-2 bg-[#F8FAFC] hover:bg-[#F1F5F9] text-[#0F2342] rounded-xl font-semibold flex items-center justify-center gap-1.5 border border-[#E2E8F0] transition"
                              >
                                <Phone className="w-3.5 h-3.5 text-[#1B365D]" />
                                <span>Ligar</span>
                              </a>
                              <a
                                href={`https://wa.me/55${driver.phone.replace(/\D/g, '')}`}
                                target="_blank"
                                rel="noreferrer"
                                className="flex-1 min-h-[38px] py-1.5 px-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 rounded-xl font-semibold flex items-center justify-center gap-1.5 border border-emerald-200 transition"
                              >
                                <MessageSquare className="w-3.5 h-3.5 text-emerald-600" />
                                <span>WhatsApp</span>
                              </a>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Consult details button */}
                      <button
                        type="button"
                        onClick={() => {
                          setDriverHistoryDate(getFortalezaDateKey());
                          setSelectedDriver(driver);
                        }}
                        className="w-full min-h-[40px] py-2 bg-[#0F2342] hover:bg-[#1B365D] text-white font-bold rounded-xl text-xs transition flex items-center justify-center gap-1.5 cursor-pointer"
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
            <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 sm:p-6 shadow-2xs">
              <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-lg font-extrabold text-[#0F2342]">Movimento Diário de Entregas</h2>
                    {currentShift && currentShift.status === 'ABERTO' ? (
                      <span className="text-xs font-bold text-emerald-700">· Aberto hoje</span>
                    ) : (
                      <span className="text-xs font-bold text-rose-700">· Fechado</span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    Controle de turnos diários de entregas, fechamento de caixa de motoboys e prestação de contas.
                  </p>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  {currentShift && currentShift.status === 'ABERTO' ? (
                    permissions.canCloseDailyShift && (
                      <button
                        type="button"
                        onClick={() => setIsCloseShiftModalOpen(true)}
                        className="min-h-[40px] px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl text-xs transition shadow-2xs cursor-pointer flex items-center gap-1.5"
                      >
                        <Lock className="w-4 h-4" />
                        <span>Fechar Movimento Diário</span>
                      </button>
                    )
                  ) : (
                    <div className="flex items-center gap-2 flex-wrap">
                      {permissions.canOpenDailyShift && (
                        <button
                          type="button"
                          onClick={() => setIsOpenShiftModalOpen(true)}
                          className="min-h-[40px] px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs transition shadow-2xs cursor-pointer flex items-center gap-1.5"
                        >
                          <Unlock className="w-4 h-4" />
                          <span>Abrir Novo Movimento</span>
                        </button>
                      )}
                      {permissions.canReopenDailyShift && currentShift && (
                        <button
                          type="button"
                          onClick={handleReopenShift}
                          className="min-h-[40px] px-3 py-2 bg-[#F8FAFC] hover:bg-[#F1F5F9] text-[#0F2342] font-bold rounded-xl text-xs transition border border-[#E2E8F0] cursor-pointer flex items-center gap-1.5"
                          title="Reabrir Movimento Anterior"
                        >
                          <RotateCcw className="w-4 h-4 text-[#EA580C]" />
                          <span>Reabrir</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Shift Details Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 p-4 bg-[#F8FAFC] rounded-xl border border-[#E2E8F0] text-xs">
                <div>
                  <span className="text-slate-500 block text-[11px]">Data de Referência</span>
                  <span className="font-bold text-[#0F2342] font-mono text-sm">{currentShift?.date || todayStr}</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[11px]">Aberto por</span>
                  <span className="font-bold text-[#0F2342]">
                    {currentShift?.openedBy?.userName || 'Administrador'} ({currentShift?.openedBy?.userRole || 'ADMIN'})
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[11px]">Horário de Abertura</span>
                  <span className="font-bold text-[#0F2342] font-mono tabular-nums">
                    {currentShift?.openedAt ? formatDateTime(currentShift.openedAt) : '--'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[11px]">Entregas Concluídas Hoje</span>
                  <span className="font-bold text-emerald-700 font-mono tabular-nums text-sm">
                    {completedToday.length} de {todayDeliveryOrders.length} pedidos
                  </span>
                </div>
              </div>

              {/* Strict Notice regarding closed shift and pending orders */}
              <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-950 flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div className="leading-relaxed">
                  <span className="font-bold text-amber-900">Regra de Fechamento de Entregas:</span>
                  <span className="ml-1">
                    O encerramento do movimento diário não apaga pedidos, não altera datas originais e não marca entregas pendentes como concluídas.
                    Qualquer entrega não concluída permanecerá no sistema como pendência de dia anterior para apuração e continuidade.
                  </span>
                </div>
              </div>
            </div>

            {/* Closed Shifts History Section */}
            <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 sm:p-6 shadow-2xs">
              <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
                <h3 className="text-base font-bold text-[#0F2342] flex items-center gap-2">
                  <History className="w-4 h-4 text-[#EA580C]" />
                  <span>Histórico de Fechamentos Anteriores</span>
                </h3>
                <span className="text-xs text-slate-500 font-mono tabular-nums">{shiftHistory.length} fechamentos registrados</span>
              </div>

              {shiftHistory.length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-6">
                  Nenhum fechamento registrado no histórico até o momento.
                </p>
              ) : (
                <div className="space-y-2.5">
                  {shiftHistory.map((shift) => (
                    <div
                      key={shift.id}
                      className="p-3.5 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl flex items-center justify-between gap-3 text-xs flex-wrap"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-extrabold text-[#0F2342] font-mono text-sm">
                            Turno {shift.date}
                          </span>
                          <span className="text-[11px] font-semibold text-slate-500">· Fechado</span>
                        </div>
                        <p className="text-[11px] text-slate-600 mt-0.5">
                          Fechado por {shift.closedBy?.userName || 'Supervisão'} em {shift.closedAt ? formatDateTime(shift.closedAt) : '--'}
                        </p>
                        {shift.notes && (
                          <p className="text-[11px] text-[#9A3412] mt-1 italic">Obs: {shift.notes}</p>
                        )}
                      </div>

                      {shift.summary && (
                        <div className="flex items-center gap-4 text-right">
                          <div>
                            <span className="text-[10px] text-slate-500 block">Concluídas</span>
                            <span className="font-bold text-emerald-700 font-mono tabular-nums">
                              {shift.summary.completedDeliveries} / {shift.summary.totalDeliveries}
                            </span>
                          </div>
                          <div>
                            <span className="text-[10px] text-slate-500 block">Total Entregue</span>
                            <span className="font-bold text-[#0F2342] font-mono tabular-nums">
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
        <div className="fixed inset-0 z-50 bg-[#0F2342]/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white border border-[#E2E8F0] rounded-2xl sm:rounded-3xl p-5 sm:p-6 max-w-lg w-full shadow-2xl relative text-[#0F2342]">
            <button
              type="button"
              onClick={() => {
                setAssignModalOrder(null);
                setSelectedNewDriverId('');
                setReassignReason('');
              }}
              className="absolute right-4 top-4 text-slate-400 hover:text-[#0F2342] p-1.5 rounded-lg hover:bg-[#F1F5F9] transition cursor-pointer"
              aria-label="Fechar modal"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2.5 mb-4 pr-8">
              <div className="w-9 h-9 rounded-xl bg-[#FFF7ED] text-[#EA580C] border border-[#FED7AA] flex items-center justify-center shrink-0">
                <Bike className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-[#0F2342]">
                  {assignModalOrder.deliveryPerson ? 'Reatribuir Entrega' : 'Atribuir Entregador'}
                </h3>
                <p className="text-xs text-slate-500 font-mono">
                  Pedido {assignModalOrder.orderNumber} · {assignModalOrder.customer.name}
                </p>
              </div>
            </div>

            <form onSubmit={handleConfirmAssignment} className="space-y-4">
              {/* Current Driver status */}
              <div className="p-3 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl text-xs space-y-1">
                <span className="text-[11px] text-slate-500 font-semibold block">
                  Responsável Atual
                </span>
                <p className="font-bold text-[#0F2342]">
                  {assignModalOrder.deliveryPerson?.name || assignModalOrder.deliveryPersonName || 'Nenhum entregador atribuído (Aguardando Atribuição)'}
                </p>
              </div>

              {/* Select New Driver */}
              <div>
                <label className="block text-xs font-semibold text-[#0F2342] mb-1.5">
                  Selecione o Novo Entregador Responsável
                </label>
                <select
                  value={selectedNewDriverId}
                  onChange={(e) => setSelectedNewDriverId(e.target.value)}
                  className="w-full min-h-[42px] px-3 py-2 bg-[#F8FAFC] focus:bg-white border border-[#E2E8F0] rounded-xl text-xs sm:text-sm text-[#0F2342] focus:outline-none focus:ring-2 focus:ring-[#EA580C]/20 focus:border-[#EA580C]"
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
                <label className="block text-xs font-semibold text-[#0F2342] mb-1.5">
                  Motivo da Atribuição / Reatribuição (Opcional)
                </label>
                <input
                  type="text"
                  value={reassignReason}
                  onChange={(e) => setReassignReason(e.target.value)}
                  placeholder="Ex: Redistribuição de rota, moto furou pneu, etc."
                  className="w-full min-h-[42px] px-3 py-2 bg-[#F8FAFC] focus:bg-white border border-[#E2E8F0] rounded-xl text-xs sm:text-sm text-[#0F2342] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#EA580C]/20 focus:border-[#EA580C]"
                />
              </div>

              {/* Assignment Audit History */}
              {(assignModalOrder.deliveryAssignmentHistory?.length || 0) > 0 && (
                <div className="pt-2 border-t border-[#E2E8F0]">
                  <span className="text-xs text-slate-600 font-semibold block mb-1.5">
                    Histórico de Alterações de Responsável
                  </span>
                  <div className="space-y-1.5 max-h-28 overflow-y-auto pr-1">
                    {assignModalOrder.deliveryAssignmentHistory?.map((h, i) => (
                      <div key={i} className="text-[11px] p-2 bg-[#F8FAFC] rounded-lg border border-[#E2E8F0]">
                        <div className="flex items-center justify-between text-slate-500">
                          <span>Por: <strong className="text-[#0F2342]">{h.assignedBy}</strong></span>
                          <span className="font-mono">{formatDateTime(h.assignedAt)}</span>
                        </div>
                        <p className="text-[#1B365D] font-medium mt-0.5">
                          {h.previousDriverName ? `De: ${h.previousDriverName}` : 'Inicial'} → {h.newDriverName || 'Desvinculado'}
                          {h.reason ? ` (${h.reason})` : ''}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {assignError && (
                <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{assignError}</span>
                </div>
              )}

              {/* Buttons */}
              <div className="pt-3 border-t border-[#E2E8F0] flex items-center justify-end gap-2">
                <button
                  type="button"
                  disabled={isAssigning}
                  onClick={() => {
                    setAssignModalOrder(null);
                    setSelectedNewDriverId('');
                    setReassignReason('');
                    setAssignError(null);
                  }}
                  className="min-h-[40px] px-4 py-2 bg-[#F8FAFC] hover:bg-[#F1F5F9] disabled:opacity-50 text-[#0F2342] border border-[#E2E8F0] rounded-xl text-xs font-semibold transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isAssigning}
                  className="min-h-[40px] px-4 py-2 bg-[#EA580C] hover:bg-[#C2410C] disabled:opacity-60 text-white rounded-xl text-xs font-bold transition cursor-pointer shadow-2xs"
                >
                  {isAssigning ? 'Salvando...' : 'Salvar Atribuição'}
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
        <div className="fixed inset-0 z-50 bg-[#0F2342]/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white border border-[#E2E8F0] rounded-2xl sm:rounded-3xl p-5 sm:p-6 max-w-md w-full shadow-2xl relative text-[#0F2342]">
            <button
              type="button"
              onClick={() => { setOccurrenceModalOrder(null); setOccurrenceNote(''); }}
              className="absolute right-4 top-4 text-slate-400 hover:text-[#0F2342] p-1.5 rounded-lg hover:bg-[#F1F5F9] transition cursor-pointer"
              aria-label="Fechar modal"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2 mb-3 pr-8">
              <AlertCircle className="w-5 h-5 text-[#EA580C] shrink-0" />
              <h3 className="text-base font-bold text-[#0F2342]">
                Registrar Ocorrência no Pedido {occurrenceModalOrder.orderNumber}
              </h3>
            </div>

            <form onSubmit={handleSaveOccurrence} className="space-y-3.5">
              <p className="text-xs text-slate-600">
                Adicione notas sobre intercorrências na rota (ex: cliente não atende, portaria bloqueada, etc.).
              </p>

              <div>
                <textarea
                  value={occurrenceNote}
                  onChange={(e) => setOccurrenceNote(e.target.value)}
                  placeholder="Descreva a ocorrência..."
                  rows={3}
                  className="w-full px-3 py-2.5 bg-[#F8FAFC] focus:bg-white border border-[#E2E8F0] rounded-xl text-xs sm:text-sm text-[#0F2342] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#EA580C]/20 focus:border-[#EA580C]"
                  required
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => { setOccurrenceModalOrder(null); setOccurrenceNote(''); }}
                  className="min-h-[40px] px-4 py-2 bg-[#F8FAFC] hover:bg-[#F1F5F9] text-[#0F2342] border border-[#E2E8F0] rounded-xl text-xs font-semibold cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="min-h-[40px] px-4 py-2 bg-[#EA580C] hover:bg-[#C2410C] text-white rounded-xl text-xs font-bold shadow-2xs cursor-pointer"
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
        <div className="fixed inset-0 z-50 bg-[#0F2342]/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white border border-[#E2E8F0] rounded-2xl sm:rounded-3xl p-5 sm:p-6 max-w-lg w-full shadow-2xl relative text-[#0F2342]">
            <button
              type="button"
              onClick={() => setIsCloseShiftModalOpen(false)}
              className="absolute right-4 top-4 text-slate-400 hover:text-[#0F2342] p-1.5 rounded-lg hover:bg-[#F1F5F9] transition cursor-pointer"
              aria-label="Fechar modal"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2.5 mb-4 pr-8">
              <div className="w-9 h-9 rounded-xl bg-rose-50 text-rose-600 border border-rose-200 flex items-center justify-center shrink-0">
                <Lock className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-[#0F2342]">Fechamento do Movimento Diário</h3>
                <p className="text-xs text-slate-500">Data: {currentShift?.date || todayStr}</p>
              </div>
            </div>

            <form onSubmit={handleCloseShift} className="space-y-4">
              {/* Summary of current shift */}
              <div className="p-3.5 bg-[#F8FAFC] rounded-xl border border-[#E2E8F0] text-xs space-y-2">
                <div className="flex justify-between">
                  <span className="text-slate-600">Total de Entregas Hoje:</span>
                  <span className="font-bold text-[#0F2342] font-mono tabular-nums">{todayDeliveryOrders.length}</span>
                </div>
                <div className="flex justify-between text-emerald-700">
                  <span>Entregas Concluídas:</span>
                  <span className="font-bold font-mono tabular-nums">{completedToday.length}</span>
                </div>
                <div className="flex justify-between text-[#EA580C]">
                  <span>Entregas Ainda Pendentes:</span>
                  <span className="font-bold font-mono tabular-nums">{pendingToday.length}</span>
                </div>
                <div className="flex justify-between pt-2 border-t border-[#E2E8F0] text-sm">
                  <span className="font-bold text-[#0F2342]">Total Faturado em Entregas:</span>
                  <span className="font-extrabold text-[#EA580C] font-mono tabular-nums">
                    {formatCurrency(completedToday.reduce((sum, o) => sum + (o.totalAmount || 0), 0))}
                  </span>
                </div>
              </div>

              {/* Explicit Safety Notice */}
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-950 leading-relaxed">
                <strong>Importante:</strong> O fechamento do movimento registra o relatório consolidado deste turno.
                Pedidos pendentes <strong>não serão apagados nem alterados</strong> e continuarão disponíveis como pendências para o próximo turno.
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#0F2342] mb-1.5">
                  Observações do Fechamento (Opcional)
                </label>
                <textarea
                  value={closeShiftNotes}
                  onChange={(e) => setCloseShiftNotes(e.target.value)}
                  placeholder="Ex: Prestação de contas realizada com todos os motoboys..."
                  rows={2}
                  className="w-full px-3 py-2 bg-[#F8FAFC] focus:bg-white border border-[#E2E8F0] rounded-xl text-xs sm:text-sm text-[#0F2342] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#EA580C]/20 focus:border-[#EA580C]"
                />
              </div>

              <div className="pt-3 border-t border-[#E2E8F0] flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsCloseShiftModalOpen(false)}
                  className="min-h-[40px] px-4 py-2 bg-[#F8FAFC] hover:bg-[#F1F5F9] text-[#0F2342] border border-[#E2E8F0] rounded-xl text-xs font-semibold cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="min-h-[40px] px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold shadow-2xs cursor-pointer"
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
        <div className="fixed inset-0 z-50 bg-[#0F2342]/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white border border-[#E2E8F0] rounded-2xl sm:rounded-3xl p-5 sm:p-6 max-w-md w-full shadow-2xl relative text-[#0F2342]">
            <button
              type="button"
              onClick={() => setIsOpenShiftModalOpen(false)}
              className="absolute right-4 top-4 text-slate-400 hover:text-[#0F2342] p-1.5 rounded-lg hover:bg-[#F1F5F9] transition cursor-pointer"
              aria-label="Fechar modal"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2.5 mb-3 pr-8">
              <Unlock className="w-5 h-5 text-emerald-600 shrink-0" />
              <h3 className="text-base font-bold text-[#0F2342]">Abrir Movimento Diário de Entregas</h3>
            </div>

            <form onSubmit={handleOpenShift} className="space-y-3.5">
              <p className="text-xs text-slate-600">
                Inicie um novo turno para controle de entregas do dia ({todayStr}).
              </p>

              <div>
                <label className="block text-xs font-semibold text-[#0F2342] mb-1.5">
                  Observações de Abertura (Opcional)
                </label>
                <input
                  type="text"
                  value={openShiftNotes}
                  onChange={(e) => setOpenShiftNotes(e.target.value)}
                  placeholder="Ex: Turno almoço e jantar..."
                  className="w-full min-h-[42px] px-3 py-2 bg-[#F8FAFC] focus:bg-white border border-[#E2E8F0] rounded-xl text-xs sm:text-sm text-[#0F2342] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#EA580C]/20 focus:border-[#EA580C]"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsOpenShiftModalOpen(false)}
                  className="min-h-[40px] px-4 py-2 bg-[#F8FAFC] hover:bg-[#F1F5F9] text-[#0F2342] border border-[#E2E8F0] rounded-xl text-xs font-semibold cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="min-h-[40px] px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-2xs cursor-pointer"
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
        <div className="fixed inset-0 z-50 bg-[#0F2342]/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white border border-[#E2E8F0] rounded-2xl sm:rounded-3xl p-5 sm:p-6 max-w-2xl w-full shadow-2xl relative max-h-[90vh] flex flex-col text-[#0F2342]">
            <button
              type="button"
              onClick={() => setSelectedDriver(null)}
              className="absolute right-4 top-4 text-slate-400 hover:text-[#0F2342] p-1.5 rounded-lg hover:bg-[#F1F5F9] transition cursor-pointer"
              aria-label="Fechar modal"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3 mb-4 pr-8">
              <div className="w-10 h-10 rounded-xl bg-[#FFF7ED] text-[#EA580C] border border-[#FED7AA] flex items-center justify-center shrink-0">
                <Bike className="w-6 h-6" />
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-bold text-[#0F2342] truncate">
                  {selectedDriver.name || selectedDriver.username}
                </h3>
                <p className="text-xs text-slate-500 font-mono truncate">
                  @{selectedDriver.username} {selectedDriver.phone ? `· ${selectedDriver.phone}` : ''}
                </p>
              </div>
            </div>

            {(() => {
              const linkedOrders = getDriverDeliveriesForDate(
                deliveryOrders,
                selectedDriver,
                driverHistoryDate
              );
              const isViewingToday = driverHistoryDate === todayStr;

              return (
                <>
                  {/* Date Filter Controls & Summary */}
                  <div className="mb-3 p-3 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Calendar className="w-3.5 h-3.5 text-[#EA580C] shrink-0" />
                        <span className="text-xs font-bold text-[#0F2342]">
                          Data: {formatFortalezaDateLabel(driverHistoryDate)}
                        </span>
                        {isViewingToday && (
                          <span className="text-xs font-semibold text-emerald-700">· Hoje</span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-600">
                        <strong className="text-[#EA580C] font-mono tabular-nums">{linkedOrders.length}</strong>{' '}
                        {linkedOrders.length === 1 ? 'entrega encontrada' : 'entregas encontradas'}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <input
                        type="date"
                        aria-label="Filtrar entregas do entregador por data"
                        value={driverHistoryDate}
                        onChange={(e) => {
                          const nextDate = e.target.value;
                          setDriverHistoryDate(
                            /^\d{4}-\d{2}-\d{2}$/.test(nextDate) ? nextDate : getFortalezaDateKey()
                          );
                        }}
                        className="min-h-[38px] px-2.5 py-1.5 bg-white border border-[#E2E8F0] rounded-xl text-xs font-mono text-[#0F2342] focus:outline-none focus:ring-2 focus:ring-[#EA580C]/20 focus:border-[#EA580C]"
                      />
                      <button
                        type="button"
                        onClick={() => setDriverHistoryDate(getFortalezaDateKey())}
                        className={`min-h-[38px] px-3 py-1.5 rounded-xl text-xs font-bold transition border cursor-pointer shrink-0 ${
                          isViewingToday
                            ? 'bg-white text-slate-600 border-[#E2E8F0] hover:bg-[#F1F5F9]'
                            : 'bg-[#EA580C] hover:bg-[#C2410C] text-white border-[#EA580C]'
                        }`}
                      >
                        Hoje
                      </button>
                    </div>
                  </div>

                  {/* Driver Linked Orders List */}
                  <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
                    <h4 className="text-xs font-bold text-[#0F2342]">
                      Entregas Vinculadas a Este Entregador ({formatFortalezaDateLabel(driverHistoryDate)})
                    </h4>

                    {linkedOrders.length === 0 ? (
                      <p className="text-xs text-slate-500 text-center py-8">
                        Nenhuma entrega vinculada a este entregador em {formatFortalezaDateLabel(driverHistoryDate)}.
                      </p>
                    ) : (
                      linkedOrders.map((ord) => (
                        <div
                          key={ord.id}
                          className="p-3 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl flex items-center justify-between gap-3 text-xs"
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-bold text-[#0F2342] font-mono tabular-nums">{ord.orderNumber}</span>
                              <span className={`text-[11px] font-bold ${
                                ord.status === 'ENTREGUE'
                                  ? 'text-emerald-700'
                                  : ord.status === 'EM_ROTA'
                                  ? 'text-[#1B365D]'
                                  : 'text-[#EA580C]'
                              }`}>
                                · {ord.status}
                              </span>
                            </div>
                            <p className="text-[#0F2342] font-medium mt-0.5 truncate">{ord.customer.name}</p>
                            <p className="text-[11px] text-slate-500 font-mono tabular-nums">
                              {formatDateTime(ord.createdAt)} · {formatCurrency(ord.totalAmount)}
                            </p>
                          </div>

                          <button
                            type="button"
                            onClick={() => {
                              setSelectedDriver(null);
                              setAssignModalOrder(ord);
                              setSelectedNewDriverId(ord.deliveryPersonId || '');
                            }}
                            className="px-3 py-1.5 bg-white hover:bg-[#FFF7ED] text-[#0F2342] hover:text-[#EA580C] rounded-lg text-xs font-semibold border border-[#E2E8F0] hover:border-[#FED7AA] transition cursor-pointer shrink-0"
                          >
                            Reatribuir
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </>
              );
            })()}

            <div className="pt-4 border-t border-[#E2E8F0] flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedDriver(null)}
                className="min-h-[40px] px-4 py-2 bg-[#0F2342] hover:bg-[#1B365D] text-white rounded-xl text-xs font-bold cursor-pointer"
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
        <div className="fixed inset-0 z-50 bg-[#0F2342]/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white border border-[#E2E8F0] rounded-2xl sm:rounded-3xl p-5 sm:p-6 max-w-xl w-full shadow-2xl relative max-h-[85vh] flex flex-col text-[#0F2342]">
            <button
              type="button"
              onClick={() => setIsShiftHistoryModalOpen(false)}
              className="absolute right-4 top-4 text-slate-400 hover:text-[#0F2342] p-1.5 rounded-lg hover:bg-[#F1F5F9] transition cursor-pointer"
              aria-label="Fechar modal"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2 mb-4 pr-8">
              <History className="w-5 h-5 text-[#EA580C] shrink-0" />
              <h3 className="text-base font-bold text-[#0F2342]">Histórico dos Fechamentos de Entregas</h3>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
              {shiftHistory.length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-8">
                  Nenhum fechamento registrado no histórico.
                </p>
              ) : (
                shiftHistory.map((shift) => (
                  <div key={shift.id} className="p-3 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl text-xs space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-[#0F2342] font-mono text-sm">Turno {shift.date}</span>
                      <span className="text-slate-500 font-mono text-[11px] tabular-nums">
                        {shift.closedAt ? formatDateTime(shift.closedAt) : '--'}
                      </span>
                    </div>
                    <p className="text-slate-600">
                      Fechado por: <strong className="text-[#0F2342]">{shift.closedBy?.userName || 'Supervisão'}</strong>
                    </p>
                    {shift.summary && (
                      <p className="text-emerald-700 font-mono tabular-nums font-semibold">
                        Concluídas: {shift.summary.completedDeliveries} / {shift.summary.totalDeliveries} pedidos (Faturamento: {formatCurrency(shift.summary.totalAmount)})
                      </p>
                    )}
                    {shift.notes && <p className="text-slate-500 italic mt-0.5">Obs: {shift.notes}</p>}
                  </div>
                ))
              )}
            </div>

            <div className="pt-3 border-t border-[#E2E8F0] flex justify-end">
              <button
                type="button"
                onClick={() => setIsShiftHistoryModalOpen(false)}
                className="min-h-[40px] px-4 py-2 bg-[#0F2342] hover:bg-[#1B365D] text-white rounded-xl text-xs font-bold cursor-pointer"
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
