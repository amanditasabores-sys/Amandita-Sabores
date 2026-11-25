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
  EyeOff,
} from 'lucide-react';
import { AmanditaLogo } from '../common/AmanditaLogo';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (user: User) => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const cleanUsername = username.trim().toLowerCase();
    const rawPassword = password;

    if (!cleanUsername || !rawPassword.trim()) {
      setError('Informe seu nome de login e sua senha de acesso.');
      return;
    }

    if (cleanUsername.includes('@')) {
      setError('Utilize seu nome de login cadastrado (não utilize endereço de e-mail).');
      return;
    }

    setLoading(true);
    try {
      const res = await store.login(cleanUsername, rawPassword);
      setLoading(false);

      if (res.success && res.user) {
        setPassword('');
        onSuccess(res.user);
        onClose();
      } else {
        setError(res.message || 'Credenciais inválidas. Verifique seu nome de login e sua senha.');
      }
    } catch {
      setLoading(false);
      setError('Falha temporária de comunicação com o servidor. Tente novamente em instantes.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#0F2342]/60 backdrop-blur-xs font-sans">
      <div className="w-full max-w-md bg-white rounded-2xl sm:rounded-3xl shadow-2xl border border-[#E2E8F0] overflow-hidden">
        {/* Header with Amandita branding */}
        <div className="relative bg-gradient-to-br from-[#0F2342] to-[#1B365D] text-white p-6 pb-5">
          <button
            type="button"
            onClick={onClose}
            className="absolute right-4 top-4 p-1.5 rounded-xl text-slate-300 hover:text-white hover:bg-white/10 transition cursor-pointer"
            aria-label="Fechar modal de acesso"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-3 mb-2 pr-8">
            <AmanditaLogo variant="icon" size="sm" theme="dark" />
            <div>
              <h2 className="text-lg font-extrabold tracking-tight text-white">
                Acesso do Colaborador
              </h2>
              <p className="text-xs text-slate-300">Amandita Sabores · Sistema de Gestão</p>
            </div>
          </div>
          <p className="text-xs text-slate-300/90 mt-2 leading-relaxed">
            Área restrita. Entre com seu nome de login e senha para acessar os módulos autorizados.
          </p>
        </div>

        {/* Content Form */}
        <div className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 mt-0.5" />
              <span className="font-medium leading-relaxed">{error}</span>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4" noValidate>
            <div>
              <label
                htmlFor="modal-login-username"
                className="block text-xs font-semibold text-[#0F2342] mb-1.5"
              >
                Nome de login
              </label>
              <div className="relative">
                <UserIcon className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="modal-login-username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/\s+/g, ''))}
                  placeholder="Digite seu nome de login"
                  autoComplete="username"
                  className="w-full min-h-[44px] pl-10 pr-4 py-2.5 bg-[#F8FAFC] focus:bg-white border border-[#E2E8F0] rounded-xl text-sm text-[#0F2342] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#EA580C]/20 focus:border-[#EA580C] transition"
                  autoFocus
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="modal-login-password"
                className="block text-xs font-semibold text-[#0F2342] mb-1.5"
              >
                Senha
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="modal-login-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Digite sua senha"
                  autoComplete="current-password"
                  className="w-full min-h-[44px] pl-10 pr-11 py-2.5 bg-[#F8FAFC] focus:bg-white border border-[#E2E8F0] rounded-xl text-sm text-[#0F2342] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#EA580C]/20 focus:border-[#EA580C] transition"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-[#0F2342] p-1.5 rounded-lg transition cursor-pointer"
                  title={showPassword ? 'Ocultar senha' : 'Exibir senha'}
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full min-h-[44px] py-2.5 px-4 bg-[#EA580C] hover:bg-[#C2410C] text-white font-bold rounded-xl text-sm flex items-center justify-center gap-2 transition cursor-pointer active:scale-[0.99] disabled:opacity-50"
            >
              <LogIn className="w-4 h-4" />
              <span>{loading ? 'Validando Acesso...' : 'Entrar no Sistema'}</span>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
