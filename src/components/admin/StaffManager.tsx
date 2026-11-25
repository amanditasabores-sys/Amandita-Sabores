import React, { useState, useEffect, useCallback } from 'react';
import { store } from '../../services/store';
import {
  User,
  UserRole,
  UserStatus,
  AppModule,
  UserAccessLog,
  DeliveryPermissions,
} from '../../types';
import { formatDateTime } from '../../utils/formatters';
import {
  Users,
  UserPlus,
  ShieldCheck,
  ShieldAlert,
  Lock,
  KeyRound,
  CheckCircle2,
  AlertCircle,
  Ban,
  Check,
  Trash2,
  Edit3,
  Eye,
  EyeOff,
  History,
  Bike,
  Search,
  X,
  Phone,
  RefreshCw,
  UserCog,
} from 'lucide-react';
import { ConfirmModal } from '../common/ConfirmModal';

const DEFAULT_DELIVERY_PERMISSIONS: DeliveryPermissions = {
  canViewDeliveryDashboard: false,
  canManageDrivers: false,
  canAssignDeliveries: false,
  canOpenDailyShift: false,
  canCloseDailyShift: false,
  canViewShiftHistory: false,
  canReopenDailyShift: false,
};

const AVAILABLE_MODULES: { id: AppModule; label: string; desc: string }[] = [
  { id: 'pdv', label: 'PDV / Frente de Caixa', desc: 'Registro de vendas, comandas no balcão e cupons' },
  { id: 'kanban', label: 'Gestão de Pedidos (Kanban)', desc: 'Visualização e avanço de pedidos em tempo real' },
  { id: 'kds', label: 'Cozinha (KDS)', desc: 'Fila de preparação de lanches e pratos' },
  { id: 'caixa', label: 'Controle de Caixa', desc: 'Abertura, fechamento, sangrias, suprimentos e vales' },
  { id: 'entregas', label: 'Área do Entregador', desc: 'Despacho e confirmação de rotas com motoboys' },
  { id: 'relatorios', label: 'Relatórios Financeiros & DRE', desc: 'Vendas por período, faturamento e lucro' },
  { id: 'menu', label: 'Gestão do Cardápio', desc: 'Edição de produtos, preços, fotos e categorias' },
  { id: 'usuarios', label: 'Equipe & Permissões', desc: 'Cadastro de funcionários e controle de acessos (exclusivo Administrador)' },
  { id: 'configuracoes', label: 'Configurações da Loja & PIX', desc: 'Horários, dados do restaurante e chave PIX' },
  { id: 'qrcodes', label: 'QR Codes & Links Públicos', desc: 'Links do cardápio WhatsApp e entregador' },
  { id: 'auditoria', label: 'Auditoria & Logs', desc: 'Histórico de movimentações de pedidos e caixa' },
];

const DELIVERY_PERMISSION_ITEMS: { key: keyof DeliveryPermissions; label: string; desc: string }[] = [
  { key: 'canViewDeliveryDashboard', label: 'Painel & Métricas', desc: 'Visualizar painel de controle e métricas de entregas' },
  { key: 'canManageDrivers', label: 'Gerenciar Entregadores', desc: 'Visualizar status e presença da equipe de entrega' },
  { key: 'canAssignDeliveries', label: 'Atribuir Pedidos', desc: 'Despachar e reatribuir entregas aos entregadores' },
  { key: 'canOpenDailyShift', label: 'Abrir Movimento Diário', desc: 'Iniciar novo turno diário de entregas' },
  { key: 'canCloseDailyShift', label: 'Fechar Movimento Diário', desc: 'Encerrar o dia com conferência e checklist' },
  { key: 'canViewShiftHistory', label: 'Histórico de Movimentos', desc: 'Consultar turnos anteriores e auditoria' },
  { key: 'canReopenDailyShift', label: 'Reabrir Movimento Diário', desc: 'Reabrir movimento fechado (restrito e auditado)' },
];

const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,31}$/;

function sanitizeUsername(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9._-]/g, '');
}

function validatePasswordClient(pw: string): string | null {
  if (pw.length < 8) {
    return 'A senha deve ter no mínimo 8 caracteres.';
  }
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) {
    return 'A senha deve conter pelo menos uma letra e um número.';
  }
  return null;
}

