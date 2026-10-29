import React, { useState } from 'react';
import { store } from '../../services/store';
import { User } from '../../types';
import { 
  X, 
  Lock, 
  User as UserIcon, 
  LogIn, 
  AlertCircle, 
  Eye, 
  EyeOff
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
        </div>
      </div>
    </div>
  );
};
