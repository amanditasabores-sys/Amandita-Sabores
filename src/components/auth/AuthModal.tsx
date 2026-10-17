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
  Briefcase
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

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    if (!loginIdentifier.trim() || !loginPassword.trim()) {
      setError('Por favor, informe seu usuário/e-mail e senha.');
      setLoading(false);
      return;
    }

    const res = store.login(loginIdentifier, loginPassword);
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
            Área restrita e segura. Entre com suas credenciais para acessar os módulos autorizados.
          </p>
        </div>

        {/* Content Form */}
        <div className="p-6 space-y-5">
          {error && (
            <div className="p-3.5 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs flex items-center gap-2.5 animate-in fade-in">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
              <span className="font-medium">{error}</span>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-[#3D2314] uppercase tracking-wider mb-1.5">
                Usuário ou E-mail
              </label>
              <div className="relative">
                <UserIcon className="w-4 h-4 text-[#8C5E47] absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={loginIdentifier}
                  onChange={(e) => setLoginIdentifier(e.target.value)}
                  placeholder="Ex: admin, caixa ou maria"
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
                <span className="text-[11px] text-[#8C5E47]">Padrão inicial: 123456</span>
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
              className="w-full py-3 bg-gradient-to-r from-[#C86D3B] via-[#B85D2A] to-[#721C24] hover:opacity-95 text-white font-bold rounded-xl text-sm shadow-sm flex items-center justify-center gap-2 transition cursor-pointer active:scale-[0.99] disabled:opacity-50"
            >
              <LogIn className="w-4 h-4" />
              <span>{loading ? 'Validando Acesso...' : 'Entrar no Sistema'}</span>
            </button>
          </form>

          {/* Quick Login Profiles for Testing / Switching Roles */}
          <div className="pt-4 border-t border-[#E8DFD5]">
            <p className="text-[11px] font-bold text-[#6B4B3E] uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-[#C86D3B]" />
              <span>Atalhos de Acesso Rápido por Função:</span>
            </p>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              <button
                type="button"
                onClick={() => handleQuickFill('admin')}
                className="p-2 bg-[#F7F2EA] hover:bg-[#EFE6DC] border border-[#E8DFD5] rounded-xl text-left transition flex items-center gap-2"
              >
                <div className="w-6 h-6 rounded-lg bg-[#C86D3B]/20 text-[#8C5E47] flex items-center justify-center shrink-0">
                  <ShieldCheck className="w-3.5 h-3.5" />
                </div>
                <div className="truncate">
                  <p className="text-xs font-bold text-[#2C1810]">Admin</p>
                  <p className="text-[10px] text-slate-500">Geral</p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => handleQuickFill('caixa')}
                className="p-2 bg-[#F7F2EA] hover:bg-[#EFE6DC] border border-[#E8DFD5] rounded-xl text-left transition flex items-center gap-2"
              >
                <div className="w-6 h-6 rounded-lg bg-emerald-500/20 text-emerald-800 flex items-center justify-center shrink-0">
                  <ShoppingBag className="w-3.5 h-3.5" />
                </div>
                <div className="truncate">
                  <p className="text-xs font-bold text-[#2C1810]">Caixa</p>
                  <p className="text-[10px] text-slate-500">PDV & Vendas</p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => handleQuickFill('cozinha')}
                className="p-2 bg-[#F7F2EA] hover:bg-[#EFE6DC] border border-[#E8DFD5] rounded-xl text-left transition flex items-center gap-2"
              >
                <div className="w-6 h-6 rounded-lg bg-amber-500/20 text-amber-800 flex items-center justify-center shrink-0">
                  <ChefHat className="w-3.5 h-3.5" />
                </div>
                <div className="truncate">
                  <p className="text-xs font-bold text-[#2C1810]">Cozinha</p>
                  <p className="text-[10px] text-slate-500">KDS Preparo</p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => handleQuickFill('entregador')}
                className="p-2 bg-[#F7F2EA] hover:bg-[#EFE6DC] border border-[#E8DFD5] rounded-xl text-left transition flex items-center gap-2"
              >
                <div className="w-6 h-6 rounded-lg bg-indigo-500/20 text-indigo-800 flex items-center justify-center shrink-0">
                  <Bike className="w-3.5 h-3.5" />
                </div>
                <div className="truncate">
                  <p className="text-xs font-bold text-[#2C1810]">Entregador</p>
                  <p className="text-[10px] text-slate-500">Rotas</p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => handleQuickFill('gerente')}
                className="p-2 bg-[#F7F2EA] hover:bg-[#EFE6DC] border border-[#E8DFD5] rounded-xl text-left transition flex items-center gap-2"
              >
                <div className="w-6 h-6 rounded-lg bg-purple-500/20 text-purple-800 flex items-center justify-center shrink-0">
                  <Briefcase className="w-3.5 h-3.5" />
                </div>
                <div className="truncate">
                  <p className="text-xs font-bold text-[#2C1810]">Gerente</p>
                  <p className="text-[10px] text-slate-500">Supervisão</p>
                </div>
              </button>
            </div>
          </div>

          <div className="bg-[#FAF6F0] p-3 rounded-xl border border-[#E8DFD5] text-[11px] text-[#8C5E47] leading-relaxed">
            <span className="font-semibold text-[#3D2314]">Aviso de Segurança:</span> Não disponibilizamos cadastro administrativo aberto ao público. Novos funcionários devem ser cadastrados pelo Administrador na aba <strong className="text-[#C86D3B]">Equipe & Acessos</strong>.
          </div>
        </div>
      </div>
    </div>
  );
};
