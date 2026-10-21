import React, { useState, useEffect } from 'react';
import { store, MigrationSummary } from '../../services/store';
import { FirebaseConfigState, saveCustomFirebaseConfig, clearCustomFirebaseConfig } from '../../services/firebase';
import { 
  X, 
  Database, 
  Flame, 
  CheckCircle2, 
  AlertTriangle, 
  RefreshCw, 
  Download, 
  UploadCloud, 
  ExternalLink, 
  Copy, 
  Check, 
  ShieldCheck, 
  Wifi, 
  WifiOff,
  Key,
  Save,
  RotateCcw,
  Clock,
  Layers,
  Sparkles
} from 'lucide-react';

interface FirebaseStatusModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const FirebaseStatusModal: React.FC<FirebaseStatusModalProps> = ({ isOpen, onClose }) => {
  const [status, setStatus] = useState<FirebaseConfigState>(() => store.getFirebaseStatus());
  const [testResult, setTestResult] = useState<{ loading: boolean; success?: boolean; message?: string; details?: string }>({ loading: false });
  const [migrationResult, setMigrationResult] = useState<{ loading: boolean; summary?: MigrationSummary }>({ loading: false });
  const [copiedEnv, setCopiedEnv] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setStatus(store.getFirebaseStatus());
      setTestResult({ loading: false });
      setMigrationResult({ loading: false });
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleTestConnection = async () => {
    setTestResult({ loading: true });
    try {
      const res = await store.testConnection();
      setTestResult({ loading: false, success: res.success, message: res.message, details: res.details });
      setStatus(store.getFirebaseStatus());
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setTestResult({ loading: false, success: false, message: msg, details: 'Falha durante o teste de conexão.' });
    }
  };

  const handleForceRefresh = () => {
    if (typeof window !== 'undefined') {
      const cleanUrl = window.location.origin + window.location.pathname + '?refresh=' + Date.now();
      window.location.href = cleanUrl;
    }
  };

  const handleMigrateData = async () => {
    if (!window.confirm('Deseja iniciar a migração segura dos dados locais para o Cloud Firestore (amandita-sabores)? Dados existentes no banco não serão sobrescritos.')) {
      return;
    }

    setMigrationResult({ loading: true });
    try {
      const res = await store.migrateLocalDataToFirestore();
      setMigrationResult({ loading: false, summary: res });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setMigrationResult({
        loading: false,
        summary: {
          success: false,
          message: msg,
          counts: { menuItems: 0, orders: 0, cashShifts: 0, users: 0, configs: 0 },
          skippedCount: 0,
        }
      });
    }
  };

