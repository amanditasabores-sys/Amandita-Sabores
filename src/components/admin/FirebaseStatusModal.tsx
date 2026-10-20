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
  RotateCcw
} from 'lucide-react';

interface FirebaseStatusModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const FirebaseStatusModal: React.FC<FirebaseStatusModalProps> = ({ isOpen, onClose }) => {
  const [status, setStatus] = useState<FirebaseConfigState>(() => store.getFirebaseStatus());
  const [testResult, setTestResult] = useState<{ loading: boolean; success?: boolean; message?: string }>({ loading: false });
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
      setTestResult({ loading: false, success: res.success, message: res.message });
      setStatus(store.getFirebaseStatus());
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setTestResult({ loading: false, success: false, message: msg });
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
VITE_FIREBASE_API_KEY=AIzaSy... (Sua chave Web API do Console Firebase)
VITE_FIREBASE_AUTH_DOMAIN=amandita-sabores.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=amandita-sabores
VITE_FIREBASE_STORAGE_BUCKET=amandita-sabores.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=630521361717
VITE_FIREBASE_APP_ID=1:630521361717:web:...`;

  const copyEnvToClipboard = () => {
    navigator.clipboard.writeText(envTemplate);
    setCopiedEnv(true);
    setTimeout(() => setCopiedEnv(false), 2000);
  };

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
                <h2 className="text-lg font-black tracking-tight text-white">Integração Firebase Firestore</h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-white/20 text-white">
                  amandita-sabores
                </span>
              </div>
              <p className="text-xs text-[#D9C7B8]">
                Banco de Dados em Tempo Real, Persistência e Sincronização entre Dispositivos
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
          <div className={`p-4 rounded-2xl border flex items-start justify-between gap-4 ${
            status.isConfigured && status.isConnected
              ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
              : 'bg-amber-50 border-amber-200 text-amber-950'
          }`}>
            <div className="flex items-start gap-3">
              <div className={`p-2 rounded-xl mt-0.5 ${
                status.isConfigured && status.isConnected ? 'bg-emerald-600 text-white' : 'bg-amber-600 text-white'
              }`}>
                {status.isConfigured && status.isConnected ? <Wifi className="w-5 h-5" /> : <WifiOff className="w-5 h-5" />}
              </div>
              <div>
                <h3 className="font-bold text-sm">
                  {status.isConfigured && status.isConnected
                    ? 'Conectado ao Cloud Firestore & Firebase Auth'
                    : 'Modo Cache Resiliente Ativo (Aguardando Credenciais Web)'}
                </h3>
                <p className="text-xs mt-1 leading-relaxed opacity-90">
                  {status.isConfigured && status.isConnected
                    ? 'Os dados do cardápio, pedidos da cozinha KDS, PDV e entregadores são sincronizados em tempo real através do Cloud Firestore.'
                    : 'A aplicação está funcionando com cache local seguro e resiliente. Para persistência multidevice no projeto amandita-sabores, configure as variáveis de ambiente VITE_FIREBASE_*.'}
                </p>
                <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[11px] font-semibold">
                  <span className="bg-white/80 px-2.5 py-1 rounded-lg border border-current/20">
                    Project ID: <strong>{status.projectId}</strong>
                  </span>
                  <span className="bg-white/80 px-2.5 py-1 rounded-lg border border-current/20">
                    Região: <strong>{status.region}</strong> (São Paulo)
                  </span>
                  <span className="bg-white/80 px-2.5 py-1 rounded-lg border border-current/20">
                    Database: <strong>{status.databaseId}</strong>
                  </span>
                </div>
              </div>
            </div>

            <button
              onClick={handleTestConnection}
              disabled={testResult.loading}
              className="shrink-0 px-3 py-1.5 bg-white border border-[#E8DFD5] hover:bg-slate-50 text-xs font-bold rounded-xl shadow-2xs flex items-center gap-1.5 transition cursor-pointer active:scale-95 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${testResult.loading ? 'animate-spin' : ''}`} />
              <span>{testResult.loading ? 'Testando...' : 'Testar Conexão'}</span>
            </button>
          </div>

          {/* Test connection result notice */}
          {testResult.message && (
            <div className={`p-3 rounded-xl border text-xs flex items-center gap-2 ${
              testResult.success ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800'
            }`}>
              {testResult.success ? <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" /> : <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />}
              <span>{testResult.message}</span>
            </div>
          )}

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
                disabled={migrationResult.loading}
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
                Se o site na Vercel foi compilado antes de adicionar as variáveis de ambiente, insira a chave da Web API abaixo para conectar este dispositivo imediatamente ao Cloud Firestore (amandita-sabores):
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="block text-[11px] font-bold text-[#3D2314] mb-1">
                    VITE_FIREBASE_API_KEY (Web API Key):
                  </label>
                  <input
                    type="password"
                    id="input-custom-firebase-key"
                    placeholder="AIzaSy..."
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
                    placeholder="1:630521361717:web:..."
                    defaultValue={status.hasAppId ? '1:630521361717:web:...' : ''}
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
                      alert('Por favor, informe uma chave de API válida do Firebase (ex: AIzaSy...).');
                      return;
                    }
                    saveCustomFirebaseConfig({
                      apiKey: keyInput,
                      appId: appInput || '1:630521361717:web:amanditasabores',
                      projectId: 'amandita-sabores',
                      authDomain: 'amandita-sabores.firebaseapp.com',
                      storageBucket: 'amandita-sabores.appspot.com',
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
                  <span>Configuração Permanente no Vercel (Recomendado para Produção)</span>
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
                <p className="font-bold">⚠️ Como ativar no Vercel para todos os dispositivos:</p>
                <ol className="list-decimal pl-4 space-y-0.5">
                  <li>Acesse o painel da <strong>Vercel</strong> → Seu projeto <strong>Amandita Sabores</strong>.</li>
                  <li>Clique em <strong>Settings</strong> → <strong>Environment Variables</strong>.</li>
                  <li>Adicione <code>VITE_FIREBASE_API_KEY</code> e <code>VITE_FIREBASE_APP_ID</code>.</li>
                  <li><strong>Importante:</strong> Como o Vite embute variáveis <code>VITE_*</code> no momento da compilação do JavaScript, após salvar na Vercel acesse a aba <strong>Deployments</strong> e clique em <strong>Redeploy</strong> para gerar o novo pacote compilado com as credenciais.</li>
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
