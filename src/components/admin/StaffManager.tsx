import React, { useState } from 'react';
import { store } from '../../services/store';
import { User, UserRole, UserStatus, AppModule, UserAccessLog } from '../../types';
import { formatDateTime } from '../../utils/formatters';
import { 
  Users, 
  UserPlus, 
  ShieldCheck, 
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
  Store, 
  ShoppingBag, 
  ChefHat, 
  Bike, 
  BarChart3, 
  Settings, 
  QrCode, 
  FileText,
  Search,
  X
} from 'lucide-react';
import { ConfirmModal } from '../common/ConfirmModal';

const AVAILABLE_MODULES: { id: AppModule; label: string; desc: string }[] = [
  { id: 'pdv', label: 'PDV / Frente de Caixa', desc: 'Registro de vendas, comandas no balcão e cupons' },
  { id: 'kanban', label: 'Gestão de Pedidos (Kanban)', desc: 'Visualização e avanço de pedidos em tempo real' },
  { id: 'kds', label: 'Cozinha (KDS)', desc: 'Fila de preparação de lanches e pratos' },
  { id: 'caixa', label: 'Controle de Caixa', desc: 'Abertura, fechamento, sangrias, suprimentos e vales' },
  { id: 'entregas', label: 'Área do Entregador', desc: 'Despacho e confirmação de rotas com motoboys' },
  { id: 'relatorios', label: 'Relatórios Financeiros & DRE', desc: 'Vendas por período, faturamento e lucro' },
  { id: 'menu', label: 'Gestão do Cardápio', desc: 'Edição de produtos, preços, fotos e categorias' },
  { id: 'usuarios', label: 'Equipe & Permissões', desc: 'Cadastro de funcionários e controle de acessos' },
  { id: 'configuracoes', label: 'Configurações da Loja & PIX', desc: 'Horários, dados do restaurante e chave PIX' },
  { id: 'qrcodes', label: 'QR Codes & Links Públicos', desc: 'Links do cardápio WhatsApp e entregador' },
  { id: 'auditoria', label: 'Auditoria & Logs', desc: 'Histórico de movimentações de pedidos e caixa' },
];