  const handleExportBackup = () => {
    const jsonStr = store.exportLocalDataBackup();
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `amandita-sabores-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const envTemplate = `# Configuração Oficial Firebase - Amandita Sabores
VITE_FIREBASE_API_KEY=AIzaSyAYjUJ51f7sg88DWglIF8VlCmZBR_YJbUI
VITE_FIREBASE_AUTH_DOMAIN=amandita-sabores.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=amandita-sabores
VITE_FIREBASE_STORAGE_BUCKET=amandita-sabores.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=1071664785777
VITE_FIREBASE_APP_ID=1:1071664785777:web:38c3cba0e3214330e6aed0`;

  const copyEnvToClipboard = () => {
    navigator.clipboard.writeText(envTemplate);
    setCopiedEnv(true);
    setTimeout(() => setCopiedEnv(false), 2000);
  };

  const formattedBuildTime = (() => {
    try {
      return new Date(status.buildTime).toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
    } catch {
      return status.buildTime || 'Recente';
    }
  })();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#2C1810]/70 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="w-full max-w-2xl bg-[#FFFDF9] rounded-3xl shadow-2xl border border-[#E8DFD5] overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="relative bg-gradient-to-r from-[#1F100B] via-[#331C13] to-[#C86D3B] text-white p-6 pb-5 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[#FFCA28]/20 text-[#FFCA28] border border-[#FFCA28]/30 flex items-center justify-center">
              <Flame className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-black tracking-tight text-white">Diagnóstico e Status do Firebase</h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-white/20 text-white">
                  amandita-sabores
                </span>
              </div>
              <p className="text-xs text-[#D9C7B8]">
                Sincronização em tempo real entre Computador e Dispositivos Móveis
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-[#D9C7B8] hover:text-white hover:bg-white/10 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-6 text-[#2C1810]">
          {/* Connection Status Box */}
          <div className={`p-4 rounded-2xl border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 ${
            status.isConfigured && status.isConnected
              ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
              : 'bg-amber-50 border-amber-200 text-amber-950'
          }`}>
            <div className="flex items-start gap-3">
              <div className={`p-2.5 rounded-xl mt-0.5 shrink-0 ${
                status.isConfigured && status.isConnected ? 'bg-emerald-600 text-white' : 'bg-amber-600 text-white'
              }`}>
                {status.isConfigured && status.isConnected ? <Wifi className="w-5 h-5" /> : <WifiOff className="w-5 h-5" />}
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-bold text-sm">
                    {status.isConfigured && status.isConnected
                      ? 'Conectado ao Cloud Firestore & Firebase Auth'
                      : 'Modo Cache Resiliente Ativo (Aguardando Credenciais Web)'}
                  </h3>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                    status.configOrigin === 'build_env'
                      ? 'bg-emerald-200 text-emerald-800'
                      : status.configOrigin === 'local_storage'
                      ? 'bg-sky-200 text-sky-800'
                      : 'bg-amber-200 text-amber-800'
                  }`}>
                    {status.configOrigin === 'build_env'
                      ? 'Compilado no Vercel (Produção)'
                      : status.configOrigin === 'local_storage'
                      ? 'Configuração Local do Dispositivo'
                      : 'Credenciais Ausentes no Bundle'}
                  </span>
                </div>
                <p className="text-xs mt-1 leading-relaxed opacity-90">
                  {status.isConfigured && status.isConnected
                    ? 'Os dados do cardápio, pedidos da cozinha KDS, PDV e entregadores são sincronizados em tempo real através do Cloud Firestore na região southamerica-east1.'
                    : 'A aplicação está funcionando no modo cache local seguro. Para ativar a sincronização em tempo real com o Cloud Firestore amandita-sabores neste computador, verifique as variáveis de compilação da Vercel ou cadastre as chaves abaixo.'}
                </p>
                <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[11px] font-medium text-slate-700">
                  <span className="bg-white/80 px-2.5 py-1 rounded-lg border border-current/20 flex items-center gap-1">
                    <Clock className="w-3 h-3 text-[#C86D3B]" />
                    Compilação deste Bundle: <strong>{formattedBuildTime}</strong>
                  </span>
                  <span className="bg-white/80 px-2.5 py-1 rounded-lg border border-current/20">
                    Região: <strong>{status.region}</strong>
                  </span>
                  <span className="bg-white/80 px-2.5 py-1 rounded-lg border border-current/20">
                    Database: <strong>{status.databaseId}</strong>
                  </span>
                </div>
              </div>
            </div>

            <div className="flex sm:flex-col gap-2 shrink-0 w-full sm:w-auto">
              <button
                onClick={handleTestConnection}
                disabled={testResult.loading}
                className="flex-1 sm:flex-none px-3.5 py-2 bg-white border border-[#E8DFD5] hover:bg-slate-50 text-xs font-bold rounded-xl shadow-2xs flex items-center justify-center gap-1.5 transition cursor-pointer active:scale-95 disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${testResult.loading ? 'animate-spin' : ''}`} />
                <span>{testResult.loading ? 'Testando...' : 'Testar Conexão'}</span>
              </button>
              <button
                onClick={handleForceRefresh}
                className="flex-1 sm:flex-none px-3.5 py-2 bg-[#2C1810] hover:bg-[#3D2314] text-white text-xs font-bold rounded-xl shadow-2xs flex items-center justify-center gap-1.5 transition cursor-pointer active:scale-95"
                title="Recarrega o aplicativo forçando o navegador a baixar a versão mais recente sem cache"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Limpar Cache</span>
              </button>
            </div>
          </div>

