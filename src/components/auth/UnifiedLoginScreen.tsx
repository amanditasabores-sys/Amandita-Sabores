import React, { useEffect, useState } from 'react';
import { store } from '../../services/store';
import { AuthBootstrapStatus, User } from '../../types';
import { AmanditaLogo } from '../common/AmanditaLogo';
import {
  User as UserIcon,
  Lock,
  Eye,
  EyeOff,
  AlertCircle,
  CheckCircle2,
  LogIn,
  UtensilsCrossed,
  ShieldCheck,
  Phone,
  RefreshCw,
  UserCheck,
} from 'lucide-react';

interface UnifiedLoginScreenProps {
  onLoginSuccess: (user: User) => void;
  onNavigateToCustomerMenu: () => void;
  initialNotice?: string | null;
}

type ScreenMode = 'checking' | 'setup_required' | 'login';

const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,31}$/;

function sanitizeUsernameInput(raw: string): string {
  return raw.toLowerCase().replace(/\s+/g, '');
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

export const UnifiedLoginScreen: React.FC<UnifiedLoginScreenProps> = ({
  onLoginSuccess,
  onNavigateToCustomerMenu,
  initialNotice,
}) => {
  const [screenMode, setScreenMode] = useState<ScreenMode>('checking');
  const [bootstrapUnavailableMsg, setBootstrapUnavailableMsg] = useState<string | null>(null);
  const [isCheckingStatus, setIsCheckingStatus] = useState(true);

  // Normal Login State
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // First-Access Admin Setup State
  const [setupName, setSetupName] = useState('');
  const [setupUsername, setSetupUsername] = useState('');
  const [setupPhone, setSetupPhone] = useState('');
  const [setupPassword, setSetupPassword] = useState('');
  const [setupConfirmPassword, setSetupConfirmPassword] = useState('');
  const [showSetupPassword, setShowSetupPassword] = useState(false);
  const [showSetupConfirm, setShowSetupConfirm] = useState(false);

  // Feedback State
  const [errorMessage, setErrorMessage] = useState<string | null>(initialNotice || null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const checkBootstrapStatus = async () => {
    setIsCheckingStatus(true);
    setBootstrapUnavailableMsg(null);
    try {
      const status: AuthBootstrapStatus = await store.getAuthBootstrapStatus();
      if (status.mode === 'setup_required' && status.initialized === false) {
        setScreenMode('setup_required');
      } else if (status.mode === 'unavailable') {
        // Fail-closed: never expose initial setup when status cannot be confirmed by server
        setScreenMode('login');
        setBootstrapUnavailableMsg(
          status.message ||
            'Não foi possível confirmar o status do serviço de autenticação no momento. Tente novamente em instantes.'
        );
      } else {
        setScreenMode('login');
      }
    } catch {
      setScreenMode('login');
      setBootstrapUnavailableMsg(
        'Serviço de autenticação temporariamente indisponível. Verifique sua conexão e tente novamente.'
      );
    } finally {
      setIsCheckingStatus(false);
    }
  };

  useEffect(() => {
    void checkBootstrapStatus();
  }, []);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    const cleanUsername = username.trim().toLowerCase();
    const rawPassword = password;

    if (!cleanUsername || !rawPassword.trim()) {
      setErrorMessage('Informe seu nome de login e sua senha de acesso.');
      return;
    }

    if (cleanUsername.includes('@')) {
      setErrorMessage('Utilize seu nome de login cadastrado (não utilize endereço de e-mail).');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await store.login(cleanUsername, rawPassword);
      setIsSubmitting(false);

      if (res.success && res.user) {
        try {
          localStorage.removeItem('gf_delivery_user');
        } catch {
          // ignore storage restrictions
        }
        setPassword('');
        onLoginSuccess(res.user);
      } else {
        setErrorMessage(
          res.message || 'Credenciais inválidas. Verifique seu nome de login e sua senha.'
        );
      }
    } catch {
      setIsSubmitting(false);
      setErrorMessage('Falha temporária de comunicação com o servidor. Tente novamente em instantes.');
    }
  };

  const handleBootstrapSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    const cleanName = setupName.trim();
    const cleanUsername = sanitizeUsernameInput(setupUsername.trim());
    const cleanPhone = setupPhone.trim();
    const digitsPhone = cleanPhone.replace(/\D/g, '');

    if (cleanName.length < 3) {
      setErrorMessage('Informe o nome completo do administrador (mínimo 3 caracteres).');
      return;
    }

    if (cleanUsername.includes('@')) {
      setErrorMessage('O nome de login não pode ser um endereço de e-mail.');
      return;
    }

    if (!USERNAME_PATTERN.test(cleanUsername)) {
      setErrorMessage(
        'Nome de login inválido: use de 3 a 32 caracteres (letras minúsculas, números, ponto, hífen ou sublinhado).'
      );
      return;
    }

    if (digitsPhone.length < 10 || digitsPhone.length > 15) {
      setErrorMessage('Informe um número de contato válido com DDD (10 a 15 dígitos).');
      return;
    }

    const pwError = validatePasswordClient(setupPassword);
    if (pwError) {
      setErrorMessage(pwError);
      return;
    }

    if (setupPassword !== setupConfirmPassword) {
      setErrorMessage('A confirmação de senha não confere com a senha informada.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await store.bootstrapInitialAdmin({
        name: cleanName,
        username: cleanUsername,
        phone: cleanPhone,
        password: setupPassword,
      });

      if (res.success) {
        // Ensure administrator completes normal login after initial setup
        await store.logoutAsync();
        setSetupPassword('');
        setSetupConfirmPassword('');
        setUsername(res.user?.username || cleanUsername);
        setPassword('');
        setScreenMode('login');
        setBootstrapUnavailableMsg(null);
        setSuccessMessage(
          'Administrador inicial configurado com sucesso! Agora faça login com seu nome de login e senha.'
        );
      } else {
        if (res.code === 'ALREADY_INITIALIZED') {
          setScreenMode('login');
          setErrorMessage(
            res.message ||
              'A configuração inicial já foi concluída anteriormente. Utilize o login normal.'
          );
        } else {
          setErrorMessage(
            res.message || 'Não foi possível concluir a configuração inicial do administrador.'
          );
        }
      }
    } catch {
      setErrorMessage(
        'Falha temporária de comunicação durante a configuração inicial. Tente novamente.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen w-full bg-[#F8FAFC] flex flex-col justify-between px-4 py-4 sm:px-6 sm:py-6 text-[#0F2342] font-sans">
      {/* Top Brand Bar */}
      <header className="w-full max-w-5xl mx-auto flex items-center justify-between gap-4 py-1">
        <div className="flex items-center gap-2.5 min-w-0">
          <AmanditaLogo variant="icon" size="sm" theme="light" />
          <span className="font-extrabold tracking-tight text-base text-[#0F2342] whitespace-nowrap">
            Amandita <span className="text-[#EA580C]">Sabores</span>
          </span>
        </div>

        <button
          type="button"
          onClick={onNavigateToCustomerMenu}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[40px] rounded-xl text-xs font-semibold bg-white text-[#1B365D] hover:bg-[#F1F5F9] hover:text-[#0F2342] transition border border-[#E2E8F0] whitespace-nowrap shrink-0 cursor-pointer"
          title="Ver o Cardápio Público do Cliente"
        >
          <UtensilsCrossed className="w-3.5 h-3.5 text-[#EA580C] shrink-0" />
          <span>Cardápio Público</span>
        </button>
      </header>

      {/* Main Authentication Card */}
      <div className="w-full max-w-md mx-auto my-auto py-6">
        <div className="bg-white rounded-2xl sm:rounded-3xl p-6 sm:p-8 shadow-sm border border-[#E2E8F0] relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-[#0F2342] via-[#1B365D] to-[#EA580C]" />

          {/* Header */}
          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center p-2.5 rounded-2xl bg-[#F8FAFC] border border-[#E2E8F0] mb-3.5">
              <AmanditaLogo variant="icon" size="lg" theme="light" />
            </div>

            {screenMode === 'checking' ? (
              <>
                <h1 className="text-2xl font-extrabold text-[#0F2342] tracking-tight">
                  Verificando Acesso
                </h1>
                <p className="text-xs sm:text-[13px] text-slate-600 mt-1.5 leading-relaxed">
                  Consultando o servidor de autenticação da Amandita Sabores...
                </p>
              </>
            ) : screenMode === 'setup_required' ? (
              <>
                <p className="text-xs font-semibold text-[#EA580C] mb-1">
                  Primeiro Acesso · Configuração Única
                </p>
                <h1 className="text-2xl font-extrabold text-[#0F2342] tracking-tight">
                  Configurar Administrador
                </h1>
                <p className="text-xs sm:text-[13px] text-slate-600 mt-1.5 leading-relaxed">
                  Defina as credenciais exclusivas do administrador principal. Esta etapa ocorre uma única vez.
                </p>
              </>
            ) : (
              <>
                <h1 className="text-2xl font-extrabold text-[#0F2342] tracking-tight">
                  Acesso ao Sistema
                </h1>
                <p className="text-xs sm:text-[13px] text-slate-600 mt-1.5 leading-relaxed">
                  Entre com seu nome de login e senha para acessar os módulos autorizados.
                </p>
              </>
            )}
          </div>

          {/* Checking State */}
          {screenMode === 'checking' && (
            <div className="py-10 flex flex-col items-center justify-center gap-3">
              <div className="w-7 h-7 border-2 border-[#E2E8F0] border-t-[#EA580C] rounded-full animate-spin" />
              <span className="text-xs text-slate-500 font-medium">
                Validando ambiente seguro...
              </span>
            </div>
          )}

          {/* Temporary Unavailability Notice (Fail-Closed) */}
          {screenMode !== 'checking' && bootstrapUnavailableMsg && (
            <div className="mb-4 p-3.5 bg-amber-50 border border-amber-200 text-amber-900 rounded-xl text-xs space-y-2">
              <div className="flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 shrink-0 text-amber-600 mt-0.5" />
                <span className="leading-relaxed font-medium">{bootstrapUnavailableMsg}</span>
              </div>
              <button
                type="button"
                onClick={() => void checkBootstrapStatus()}
                disabled={isCheckingStatus}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#1B365D] hover:text-[#EA580C] cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isCheckingStatus ? 'animate-spin' : ''}`} />
                <span>Tentar novamente</span>
              </button>
            </div>
          )}

          {/* Success Notice */}
          {screenMode !== 'checking' && successMessage && (
            <div className="mb-4 p-3.5 bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-xl text-xs flex items-start gap-2.5">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600 mt-0.5" />
              <div className="flex-1 font-medium leading-relaxed">{successMessage}</div>
            </div>
          )}

          {/* Error Notice */}
          {screenMode !== 'checking' && errorMessage && (
            <div className="mb-4 p-3.5 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 mt-0.5" />
              <div className="flex-1 font-medium leading-relaxed">{errorMessage}</div>
            </div>
          )}

          {/* FIRST ACCESS: INITIAL ADMINISTRATOR SETUP FORM */}
          {screenMode === 'setup_required' && (
            <form onSubmit={handleBootstrapSubmit} className="space-y-3.5" noValidate>
              <div>
                <label
                  htmlFor="setup-admin-name"
                  className="block text-xs font-semibold text-[#0F2342] mb-1.5"
                >
                  Nome completo
                </label>
                <div className="relative">
                  <UserCheck className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="setup-admin-name"
                    type="text"
                    value={setupName}
                    onChange={(e) => setSetupName(e.target.value)}
                    placeholder="Nome completo do administrador"
                    autoComplete="name"
                    autoFocus
                    required
                    className="w-full min-h-[44px] pl-10 pr-4 py-2.5 bg-[#F8FAFC] focus:bg-white border border-[#E2E8F0] rounded-xl text-sm text-[#0F2342] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#EA580C]/20 focus:border-[#EA580C] transition"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="setup-admin-username"
                  className="block text-xs font-semibold text-[#0F2342] mb-1.5"
                >
                  Nome de login
                </label>
                <div className="relative">
                  <UserIcon className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="setup-admin-username"
                    type="text"
                    value={setupUsername}
                    onChange={(e) => setSetupUsername(sanitizeUsernameInput(e.target.value))}
                    placeholder="Escolha seu nome de login único"
                    autoComplete="username"
                    required
                    className="w-full min-h-[44px] pl-10 pr-4 py-2.5 bg-[#F8FAFC] focus:bg-white border border-[#E2E8F0] rounded-xl text-sm font-mono text-[#0F2342] placeholder:font-sans placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#EA580C]/20 focus:border-[#EA580C] transition"
                  />
                </div>
                <p className="text-[11px] text-slate-500 mt-1">
                  3 a 32 caracteres: letras minúsculas, números, ponto, hífen ou sublinhado. Sem e-mail.
                </p>
              </div>

              <div>
                <label
                  htmlFor="setup-admin-phone"
                  className="block text-xs font-semibold text-[#0F2342] mb-1.5"
                >
                  Número de contato
                </label>
                <div className="relative">
                  <Phone className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="setup-admin-phone"
                    type="tel"
                    value={setupPhone}
                    onChange={(e) => setSetupPhone(e.target.value)}
                    placeholder="(83) 99999-9999"
                    autoComplete="tel"
                    required
                    className="w-full min-h-[44px] pl-10 pr-4 py-2.5 bg-[#F8FAFC] focus:bg-white border border-[#E2E8F0] rounded-xl text-sm font-mono tabular-nums text-[#0F2342] placeholder:font-sans placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#EA580C]/20 focus:border-[#EA580C] transition"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="setup-admin-password"
                  className="block text-xs font-semibold text-[#0F2342] mb-1.5"
                >
                  Senha
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="setup-admin-password"
                    type={showSetupPassword ? 'text' : 'password'}
                    value={setupPassword}
                    onChange={(e) => setSetupPassword(e.target.value)}
                    placeholder="Mínimo 8 caracteres (letras e números)"
                    autoComplete="new-password"
                    required
                    className="w-full min-h-[44px] pl-10 pr-11 py-2.5 bg-[#F8FAFC] focus:bg-white border border-[#E2E8F0] rounded-xl text-sm text-[#0F2342] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#EA580C]/20 focus:border-[#EA580C] transition"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSetupPassword((prev) => !prev)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-[#0F2342] transition p-1.5 rounded-lg cursor-pointer"
                    title={showSetupPassword ? 'Ocultar senha' : 'Exibir senha'}
                    tabIndex={-1}
                  >
                    {showSetupPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label
                  htmlFor="setup-admin-confirm"
                  className="block text-xs font-semibold text-[#0F2342] mb-1.5"
                >
                  Confirmar senha
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="setup-admin-confirm"
                    type={showSetupConfirm ? 'text' : 'password'}
                    value={setupConfirmPassword}
                    onChange={(e) => setSetupConfirmPassword(e.target.value)}
                    placeholder="Repita a senha escolhida"
                    autoComplete="new-password"
                    required
                    className="w-full min-h-[44px] pl-10 pr-11 py-2.5 bg-[#F8FAFC] focus:bg-white border border-[#E2E8F0] rounded-xl text-sm text-[#0F2342] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#EA580C]/20 focus:border-[#EA580C] transition"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSetupConfirm((prev) => !prev)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-[#0F2342] transition p-1.5 rounded-lg cursor-pointer"
                    title={showSetupConfirm ? 'Ocultar confirmação' : 'Exibir confirmação'}
                    tabIndex={-1}
                  >
                    {showSetupConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full min-h-[46px] py-3 px-4 bg-[#EA580C] hover:bg-[#C2410C] active:scale-[0.99] text-white font-bold rounded-xl transition flex items-center justify-center gap-2 text-sm disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer mt-2"
              >
                {isSubmitting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Configurando Administrador...</span>
                  </>
                ) : (
                  <>
                    <ShieldCheck className="w-4 h-4" />
                    <span>Concluir Configuração Inicial</span>
                  </>
                )}
              </button>

              <p className="text-[11px] text-slate-500 text-center leading-relaxed pt-1">
                Exclusivo para o administrador responsável pela loja. Após concluir, esta tela será bloqueada permanentemente.
              </p>
            </form>
          )}

          {/* NORMAL LOGIN FORM */}
          {screenMode === 'login' && (
            <form onSubmit={handleLoginSubmit} className="space-y-4" noValidate>
              <div>
                <label
                  htmlFor="unified-login-username"
                  className="block text-xs font-semibold text-[#0F2342] mb-1.5"
                >
                  Nome de login
                </label>
                <div className="relative">
                  <UserIcon className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="unified-login-username"
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(sanitizeUsernameInput(e.target.value))}
                    placeholder="Digite seu nome de login"
                    autoComplete="username"
                    autoFocus
                    required
                    className="w-full min-h-[44px] pl-10 pr-4 py-2.5 bg-[#F8FAFC] focus:bg-white border border-[#E2E8F0] rounded-xl text-sm text-[#0F2342] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#EA580C]/20 focus:border-[#EA580C] transition"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="unified-login-password"
                  className="block text-xs font-semibold text-[#0F2342] mb-1.5"
                >
                  Senha
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="unified-login-password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Digite sua senha"
                    autoComplete="current-password"
                    required
                    className="w-full min-h-[44px] pl-10 pr-11 py-2.5 bg-[#F8FAFC] focus:bg-white border border-[#E2E8F0] rounded-xl text-sm text-[#0F2342] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#EA580C]/20 focus:border-[#EA580C] transition"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-[#0F2342] transition p-1.5 rounded-lg cursor-pointer"
                    title={showPassword ? 'Ocultar senha' : 'Exibir senha'}
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full min-h-[46px] py-3 px-4 bg-[#EA580C] hover:bg-[#C2410C] active:scale-[0.99] text-white font-bold rounded-xl transition flex items-center justify-center gap-2 text-sm disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer mt-2"
              >
                {isSubmitting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Autenticando...</span>
                  </>
                ) : (
                  <>
                    <LogIn className="w-4 h-4" />
                    <span>Entrar no Sistema</span>
                  </>
                )}
              </button>
            </form>
          )}

          {/* Role Routing Info */}
          {screenMode === 'login' && (
            <div className="mt-6 pt-5 border-t border-[#E2E8F0] text-center">
              <div className="flex items-center justify-center gap-1.5 text-xs font-semibold text-[#1B365D] mb-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span>Acesso restrito a colaboradores cadastrados</span>
              </div>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                O sistema redireciona automaticamente cada colaborador para o módulo autorizado pela administração.
              </p>
            </div>
          )}
        </div>

        {/* Discreet Customer Menu Access */}
        <div className="mt-5 text-center">
          <p className="text-xs text-slate-500">
            É cliente e deseja fazer um pedido?{' '}
            <button
              type="button"
              onClick={onNavigateToCustomerMenu}
              className="font-semibold text-[#1B365D] hover:text-[#EA580C] hover:underline cursor-pointer inline-flex items-center gap-1 transition-colors"
            >
              <span>Abrir Cardápio Digital</span>
              <UtensilsCrossed className="w-3 h-3" />
            </button>
          </p>
        </div>
      </div>

      {/* Footer */}
      <footer className="w-full max-w-5xl mx-auto py-2 text-center text-[11px] text-slate-400">
        <span>
          Amandita Sabores © {new Date().getFullYear()} · Sistema Integrado de Gestão e Entregas
        </span>
      </footer>
    </main>
  );
};
