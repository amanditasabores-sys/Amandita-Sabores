import React, { useState } from 'react';
import { store } from '../../services/store';
import { User } from '../../types';
import { AmanditaLogo } from '../common/AmanditaLogo';
import { 
  User as UserIcon, 
  Lock, 
  Eye, 
  EyeOff, 
  AlertCircle, 
  LogIn, 
  Sparkles,
  UtensilsCrossed,
  ShieldCheck,
  Bike
} from 'lucide-react';

interface UnifiedLoginScreenProps {
  onLoginSuccess: (user: User) => void;
  onNavigateToCustomerMenu: () => void;
  initialNotice?: string | null;
}

export const UnifiedLoginScreen: React.FC<UnifiedLoginScreenProps> = ({
  onLoginSuccess,
  onNavigateToCustomerMenu,
  initialNotice
}) => {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(initialNotice || null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const cleanIdentifier = identifier.trim();
    const cleanPassword = password.trim();

    if (!cleanIdentifier || !cleanPassword) {
      setErrorMessage('Por favor, informe seu usuário ou e-mail e sua senha de acesso.');
      return;
    }

    setIsLoading(true);

    try {
      const res = await store.login(cleanIdentifier, cleanPassword);
      setIsLoading(false);

      if (res.success && res.user) {
        // Enforce single unified session: clear any legacy delivery session
        try {
          localStorage.removeItem('gf_delivery_user');
        } catch {
          // ignore
        }

        onLoginSuccess(res.user);
      } else {
        setErrorMessage(res.message || 'Credenciais inválidas. Verifique seu usuário e senha.');
      }
    } catch {
      setIsLoading(false);
      setErrorMessage('Erro de comunicação com o servidor. Tente novamente.');
    }
  };

  return (
    <main className="min-h-screen w-full bg-[#FAF7F2] flex flex-col justify-between p-4 sm:p-6 text-[#2C1810]">
      {/* Top Brand Bar */}
      <header className="w-full max-w-5xl mx-auto flex items-center justify-between py-2">
        <div className="flex items-center gap-2">
          <AmanditaLogo variant="icon" size="sm" theme="light" />
          <span className="font-serif font-black tracking-wider text-base text-[#2C1810]">
            AMANDITA <span className="text-[#C86D3B]">SABORES</span>
          </span>
        </div>

        <button
          onClick={onNavigateToCustomerMenu}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-[#EFE8DE] text-[#6B4B3E] hover:bg-[#E2D6C5] hover:text-[#2C1810] transition border border-[#D9C7B8]/60 cursor-pointer"
          title="Ver o Cardápio Público do Cliente"
        >
          <UtensilsCrossed className="w-3.5 h-3.5 text-[#C86D3B]" />
          <span>Cardápio Público</span>
        </button>
      </header>

      {/* Main Login Card */}
      <div className="w-full max-w-md mx-auto my-auto py-6">
        <div className="bg-[#FFFDF9] rounded-3xl p-6 sm:p-8 shadow-xl border border-[#E8DFD5] relative overflow-hidden">
          {/* Subtle Accent Glow */}
          <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-[#C86D3B] via-[#E89255] to-[#721C24]" />

          {/* Header */}
          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center p-3 rounded-2xl bg-[#FAF0E6] border border-[#E8DFD5] mb-3 shadow-inner">
              <AmanditaLogo variant="icon" size="md" theme="light" />
            </div>
            <h1 className="text-2xl font-black text-[#2C1810] tracking-tight">
              Acesso ao Sistema
            </h1>
            <p className="text-xs text-[#8C5E47] mt-1.5 leading-relaxed">
              Login único para administradores, gerentes, atendentes, operadores de caixa, cozinha e entregadores.
            </p>
          </div>

          {/* Error Notice */}
          {errorMessage && (
            <div className="mb-4 p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs flex items-start gap-2.5 animate-in fade-in">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 mt-0.5" />
              <div className="flex-1 font-medium leading-relaxed">{errorMessage}</div>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label 
                htmlFor="unified-login-identifier" 
                className="block text-xs font-bold text-[#3D2314] uppercase tracking-wider mb-1.5"
              >
                Usuário ou E-mail
              </label>
              <div className="relative">
                <UserIcon className="w-4 h-4 text-[#8C5E47] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="unified-login-identifier"
                  type="text"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="Ex: admin, gerente, entregador, caixa..."
                  autoComplete="username"
                  autoFocus
                  required
                  className="w-full pl-10 pr-4 py-2.5 bg-white border border-[#E8DFD5] rounded-xl text-sm text-[#2C1810] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#C86D3B]/40 focus:border-[#C86D3B] transition shadow-xs"
                />
              </div>
            </div>

            <div>
              <label 
                htmlFor="unified-login-password" 
                className="block text-xs font-bold text-[#3D2314] uppercase tracking-wider mb-1.5"
              >
                Senha
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-[#8C5E47] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="unified-login-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  required
                  className="w-full pl-10 pr-11 py-2.5 bg-white border border-[#E8DFD5] rounded-xl text-sm text-[#2C1810] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#C86D3B]/40 focus:border-[#C86D3B] transition shadow-xs"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-[#2C1810] transition p-1 cursor-pointer"
                  title={showPassword ? 'Ocultar senha' : 'Exibir senha'}
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3 px-4 bg-gradient-to-r from-[#C86D3B] to-[#721C24] hover:from-[#B55D2D] hover:to-[#5E161D] text-white font-bold rounded-xl shadow-md hover:shadow-lg transition-all duration-200 flex items-center justify-center gap-2 text-sm disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer mt-2"
            >
              {isLoading ? (
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

          {/* Quick Helper / Role Routing Notice */}
          <div className="mt-6 pt-5 border-t border-[#E8DFD5]/80 text-center">
            <div className="flex items-center justify-center gap-1.5 text-[11px] font-semibold text-[#8C5E47] mb-2">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
              <span>Direcionamento automático por função cadastrada</span>
            </div>
            <p className="text-[10px] text-[#A88877] leading-relaxed">
              O sistema identifica o perfil do usuário e abre automaticamente o painel correspondente (Administração, PDV, Balcão, Cozinha, Caixa ou Portal do Entregador).
            </p>
          </div>
        </div>

        {/* Customer fallback card */}
        <div className="mt-4 text-center">
          <p className="text-xs text-[#8C5E47]">
            É cliente e deseja fazer um pedido?{' '}
            <button
              onClick={onNavigateToCustomerMenu}
              className="font-bold text-[#C86D3B] hover:underline cursor-pointer inline-flex items-center gap-1"
            >
              <span>Abrir Cardápio Digital</span>
              <UtensilsCrossed className="w-3 h-3" />
            </button>
          </p>
        </div>
      </div>

      {/* Footer */}
      <footer className="w-full max-w-5xl mx-auto py-3 text-center text-[11px] text-[#A88877]">
        <span>Amandita Sabores © {new Date().getFullYear()} · Sistema Integrado de Gestão & Entregas</span>
      </footer>
    </main>
  );
};