          {/* Test connection result notice */}
          {testResult.message && (
            <div className={`p-3.5 rounded-xl border text-xs flex flex-col gap-1 ${
              testResult.success ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-rose-50 border-rose-200 text-rose-900'
            }`}>
              <div className="flex items-center gap-2 font-bold">
                {testResult.success ? <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" /> : <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />}
                <span>{testResult.message}</span>
              </div>
              {testResult.details && (
                <p className="text-[11px] opacity-80 pl-6">{testResult.details}</p>
              )}
            </div>
          )}

          {/* Detailed 6-variable Status Grid */}
          <div className="p-4 rounded-2xl bg-[#FBF9F5] border border-[#E8DFD5] space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold uppercase tracking-wider text-[#3D2314] flex items-center gap-1.5">
                <Layers className="w-4 h-4 text-[#C86D3B]" />
                <span>Status das 6 Variáveis de Ambiente no Dispositivo Atual</span>
              </h4>
              <span className="text-[11px] text-[#8C5E47]">Projeto: <strong>amandita-sabores</strong></span>
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              {/* API Key */}
              <div className="p-2.5 bg-white rounded-xl border border-[#E8DFD5] flex items-center justify-between">
                <div>
                  <span className="font-mono text-[10px] text-slate-500 block">VITE_FIREBASE_API_KEY</span>
                  <span className="font-mono font-bold text-[11px]">{status.maskedApiKey}</span>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                  status.hasApiKey ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                }`}>
                  {status.hasApiKey ? 'Presente' : 'Ausente'}
                </span>
              </div>

              {/* App ID */}
              <div className="p-2.5 bg-white rounded-xl border border-[#E8DFD5] flex items-center justify-between">
                <div>
                  <span className="font-mono text-[10px] text-slate-500 block">VITE_FIREBASE_APP_ID</span>
                  <span className="font-mono font-bold text-[11px]">{status.maskedAppId}</span>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                  status.hasAppId ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                }`}>
                  {status.hasAppId ? 'Presente' : 'Ausente'}
                </span>
              </div>

              {/* Project ID */}
              <div className="p-2.5 bg-white rounded-xl border border-[#E8DFD5] flex items-center justify-between">
                <div>
                  <span className="font-mono text-[10px] text-slate-500 block">VITE_FIREBASE_PROJECT_ID</span>
                  <span className="font-mono font-bold text-[11px]">{status.projectId}</span>
                </div>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                  Ativo
                </span>
              </div>

              {/* Auth Domain */}
              <div className="p-2.5 bg-white rounded-xl border border-[#E8DFD5] flex items-center justify-between">
                <div>
                  <span className="font-mono text-[10px] text-slate-500 block">VITE_FIREBASE_AUTH_DOMAIN</span>
                  <span className="font-mono font-bold text-[11px]">{status.hasAuthDomain ? 'Configurado' : 'Padrão'}</span>
                </div>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                  Ativo
                </span>
              </div>

              {/* Storage Bucket */}
              <div className="p-2.5 bg-white rounded-xl border border-[#E8DFD5] flex items-center justify-between">
                <div>
                  <span className="font-mono text-[10px] text-slate-500 block">VITE_FIREBASE_STORAGE_BUCKET</span>
                  <span className="font-mono font-bold text-[11px]">{status.hasStorageBucket ? 'Configurado' : 'Padrão'}</span>
                </div>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                  Ativo
                </span>
              </div>

              {/* Messaging Sender ID */}
              <div className="p-2.5 bg-white rounded-xl border border-[#E8DFD5] flex items-center justify-between">
                <div>
                  <span className="font-mono text-[10px] text-slate-500 block">VITE_FIREBASE_MESSAGING_SENDER_ID</span>
                  <span className="font-mono font-bold text-[11px]">1071664785777</span>
                </div>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                  Ativo
                </span>
              </div>
            </div>
          </div>

          {/* Migration & Backup Section */}
          <div className="p-4 rounded-2xl bg-[#FBF9F5] border border-[#E8DFD5] space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-bold text-[#2C1810] flex items-center gap-2">
                  <Database className="w-4 h-4 text-[#C86D3B]" />
                  <span>Migração Segura & Cópia de Segurança</span>
                </h4>
                <p className="text-xs text-[#8C5E47] mt-0.5">
                  Faça o backup dos dados locais e envie pedidos, cardápio e turnos para o Cloud Firestore sem perdas.
                </p>
              </div>

              <button
                onClick={handleExportBackup}
                className="px-3 py-1.5 bg-white border border-[#E8DFD5] hover:bg-slate-50 text-[#3D2314] font-bold text-xs rounded-xl shadow-2xs flex items-center gap-1.5 transition cursor-pointer"
                title="Baixar cópia de segurança em formato JSON"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Exportar Backup (JSON)</span>
              </button>
            </div>

            <div className="pt-2 border-t border-[#E8DFD5] flex items-center justify-between gap-4">
              <div className="text-xs text-[#6B4B3E]">
                <span>Regra de Migração: </span>
                <strong className="text-[#2C1810]">Preserva documentos existentes</strong> sem duplicatas e não envia senhas para o Firestore.
              </div>

              <button
                onClick={handleMigrateData}
                disabled={migrationResult.loading || !status.isConfigured}
                className="px-4 py-2 bg-[#C86D3B] hover:bg-[#B85D2A] text-white font-bold text-xs rounded-xl shadow-xs flex items-center gap-2 transition cursor-pointer disabled:opacity-50"
              >
                <UploadCloud className={`w-4 h-4 ${migrationResult.loading ? 'animate-bounce' : ''}`} />
                <span>{migrationResult.loading ? 'Migrando Dados...' : 'Migrar Local → Firestore'}</span>
              </button>
            </div>

            {migrationResult.summary && (
              <div className={`p-3 rounded-xl border text-xs mt-2 ${
                migrationResult.summary.success ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-rose-50 border-rose-200 text-rose-900'
              }`}>
                <p className="font-bold mb-1">{migrationResult.summary.message}</p>
                {migrationResult.summary.success && (
                  <ul className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-2 font-mono text-[11px]">
                    <li className="bg-white/80 p-1.5 rounded-lg border border-emerald-200">
                      Cardápio: <strong>{migrationResult.summary.counts.menuItems}</strong>
                    </li>
                    <li className="bg-white/80 p-1.5 rounded-lg border border-emerald-200">
                      Pedidos: <strong>{migrationResult.summary.counts.orders}</strong>
                    </li>
                    <li className="bg-white/80 p-1.5 rounded-lg border border-emerald-200">
                      Turnos de Caixa: <strong>{migrationResult.summary.counts.cashShifts}</strong>
                    </li>
                    <li className="bg-white/80 p-1.5 rounded-lg border border-emerald-200">
                      Funcionários: <strong>{migrationResult.summary.counts.users}</strong>
                    </li>
                    <li className="bg-white/80 p-1.5 rounded-lg border border-emerald-200">
                      Existentes mantidos: <strong>{migrationResult.summary.skippedCount}</strong>
                    </li>
                  </ul>
                )}
              </div>
            )}
          </div>

          {/* Credentials Guide Box & In-App Direct Configuration */}
          <div className="space-y-4">
            <div className="p-4 bg-[#F5EFE6] rounded-2xl border border-[#E8DFD5] space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold uppercase tracking-wider text-[#3D2314] flex items-center gap-1.5">
                  <Key className="w-4 h-4 text-[#C86D3B]" />
                  <span>Configuração Direta no Dispositivo (Sem Re-Deploy)</span>
                </label>
                {status.hasApiKey && (
                  <button
                    onClick={() => {
                      if (window.confirm('Deseja limpar as credenciais salvas neste navegador?')) {
                        clearCustomFirebaseConfig();
                      }
                    }}
                    className="text-[11px] text-rose-600 hover:text-rose-800 font-bold flex items-center gap-1 cursor-pointer"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Redefinir</span>
                  </button>
                )}
              </div>
              <p className="text-xs text-[#6B4B3E]">
                Se o computador estiver exibindo dados locais ou se a compilação da Vercel foi realizada antes das variáveis de ambiente, insira as credenciais abaixo para conectar este computador imediatamente ao Cloud Firestore (amandita-sabores):
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="block text-[11px] font-bold text-[#3D2314] mb-1">
                    VITE_FIREBASE_API_KEY (Web API Key):
                  </label>
                  <input
                    type="password"
                    id="input-custom-firebase-key"
                    placeholder="AIzaSyAYjUJ51f7sg88DWglIF8VlCmZBR_YJbUI"
                    defaultValue={status.hasApiKey ? '••••••••••••••••••••••••••••••••' : ''}
                    className="w-full px-3 py-2 bg-white rounded-xl border border-[#D9C7B8] text-xs font-mono focus:outline-[#C86D3B]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-[#3D2314] mb-1">
                    VITE_FIREBASE_APP_ID (App ID):
                  </label>
                  <input
                    type="text"
                    id="input-custom-firebase-appid"
                    placeholder="1:1071664785777:web:38c3cba0e3214330e6aed0"
                    defaultValue={status.hasAppId ? '1:1071664785777:web:38c3cba0e3214330e6aed0' : ''}
                    className="w-full px-3 py-2 bg-white rounded-xl border border-[#D9C7B8] text-xs font-mono focus:outline-[#C86D3B]"
                  />
                </div>
              </div>
              <div className="flex justify-end pt-1">
                <button
                  onClick={() => {
                    const keyInput = (document.getElementById('input-custom-firebase-key') as HTMLInputElement)?.value?.trim();
                    const appInput = (document.getElementById('input-custom-firebase-appid') as HTMLInputElement)?.value?.trim();
                    if (!keyInput || keyInput.includes('••••')) {
                      alert('Por favor, informe a chave de API do Firebase (inicia com AIzaSy...).');
                      return;
                    }
                    saveCustomFirebaseConfig({
                      apiKey: keyInput,
                      appId: appInput || '1:1071664785777:web:38c3cba0e3214330e6aed0',
                      projectId: 'amandita-sabores',
                      authDomain: 'amandita-sabores.firebaseapp.com',
                      storageBucket: 'amandita-sabores.firebasestorage.app',
                      messagingSenderId: '1071664785777'
                    });
                  }}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-xs flex items-center gap-1.5 transition cursor-pointer"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>Salvar e Conectar Este Dispositivo</span>
                </button>
              </div>
            </div>

            {/* Vercel Environment Variables Guide */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold uppercase tracking-wider text-[#3D2314] flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-[#C86D3B]" />
                  <span>Configuração Permanente na Vercel (Compilação Global)</span>
                </label>
                <button
                  onClick={copyEnvToClipboard}
                  className="text-[11px] font-bold text-[#C86D3B] hover:text-[#B85D2A] flex items-center gap-1 cursor-pointer"
                >
                  {copiedEnv ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedEnv ? 'Copiado!' : 'Copiar Variáveis'}</span>
                </button>
              </div>

              <pre className="p-3 bg-[#1F100B] text-[#D9C7B8] rounded-2xl text-[11px] font-mono overflow-x-auto border border-[#4A2E1F] leading-relaxed">
                {envTemplate}
              </pre>
              <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-amber-900 text-[11px] leading-relaxed space-y-1">
                <p className="font-bold">⚠️ Procedimento indispensável após cadastrar as variáveis na Vercel:</p>
                <ol className="list-decimal pl-4 space-y-1">
                  <li>No painel da Vercel, acesse a aba <strong>Deployments</strong>.</li>
                  <li>No menu (ícone de 3 pontos) da versão mais recente, clique em <strong>Redeploy</strong>.</li>
                  <li><strong>Atenção:</strong> DESMARQUE a opção <em>"Use existing Build Cache"</em> (ou clique em <em>Redeploy without cache</em>) para que o Vite compile um pacote novo incorporando as variáveis.</li>
                  <li>No computador, pressione <strong>Ctrl + Shift + R</strong> (ou Cmd + Shift + R no Mac) para limpar o cache do navegador e carregar o novo bundle.</li>
                </ol>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 bg-[#FAF7F2] border-t border-[#E8DFD5] flex items-center justify-between shrink-0">
          <div className="text-[11px] text-[#8C5E47]">
            Regras de segurança ativas em <strong>firestore.rules</strong>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-[#2C1810] hover:bg-[#3D2314] text-white font-bold text-xs rounded-xl shadow-xs transition cursor-pointer"
          >
            Fechar Janela
          </button>
        </div>
      </div>
    </div>
  );
};