export const StaffManager: React.FC = () => {
  const [activeSubTab, setActiveSubTab] = useState<'funcionarios' | 'auditoria'>('funcionarios');
  const [users, setUsers] = useState<User[]>(() => store.getUsers());
  const [accessLogs, setAccessLogs] = useState<UserAccessLog[]>(() => store.getAccessLogs());

  // Current logged in actor
  const currentActor = store.getCurrentUser();
  const isActorAdmin = currentActor?.role === 'ADMINISTRADOR';
  const isActorGerente = currentActor?.role === 'GERENTE';

  // Search filter
  const [searchQuery, setSearchQuery] = useState('');

  // New / Edit User Modal
  const [isUserModalOpen, setIsUserModalOpen] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [formName, setFormName] = useState('');
  const [formUsername, setFormUsername] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formPassword, setFormPassword] = useState('123456');
  const [formRole, setFormRole] = useState<UserRole>('CAIXA');
  const [formStatus, setFormStatus] = useState<UserStatus>('ATIVO');
  const [formAllowedModules, setFormAllowedModules] = useState<AppModule[]>(['pdv', 'kanban', 'caixa']);
  const [formError, setFormError] = useState<string | null>(null);

  // Password reset modal
  const [resetModalUser, setResetModalUser] = useState<User | null>(null);
  const [newPasswordInput, setNewPasswordInput] = useState('');
  const [resetSuccessNotice, setResetSuccessNotice] = useState<string | null>(null);

  // Delete modal
  const [userToDelete, setUserToDelete] = useState<User | null>(null);

  const reloadData = () => {
    setUsers(store.getUsers());
    setAccessLogs(store.getAccessLogs());
  };

  const handleRoleChange = (role: UserRole) => {
    if (!isActorAdmin && role === 'ADMINISTRADOR') return;
    setFormRole(role);
    // Apply smart preset modules based on chosen role
    if (role === 'ADMINISTRADOR') {
      setFormAllowedModules(AVAILABLE_MODULES.map((m) => m.id));
    } else if (role === 'GERENTE') {
      setFormAllowedModules(['pdv', 'kanban', 'kds', 'caixa', 'relatorios', 'menu', 'qrcodes', 'auditoria']);
    } else if (role === 'CAIXA') {
      setFormAllowedModules(['pdv', 'kanban', 'caixa']);
    } else if (role === 'COZINHA') {
      setFormAllowedModules(['kds']);
    } else if (role === 'ENTREGADOR') {
      setFormAllowedModules(['entregas']);
    }
  };

  const toggleModule = (modId: AppModule) => {
    if (isActorGerente && modId === 'usuarios') return;
    if (formAllowedModules.includes(modId)) {
      setFormAllowedModules(formAllowedModules.filter((m) => m !== modId));
    } else {
      setFormAllowedModules([...formAllowedModules, modId]);
    }
  };

  const handleOpenNewUser = () => {
    setEditingUserId(null);
    setFormName('');
    setFormUsername('');
    setFormEmail('');
    setFormPhone('');
    setFormPassword('123456');
    setFormRole('CAIXA');
    setFormStatus('ATIVO');
    setFormAllowedModules(['pdv', 'kanban', 'caixa']);
    setFormError(null);
    setIsUserModalOpen(true);
  };

  const handleOpenEditUser = (user: User) => {
    if (isActorGerente && user.role === 'ADMINISTRADOR') return;
    setEditingUserId(user.id);
    setFormName(user.name || '');
    setFormUsername(user.username);
    setFormEmail(user.email);
    setFormPhone(user.phone || '');
    setFormPassword(store.getUserPassword(user.id));
    setFormRole(user.role);
    setFormStatus(user.status || 'ATIVO');
    setFormAllowedModules(user.allowedModules || ['pdv', 'kanban']);
    setFormError(null);
    setIsUserModalOpen(true);
  };

  const handleSaveUser = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const cleanUser = formUsername.trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '');
    const cleanName = formName.trim() || cleanUser;

    if (!cleanUser) {
      setFormError('Por favor, informe o nome ou nome de usuário do colaborador.');
      return;
    }

    if (formAllowedModules.length === 0) {
      setFormError('Selecione ao menos um módulo permitido para o colaborador.');
      return;
    }

    const resolvedEmail = formEmail.trim() || `${cleanUser}@staff.amanditasabores.com.br`;

    if (editingUserId) {
      // Update existing
      const res = store.updateUser(editingUserId, {
        name: cleanName,
        username: cleanUser,
        email: resolvedEmail,
        phone: formPhone.trim() || undefined,
        role: formRole,
        status: formStatus,
        allowedModules: formAllowedModules,
      });

      if (formPassword && formPassword.trim().length >= 4) {
        store.resetUserPassword(editingUserId, formPassword.trim());
      }

      if (res.success) {
        setIsUserModalOpen(false);
        reloadData();
      } else {
        setFormError(res.message);
      }
    } else {
      // Create new
      const res = store.createUser(
        {
          name: cleanName,
          username: cleanUser,
          email: resolvedEmail,
          phone: formPhone.trim() || undefined,
          role: formRole,
          status: formStatus,
          allowedModules: formAllowedModules,
          isEmailVerified: true,
        },
        formPassword || '123456'
      );

      if (res.success) {
        setIsUserModalOpen(false);
        reloadData();
      } else {
        setFormError(res.message);
      }
    }
  };

  const handleToggleStatus = (user: User) => {
    if (user.username === 'admin' || user.role === 'ADMINISTRADOR') return;
    const nextStatus: UserStatus = user.status === 'ATIVO' ? 'BLOQUEADO' : 'ATIVO';
    store.updateUser(user.id, { status: nextStatus });
    reloadData();
  };

  const handleOpenResetPassword = (user: User) => {
    if (isActorGerente && (user.role === 'ADMINISTRADOR' || user.username === 'admin')) return;
    setResetModalUser(user);
    setNewPasswordInput('');
    setResetSuccessNotice(null);
  };

  const handleSaveResetPassword = () => {
    if (!resetModalUser || !newPasswordInput.trim()) return;
    const res = store.resetUserPassword(resetModalUser.id, newPasswordInput.trim());
    if (res.success) {
      setResetSuccessNotice(`Senha de ${resetModalUser.name || resetModalUser.username} alterada com sucesso!`);
      setTimeout(() => {
        setResetModalUser(null);
        setResetSuccessNotice(null);
      }, 1500);
      reloadData();
    }
  };

  const executeDeleteUser = () => {
    if (!userToDelete) return;
    store.deleteUser(userToDelete.id);
    setUserToDelete(null);
    reloadData();
  };

  // Filtered users
  const filteredUsers = users.filter((u) => {
    const q = searchQuery.toLowerCase();
    const nameMatch = (u.name || '').toLowerCase().includes(q);
    const userMatch = u.username.toLowerCase().includes(q);
    const emailMatch = u.email.toLowerCase().includes(q);
    const roleMatch = u.role.toLowerCase().includes(q);
    return nameMatch || userMatch || emailMatch || roleMatch;
  });

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Top Banner */}
      <div className="bg-[#FFFDF9] rounded-2xl p-6 border border-[#E8DFD5] shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-[#C86D3B]/10 text-[#C86D3B] flex items-center justify-center font-bold text-xl border border-[#C86D3B]/20">
            <ShieldCheck className="w-6 h-6 text-[#C86D3B]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-black text-[#2C1810]">Equipe, Usuários & Permissões</h2>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[#C86D3B]/15 text-[#C86D3B] border border-[#C86D3B]/25">
                EXCLUSIVO ADMINISTRADOR
              </span>
            </div>
            <p className="text-xs text-[#8C5E47] mt-0.5">
              Cadastre novos colaboradores, configure senhas e controle exatamente quais módulos cada funcionário pode acessar.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Subtab toggle */}
          <div className="flex p-1 bg-[#F5EFEB] rounded-xl border border-[#E8DFD5] text-xs font-bold">
            <button
              onClick={() => setActiveSubTab('funcionarios')}
              className={`px-3 py-1.5 rounded-lg transition flex items-center gap-1.5 ${
                activeSubTab === 'funcionarios'
                  ? 'bg-gradient-to-r from-[#C86D3B] to-[#721C24] text-white shadow-xs'
                  : 'text-[#6B4B3E] hover:text-[#2C1810]'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>Colaboradores ({users.length})</span>
            </button>
            <button
              onClick={() => setActiveSubTab('auditoria')}
              className={`px-3 py-1.5 rounded-lg transition flex items-center gap-1.5 ${
                activeSubTab === 'auditoria'
                  ? 'bg-gradient-to-r from-[#C86D3B] to-[#721C24] text-white shadow-xs'
                  : 'text-[#6B4B3E] hover:text-[#2C1810]'
              }`}
            >
              <History className="w-3.5 h-3.5" />
              <span>Auditoria de Acessos ({accessLogs.length})</span>
            </button>
          </div>

          <button
            onClick={handleOpenNewUser}
            className="px-4 py-2 bg-gradient-to-r from-[#C86D3B] via-[#B85D2A] to-[#721C24] hover:opacity-95 text-white font-bold rounded-xl text-xs flex items-center gap-2 shadow-xs transition cursor-pointer"
          >
            <UserPlus className="w-4 h-4" />
            <span>Cadastrar Funcionário</span>
          </button>
        </div>
      </div>

      {activeSubTab === 'funcionarios' ? (
        /* STAFF LIST VIEW */
        <div className="space-y-4">
          {/* Search bar */}
          <div className="bg-[#FFFDF9] rounded-2xl p-4 border border-[#E8DFD5] shadow-xs flex items-center justify-between gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-[#8C5E47] absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filtrar por nome, usuário, função ou e-mail..."
                className="w-full pl-10 pr-4 py-2 bg-[#FAF7F2] border border-[#E8DFD5] rounded-xl text-xs text-[#2C1810] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#C86D3B]/40"
              />
            </div>
            <div className="text-xs text-[#8C5E47] font-semibold">
              Mostrando {filteredUsers.length} de {users.length} funcionários
            </div>
          </div>

          {/* Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredUsers.map((user) => {
              const isAdmin = user.username === 'admin' || user.role === 'ADMINISTRADOR';
              const isBlocked = user.status === 'BLOQUEADO';
              const currentPass = store.getUserPassword(user.id);

              return (
                <div
                  key={user.id}
                  className={`bg-[#FFFDF9] rounded-2xl border p-5 shadow-xs transition space-y-4 ${
                    isBlocked
                      ? 'border-rose-200 bg-rose-50/20'
                      : 'border-[#E8DFD5] hover:border-[#C86D3B]/60'
                  }`}
                >
                  {/* Top user row */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className={`w-12 h-12 rounded-2xl flex items-center justify-center font-black text-lg ${
                        isAdmin
                          ? 'bg-[#C86D3B]/15 text-[#C86D3B]'
                          : user.role === 'CAIXA'
                          ? 'bg-emerald-100 text-emerald-800'
                          : user.role === 'COZINHA'
                          ? 'bg-amber-100 text-amber-800'
                          : user.role === 'ENTREGADOR'
                          ? 'bg-indigo-100 text-indigo-800'
                          : 'bg-purple-100 text-purple-800'
                      }`}>
                        {user.name ? user.name[0].toUpperCase() : user.username[0].toUpperCase()}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-extrabold text-sm text-[#2C1810]">
                            {user.name || user.username}
                          </h3>
                          <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase ${
                            isBlocked
                              ? 'bg-rose-100 text-rose-700'
                              : 'bg-emerald-100 text-emerald-800'
                          }`}>
                            {user.status || 'ATIVO'}
                          </span>
                        </div>
                        <p className="text-xs text-[#8C5E47] flex items-center gap-2 mt-0.5">
                          <span>Login: <strong className="text-[#2C1810]">@{user.username}</strong></span>
                          <span>·</span>
                          <span>{user.email}</span>
                        </p>
                      </div>
                    </div>

                    <span className="px-2.5 py-1 rounded-xl text-[10px] font-black uppercase tracking-wider bg-[#F7F2EA] text-[#3D2314] border border-[#E8DFD5]">
                      {user.role}
                    </span>
                  </div>

                  {/* Modules Permissions Badges */}
                  <div className="pt-2 border-t border-[#E8DFD5]/60">
                    <span className="text-[10px] font-bold text-[#6B4B3E] uppercase tracking-wider block mb-1.5">
                      Módulos com Acesso Liberado:
                    </span>
                    <div className="flex flex-wrap gap-1">
                      {user.allowedModules && user.allowedModules.length > 0 ? (
                        user.allowedModules.map((mId) => {
                          const modInfo = AVAILABLE_MODULES.find((m) => m.id === mId);
                          return (
                            <span
                              key={mId}
                              className="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-[#FAF7F2] text-[#3D2314] border border-[#E8DFD5]"
                            >
                              {modInfo?.label || mId}
                            </span>
                          );
                        })
                      ) : (
                        <span className="text-xs text-rose-600 font-medium">Nenhum módulo autorizado</span>
                      )}
                    </div>
                  </div>

                  {/* Actions Bar */}
                  <div className="pt-3 border-t border-[#E8DFD5] flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2 text-[11px] text-[#8C5E47]">
                      <Lock className="w-3.5 h-3.5 text-[#C86D3B]" />
                      <span>Senha: <strong className="text-[#2C1810] font-mono">{currentPass}</strong></span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      {isActorAdmin || (!isAdmin && isActorGerente) ? (
                        <>
                          <button
                            type="button"
                            onClick={() => handleOpenResetPassword(user)}
                            className="px-2.5 py-1.5 bg-[#FAF7F2] hover:bg-[#EFE6DC] text-[#3D2314] font-semibold rounded-lg border border-[#E8DFD5] transition flex items-center gap-1 cursor-pointer"
                            title="Redefinir senha do funcionário"
                          >
                            <KeyRound className="w-3.5 h-3.5 text-[#C86D3B]" />
                            <span>Senha</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleOpenEditUser(user)}
                            className="px-2.5 py-1.5 bg-[#FAF7F2] hover:bg-[#EFE6DC] text-[#3D2314] font-semibold rounded-lg border border-[#E8DFD5] transition flex items-center gap-1 cursor-pointer"
                            title="Editar dados e permissões"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            <span>Editar</span>
                          </button>

                          {!isAdmin && (
                            <button
                              type="button"
                              onClick={() => handleToggleStatus(user)}
                              className={`p-1.5 rounded-lg border transition cursor-pointer ${
                                isBlocked
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                                  : 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100'
                              }`}
                              title={isBlocked ? 'Desbloquear conta' : 'Bloquear acesso do funcionário'}
                            >
                              {isBlocked ? <Check className="w-3.5 h-3.5" /> : <Ban className="w-3.5 h-3.5" />}
                            </button>
                          )}

                          {!isAdmin && isActorAdmin && (
                            <button
                              type="button"
                              onClick={() => setUserToDelete(user)}
                              className="p-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 transition cursor-pointer"
                              title="Excluir funcionário"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </>
                      ) : (
                        <span className="text-[10px] text-[#8C5E47] font-semibold px-2 py-1 bg-[#FAF7F2] rounded-md border border-[#E8DFD5]">
                          Protegido
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        /* AUDIT ACCESS LOGS VIEW */
        <div className="bg-[#FFFDF9] rounded-2xl border border-[#E8DFD5] shadow-xs p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-black text-sm text-[#2C1810]">Registros de Acesso e Segurança</h3>
              <p className="text-xs text-[#8C5E47]">Eventos de login, alteração de senhas e bloqueios</p>
            </div>
            <span className="text-xs text-[#8C5E47] font-semibold">
              Últimos {accessLogs.length} eventos registrados
            </span>
          </div>

          <div className="divide-y divide-[#E8DFD5] border border-[#E8DFD5] rounded-xl overflow-hidden max-h-[600px] overflow-y-auto">
            {accessLogs.length === 0 ? (
              <div className="py-8 text-center text-[#8C5E47] text-xs">
                Nenhum registro de acesso registrado até o momento.
              </div>
            ) : (
              accessLogs.map((log) => (
                <div key={log.id} className="p-3.5 hover:bg-[#FAF7F2] transition flex items-start justify-between gap-3 text-xs">
                  <div className="flex items-start gap-3">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                      log.action === 'LOGIN_SUCESSO'
                        ? 'bg-emerald-100 text-emerald-800'
                        : log.action === 'SENHA_ALTERADA'
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-rose-100 text-rose-800'
                    }`}>
                      {log.action === 'LOGIN_SUCESSO' ? (
                        <CheckCircle2 className="w-4 h-4" />
                      ) : (
                        <AlertCircle className="w-4 h-4" />
                      )}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-extrabold text-[#2C1810]">@{log.username}</span>
                        {log.role && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-[#F7F2EA] text-[#3D2314]">
                            {log.role}
                          </span>
                        )}
                        <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase ${
                          log.action === 'LOGIN_SUCESSO'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-rose-100 text-rose-800'
                        }`}>
                          {log.action}
                        </span>
                      </div>
                      <p className="text-xs text-[#6B4B3E] mt-0.5">{log.details}</p>
                    </div>
                  </div>

                  <span className="text-[11px] text-[#8C5E47] font-mono shrink-0">
                    {formatDateTime(log.timestamp)}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* CREATE / EDIT USER MODAL */}
      {isUserModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#2C1810]/70 backdrop-blur-xs animate-in fade-in">
          <div className="w-full max-w-xl bg-[#FFFDF9] rounded-3xl border border-[#E8DFD5] shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="bg-[#2C1810] text-white p-5 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <ShieldCheck className="w-5 h-5 text-[#C86D3B]" />
                <h3 className="font-black text-base">
                  {editingUserId ? 'Editar Cadastro do Colaborador' : 'Novo Cadastro de Funcionário'}
                </h3>
              </div>
              <button
                onClick={() => setIsUserModalOpen(false)}
                className="p-1 text-[#D9C7B8] hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveUser} className="p-6 space-y-4 overflow-y-auto flex-1">
              {formError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-center gap-2 font-medium">
                  <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                  <span>{formError}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-[#3D2314] uppercase mb-1">
                    Nome Completo ou Apelido
                  </label>
                  <input
                    type="text"
                    value={formName}
                    onChange={(e) => {
                      const val = e.target.value;
                      setFormName(val);
                      if (!editingUserId && (!formUsername || formUsername === formName.toLowerCase().replace(/[^a-z0-9]/g, ''))) {
                        setFormUsername(val.toLowerCase().trim().replace(/[^a-z0-9_.-]/g, ''));
                      }
                    }}
                    placeholder="Ex: Carlos Mendes"
                    className="w-full px-3 py-2 bg-white border border-[#E8DFD5] rounded-xl text-xs text-[#2C1810]"
                    autoFocus
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#3D2314] uppercase mb-1">
                    Nome de Usuário (Login) *
                  </label>
                  <input
                    type="text"
                    value={formUsername}
                    onChange={(e) => setFormUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_.-]/g, ''))}
                    placeholder="Ex: carlos, maria, caixa"
                    className="w-full px-3 py-2 bg-white border border-[#E8DFD5] rounded-xl text-xs font-mono text-[#2C1810]"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#3D2314] uppercase mb-1">
                    Função / Cargo *
                  </label>
                  <select
                    value={formRole}
                    onChange={(e) => handleRoleChange(e.target.value as UserRole)}
                    className="w-full px-3 py-2 bg-white border border-[#E8DFD5] rounded-xl text-xs font-bold text-[#2C1810]"
                  >
                    {isActorAdmin && <option value="ADMINISTRADOR">Administrador Geral</option>}
                    <option value="GERENTE">Gerente / Supervisor</option>
                    <option value="CAIXA">Caixa / Atendente</option>
                    <option value="COZINHA">Produção / Cozinha (KDS)</option>
                    <option value="ENTREGADOR">Entregador (Motoboy)</option>
                  </select>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-bold text-[#3D2314] uppercase">
                      Senha de Acesso
                    </label>
                    <span className="text-[10px] text-[#8C5E47]">Padrão: 123456</span>
                  </div>
                  <input
                    type="text"
                    value={formPassword}
                    onChange={(e) => setFormPassword(e.target.value)}
                    placeholder="Mínimo 4 caracteres (Ex: 123456)"
                    className="w-full px-3 py-2 bg-white border border-[#E8DFD5] rounded-xl text-xs font-mono text-[#2C1810]"
                  />
                </div>

              </div>

              {/* Status (shown when editing or creating) */}
              {editingUserId && (
                <div className="pt-2 border-t border-[#E8DFD5]/60">
                  <label className="block text-xs font-bold text-[#3D2314] uppercase mb-1.5">
                    Status da Conta
                  </label>
                  <div className="flex gap-2 text-xs font-bold">
                    {(['ATIVO', 'BLOQUEADO', 'DESATIVADO'] as const).map((st) => (
                      <button
                        key={st}
                        type="button"
                        onClick={() => setFormStatus(st)}
                        className={`px-3 py-1.5 rounded-xl border transition cursor-pointer ${
                          formStatus === st
                            ? 'bg-[#3D2314] text-white border-[#3D2314]'
                            : 'bg-white text-slate-600 border-[#E8DFD5] hover:bg-[#FAF7F2]'
                        }`}
                      >
                        {st}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Modules selection checkboxes */}
              <div className="space-y-2 pt-2 border-t border-[#E8DFD5]">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-bold text-[#3D2314] uppercase">
                    Módulos Liberados para este Colaborador:
                  </label>
                  <span className="text-[11px] text-[#8C5E47]">
                    {formAllowedModules.length} de {AVAILABLE_MODULES.length} selecionados
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {AVAILABLE_MODULES.map((mod) => {
                    const isChecked = formAllowedModules.includes(mod.id);
                    return (
                      <label
                        key={mod.id}
                        className={`p-2.5 rounded-xl border text-xs cursor-pointer flex items-start gap-2.5 transition ${
                          isChecked
                            ? 'bg-[#C86D3B]/10 border-[#C86D3B] text-[#2C1810]'
                            : 'bg-white border-[#E8DFD5] text-slate-600 hover:bg-[#FAF7F2]'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleModule(mod.id)}
                          className="mt-0.5 w-4 h-4 rounded text-[#C86D3B] focus:ring-[#C86D3B]"
                        />
                        <div>
                          <p className="font-bold">{mod.label}</p>
                          <p className="text-[10px] text-slate-500 leading-tight mt-0.5">{mod.desc}</p>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Actions */}
              <div className="pt-4 border-t border-[#E8DFD5] flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsUserModalOpen(false)}
                  className="px-4 py-2 bg-[#FAF7F2] text-[#3D2314] font-bold rounded-xl text-xs border border-[#E8DFD5]"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-gradient-to-r from-[#C86D3B] to-[#721C24] text-white font-bold rounded-xl text-xs shadow-xs"
                >
                  {editingUserId ? 'Salvar Alterações' : 'Concluir Cadastro'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* PASSWORD RESET MODAL */}
      {resetModalUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#2C1810]/70 backdrop-blur-xs animate-in fade-in">
          <div className="w-full max-w-sm bg-[#FFFDF9] rounded-3xl border border-[#E8DFD5] shadow-2xl p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center shrink-0">
                <KeyRound className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-black text-sm text-[#2C1810]">Redefinir Senha</h3>
                <p className="text-xs text-[#8C5E47]">{resetModalUser.name || resetModalUser.username}</p>
              </div>
            </div>

            {resetSuccessNotice ? (
              <div className="p-3 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-xl text-xs font-bold text-center">
                {resetSuccessNotice}
              </div>
            ) : (
              <>
                <div>
                  <label className="block text-xs font-bold text-[#3D2314] mb-1">
                    Nova Senha Inicial
                  </label>
                  <input
                    type="text"
                    value={newPasswordInput}
                    onChange={(e) => setNewPasswordInput(e.target.value)}
                    placeholder="Digite a nova senha..."
                    className="w-full px-3 py-2 bg-white border border-[#E8DFD5] rounded-xl text-xs font-mono font-bold text-[#2C1810]"
                    autoFocus
                  />
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setResetModalUser(null)}
                    className="flex-1 py-2 bg-[#FAF7F2] text-[#3D2314] font-bold rounded-xl text-xs border border-[#E8DFD5]"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveResetPassword}
                    className="flex-1 py-2 bg-gradient-to-r from-[#C86D3B] to-[#721C24] text-white font-bold rounded-xl text-xs"
                  >
                    Salvar Nova Senha
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* DELETE CONFIRM MODAL */}
      <ConfirmModal
        isOpen={!!userToDelete}
        title="Remover Colaborador"
        message={`Deseja realmente remover o colaborador ${userToDelete?.name || userToDelete?.username}? O acesso dele ao sistema será revogado imediatamente.`}
        confirmLabel="Sim, Remover"
        cancelLabel="Voltar"
        isDanger={true}
        onConfirm={executeDeleteUser}
        onCancel={() => setUserToDelete(null)}
      />
    </div>
  );
};