export const StaffManager: React.FC = () => {
  const [activeSubTab, setActiveSubTab] = useState<'funcionarios' | 'credenciais' | 'auditoria'>('funcionarios');
  const [users, setUsers] = useState<User[]>(() => store.getUsers());
  const [accessLogs, setAccessLogs] = useState<UserAccessLog[]>(() => store.getAccessLogs());
  const [currentActor, setCurrentActor] = useState<User | null>(() => store.getCurrentUser());

  const isActorAdmin = Boolean(currentActor && currentActor.role === 'ADMINISTRADOR' && store.canUserManageUsers());

  // Loading & Feedback states
  const [isLoadingStaff, setIsLoadingStaff] = useState(false);
  const [pageBanner, setPageBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  // Search filter
  const [searchQuery, setSearchQuery] = useState('');

  // Create / Edit Staff Modal
  const [isUserModalOpen, setIsUserModalOpen] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [formName, setFormName] = useState('');
  const [formUsername, setFormUsername] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [formConfirmPassword, setFormConfirmPassword] = useState('');
  const [showFormPassword, setShowFormPassword] = useState(false);
  const [showFormConfirm, setShowFormConfirm] = useState(false);
  const [formRole, setFormRole] = useState<UserRole>('CAIXA');
  const [formStatus, setFormStatus] = useState<UserStatus>('ATIVO');
  const [formAllowedModules, setFormAllowedModules] = useState<AppModule[]>(['pdv', 'kanban', 'caixa']);
  const [formDeliveryPermissions, setFormDeliveryPermissions] = useState<DeliveryPermissions>(DEFAULT_DELIVERY_PERMISSIONS);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSavingUser, setIsSavingUser] = useState(false);

  // Password Reset Modal
  const [resetModalUser, setResetModalUser] = useState<User | null>(null);
  const [newPasswordInput, setNewPasswordInput] = useState('');
  const [confirmNewPasswordInput, setConfirmNewPasswordInput] = useState('');
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetSuccessNotice, setResetSuccessNotice] = useState<string | null>(null);
  const [isResettingPassword, setIsResettingPassword] = useState(false);

  // Delete Confirm Modal
  const [userToDelete, setUserToDelete] = useState<User | null>(null);
  const [isDeletingUser, setIsDeletingUser] = useState(false);

  // Admin Own Credentials State
  const [credCurrentPassword, setCredCurrentPassword] = useState('');
  const [credNewUsername, setCredNewUsername] = useState(() => currentActor?.username || '');
  const [credNewPassword, setCredNewPassword] = useState('');
  const [credConfirmPassword, setCredConfirmPassword] = useState('');
  const [showCredCurrent, setShowCredCurrent] = useState(false);
  const [showCredNew, setShowCredNew] = useState(false);
  const [showCredConfirm, setShowCredConfirm] = useState(false);
  const [credError, setCredError] = useState<string | null>(null);
  const [credSuccess, setCredSuccess] = useState<string | null>(null);
  const [isUpdatingCreds, setIsUpdatingCreds] = useState(false);

  const reloadLocalState = useCallback(() => {
    setUsers(store.getUsers());
    setAccessLogs(store.getAccessLogs());
    const freshActor = store.getCurrentUser();
    setCurrentActor(freshActor);
  }, []);

  const refreshAuthoritativeStaff = useCallback(async () => {
    if (!store.canUserManageUsers()) return;
    setIsLoadingStaff(true);
    try {
      const res = await store.fetchStaffListAsync();
      if (res.success && res.users) {
        setUsers(res.users);
      } else if (res.message) {
        setPageBanner({ type: 'error', text: res.message });
      }
    } catch {
      setPageBanner({
        type: 'error',
        text: 'Não foi possível sincronizar a lista de funcionários com o servidor.',
      });
    } finally {
      setIsLoadingStaff(false);
    }
  }, []);

  useEffect(() => {
    void refreshAuthoritativeStaff();
    const handleSync = () => reloadLocalState();
    window.addEventListener('gestaofood_state_changed', handleSync);
    return () => window.removeEventListener('gestaofood_state_changed', handleSync);
  }, [refreshAuthoritativeStaff, reloadLocalState]);

  useEffect(() => {
    if (currentActor?.username && !credNewUsername) {
      setCredNewUsername(currentActor.username);
    }
  }, [currentActor?.username, credNewUsername]);

  // Strict ADMINISTRADOR-only gate (GERENTE and all other roles are blocked)
  if (!isActorAdmin) {
    return (
      <div className="max-w-2xl mx-auto py-8">
        <div className="bg-white rounded-2xl border border-[#E2E8F0] p-8 text-center space-y-4">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 flex items-center justify-center">
            <ShieldAlert className="w-7 h-7" />
          </div>
          <div className="space-y-1.5">
            <h2 className="text-xl font-extrabold text-[#0F2342]">
              Acesso Exclusivo do Administrador
            </h2>
            <p className="text-sm text-slate-600 leading-relaxed max-w-md mx-auto">
              Somente usuários com função <strong>Administrador</strong> podem cadastrar, editar, bloquear, redefinir senhas ou excluir funcionários.
            </p>
          </div>
          <p className="text-xs text-slate-500">
            Função atual: <strong className="text-[#0F2342]">{currentActor?.role || 'Não autenticado'}</strong>
          </p>
        </div>
      </div>
    );
  }

  const handleRoleChange = (role: UserRole) => {
    setFormRole(role);
    if (role === 'ADMINISTRADOR') {
      setFormAllowedModules(AVAILABLE_MODULES.map((m) => m.id));
      setFormDeliveryPermissions({
        canViewDeliveryDashboard: true,
        canManageDrivers: true,
        canAssignDeliveries: true,
        canOpenDailyShift: true,
        canCloseDailyShift: true,
        canViewShiftHistory: true,
        canReopenDailyShift: true,
      });
    } else if (role === 'GERENTE') {
      setFormAllowedModules([
        'pdv',
        'kanban',
        'kds',
        'caixa',
        'relatorios',
        'menu',
        'qrcodes',
        'auditoria',
        'entregas',
      ]);
      setFormDeliveryPermissions({
        canViewDeliveryDashboard: true,
        canManageDrivers: true,
        canAssignDeliveries: true,
        canOpenDailyShift: true,
        canCloseDailyShift: true,
        canViewShiftHistory: true,
        canReopenDailyShift: false,
      });
    } else if (role === 'CAIXA') {
      setFormAllowedModules(['pdv', 'kanban', 'caixa']);
      setFormDeliveryPermissions(DEFAULT_DELIVERY_PERMISSIONS);
    } else if (role === 'COZINHA') {
      setFormAllowedModules(['kds']);
      setFormDeliveryPermissions(DEFAULT_DELIVERY_PERMISSIONS);
    } else if (role === 'ENTREGADOR') {
      setFormAllowedModules(['entregas']);
      setFormDeliveryPermissions(DEFAULT_DELIVERY_PERMISSIONS);
    } else if (role === 'ATENDENTE' || role === 'atendente') {
      setFormAllowedModules(['pdv', 'kanban']);
      setFormDeliveryPermissions(DEFAULT_DELIVERY_PERMISSIONS);
    }
  };

  const toggleModule = (modId: AppModule) => {
    // Module 'usuarios' is exclusively granted to ADMINISTRADOR
    if (modId === 'usuarios' && formRole !== 'ADMINISTRADOR') return;
    if (formAllowedModules.includes(modId)) {
      setFormAllowedModules(formAllowedModules.filter((m) => m !== modId));
    } else {
      setFormAllowedModules([...formAllowedModules, modId]);
    }
  };

  const handleOpenNewUser = () => {
    setPageBanner(null);
    setEditingUserId(null);
    setFormName('');
    setFormUsername('');
    setFormPhone('');
    setFormPassword('');
    setFormConfirmPassword('');
    setShowFormPassword(false);
    setShowFormConfirm(false);
    setFormRole('CAIXA');
    setFormStatus('ATIVO');
    setFormAllowedModules(['pdv', 'kanban', 'caixa']);
    setFormDeliveryPermissions(DEFAULT_DELIVERY_PERMISSIONS);
    setFormError(null);
    setIsUserModalOpen(true);
  };

  const handleOpenEditUser = (user: User) => {
    setPageBanner(null);
    setEditingUserId(user.id);
    setFormName(user.name || '');
    setFormUsername(user.username || '');
    setFormPhone(user.phone || '');
    setFormPassword('');
    setFormConfirmPassword('');
    setFormRole(user.role);
    setFormStatus(user.status || 'ATIVO');
    setFormAllowedModules(
      user.role === 'ADMINISTRADOR'
        ? user.allowedModules || AVAILABLE_MODULES.map((m) => m.id)
        : (user.allowedModules || ['pdv', 'kanban']).filter((m) => m !== 'usuarios')
    );
    setFormDeliveryPermissions(store.getDeliveryPermissions(user));
    setFormError(null);
    setIsUserModalOpen(true);
  };

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const cleanName = formName.trim();
    const cleanUser = sanitizeUsername(formUsername.trim());
    const cleanPhone = formPhone.trim();
    const digitsPhone = cleanPhone.replace(/\D/g, '');

    if (cleanName.length < 3) {
      setFormError('Informe o nome completo do funcionário (mínimo 3 caracteres).');
      return;
    }

    if (formUsername.includes('@')) {
      setFormError('O nome de login não pode ser um e-mail.');
      return;
    }

    if (!USERNAME_PATTERN.test(cleanUser)) {
      setFormError(
        'Nome de login inválido: use de 3 a 32 caracteres (letras minúsculas, números, ponto, hífen ou sublinhado).'
      );
      return;
    }

    if (digitsPhone.length < 10 || digitsPhone.length > 15) {
      setFormError('Informe um número de contato válido com DDD (10 a 15 dígitos).');
      return;
    }

    const sanitizedModules =
      formRole === 'ADMINISTRADOR'
        ? formAllowedModules
        : formAllowedModules.filter((m) => m !== 'usuarios');

    if (sanitizedModules.length === 0) {
      setFormError('Selecione ao menos um módulo autorizado para o colaborador.');
      return;
    }

    if (!editingUserId) {
      const pwError = validatePasswordClient(formPassword);
      if (pwError) {
        setFormError(pwError);
        return;
      }
      if (formPassword !== formConfirmPassword) {
        setFormError('A confirmação de senha não confere com a senha informada.');
        return;
      }
    }

    setIsSavingUser(true);
    try {
      if (editingUserId) {
        const res = await store.updateUserAsync(editingUserId, {
          name: cleanName,
          username: cleanUser,
          phone: cleanPhone,
          role: formRole,
          status: formStatus,
          allowedModules: sanitizedModules,
          deliveryPermissions: formDeliveryPermissions,
        });

        if (res.success) {
          setIsUserModalOpen(false);
          setPageBanner({ type: 'success', text: res.message || 'Funcionário atualizado com sucesso.' });
          await refreshAuthoritativeStaff();
        } else {
          setFormError(res.message || 'Não foi possível atualizar o cadastro do funcionário.');
        }
      } else {
        const res = await store.createUserAsync({
          name: cleanName,
          username: cleanUser,
          phone: cleanPhone,
          password: formPassword,
          role: formRole,
          allowedModules: sanitizedModules,
          deliveryPermissions: formDeliveryPermissions,
        });

        if (res.success) {
          setFormPassword('');
          setFormConfirmPassword('');
          setIsUserModalOpen(false);
          setPageBanner({ type: 'success', text: res.message || 'Funcionário cadastrado com sucesso.' });
          await refreshAuthoritativeStaff();
        } else {
          setFormError(res.message || 'Não foi possível cadastrar o funcionário.');
        }
      }
    } catch {
      setFormError('Falha de comunicação com o servidor ao salvar os dados.');
    } finally {
      setIsSavingUser(false);
    }
  };

  const handleToggleStatus = async (user: User) => {
    if (user.id === currentActor?.id) return;
    setPageBanner(null);
    setBusyUserId(user.id);
    const nextStatus: UserStatus = user.status === 'ATIVO' ? 'BLOQUEADO' : 'ATIVO';
    try {
      const res = await store.toggleUserStatusAsync(user.id, nextStatus);
      if (res.success) {
        setPageBanner({
          type: 'success',
          text:
            res.message ||
            (nextStatus === 'BLOQUEADO'
              ? `Acesso de ${user.name} bloqueado com sucesso.`
              : `Acesso de ${user.name} desbloqueado com sucesso.`),
        });
        await refreshAuthoritativeStaff();
      } else {
        setPageBanner({ type: 'error', text: res.message || 'Não foi possível alterar o status da conta.' });
      }
    } catch {
      setPageBanner({ type: 'error', text: 'Erro de comunicação ao alterar o status da conta.' });
    } finally {
      setBusyUserId(null);
    }
  };

  const handleOpenResetPassword = (user: User) => {
    setPageBanner(null);
    setResetModalUser(user);
    setNewPasswordInput('');
    setConfirmNewPasswordInput('');
    setShowResetPassword(false);
    setResetError(null);
    setResetSuccessNotice(null);
  };

  const handleSaveResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetModalUser) return;
    setResetError(null);

    const pwError = validatePasswordClient(newPasswordInput);
    if (pwError) {
      setResetError(pwError);
      return;
    }

    if (newPasswordInput !== confirmNewPasswordInput) {
      setResetError('A confirmação não confere com a nova senha.');
      return;
    }

    setIsResettingPassword(true);
    try {
      const res = await store.resetUserPasswordAsync(resetModalUser.id, newPasswordInput);
      if (res.success) {
        setNewPasswordInput('');
        setConfirmNewPasswordInput('');
        setResetSuccessNotice(
          res.message || `Senha de ${resetModalUser.name || resetModalUser.username} redefinida com sucesso.`
        );
        setTimeout(() => {
          setResetModalUser(null);
          setResetSuccessNotice(null);
        }, 1400);
        await refreshAuthoritativeStaff();
      } else {
        setResetError(res.message || 'Não foi possível redefinir a senha.');
      }
    } catch {
      setResetError('Falha de comunicação ao redefinir a senha.');
    } finally {
      setIsResettingPassword(false);
    }
  };

  const executeDeleteUser = async () => {
    if (!userToDelete) return;
    setIsDeletingUser(true);
    setPageBanner(null);
    try {
      const res = await store.deleteUserAsync(userToDelete.id);
      if (res.success) {
        setPageBanner({ type: 'success', text: res.message || 'Funcionário removido com sucesso.' });
        setUserToDelete(null);
        await refreshAuthoritativeStaff();
      } else {
        setPageBanner({ type: 'error', text: res.message || 'Não foi possível excluir o funcionário.' });
        setUserToDelete(null);
      }
    } catch {
      setPageBanner({ type: 'error', text: 'Falha de comunicação ao excluir o funcionário.' });
      setUserToDelete(null);
    } finally {
      setIsDeletingUser(false);
    }
  };

  const handleUpdateOwnCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    setCredError(null);
    setCredSuccess(null);

    if (!credCurrentPassword.trim()) {
      setCredError('Informe sua senha atual para confirmar a alteração.');
      return;
    }

    const cleanNextUsername = sanitizeUsername(credNewUsername.trim());
    const currentUsername = (currentActor?.username || '').trim().toLowerCase();
    const isChangingUsername = cleanNextUsername !== '' && cleanNextUsername !== currentUsername;
    const isChangingPassword = credNewPassword.length > 0 || credConfirmPassword.length > 0;

    if (!isChangingUsername && !isChangingPassword) {
      setCredError('Informe um novo nome de login e/ou uma nova senha para salvar.');
      return;
    }

    if (credNewUsername.includes('@')) {
      setCredError('O nome de login não pode ser um endereço de e-mail.');
      return;
    }

    if (isChangingUsername && !USERNAME_PATTERN.test(cleanNextUsername)) {
      setCredError(
        'Novo nome de login inválido: use de 3 a 32 caracteres (letras minúsculas, números, ponto, hífen ou sublinhado).'
      );
      return;
    }

    if (isChangingPassword) {
      const pwError = validatePasswordClient(credNewPassword);
      if (pwError) {
        setCredError(pwError);
        return;
      }
      if (credNewPassword !== credConfirmPassword) {
        setCredError('A confirmação da nova senha não confere.');
        return;
      }
    }

    setIsUpdatingCreds(true);
    try {
      const res = await store.updateOwnAdminCredentialsAsync({
        currentPassword: credCurrentPassword,
        ...(isChangingUsername ? { newUsername: cleanNextUsername } : {}),
        ...(isChangingPassword ? { newPassword: credNewPassword } : {}),
      });

      if (res.success && res.user) {
        setCredCurrentPassword('');
        setCredNewPassword('');
        setCredConfirmPassword('');
        setCredNewUsername(res.user.username);
        setCurrentActor(res.user);
        setCredSuccess(
          res.message ||
            'Credenciais atualizadas com sucesso. Seu UID, função Administrador, permissões e histórico foram preservados integralmente.'
        );
        await refreshAuthoritativeStaff();
      } else {
        setCredError(res.message || 'Não foi possível atualizar suas credenciais.');
      }
    } catch {
      setCredError('Falha temporária de comunicação ao atualizar credenciais.');
    } finally {
      setIsUpdatingCreds(false);
    }
  };

  const filteredUsers = users.filter((u) => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    const nameMatch = (u.name || '').toLowerCase().includes(q);
    const userMatch = (u.username || '').toLowerCase().includes(q);
    const phoneMatch = (u.phone || '').toLowerCase().includes(q);
    const roleMatch = (u.role || '').toLowerCase().includes(q);
    return nameMatch || userMatch || phoneMatch || roleMatch;
  });

  return (
    <div className="space-y-6 max-w-6xl mx-auto font-sans">
      {/* Header Bar */}
      <div className="bg-white rounded-2xl p-5 sm:p-6 border border-[#E2E8F0] flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3.5 min-w-0">
          <div className="w-11 h-11 rounded-xl bg-[#0F2342] text-white flex items-center justify-center shrink-0">
            <ShieldCheck className="w-5 h-5 text-[#EA580C]" />
          </div>
          <div className="min-w-0">
            <h2 className="text-lg sm:text-xl font-extrabold text-[#0F2342] tracking-tight">
              Equipe, Usuários e Permissões
            </h2>
            <p className="text-xs text-slate-600 mt-0.5">
              Acesso exclusivo do Administrador · Gestão segura de logins, funções e permissões
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex p-1 bg-[#F8FAFC] rounded-xl border border-[#E2E8F0] text-xs font-semibold">
            <button
              type="button"
              onClick={() => setActiveSubTab('funcionarios')}
              className={`px-3 py-1.5 min-h-[36px] rounded-lg transition flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                activeSubTab === 'funcionarios'
                  ? 'bg-[#0F2342] text-white'
                  : 'text-slate-600 hover:text-[#0F2342]'
              }`}
            >
              <Users className="w-3.5 h-3.5 shrink-0" />
              <span>Colaboradores ({users.length})</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveSubTab('credenciais');
                setCredError(null);
                setCredSuccess(null);
                setCredNewUsername(currentActor?.username || '');
              }}
              className={`px-3 py-1.5 min-h-[36px] rounded-lg transition flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                activeSubTab === 'credenciais'
                  ? 'bg-[#0F2342] text-white'
                  : 'text-slate-600 hover:text-[#0F2342]'
              }`}
            >
              <UserCog className="w-3.5 h-3.5 shrink-0" />
              <span>Minhas Credenciais</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveSubTab('auditoria')}
              className={`px-3 py-1.5 min-h-[36px] rounded-lg transition flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                activeSubTab === 'auditoria'
                  ? 'bg-[#0F2342] text-white'
                  : 'text-slate-600 hover:text-[#0F2342]'
              }`}
            >
              <History className="w-3.5 h-3.5 shrink-0" />
              <span>Auditoria ({accessLogs.length})</span>
            </button>
          </div>

          <button
            type="button"
            onClick={handleOpenNewUser}
            className="px-4 py-2 min-h-[40px] bg-[#EA580C] hover:bg-[#C2410C] text-white font-bold rounded-xl text-xs flex items-center gap-2 transition cursor-pointer whitespace-nowrap shrink-0"
          >
            <UserPlus className="w-4 h-4 shrink-0" />
            <span>Cadastrar Funcionário</span>
          </button>
        </div>
      </div>

      {/* Page Feedback Banner */}
      {pageBanner && (
        <div
          className={`p-3.5 rounded-xl border text-xs font-medium flex items-center justify-between gap-3 ${
            pageBanner.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          <div className="flex items-center gap-2.5">
            {pageBanner.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            )}
            <span>{pageBanner.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setPageBanner(null)}
            className="p-1 text-slate-500 hover:text-[#0F2342] cursor-pointer"
            aria-label="Fechar aviso"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* TAB 1: STAFF LIST */}
      {activeSubTab === 'funcionarios' && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl p-4 border border-[#E2E8F0] flex flex-wrap items-center justify-between gap-3">
            <div className="relative flex-1 min-w-[220px] max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filtrar por nome, login, contato ou função..."
                className="w-full min-h-[40px] pl-10 pr-4 py-2 bg-[#F8FAFC] focus:bg-white border border-[#E2E8F0] rounded-xl text-xs text-[#0F2342] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#EA580C]/20 focus:border-[#EA580C]"
              />
            </div>

            <div className="flex items-center gap-3 text-xs text-slate-600">
              <span className="tabular-nums">
                Exibindo <strong className="text-[#0F2342]">{filteredUsers.length}</strong> de{' '}
                <strong className="text-[#0F2342]">{users.length}</strong> colaboradores
              </span>
              <button
                type="button"
                onClick={() => void refreshAuthoritativeStaff()}
                disabled={isLoadingStaff}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 min-h-[36px] rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] hover:bg-slate-100 text-[#1B365D] font-semibold transition cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoadingStaff ? 'animate-spin' : ''}`} />
                <span>Atualizar</span>
              </button>
            </div>
          </div>

          {isLoadingStaff && users.length === 0 ? (
            <div className="bg-white rounded-2xl border border-[#E2E8F0] p-10 text-center text-xs text-slate-500">
              Carregando colaboradores cadastrados...
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="bg-white rounded-2xl border border-[#E2E8F0] p-10 text-center space-y-3">
              <p className="text-sm font-semibold text-[#0F2342]">
                Nenhum colaborador encontrado.
              </p>
              <p className="text-xs text-slate-500">
                Cadastre novos colaboradores utilizando o botão acima ou limpe o filtro de busca.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredUsers.map((user) => {
                const isSelf = user.id === currentActor?.id;
                const isAdmin = user.role === 'ADMINISTRADOR';
                const isBlocked = user.status === 'BLOQUEADO' || user.status === 'DESATIVADO';
                const isBusy = busyUserId === user.id;

                return (
                  <div
                    key={user.id}
                    className={`bg-white rounded-2xl border p-5 transition space-y-4 ${
                      isBlocked
                        ? 'border-rose-200 bg-rose-50/30'
                        : 'border-[#E2E8F0] hover:border-[#1B365D]/40'
                    }`}
                  >
                    {/* User Identity Row */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className={`w-11 h-11 rounded-xl flex items-center justify-center font-extrabold text-base shrink-0 ${
                            isAdmin
                              ? 'bg-[#0F2342] text-white'
                              : user.role === 'GERENTE'
                              ? 'bg-[#1B365D] text-white'
                              : 'bg-[#F8FAFC] text-[#0F2342] border border-[#E2E8F0]'
                          }`}
                        >
                          {(user.name || user.username || '?')[0].toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <h3 className="font-bold text-sm text-[#0F2342] truncate">
                            {user.name || user.username}
                            {isSelf && (
                              <span className="ml-1.5 text-xs font-medium text-[#EA580C]">
                                (você)
                              </span>
                            )}
                          </h3>
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-600 mt-0.5">
                            <span className="font-mono text-[#1B365D] font-semibold">
                              @{user.username}
                            </span>
                            {user.phone && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="font-mono tabular-nums">{user.phone}</span>
                              </>
                            )}
                            <span aria-hidden="true">·</span>
                            <span
                              className={`font-semibold ${
                                isBlocked ? 'text-rose-700' : 'text-emerald-700'
                              }`}
                            >
                              {user.status || 'ATIVO'}
                            </span>
                          </div>
                        </div>
                      </div>

                      <span className="text-xs font-bold text-[#1B365D] shrink-0">
                        {user.role}
                      </span>
                    </div>

                    {/* Modules Summary */}
                    <div className="pt-3 border-t border-[#E2E8F0]">
                      <p className="text-[11px] font-semibold text-slate-500 mb-1.5">
                        Módulos autorizados
                      </p>
                      <p className="text-xs text-[#0F2342] leading-relaxed">
                        {user.allowedModules && user.allowedModules.length > 0
                          ? user.allowedModules
                              .map((mId) => AVAILABLE_MODULES.find((m) => m.id === mId)?.label || mId)
                              .join(' · ')
                          : 'Nenhum módulo autorizado'}
                      </p>
                    </div>

                    {/* Actions Footer (ZERO plaintext password display) */}
                    <div className="pt-3 border-t border-[#E2E8F0] flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-500">
                        <Lock className="w-3.5 h-3.5 text-[#1B365D]" />
                        <span>Senha protegida no servidor</span>
                      </span>

                      <div className="flex items-center gap-1.5">
                        {isSelf ? (
                          <button
                            type="button"
                            onClick={() => {
                              setActiveSubTab('credenciais');
                              setCredError(null);
                              setCredSuccess(null);
                              setCredNewUsername(currentActor?.username || '');
                            }}
                            className="px-3 py-1.5 min-h-[36px] bg-[#F8FAFC] hover:bg-slate-100 text-[#0F2342] font-semibold rounded-lg border border-[#E2E8F0] transition flex items-center gap-1.5 cursor-pointer"
                          >
                            <UserCog className="w-3.5 h-3.5 text-[#EA580C]" />
                            <span>Alterar Login/Senha</span>
                          </button>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => handleOpenResetPassword(user)}
                              disabled={isBusy}
                              className="px-2.5 py-1.5 min-h-[36px] bg-[#F8FAFC] hover:bg-slate-100 text-[#0F2342] font-semibold rounded-lg border border-[#E2E8F0] transition flex items-center gap-1 cursor-pointer disabled:opacity-50"
                              title="Redefinir senha do funcionário"
                            >
                              <KeyRound className="w-3.5 h-3.5 text-[#EA580C]" />
                              <span>Senha</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => handleOpenEditUser(user)}
                              disabled={isBusy}
                              className="px-2.5 py-1.5 min-h-[36px] bg-[#F8FAFC] hover:bg-slate-100 text-[#0F2342] font-semibold rounded-lg border border-[#E2E8F0] transition flex items-center gap-1 cursor-pointer disabled:opacity-50"
                              title="Editar dados e permissões"
                            >
                              <Edit3 className="w-3.5 h-3.5 text-[#1B365D]" />
                              <span>Editar</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => void handleToggleStatus(user)}
                              disabled={isBusy}
                              className={`px-2.5 py-1.5 min-h-[36px] rounded-lg border transition cursor-pointer disabled:opacity-50 ${
                                isBlocked
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                                  : 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100'
                              }`}
                              title={isBlocked ? 'Desbloquear conta' : 'Bloquear acesso do funcionário'}
                            >
                              {isBlocked ? <Check className="w-3.5 h-3.5" /> : <Ban className="w-3.5 h-3.5" />}
                            </button>

                            <button
                              type="button"
                              onClick={() => setUserToDelete(user)}
                              disabled={isBusy}
                              className="px-2.5 py-1.5 min-h-[36px] rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 transition cursor-pointer disabled:opacity-50"
                              title="Excluir funcionário"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
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

      {/* TAB 2: OWN ADMINISTRATOR CREDENTIALS */}
      {activeSubTab === 'credenciais' && (
        <div className="bg-white rounded-2xl border border-[#E2E8F0] p-6 max-w-2xl space-y-5">
          <div>
            <h3 className="text-base font-extrabold text-[#0F2342]">
              Alterar Credenciais do Administrador
            </h3>
            <p className="text-xs text-slate-600 mt-1 leading-relaxed">
              Atualize seu nome de login e/ou senha mantendo integralmente sua conta, função <strong>Administrador</strong>, permissões e histórico operacional.
            </p>
          </div>

          {credSuccess && (
            <div className="p-3.5 bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-xl text-xs flex items-start gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <span className="font-medium leading-relaxed">{credSuccess}</span>
            </div>
          )}

          {credError && (
            <div className="p-3.5 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span className="font-medium leading-relaxed">{credError}</span>
            </div>
          )}

          <form onSubmit={handleUpdateOwnCredentials} className="space-y-4" noValidate>
            <div>
              <label
                htmlFor="admin-cred-current-password"
                className="block text-xs font-semibold text-[#0F2342] mb-1.5"
              >
                Senha atual (obrigatória para confirmar)
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="admin-cred-current-password"
                  type={showCredCurrent ? 'text' : 'password'}
                  value={credCurrentPassword}
                  onChange={(e) => setCredCurrentPassword(e.target.value)}
                  placeholder="Digite sua senha atual"
                  autoComplete="current-password"
                  required
                  className="w-full min-h-[44px] pl-10 pr-11 py-2.5 bg-[#F8FAFC] focus:bg-white border border-[#E2E8F0] rounded-xl text-sm text-[#0F2342] focus:outline-none focus:ring-2 focus:ring-[#EA580C]/20 focus:border-[#EA580C]"
                />
                <button
                  type="button"
                  onClick={() => setShowCredCurrent((prev) => !prev)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-[#0F2342] p-1.5 cursor-pointer"
                  tabIndex={-1}
                >
                  {showCredCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="pt-2 border-t border-[#E2E8F0]">
              <label
                htmlFor="admin-cred-new-username"
                className="block text-xs font-semibold text-[#0F2342] mb-1.5"
              >
                Nome de login
              </label>
              <input
                id="admin-cred-new-username"
                type="text"
                value={credNewUsername}
                onChange={(e) => setCredNewUsername(sanitizeUsername(e.target.value))}
                placeholder="Seu nome de login único"
                autoComplete="username"
                className="w-full min-h-[44px] px-3.5 py-2.5 bg-[#F8FAFC] focus:bg-white border border-[#E2E8F0] rounded-xl text-sm font-mono text-[#0F2342] focus:outline-none focus:ring-2 focus:ring-[#EA580C]/20 focus:border-[#EA580C]"
              />
              <p className="text-[11px] text-slate-500 mt-1">
                Deixe inalterado caso deseje alterar apenas a senha.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="admin-cred-new-password"
                  className="block text-xs font-semibold text-[#0F2342] mb-1.5"
                >
                  Nova senha (opcional)
                </label>
                <div className="relative">
                  <input
                    id="admin-cred-new-password"
                    type={showCredNew ? 'text' : 'password'}
                    value={credNewPassword}
                    onChange={(e) => setCredNewPassword(e.target.value)}
                    placeholder="Mín. 8 caracteres (letras e números)"
                    autoComplete="new-password"
                    className="w-full min-h-[44px] pl-3.5 pr-10 py-2.5 bg-[#F8FAFC] focus:bg-white border border-[#E2E8F0] rounded-xl text-sm text-[#0F2342] focus:outline-none focus:ring-2 focus:ring-[#EA580C]/20 focus:border-[#EA580C]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCredNew((prev) => !prev)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-[#0F2342] p-1.5 cursor-pointer"
                    tabIndex={-1}
                  >
                    {showCredNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label
                  htmlFor="admin-cred-confirm-password"
                  className="block text-xs font-semibold text-[#0F2342] mb-1.5"
                >
                  Confirmar nova senha
                </label>
                <div className="relative">
                  <input
                    id="admin-cred-confirm-password"
                    type={showCredConfirm ? 'text' : 'password'}
                    value={credConfirmPassword}
                    onChange={(e) => setCredConfirmPassword(e.target.value)}
                    placeholder="Repita a nova senha"
                    autoComplete="new-password"
                    className="w-full min-h-[44px] pl-3.5 pr-10 py-2.5 bg-[#F8FAFC] focus:bg-white border border-[#E2E8F0] rounded-xl text-sm text-[#0F2342] focus:outline-none focus:ring-2 focus:ring-[#EA580C]/20 focus:border-[#EA580C]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCredConfirm((prev) => !prev)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-[#0F2342] p-1.5 cursor-pointer"
                    tabIndex={-1}
                  >
                    {showCredConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>

            <div className="pt-2 flex items-center justify-end">
              <button
                type="submit"
                disabled={isUpdatingCreds}
                className="px-5 py-2.5 min-h-[44px] bg-[#EA580C] hover:bg-[#C2410C] text-white font-bold rounded-xl text-xs transition cursor-pointer disabled:opacity-50"
              >
                {isUpdatingCreds ? 'Salvando Credenciais...' : 'Salvar Novas Credenciais'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* TAB 3: AUDIT LOGS */}
      {activeSubTab === 'auditoria' && (
        <div className="bg-white rounded-2xl border border-[#E2E8F0] p-5 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="font-extrabold text-sm text-[#0F2342]">
                Registros de Acesso e Segurança
              </h3>
              <p className="text-xs text-slate-500">
                Eventos de autenticação, cadastros, bloqueios e alterações de credenciais
              </p>
            </div>
            <span className="text-xs text-slate-500 font-medium tabular-nums">
              {accessLogs.length} eventos registrados
            </span>
          </div>

          <div className="divide-y divide-[#E2E8F0] border border-[#E2E8F0] rounded-xl overflow-hidden max-h-[560px] overflow-y-auto">
            {accessLogs.length === 0 ? (
              <div className="py-8 text-center text-slate-500 text-xs">
                Nenhum registro de acesso registrado até o momento.
              </div>
            ) : (
              accessLogs.map((log) => (
                <div
                  key={log.id}
                  className="p-3.5 hover:bg-[#F8FAFC] transition flex items-start justify-between gap-3 text-xs"
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <div
                      className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                        log.action === 'LOGIN_SUCESSO' || log.action === 'PRIMEIRO_ACESSO_ADMIN'
                          ? 'bg-emerald-50 text-emerald-700'
                          : log.action === 'SENHA_ALTERADA' || log.action === 'CREDENCIAIS_ALTERADAS'
                          ? 'bg-amber-50 text-amber-700'
                          : 'bg-rose-50 text-rose-700'
                      }`}
                    >
                      {log.action === 'LOGIN_SUCESSO' || log.action === 'PRIMEIRO_ACESSO_ADMIN' ? (
                        <CheckCircle2 className="w-4 h-4" />
                      ) : (
                        <AlertCircle className="w-4 h-4" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                        <span className="font-bold font-mono text-[#0F2342]">@{log.username}</span>
                        {log.role && (
                          <>
                            <span className="text-slate-300" aria-hidden="true">·</span>
                            <span className="text-slate-600 font-semibold">{log.role}</span>
                          </>
                        )}
                        <span className="text-slate-300" aria-hidden="true">·</span>
                        <span className="font-semibold text-[#1B365D]">{log.action}</span>
                      </div>
                      {log.details && (
                        <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">{log.details}</p>
                      )}
                    </div>
                  </div>

                  <span className="text-[11px] text-slate-500 font-mono tabular-nums shrink-0">
                    {formatDateTime(log.timestamp)}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* CREATE / EDIT STAFF MODAL */}
      {isUserModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#0F2342]/60 backdrop-blur-xs">
          <div className="w-full max-w-2xl bg-white rounded-2xl sm:rounded-3xl border border-[#E2E8F0] shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="bg-[#0F2342] text-white px-6 py-4 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <ShieldCheck className="w-5 h-5 text-[#EA580C]" />
                <h3 className="font-extrabold text-base">
                  {editingUserId ? 'Editar Funcionário' : 'Cadastrar Novo Funcionário'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsUserModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 transition cursor-pointer"
                aria-label="Fechar modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveUser} className="p-6 space-y-5 overflow-y-auto flex-1" noValidate>
              {formError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-start gap-2 font-medium">
                  <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 mt-0.5" />
                  <span>{formError}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#0F2342] mb-1.5">
                    Nome completo *
                  </label>
                  <input
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="Ex: Maria Clara Oliveira"
                    required
                    autoFocus
                    className="w-full min-h-[42px] px-3.5 py-2 bg-[#F8FAFC] focus:bg-white border border-[#E2E8F0] rounded-xl text-sm text-[#0F2342] focus:outline-none focus:ring-2 focus:ring-[#EA580C]/20 focus:border-[#EA580C]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#0F2342] mb-1.5">
                    Nome de login único *
                  </label>
                  <input
                    type="text"
                    value={formUsername}
                    onChange={(e) => setFormUsername(sanitizeUsername(e.target.value))}
                    placeholder="Ex: maria.caixa"
                    required
                    className="w-full min-h-[42px] px-3.5 py-2 bg-[#F8FAFC] focus:bg-white border border-[#E2E8F0] rounded-xl text-sm font-mono text-[#0F2342] placeholder:font-sans focus:outline-none focus:ring-2 focus:ring-[#EA580C]/20 focus:border-[#EA580C]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#0F2342] mb-1.5">
                    Número de contato *
                  </label>
                  <div className="relative">
                    <Phone className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="tel"
                      value={formPhone}
                      onChange={(e) => setFormPhone(e.target.value)}
                      placeholder="(83) 99999-9999"
                      required
                      className="w-full min-h-[42px] pl-9 pr-3.5 py-2 bg-[#F8FAFC] focus:bg-white border border-[#E2E8F0] rounded-xl text-sm font-mono tabular-nums text-[#0F2342] placeholder:font-sans focus:outline-none focus:ring-2 focus:ring-[#EA580C]/20 focus:border-[#EA580C]"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#0F2342] mb-1.5">
                    Função / Cargo *
                  </label>
                  <select
                    value={formRole}
                    onChange={(e) => handleRoleChange(e.target.value as UserRole)}
                    className="w-full min-h-[42px] px-3.5 py-2 bg-[#F8FAFC] focus:bg-white border border-[#E2E8F0] rounded-xl text-sm font-semibold text-[#0F2342] focus:outline-none focus:ring-2 focus:ring-[#EA580C]/20 focus:border-[#EA580C]"
                  >
                    <option value="ADMINISTRADOR">Administrador Geral</option>
                    <option value="GERENTE">Gerente / Supervisor</option>
                    <option value="ATENDENTE">Atendente (Balcão & Pedidos)</option>
                    <option value="CAIXA">Operador de Caixa</option>
                    <option value="COZINHA">Produção / Cozinha (KDS)</option>
                    <option value="ENTREGADOR">Entregador (Motoboy)</option>
                  </select>
                </div>

                {/* Password fields ONLY on new registration (never prefilled, no default password) */}
                {!editingUserId && (
                  <>
                    <div>
                      <label className="block text-xs font-semibold text-[#0F2342] mb-1.5">
                        Senha de acesso *
                      </label>
                      <div className="relative">
                        <input
                          type={showFormPassword ? 'text' : 'password'}
                          value={formPassword}
                          onChange={(e) => setFormPassword(e.target.value)}
                          placeholder="Mín. 8 caracteres (letras e números)"
                          autoComplete="new-password"
                          required
                          className="w-full min-h-[42px] pl-3.5 pr-10 py-2 bg-[#F8FAFC] focus:bg-white border border-[#E2E8F0] rounded-xl text-sm text-[#0F2342] focus:outline-none focus:ring-2 focus:ring-[#EA580C]/20 focus:border-[#EA580C]"
                        />
                        <button
                          type="button"
                          onClick={() => setShowFormPassword((prev) => !prev)}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-[#0F2342] p-1 cursor-pointer"
                          tabIndex={-1}
                        >
                          {showFormPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-[#0F2342] mb-1.5">
                        Confirmar senha *
                      </label>
                      <div className="relative">
                        <input
                          type={showFormConfirm ? 'text' : 'password'}
                          value={formConfirmPassword}
                          onChange={(e) => setFormConfirmPassword(e.target.value)}
                          placeholder="Repita a senha do funcionário"
                          autoComplete="new-password"
                          required
                          className="w-full min-h-[42px] pl-3.5 pr-10 py-2 bg-[#F8FAFC] focus:bg-white border border-[#E2E8F0] rounded-xl text-sm text-[#0F2342] focus:outline-none focus:ring-2 focus:ring-[#EA580C]/20 focus:border-[#EA580C]"
                        />
                        <button
                          type="button"
                          onClick={() => setShowFormConfirm((prev) => !prev)}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-[#0F2342] p-1 cursor-pointer"
                          tabIndex={-1}
                        >
                          {showFormConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* Status selector when editing */}
              {editingUserId && (
                <div className="pt-3 border-t border-[#E2E8F0]">
                  <label className="block text-xs font-semibold text-[#0F2342] mb-2">
                    Status da conta
                  </label>
                  <div className="flex flex-wrap gap-2 text-xs font-bold">
                    {(['ATIVO', 'BLOQUEADO', 'DESATIVADO'] as const).map((st) => (
                      <button
                        key={st}
                        type="button"
                        onClick={() => setFormStatus(st)}
                        className={`px-3.5 py-2 min-h-[38px] rounded-xl border transition cursor-pointer ${
                          formStatus === st
                            ? 'bg-[#0F2342] text-white border-[#0F2342]'
                            : 'bg-white text-slate-600 border-[#E2E8F0] hover:bg-[#F8FAFC]'
                        }`}
                      >
                        {st}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Modules Selection */}
              <div className="space-y-2.5 pt-3 border-t border-[#E2E8F0]">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#0F2342]">
                    Módulos autorizados
                  </span>
                  <span className="text-[11px] text-slate-500 tabular-nums">
                    {formAllowedModules.length} de {AVAILABLE_MODULES.length} selecionados
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {AVAILABLE_MODULES.map((mod) => {
                    const isRestrictedUsersMod = mod.id === 'usuarios' && formRole !== 'ADMINISTRADOR';
                    const isChecked = !isRestrictedUsersMod && formAllowedModules.includes(mod.id);
                    return (
                      <label
                        key={mod.id}
                        className={`p-2.5 rounded-xl border text-xs flex items-start gap-2.5 transition ${
                          isRestrictedUsersMod
                            ? 'bg-slate-50 border-[#E2E8F0] text-slate-400 cursor-not-allowed'
                            : isChecked
                            ? 'bg-[#EA580C]/5 border-[#EA580C] text-[#0F2342] cursor-pointer'
                            : 'bg-white border-[#E2E8F0] text-slate-600 hover:bg-[#F8FAFC] cursor-pointer'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          disabled={isRestrictedUsersMod}
                          onChange={() => toggleModule(mod.id)}
                          className="mt-0.5 w-4 h-4 rounded accent-[#EA580C]"
                        />
                        <div>
                          <p className="font-semibold">{mod.label}</p>
                          <p className="text-[11px] text-slate-500 leading-tight mt-0.5">{mod.desc}</p>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* 7 Granular Delivery Permissions */}
              <div className="space-y-2.5 pt-3 border-t border-[#E2E8F0]">
                <div className="flex items-center gap-2">
                  <Bike className="w-4 h-4 text-[#EA580C]" />
                  <span className="text-xs font-bold text-[#0F2342]">
                    Permissões de Gestão de Entregas (Movimento Diário)
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Controla de forma granular quem pode acompanhar rotas, atribuir entregas e gerenciar turnos diários.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {DELIVERY_PERMISSION_ITEMS.map((perm) => {
                    const isChecked = Boolean(formDeliveryPermissions[perm.key]);
                    return (
                      <label
                        key={perm.key}
                        className={`p-2.5 rounded-xl border text-xs cursor-pointer flex items-start gap-2.5 transition ${
                          isChecked
                            ? 'bg-[#EA580C]/5 border-[#EA580C] text-[#0F2342]'
                            : 'bg-white border-[#E2E8F0] text-slate-600 hover:bg-[#F8FAFC]'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            setFormDeliveryPermissions((prev: DeliveryPermissions) => ({
                              ...prev,
                              [perm.key]: e.target.checked,
                            }));
                          }}
                          className="mt-0.5 w-4 h-4 rounded accent-[#EA580C]"
                        />
                        <div>
                          <p className="font-semibold">{perm.label}</p>
                          <p className="text-[11px] text-slate-500 leading-tight mt-0.5">{perm.desc}</p>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Modal Actions */}
              <div className="pt-4 border-t border-[#E2E8F0] flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsUserModalOpen(false)}
                  disabled={isSavingUser}
                  className="px-4 py-2 min-h-[42px] bg-[#F8FAFC] hover:bg-slate-100 text-[#0F2342] font-semibold rounded-xl text-xs border border-[#E2E8F0] cursor-pointer disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSavingUser}
                  className="px-5 py-2 min-h-[42px] bg-[#EA580C] hover:bg-[#C2410C] text-white font-bold rounded-xl text-xs transition cursor-pointer disabled:opacity-50"
                >
                  {isSavingUser
                    ? 'Salvando...'
                    : editingUserId
                    ? 'Salvar Alterações'
                    : 'Concluir Cadastro'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* PASSWORD RESET MODAL */}
      {resetModalUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#0F2342]/60 backdrop-blur-xs">
          <div className="w-full max-w-sm bg-white rounded-2xl border border-[#E2E8F0] shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#0F2342] text-white flex items-center justify-center shrink-0">
                  <KeyRound className="w-5 h-5 text-[#EA580C]" />
                </div>
                <div>
                  <h3 className="font-extrabold text-sm text-[#0F2342]">Redefinir Senha</h3>
                  <p className="text-xs text-slate-500">
                    {resetModalUser.name} · @{resetModalUser.username}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setResetModalUser(null)}
                className="p-1 text-slate-400 hover:text-[#0F2342] cursor-pointer"
                aria-label="Fechar modal de senha"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {resetSuccessNotice ? (
              <div className="p-3.5 bg-emerald-50 text-emerald-900 border border-emerald-200 rounded-xl text-xs font-semibold text-center">
                {resetSuccessNotice}
              </div>
            ) : (
              <form onSubmit={handleSaveResetPassword} className="space-y-3.5" noValidate>
                {resetError && (
                  <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-start gap-2 font-medium">
                    <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 mt-0.5" />
                    <span>{resetError}</span>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-semibold text-[#0F2342] mb-1.5">
                    Nova senha
                  </label>
                  <div className="relative">
                    <input
                      type={showResetPassword ? 'text' : 'password'}
                      value={newPasswordInput}
                      onChange={(e) => setNewPasswordInput(e.target.value)}
                      placeholder="Mín. 8 caracteres (letras e números)"
                      autoComplete="new-password"
                      autoFocus
                      required
                      className="w-full min-h-[42px] pl-3.5 pr-10 py-2 bg-[#F8FAFC] focus:bg-white border border-[#E2E8F0] rounded-xl text-sm text-[#0F2342] focus:outline-none focus:ring-2 focus:ring-[#EA580C]/20 focus:border-[#EA580C]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowResetPassword((prev) => !prev)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-[#0F2342] p-1 cursor-pointer"
                      tabIndex={-1}
                    >
                      {showResetPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#0F2342] mb-1.5">
                    Confirmar nova senha
                  </label>
                  <input
                    type={showResetPassword ? 'text' : 'password'}
                    value={confirmNewPasswordInput}
                    onChange={(e) => setConfirmNewPasswordInput(e.target.value)}
                    placeholder="Repita a nova senha"
                    autoComplete="new-password"
                    required
                    className="w-full min-h-[42px] px-3.5 py-2 bg-[#F8FAFC] focus:bg-white border border-[#E2E8F0] rounded-xl text-sm text-[#0F2342] focus:outline-none focus:ring-2 focus:ring-[#EA580C]/20 focus:border-[#EA580C]"
                  />
                </div>

                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setResetModalUser(null)}
                    disabled={isResettingPassword}
                    className="flex-1 min-h-[40px] py-2 bg-[#F8FAFC] text-[#0F2342] font-semibold rounded-xl text-xs border border-[#E2E8F0] cursor-pointer disabled:opacity-50"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={isResettingPassword}
                    className="flex-1 min-h-[40px] py-2 bg-[#EA580C] hover:bg-[#C2410C] text-white font-bold rounded-xl text-xs transition cursor-pointer disabled:opacity-50"
                  >
                    {isResettingPassword ? 'Salvando...' : 'Salvar Nova Senha'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* DELETE CONFIRM MODAL */}
      <ConfirmModal
        isOpen={Boolean(userToDelete)}
        title="Remover Funcionário"
        message={`Deseja realmente remover ${userToDelete?.name || userToDelete?.username}? O acesso ao sistema será revogado imediatamente no servidor.`}
        confirmLabel={isDeletingUser ? 'Removendo...' : 'Sim, Remover'}
        cancelLabel="Cancelar"
        isDanger={true}
        onConfirm={() => void executeDeleteUser()}
        onCancel={() => {
          if (!isDeletingUser) setUserToDelete(null);
        }}
      />
    </div>
  );
};
