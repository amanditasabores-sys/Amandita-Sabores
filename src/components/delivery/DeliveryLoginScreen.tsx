import React, { useState } from 'react';
import { store } from '../../services/store';
import { User } from '../../types';
import { AmanditaLogo } from '../common/AmanditaLogo';
import { Bike, Lock, User as UserIcon, AlertCircle, ArrowRight, ArrowLeft } from 'lucide-react';

interface DeliveryLoginScreenProps {
  onLoginSuccess: (user: User) => void;
  adminUser?: User | null;
  onBackToAdmin?: () => void;
}

export const DeliveryLoginScreen: React.FC<DeliveryLoginScreenProps> = ({ 
  onLoginSuccess,
  adminUser,
  onBackToAdmin 
}) => {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const cleanId = identifier.trim();
    const cleanPw = password.trim();

    if (!cleanId || !cleanPw) {
      setError('Informe seu usuário ou e-mail de entregador e a senha.');
      return;
    }

    setLoading(true);
    try {
      const res = await store.login(cleanId, cleanPw);
      setLoading(false);

      if (!res.success || !res.user) {
        setError(res.message || 'Credenciais inválidas. Verifique seu usuário e senha.');
        return;
      }

      const role = (res.user.role || '').toUpperCase();
      if (res.user.status === 'BLOQUEADO') {
        setError('Acesso bloqueado pelo administrador. Contate a gerência.');
        return;
      }
      if (res.user.status === 'DESATIVADO') {
        setError('Esta conta de entregador foi desativada pelo administrador.');
        return;
      }

      // Allow ENTREGADOR or administrative roles (ADMINISTRADOR/GERENTE for supervision)
      if (role !== 'ENTREGADOR' && role !== 'ADMINISTRADOR' && role !== 'GERENTE') {
        setError(`Acesso restrito: sua conta possui perfil de ${res.user.role}, não de Entregador.`);
        return;
      }

      onLoginSuccess(res.user);
    } catch (err: unknown) {
      setLoading(false);
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Erro ao autenticar: ${msg}`);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#2C1810] via-[#1F100B] to-[#120805] flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md bg-[#FFFDF9] rounded-3xl p-6 sm:p-8 shadow-2xl border border-[#E8DFD5] space-y-6 animate-in zoom-in-95 duration-200">
        {onBackToAdmin && (
          <div className="flex justify-between items-center pb-2 border-b border-[#E8DFD5]">
            <button
              type="button"
              onClick={onBackToAdmin}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#FAF7F2] hover:bg-[#F3EDE2] text-[#8C5E47] hover:text-[#2C1810] border border-[#E8DFD5] rounded-xl text-xs font-bold transition cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Voltar à Administração</span>
            </button>
            <span className="text-[10px] text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
              Admin Conectado
            </span>
          </div>
        )}

        {/* Header with Official Logo */}
        <div className="text-center space-y-3">
          <div className="flex justify-center">
            <AmanditaLogo variant="icon" size="lg" theme="light" />
          </div>

          <div className="space-y-1">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-black bg-[#C86D3B]/15 text-[#C86D3B] border border-[#C86D3B]/30">
              <Bike className="w-3.5 h-3.5" />
              <span>Portal de Entregas & Rotas</span>
            </div>
            <h2 className="font-serif font-black text-xl sm:text-2xl text-[#2C1810]">
              Login do Entregador
            </h2>
            <p className="text-xs text-[#8C5E47] leading-relaxed">
              Área exclusiva da equipe de entregas Amandita Sabores. Informe suas credenciais autorizadas pela administração.
            </p>
          </div>
        </div>

        {/* Error message banner */}
        {error && (
          <div className="p-3.5 bg-rose-50 border border-rose-200 text-rose-800 rounded-2xl text-xs flex items-center gap-2.5 animate-in fade-in">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span className="font-medium">{error}</span>
          </div>
        )}

        {/* Login Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-[#3D2314] uppercase tracking-wider mb-1.5">
              Usuário ou E-mail
            </label>
            <div className="relative">
              <UserIcon className="w-4 h-4 text-[#8C5E47] absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="Ex: entregador, motoboy..."
                autoComplete="username"
                className="w-full pl-10 pr-4 py-2.5 bg-white border border-[#E8DFD5] rounded-xl text-sm text-[#2C1810] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#C86D3B]/40 focus:border-[#C86D3B] transition"
                autoFocus
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-[#3D2314] uppercase tracking-wider mb-1.5">
              Senha de Acesso
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-[#8C5E47] absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Sua senha cadastrada"
                autoComplete="current-password"
                className="w-full pl-10 pr-10 py-2.5 bg-white border border-[#E8DFD5] rounded-xl text-sm text-[#2C1810] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#C86D3B]/40 focus:border-[#C86D3B] transition"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-[#8C5E47] hover:text-[#2C1810] cursor-pointer"
              >
                {showPassword ? 'Ocultar' : 'Ver'}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 px-4 bg-gradient-to-r from-[#C86D3B] via-[#B85D2A] to-[#721C24] hover:opacity-95 text-white font-extrabold rounded-xl text-sm shadow-md flex items-center justify-center gap-2 transition cursor-pointer disabled:opacity-50 active:scale-[0.99]"
          >
            <span>{loading ? 'Validando Acesso...' : 'Entrar no Portal do Entregador'}</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>

        {/* Security & Support Footer */}
        <div className="pt-4 border-t border-[#E8DFD5] text-center space-y-1">
          <p className="text-[11px] text-[#8C5E47]">
            Dúvidas sobre seu login? Solicite ativação ao Administrador da loja.
          </p>
          <p className="text-[10px] text-[#A6806C] italic">
            Amandita Sabores · Feito com amor, servido com sabor.
          </p>
        </div>
      </div>
    </div>
  );
};
