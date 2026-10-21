import React, { useState } from 'react';
import { store } from '../../services/store';
import { User } from '../../types';
import { 
  X, 
  Lock, 
  User as UserIcon, 
  ShieldCheck, 
  LogIn, 
  AlertCircle, 
  Eye, 
  EyeOff, 
  Sparkles,
  ChefHat,
  ShoppingBag,
  Bike,
  Briefcase,
  Store
} from 'lucide-react';
import { AmanditaLogo } from '../common/AmanditaLogo';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (user: User) => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    if (!loginIdentifier.trim() || !loginPassword.trim()) {
      setError('Por favor, informe seu usuário/e-mail e senha.');
      setLoading(false);
      return;
    }

    const res = await store.login(loginIdentifier, loginPassword);
    setLoading(false);

    if (res.success && res.user) {
      onSuccess(res.user);
      onClose();
    } else {
      setError(res.message);
    }
  };

  const handleGoogleLogin = async () => {
    setError(null);
    setLoading(true);
    const res = await store.loginWithGoogle();
    setLoading(false);

    if (res.success && res.user) {
      onSuccess(res.user);
      onClose();
    } else {
      setError(res.message);
    }
  };

  const handleQuickFill = (username: string, pass = '123456') => {
    setLoginIdentifier(username);
    setLoginPassword(pass);
    setError(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#2C1810]/70 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="w-full max-w-md bg-[#FFFDF9] rounded-3xl shadow-2xl border border-[#E8DFD5] overflow-hidden">
        {/* Header with Amandita branding */}
        <div className="relative bg-gradient-to-br from-[#2C1810] via-[#3D2314] to-[#4A2E1F] text-white p-6 pb-5">
          <button
            onClick={onClose}
            className="absolute right-4 top-4 p-1.5 rounded-xl text-[#D9C7B8] hover:text-white hover:bg-white/10 transition"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-3 mb-2">
            <AmanditaLogo variant="icon" size="sm" theme="light" />
            <div>
              <h2 className="text-lg font-black tracking-tight text-white">Acesso do Colaborador</h2>
              <p className="text-[11px] text-[#E8DFD5]">Amandita Sabores — Sistema de Gestão</p>
            </div>
          </div>
          <p className="text-xs text-[#D9C7B8]/90 mt-2 leading-relaxed">
            Área restrita e segura. Entre com suas credenciais ou autentique com Firebase para acessar os módulos autorizados.
          </p>
        </div>

        {/* Content Form */}
        <div className="p-6 space-y-4">
          {error && (
            <div className="p-3.5 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs flex items-center gap-2.5 animate-in fade-in">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
              <span className="font-medium">{error}</span>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-3.5">
            <div>
              <label className="block text-xs font-bold text-[#3D2314] uppercase tracking-wider mb-1.5">
                Nome de Usuário
              </label>
              <div className="relative">
                <UserIcon className="w-4 h-4 text-[#8C5E47] absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={loginIdentifier}
                  onChange={(e) => setLoginIdentifier(e.target.value)}
                  placeholder="Ex: admin, caixa, cozinha ou maria"
                  className="w-full pl-10 pr-4 py-2.5 bg-white border border-[#E8DFD5] rounded-xl text-sm text-[#2C1810] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#C86D3B]/40 focus:border-[#C86D3B] transition"
                  autoFocus
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-bold text-[#3D2314] uppercase tracking-wider">
                  Senha
                </label>
                <span className="text-[11px] text-[#8C5E47]">Padrão: 123456</span>
              </div>
              <div className="relative">
                <Lock className="w-4 h-4 text-[#8C5E47] absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  placeholder="Sua senha secreta"
                  className="w-full pl-10 pr-10 py-2.5 bg-white border border-[#E8DFD5] rounded-xl text-sm text-[#2C1810] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#C86D3B]/40 focus:border-[#C86D3B] transition"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-[#3D2314] p-1 transition"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-gradient-to-r from-[#C86D3B] via-[#B85D2A] to-[#721C24] hover:opacity-95 text-white font-bold rounded-xl text-xs shadow-xs flex items-center justify-center gap-2 transition cursor-pointer active:scale-[0.99] disabled:opacity-50"
            >
              <LogIn className="w-3.5 h-3.5" />
              <span>{loading ? 'Validando Acesso...' : 'Entrar no Sistema'}</span>
            </button>
          </form>

          {/* Firebase Google Auth button */}
          <div className="relative my-2 text-center">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-[#E8DFD5]"></div></div>
            <span className="relative bg-[#FFFDF9] px-2 text-[10px] uppercase font-bold text-[#8C5E47]">ou autentique com</span>
          </div>

          <button
            type="button"
            onClick={handleGoogleLogin}
            disabled={loading}
            className="w-full py-2 bg-white hover:bg-slate-50 text-[#2C1810] font-bold border border-[#E8DFD5] rounded-xl text-xs flex items-center justify-center gap-2 shadow-2xs transition cursor-pointer disabled:opacity-50"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
            </svg>
            <span>Entrar com Google (Firebase Auth)</span>
          </button>

          {/* Quick Login Profiles for Testing / Switching Roles */}
          <div className="pt-3 border-t border-[#E8DFD5]">
            <p className="text-[10px] font-bold text-[#6B4B3E] uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
              <Sparkles className="w-3 h-3 text-[#C86D3B]" />
              <span>Atalhos de Acesso Rápido por Função:</span>
            </p>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              <button
                type="button"
                onClick={() => handleQuickFill('admin')}
                className="p-1.5 bg-[#F7F2EA] hover:bg-[#EFE6DC] border border-[#E8DFD5] rounded-xl text-left transition flex items-center gap-1.5 cursor-pointer"
              >
                <div className="w-5 h-5 rounded-md bg-[#C86D3B]/20 text-[#8C5E47] flex items-center justify-center shrink-0">
                  <ShieldCheck className="w-3 h-3" />
                </div>
                <div className="truncate">
                  <p className="text-[11px] font-bold text-[#2C1810]">Admin</p>
                  <p className="text-[9px] text-slate-500">Geral</p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => handleQuickFill('atendente')}
                className="p-1.5 bg-[#F7F2EA] hover:bg-[#EFE6DC] border border-[#E8DFD5] rounded-xl text-left transition flex items-center gap-1.5 cursor-pointer"
              >
                <div className="w-5 h-5 rounded-md bg-amber-500/20 text-amber-800 flex items-center justify-center shrink-0">
                  <Store className="w-3 h-3" />
                </div>
                <div className="truncate">
                  <p className="text-[11px] font-bold text-[#2C1810]">Atendente</p>
                  <p className="text-[9px] text-slate-500">Balcão</p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => handleQuickFill('entregador')}
                className="p-1.5 bg-[#F7F2EA] hover:bg-[#EFE6DC] border border-[#E8DFD5] rounded-xl text-left transition flex items-center gap-1.5 cursor-pointer"
              >
                <div className="w-5 h-5 rounded-md bg-indigo-500/20 text-indigo-800 flex items-center justify-center shrink-0">
                  <Bike className="w-3 h-3" />
                </div>
                <div className="truncate">
                  <p className="text-[11px] font-bold text-[#2C1810]">Entregador</p>
                  <p className="text-[9px] text-slate-500">Rotas</p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => handleQuickFill('cozinha')}
                className="p-1.5 bg-[#F7F2EA] hover:bg-[#EFE6DC] border border-[#E8DFD5] rounded-xl text-left transition flex items-center gap-1.5 cursor-pointer"
              >
                <div className="w-5 h-5 rounded-md bg-rose-500/20 text-rose-800 flex items-center justify-center shrink-0">
                  <ChefHat className="w-3 h-3" />
                </div>
                <div className="truncate">
                  <p className="text-[11px] font-bold text-[#2C1810]">Produção</p>
                  <p className="text-[9px] text-slate-500">KDS</p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => handleQuickFill('caixa')}
                className="p-1.5 bg-[#F7F2EA] hover:bg-[#EFE6DC] border border-[#E8DFD5] rounded-xl text-left transition flex items-center gap-1.5 cursor-pointer"
              >
                <div className="w-5 h-5 rounded-md bg-emerald-500/20 text-emerald-800 flex items-center justify-center shrink-0">
                  <ShoppingBag className="w-3 h-3" />
                </div>
                <div className="truncate">
                  <p className="text-[11px] font-bold text-[#2C1810]">Caixa</p>
                  <p className="text-[9px] text-slate-500">Fechamento</p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => handleQuickFill('gerente')}
                className="p-1.5 bg-[#F7F2EA] hover:bg-[#EFE6DC] border border-[#E8DFD5] rounded-xl text-left transition flex items-center gap-1.5 cursor-pointer"
              >
                <div className="w-5 h-5 rounded-md bg-purple-500/20 text-purple-800 flex items-center justify-center shrink-0">
                  <Briefcase className="w-3 h-3" />
                </div>
                <div className="truncate">
                  <p className="text-[11px] font-bold text-[#2C1810]">Gerente</p>
                  <p className="text-[9px] text-slate-500">Supervisão</p>
                </div>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
