import React, { useState, useEffect } from 'react';
import { store } from '../../services/store';
import { RestaurantConfig, User } from '../../types';
import { generatePixCopiaECola, sanitizePixKey, sanitizeMerchantName, sanitizeMerchantCity } from '../../utils/pix';
import { generateQRCodeDataUrl } from '../../utils/qrcode';
import { formatCurrency } from '../../utils/formatters';
import { 
  QrCode, 
  Settings, 
  Save, 
  CheckCircle2, 
  Copy, 
  Check, 
  Smartphone, 
  Building, 
  MapPin, 
  Phone, 
  Clock, 
  DollarSign, 
  Sparkles,
  AlertCircle,
  Flame,
  Database,
  Download,
  RotateCcw,
  Lock,
  ShieldAlert,
  Eye,
  EyeOff,
  RefreshCw,
  AlertTriangle,
  Store,
  X,
  Bell,
  Volume2,
  VolumeX
} from 'lucide-react';
import { FirebaseStatusModal } from './FirebaseStatusModal';
import { PrinterSettings } from './PrinterSettings';
import { PWAInstallButton } from '../common/PWAInstallButton';
import { pushNotificationService } from '../../services/pushNotification';
import { soundService } from '../../services/audio';

interface StoreSettingsProps {
  currentUser?: User | null;
  onNavigateToPdv?: () => void;
}

export const StoreSettings: React.FC<StoreSettingsProps> = ({ currentUser, onNavigateToPdv }) => {
  const [config, setConfig] = useState<RestaurantConfig>(() => store.getRestaurantConfig());
  const [isFirebaseModalOpen, setIsFirebaseModalOpen] = useState(false);
  const [isSaved, setIsSaved] = useState(false);

  // Firebase Live Test
  const [isTestingFirebase, setIsTestingFirebase] = useState(false);
  const [firebaseTestResult, setFirebaseTestResult] = useState<{
    success?: boolean;
    message?: string;
    details?: string;
  } | null>(null);

  // Protected Data Restoration
  const [isRestoreModalOpen, setIsRestoreModalOpen] = useState(false);
  const [restoreStep, setRestoreStep] = useState<'password' | 'confirm'>('password');
  const [adminPasswordInput, setAdminPasswordInput] = useState('');
  const [showAdminPassword, setShowAdminPassword] = useState(false);
  const [isCheckingPassword, setIsCheckingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const [confirmUnderstand, setConfirmUnderstand] = useState(false);

  const activeUser = currentUser || store.getCurrentUser();
  const isAdmin = Boolean(
    (activeUser?.role || '').toUpperCase() === 'ADMINISTRADOR' ||
    activeUser?.username === 'admin'
  );

  // Handlers for Firebase Connection Test
  const handleTestFirebaseConnection = async () => {
    setIsTestingFirebase(true);
    setFirebaseTestResult(null);
    try {
      const res = await store.testConnection();
      setFirebaseTestResult(res);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setFirebaseTestResult({
        success: false,
        message: msg,
        details: 'Falha durante o teste de conexão com o Firebase.'
      });
    } finally {
      setIsTestingFirebase(false);
    }
  };

  // Push Notification State & Handlers
  const [pushStatus, setPushStatus] = useState<{
    supported: boolean;
    permission: NotificationPermission;
    subscribed: boolean;
  }>({
    supported: pushNotificationService.isSupported(),
    permission: pushNotificationService.getPermission(),
    subscribed: false,
  });
  const [isSubscribingPush, setIsSubscribingPush] = useState(false);
  const [isTestingPush, setIsTestingPush] = useState(false);
  const [pushFeedback, setPushFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // New Order Alert Sound Volume & Mute State
  const [orderVolume, setOrderVolume] = useState<number>(() => soundService.getNewOrderVolume());
  const [isOrderMuted, setIsOrderMuted] = useState<boolean>(() => soundService.isNewOrderMuted());

  const handleVolumeChange = (newVol: number) => {
    setOrderVolume(newVol);
    soundService.setNewOrderVolume(newVol);
  };

  const handleToggleMuteOrder = (muted: boolean) => {
    setIsOrderMuted(muted);
    soundService.setNewOrderMuted(muted);
  };

  const handleTestAudio = () => {
    soundService.testNewOrderAlert();
  };

  useEffect(() => {
    pushNotificationService.getStatus().then((st) => {
      setPushStatus({
        supported: st.supported,
        permission: st.permission,
        subscribed: st.subscribed,
      });
    }).catch(() => {});
  }, []);

  const handleEnablePush = async () => {
    setIsSubscribingPush(true);
    setPushFeedback(null);
    try {
      const role = activeUser?.role || 'staff';
      const res = await pushNotificationService.requestAndSubscribe(role);
      if (res.success) {
        setPushFeedback({ type: 'success', message: res.message });
        const st = await pushNotificationService.getStatus();
        setPushStatus({
          supported: st.supported,
          permission: st.permission,
          subscribed: st.subscribed,
        });
      } else {
        setPushFeedback({ type: 'error', message: res.message });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setPushFeedback({ type: 'error', message: msg });
    } finally {
      setIsSubscribingPush(false);
    }
  };

  const handleTestPush = async () => {
    setIsTestingPush(true);
    setPushFeedback(null);
    try {
      const res = await fetch('/api/push/test', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
      });

      // Safely read response text first to eliminate "Unexpected end of JSON input" errors
      const rawText = await res.text().catch(() => '');
      let data: any = null;
      if (rawText && rawText.trim()) {
        try {
          data = JSON.parse(rawText);
        } catch {
          // Body is not JSON (e.g., HTML fallback or plain text error)
        }
      }

      if (res.ok && data && data.success) {
        setPushFeedback({
          type: 'success',
          message: data.message || 'Notificação de teste enviada com sucesso!',
        });
      } else if (data && data.message) {
        setPushFeedback({
          type: 'error',
          message: `Servidor (HTTP ${res.status}): ${data.message}`,
        });
      } else if (!res.ok) {
        let diagnosis = '';
        if (res.status === 404 || res.status === 405) {
          diagnosis = 'A rota /api/push/test não foi encontrada no servidor da Vercel. Verifique se a pasta /api está implantada.';
        } else if (res.status === 502 || res.status === 504) {
          diagnosis = 'O gateway da Vercel retornou timeout ou indisponibilidade temporária.';
        } else if (!rawText || !rawText.trim()) {
          diagnosis = 'O servidor retornou resposta vazia (sem corpo de dados).';
        } else {
          diagnosis = rawText.slice(0, 120);
        }
        setPushFeedback({
          type: 'error',
          message: `Erro HTTP ${res.status} (${res.statusText || 'Falha na requisição'}): ${diagnosis}`,
        });
      } else {
        setPushFeedback({
          type: 'error',
          message: `Resposta inesperada do servidor (HTTP ${res.status}). O servidor não retornou conteúdo JSON válido.`,
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setPushFeedback({ type: 'error', message: `Erro de rede ao comunicar com o servidor: ${msg}` });
    } finally {
      setIsTestingPush(false);
    }
  };

  // Handlers for Protected Data Restoration
  const handleOpenRestoreModal = () => {
    setRestoreStep('password');
    setAdminPasswordInput('');
    setPasswordError(null);
    setConfirmUnderstand(false);
    setIsRestoreModalOpen(true);
  };

  const handleValidatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError(null);
    if (!adminPasswordInput.trim()) {
      setPasswordError('Por favor, informe a senha do administrador.');
      return;
    }
    setIsCheckingPassword(true);
    try {
      const res = await store.verifyAdminPassword(adminPasswordInput);
      if (res.success) {
        setRestoreStep('confirm');
      } else {
        setPasswordError(res.message || 'Senha incorreta. Acesso não autorizado.');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setPasswordError(`Erro na validação: ${msg}`);
    } finally {
      setIsCheckingPassword(false);
    }
  };

  const handleExecuteRestore = () => {
    if (!confirmUnderstand) return;
    setIsRestoring(true);
    const active = currentUser || store.getCurrentUser();
    if (active) {
      store.logAccess({
        userId: active.id,
        username: active.username || active.name || 'admin',
        role: active.role,
        action: 'RESTAURACAO_DADOS',
        details: 'Restauração de dados executada após autenticação de administrador.',
      });
    }
    store.resetToSampleData();
    setIsRestoreModalOpen(false);
    window.location.reload();
  };

  // PIX Test Simulation
  const [testAmount, setTestAmount] = useState('25.00');
  const [testPixCode, setTestPixCode] = useState('');
  const [testQrDataUrl, setTestQrDataUrl] = useState('');
  const [copiedTestCode, setCopiedTestCode] = useState(false);

  const generateTestPix = async () => {
    if (!config.pixKey.trim()) {
      setTestPixCode('');
      setTestQrDataUrl('');
      return;
    }
    const amt = parseFloat(testAmount) || 1.00;
    try {
      const payload = generatePixCopiaECola({
        pixKey: config.pixKey.trim(),
        keyType: config.pixKeyType,
        receiverName: config.pixReceiverName?.trim() || config.name,
        receiverCity: config.pixReceiverCity?.trim() || 'CAMPINA GRANDE',
        amount: amt,
        txId: 'TESTEPIX',
        description: 'Amandita Sabores',
      });
      setTestPixCode(payload);
      const qr = await generateQRCodeDataUrl(payload, { width: 260, margin: 1 });
      setTestQrDataUrl(qr);
    } catch {
      setTestPixCode(config.pixKey);
    }
  };

  useEffect(() => {
    generateTestPix();
  }, [config.pixKey, config.pixKeyType, config.pixReceiverName, config.pixReceiverCity, config.name, testAmount]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Normalize BACEN fields to ensure the stored configuration never corrupts
    const normalizedConfig: RestaurantConfig = {
      ...config,
      pixKey: sanitizePixKey(config.pixKey, config.pixKeyType),
      pixReceiverName: sanitizeMerchantName(config.pixReceiverName || config.name),
      pixReceiverCity: sanitizeMerchantCity(config.pixReceiverCity || 'CAMPINA GRANDE'),
    };
    setConfig(normalizedConfig);
    store.updateRestaurantConfig(normalizedConfig);
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 3000);
  };

  const handleCopyTestPix = () => {
    if (!testPixCode) return;
    navigator.clipboard.writeText(testPixCode);
    setCopiedTestCode(true);
    setTimeout(() => setCopiedTestCode(false), 2000);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-5xl mx-auto">
      {/* Top Header */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-amber-500/10 text-amber-700 flex items-center justify-center font-bold text-xl border border-amber-500/20">
            <Settings className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-lg font-black text-slate-900">Configurações & Chave PIX do Restaurante</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Cadastre sua chave PIX para geração automática do QR Code com o valor exato da compra no cardápio e no balcão.
            </p>
          </div>
        </div>

        <button
          type="submit"
          className="px-5 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-xl text-xs flex items-center gap-2 transition shadow-xs cursor-pointer"
        >
          {isSaved ? <CheckCircle2 className="w-4 h-4 text-slate-950" /> : <Save className="w-4 h-4" />}
          <span>{isSaved ? 'Configurações Salvas!' : 'Salvar Alterações'}</span>
        </button>
      </div>

      {/* FIREBASE CLOUD INTEGRATION CARD */}
      <div className="bg-gradient-to-r from-[#1F100B] via-[#331C13] to-[#4A2E1F] text-white rounded-2xl p-5 border border-[#6B4B3E]/40 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-[#FFCA28]/20 text-[#FFCA28] border border-[#FFCA28]/30 flex items-center justify-center font-bold">
            <Flame className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-black text-white">Banco de Dados em Nuvem: Cloud Firestore</h3>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-amber-500/20 text-[#FFCA28] border border-[#FFCA28]/30">
                amandita-sabores
              </span>
            </div>
            <p className="text-xs text-[#D9C7B8] mt-0.5">
              Sincronização em tempo real entre PDV balcão, cozinha KDS, cardápio do cliente e entregadores.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setIsFirebaseModalOpen(true)}
          className="px-4 py-2 bg-gradient-to-r from-[#C86D3B] to-[#721C24] hover:opacity-90 text-white font-bold rounded-xl text-xs flex items-center gap-2 shadow-xs transition cursor-pointer"
        >
          <Database className="w-4 h-4 text-[#FFCA28]" />
          <span>Gerenciar Conexão & Migração</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* SECTION 1: DADOS DO PIX (2 colunas) */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-xs space-y-5">
            <div className="flex items-center gap-2.5 pb-3 border-b border-slate-100">
              <div className="w-8 h-8 rounded-xl bg-teal-500/10 text-teal-700 flex items-center justify-center font-bold">
                <QrCode className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">Cadastro de Chave PIX Oficial (Banco Central / BR Code)</h3>
                <p className="text-[11px] text-slate-500">
                  Gera automaticamente o QR Code e a Chave Copia e Cola no valor exato do pedido para o cliente pagar
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Tipo de Chave */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Tipo da Chave PIX
                </label>
                <select
                  value={config.pixKeyType || 'EMAIL'}
                  onChange={(e) => setConfig({ ...config, pixKeyType: e.target.value as any })}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                >
                  <option value="CPF">CPF (11 dígitos)</option>
                  <option value="CNPJ">CNPJ (14 dígitos)</option>
                  <option value="TELEFONE">Telefone Celular (com DDD)</option>
                  <option value="EMAIL">E-mail</option>
                  <option value="ALEATORIA">Chave Aleatória (EVP)</option>
                </select>
              </div>

              {/* Chave PIX */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Chave PIX Cadastrada *
                </label>
                <input
                  type="text"
                  required
                  value={config.pixKey}
                  onChange={(e) => setConfig({ ...config, pixKey: e.target.value })}
                  placeholder={
                    config.pixKeyType === 'TELEFONE'
                      ? 'Ex: (83) 99123-4567'
                      : config.pixKeyType === 'CPF'
                      ? 'Ex: 123.456.789-00'
                      : config.pixKeyType === 'CNPJ'
                      ? 'Ex: 12.345.678/0001-90'
                      : config.pixKeyType === 'ALEATORIA'
                      ? 'Ex: 123e4567-e89b-12d3-a456-426614174000'
                      : 'Ex: contato@amanditasabores.com.br'
                  }
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono font-bold text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
                <span className="text-[10px] text-slate-400 mt-1 block">
                  Formatada para BACEN: <strong className="font-mono text-emerald-700">{sanitizePixKey(config.pixKey, config.pixKeyType) || '—'}</strong>
                </span>
              </div>

              {/* Nome do Beneficiário */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Nome do Titular / Razão Social *
                </label>
                <input
                  type="text"
                  value={config.pixReceiverName || ''}
                  onChange={(e) => setConfig({ ...config, pixReceiverName: e.target.value })}
                  placeholder="Ex: AMANDITA SABORES"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500 uppercase"
                />
                <span className="text-[10px] text-slate-400 mt-1 block">
                  BACEN (máx 25 chars): <strong className="text-slate-700">{sanitizeMerchantName(config.pixReceiverName || config.name)}</strong> ({sanitizeMerchantName(config.pixReceiverName || config.name).length}/25)
                </span>
              </div>

              {/* Cidade do Beneficiário */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Cidade do Titular da Conta *
                </label>
                <input
                  type="text"
                  value={config.pixReceiverCity || 'CAMPINA GRANDE'}
                  onChange={(e) => setConfig({ ...config, pixReceiverCity: e.target.value })}
                  placeholder="Ex: CAMPINA GRANDE"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500 uppercase"
                />
                <span className="text-[10px] text-slate-400 mt-1 block">
                  BACEN (máx 15 chars): <strong className="text-slate-700">{sanitizeMerchantCity(config.pixReceiverCity || 'CAMPINA GRANDE')}</strong> ({sanitizeMerchantCity(config.pixReceiverCity || 'CAMPINA GRANDE').length}/15)
                </span>
              </div>
            </div>

            <div className="p-3 bg-emerald-50/80 border border-emerald-200/80 rounded-xl text-xs text-emerald-950 flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <span>
                <strong>Padrão Oficial BACEN BR Code (Estático com valor):</strong> O QR Code gerado segue rigorosamente o padrão do Banco Central (Ponto de Iniciação <code className="bg-emerald-100 text-emerald-900 px-1 py-0.5 rounded text-[11px] font-mono">01: 11</code>), permitindo leitura imediata e sem erros em qualquer aplicativo de banco (Nubank, Itaú, Banco do Brasil, Bradesco, Inter, Santander, Caixa e Mercado Pago).
              </span>
            </div>
          </div>

          {/* SECTION 2: DADOS DO ESTABELECIMENTO */}
          <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-xs space-y-4">
            <div className="flex items-center gap-2.5 pb-3 border-b border-slate-100">
              <div className="w-8 h-8 rounded-xl bg-blue-500/10 text-blue-700 flex items-center justify-center font-bold">
                <Building className="w-4 h-4" />
              </div>
              <h3 className="text-sm font-bold text-slate-900">Dados do Estabelecimento & Atendimento</h3>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Nome do Restaurante</label>
                <input
                  type="text"
                  value={config.name}
                  onChange={(e) => setConfig({ ...config, name: e.target.value })}
                  className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">WhatsApp para Receber Pedidos</label>
                <input
                  type="text"
                  value={config.whatsapp}
                  onChange={(e) => setConfig({ ...config, whatsapp: e.target.value.replace(/[^0-9]/g, '') })}
                  placeholder="5511987654321 (com DDI e DDD)"
                  className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono text-slate-800"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Endereço da Loja (Retirada no Balcão)</label>
                <input
                  type="text"
                  value={config.address}
                  onChange={(e) => setConfig({ ...config, address: e.target.value })}
                  className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Cidade e UF</label>
                <input
                  type="text"
                  value={config.city}
                  onChange={(e) => setConfig({ ...config, city: e.target.value })}
                  className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800"
                />
              </div>
            </div>

            {/* Prazos e Taxas */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-3 border-t border-slate-100">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Taxa de Entrega Base (R$)</label>
                <div className="relative">
                  <span className="absolute left-3 top-2 text-xs font-bold text-slate-400">R$</span>
                  <input
                    type="number"
                    step="0.50"
                    min="0"
                    value={config.deliveryFeeBase}
                    onChange={(e) => setConfig({ ...config, deliveryFeeBase: parseFloat(e.target.value) || 0 })}
                    className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono font-bold text-slate-800"
                  />
                </div>
                <span className="text-[10px] text-slate-400 mt-1 block">Cobrado apenas no Delivery</span>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Preparo Médio (minutos)</label>
                <input
                  type="number"
                  min="5"
                  value={config.avgPrepTimeMinutes}
                  onChange={(e) => setConfig({ ...config, avgPrepTimeMinutes: parseInt(e.target.value, 10) || 20 })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono font-bold text-slate-800"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Entrega Média (minutos)</label>
                <input
                  type="number"
                  min="5"
                  value={config.avgDeliveryTimeMinutes}
                  onChange={(e) => setConfig({ ...config, avgDeliveryTimeMinutes: parseInt(e.target.value, 10) || 20 })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono font-bold text-slate-800"
                />
              </div>
            </div>

            {/* Texto do Rodapé do Cupom Térmico */}
            <div className="pt-3 border-t border-slate-100">
              <label className="block text-xs font-bold text-slate-700 mb-1.5">Texto do rodapé do cupom</label>
              <input
                type="text"
                placeholder="Ex: Instagram: @amanditasabores ou @nomedoperfil"
                value={config.receiptFooterText || ''}
                onChange={(e) => setConfig({ ...config, receiptFooterText: e.target.value })}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800"
              />
              <span className="text-[10px] text-slate-400 mt-1 block">
                Texto exibido no final de cada comprovante impresso (térmico e visual). Se deixado em branco, a linha do rodapé não será impressa.
              </span>
            </div>
          </div>
        </div>

        {/* SECTION 3: SIMULADOR E TESTE DO QR CODE PIX EM TEMPO REAL (1 coluna) */}
        <div className="space-y-6">
          <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-xs space-y-4">
            <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
              <QrCode className="w-4 h-4 text-emerald-600" />
              <h3 className="text-sm font-bold text-slate-900">Teste do QR Code PIX</h3>
            </div>

            <p className="text-xs text-slate-500">
              Veja exatamente como o seu cliente verá o QR Code do PIX com o valor exato:
            </p>

            <div>
              <label className="block text-[11px] font-bold text-slate-600 mb-1">
                Valor para Simulação (R$):
              </label>
              <input
                type="number"
                step="0.01"
                min="0.10"
                value={testAmount}
                onChange={(e) => setTestAmount(e.target.value)}
                className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono font-bold text-slate-900"
              />
            </div>

            {/* QR Code Container */}
            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200/80 flex flex-col items-center justify-center">
              {testQrDataUrl ? (
                <img
                  src={testQrDataUrl}
                  alt="QR Code PIX de Teste"
                  className="w-48 h-48 rounded-xl shadow-xs border border-white"
                />
              ) : (
                <div className="w-48 h-48 bg-slate-200 animate-pulse rounded-xl flex items-center justify-center text-slate-400 text-xs">
                  Cadastre a chave PIX
                </div>
              )}

              <div className="text-center mt-2.5">
                <span className="text-xs font-bold text-emerald-700 font-mono">
                  {formatCurrency(parseFloat(testAmount) || 0)}
                </span>
                <p className="text-[10px] text-slate-400">Beneficiário: {config.pixReceiverName || config.name}</p>
              </div>
            </div>

            {/* Copia e Cola Code */}
            {testPixCode && (
              <div className="space-y-1.5">
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  Código PIX Copia e Cola Gerado:
                </label>
                <div className="p-2 bg-slate-100 rounded-xl font-mono text-[10px] text-slate-700 break-all max-h-20 overflow-y-auto border border-slate-200">
                  {testPixCode}
                </div>
                <button
                  type="button"
                  onClick={handleCopyTestPix}
                  className="w-full py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition"
                >
                  {copiedTestCode ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedTestCode ? 'Código Copiado!' : 'Copiar Código PIX'}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* SECTION 4: IMPRESSORA DE PEDIDOS TÉRMICA 58MM BLUETOOTH */}
      <PrinterSettings />

      {/* SECTION 5: INSTALAR APLICATIVO (PWA) */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-700 flex items-center justify-center font-bold">
              <Download className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Instalar aplicativo (PWA)</h3>
              <p className="text-xs text-slate-500">
                Instale o Amandita Sabores no seu celular Android, iPhone ou computador para acesso instantâneo em tela cheia.
              </p>
            </div>
          </div>
          <PWAInstallButton variant="primary" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1 text-xs text-slate-600">
          <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80">
            <span className="font-bold text-slate-800 block mb-1">Android (Google Chrome)</span>
            <p className="text-[11px] leading-relaxed">
              Clique em "Instalar App" acima ou no menu do Chrome (três pontos) e selecione "Instalar aplicativo" para criar o ícone na tela inicial.
            </p>
          </div>
          <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80">
            <span className="font-bold text-slate-800 block mb-1">iPhone / iPad (Safari)</span>
            <p className="text-[11px] leading-relaxed">
              Toque no botão de Compartilhar (quadrado com seta para cima) na barra do Safari e selecione "Adicionar à Tela de Início".
            </p>
          </div>
          <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80">
            <span className="font-bold text-slate-800 block mb-1">Computador (Windows / Mac)</span>
            <p className="text-[11px] leading-relaxed">
              No Chrome ou Edge, clique no ícone de instalação ao lado da barra de endereços para abrir o app em janela independente.
            </p>
          </div>
        </div>
      </div>

      {/* SECTION: NOTIFICAÇÕES PUSH EM SEGUNDO PLANO */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center font-bold">
              <Bell className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-slate-900">Notificações Push em Segundo Plano (Web Push)</h3>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                  pushStatus.permission === 'granted'
                    ? 'bg-emerald-100 text-emerald-800'
                    : pushStatus.permission === 'denied'
                    ? 'bg-rose-100 text-rose-800'
                    : 'bg-amber-100 text-amber-800'
                }`}>
                  {pushStatus.permission === 'granted' ? 'Permissão Ativa' : pushStatus.permission === 'denied' ? 'Bloqueada' : 'Pendente'}
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Receba alertas sonoros e avisos de novos pedidos mesmo com o celular bloqueado ou o navegador em segundo plano.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleEnablePush}
              disabled={isSubscribingPush}
              className="px-3.5 py-2 text-xs font-bold rounded-xl bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-2 transition cursor-pointer shadow-xs disabled:opacity-50"
            >
              <Bell className={`w-3.5 h-3.5 ${isSubscribingPush ? 'animate-bounce' : ''}`} />
              <span>{isSubscribingPush ? 'Ativando...' : 'Ativar no Aparelho'}</span>
            </button>
            <button
              type="button"
              onClick={handleTestPush}
              disabled={isTestingPush}
              className="px-3.5 py-2 text-xs font-bold rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50 border border-slate-200"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isTestingPush ? 'animate-spin' : ''}`} />
              <span>{isTestingPush ? 'Disparando...' : 'Enviar Notificação de Teste'}</span>
            </button>
          </div>
        </div>

        {pushFeedback && (
          <div className={`p-3.5 rounded-xl text-xs flex items-center justify-between gap-2 ${
            pushFeedback.type === 'success' 
              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' 
              : 'bg-rose-50 text-rose-800 border border-rose-200'
          }`}>
            <div className="flex items-center gap-2">
              {pushFeedback.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              )}
              <span>{pushFeedback.message}</span>
            </div>
            <button 
              type="button" 
              onClick={() => setPushFeedback(null)} 
              className="text-slate-400 hover:text-slate-600 font-bold px-1"
            >
              ✕
            </button>
          </div>
        )}

        {/* CONTROLE DE VOLUME DO SOM DAS NOTIFICAÇÕES DE NOVOS PEDIDOS */}
        <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200/80 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Volume2 className="w-4 h-4 text-amber-600" />
              <h4 className="text-xs font-bold text-slate-800">Controle de volume do som das notificações</h4>
            </div>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={isOrderMuted}
                  onChange={(e) => handleToggleMuteOrder(e.target.checked)}
                  className="rounded border-slate-300 text-amber-600 focus:ring-amber-500"
                />
                <span className={isOrderMuted ? 'font-bold text-rose-600' : ''}>Silenciar som de pedidos</span>
              </label>
              <button
                type="button"
                onClick={handleTestAudio}
                className="px-2.5 py-1 text-xs font-bold rounded-lg bg-amber-500 hover:bg-amber-600 text-white flex items-center gap-1 transition cursor-pointer shadow-xs"
              >
                <Volume2 className="w-3.5 h-3.5" />
                <span>Testar som</span>
              </button>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <VolumeX className={`w-4 h-4 ${isOrderMuted || orderVolume === 0 ? 'text-rose-500' : 'text-slate-400'}`} />
            <input
              type="range"
              min="0"
              max="100"
              step="5"
              disabled={isOrderMuted}
              value={isOrderMuted ? 0 : Math.round(orderVolume * 100)}
              onChange={(e) => handleVolumeChange(parseInt(e.target.value, 10) / 100)}
              className="w-full accent-amber-600 cursor-pointer disabled:opacity-40"
            />
            <Volume2 className="w-4 h-4 text-slate-500" />
            <span className="font-mono font-bold text-xs text-slate-700 min-w-[40px] text-right">
              {isOrderMuted ? '0%' : `${Math.round(orderVolume * 100)}%`}
            </span>
          </div>

          <p className="text-[11px] text-slate-500 leading-relaxed">
            Controle exclusivo para o toque de alerta de novos pedidos no balcão e na cozinha. Outros sons do sistema (como confirmações e ações) não são alterados. Funciona tanto no celular quanto no computador e salva sua preferência automaticamente.
          </p>
        </div>

        {/* Guia Android Tela Bloqueada / Economia de Bateria */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-slate-600">
          <div className="p-3.5 bg-amber-500/5 rounded-xl border border-amber-500/20 space-y-1.5">
            <span className="font-bold text-amber-900 flex items-center gap-1.5">
              <Smartphone className="w-4 h-4 text-amber-600" />
              Instruções para Celular Android (Tela Bloqueada)
            </span>
            <p className="text-[11px] leading-relaxed text-slate-600">
              Para receber alertas sonoros com a tela desligada ou bloqueada: no Android, vá em <strong>Configurações &gt; Aplicativos &gt; Chrome (ou Amandita) &gt; Bateria</strong> e marque <strong>"Sem Restrições"</strong> (desativa a economia de bateria/modo Doze para o app).
            </p>
          </div>
          <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200/80 space-y-1.5">
            <span className="font-bold text-slate-800 flex items-center gap-1.5">
              <Check className="w-4 h-4 text-emerald-600" />
              Persistência Segura no Cloud Firestore
            </span>
            <p className="text-[11px] leading-relaxed text-slate-600">
              As inscrições são salvas na coleção <code>push_subscriptions</code> do Firestore. Quando um cliente finaliza um pedido, o servidor despacha o alerta Web Push com prioridade máxima (high urgency) para todos os dispositivos autorizados.
            </p>
          </div>
        </div>
      </div>

      {/* SECTION 6: TESTAR CONEXÃO COM FIREBASE */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center font-bold">
              <Flame className="w-5 h-5 text-amber-500" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Testar conexão com Firebase</h3>
              <p className="text-xs text-slate-500">
                Verifique a comunicação em tempo real entre o Amandita Sabores e o Cloud Firestore na nuvem.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleTestFirebaseConnection}
              disabled={isTestingFirebase}
              className="px-3.5 py-2 text-xs font-bold rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 flex items-center gap-2 transition cursor-pointer shadow-xs disabled:opacity-50"
            >
              <Flame className={`w-4 h-4 ${isTestingFirebase ? 'animate-bounce' : ''}`} />
              <span>{isTestingFirebase ? 'Testando Conexão...' : 'Testar conexão com Firebase'}</span>
            </button>
            <button
              type="button"
              onClick={() => setIsFirebaseModalOpen(true)}
              className="px-3 py-2 text-xs font-semibold rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center gap-1.5 transition cursor-pointer"
              title="Ver painel avançado e migração do Firebase"
            >
              <Database className="w-3.5 h-3.5 text-slate-500" />
              <span className="hidden sm:inline">Diagnóstico Avançado</span>
            </button>
          </div>
        </div>

        {/* Live Test Feedback Banner */}
        {firebaseTestResult && (
          <div className={`p-4 rounded-xl border text-xs space-y-1.5 animate-in fade-in ${
            firebaseTestResult.success
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-rose-50 border-rose-200 text-rose-900'
          }`}>
            <div className="flex items-center gap-2 font-bold text-sm">
              {firebaseTestResult.success ? (
                <>
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>Conexão ativa e verificada com o Cloud Firestore!</span>
                </>
              ) : (
                <>
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>Falha na conexão com o Cloud Firestore</span>
                </>
              )}
            </div>
            <p className="text-xs leading-relaxed opacity-90 pl-6">
              {firebaseTestResult.message}
            </p>
            {firebaseTestResult.details && (
              <p className="text-[11px] font-mono opacity-75 pl-6 bg-black/5 p-2 rounded-lg mt-1 break-all">
                {firebaseTestResult.details}
              </p>
            )}
          </div>
        )}
      </div>

      {/* SECTION 7: RESTAURAR DADOS (PROTEGIDO COM SENHA DO ADMINISTRADOR) */}
      {isAdmin && (
        <div className="bg-white rounded-2xl p-6 border border-rose-200/80 shadow-xs space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-rose-100">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-500/10 text-rose-700 flex items-center justify-center font-bold">
                <RotateCcw className="w-5 h-5 text-rose-600" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <span>Restaurar dados</span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-700 uppercase tracking-wider">
                    Área Crítica
                  </span>
                </h3>
                <p className="text-xs text-slate-500">
                  Reinicializa os dados do sistema para a demonstração padrão inicial (cardápio, pedidos de exemplo e turnos). Requer autenticação por senha do administrador.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={handleOpenRestoreModal}
              className="px-3.5 py-2 text-xs font-bold rounded-xl bg-rose-600 hover:bg-rose-700 text-white flex items-center gap-2 transition cursor-pointer shadow-xs"
            >
              <Lock className="w-3.5 h-3.5" />
              <span>Restaurar dados</span>
            </button>
          </div>

          <div className="p-3 bg-amber-50/70 border border-amber-200/80 rounded-xl text-xs text-amber-900 flex items-start gap-2.5">
            <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <p className="leading-relaxed">
              <strong className="font-bold">Aviso de Segurança:</strong> Esta ferramenta substitui os pedidos locais e turnos de caixa atuais pelos dados padrão de demonstração. A operação é protegida e exige a senha do Administrador e confirmação explícita antes de qualquer alteração.
            </p>
          </div>
        </div>
      )}

      {/* MODAL DE RESTAURAÇÃO DE DADOS COM VALIDAÇÃO DE SENHA */}
      {isRestoreModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200 text-slate-900 relative">
            <button
              type="button"
              onClick={() => setIsRestoreModalOpen(false)}
              className="absolute top-5 right-5 p-1.5 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 transition cursor-pointer"
              aria-label="Fechar"
            >
              <X className="w-4 h-4" />
            </button>

            {/* ETAPA 1: SOLICITAÇÃO E VALIDAÇÃO DA SENHA DO ADMINISTRADOR */}
            {restoreStep === 'password' && (
              <form onSubmit={handleValidatePassword} className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-rose-100 text-rose-700 flex items-center justify-center font-bold">
                    <Lock className="w-6 h-6 text-rose-600" />
                  </div>
                  <div>
                    <h3 className="text-base font-black text-slate-900">Autenticação do Administrador</h3>
                    <p className="text-xs text-slate-500">Restaurar dados do Amandita Sabores</p>
                  </div>
                </div>

                <p className="text-xs text-slate-600 leading-relaxed bg-slate-50 p-3 rounded-xl border border-slate-200/80">
                  Para acessar a ferramenta de restauração, confirme sua senha cadastrada no sistema. Somente administradores autorizados podem continuar.
                </p>

                {passwordError && (
                  <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs flex items-center gap-2 animate-in fade-in">
                    <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                    <span>{passwordError}</span>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                    Senha do Administrador
                  </label>
                  <div className="relative">
                    <input
                      type={showAdminPassword ? 'text' : 'password'}
                      value={adminPasswordInput}
                      onChange={(e) => setAdminPasswordInput(e.target.value)}
                      placeholder="Digite sua senha de acesso"
                      autoFocus
                      className="w-full pl-3.5 pr-10 py-2.5 bg-white border border-slate-300 rounded-xl text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-500/40 focus:border-rose-500 transition"
                    />
                    <button
                      type="button"
                      onClick={() => setShowAdminPassword(!showAdminPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
                    >
                      {showAdminPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setIsRestoreModalOpen(false)}
                    className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={isCheckingPassword}
                    className="px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-xl transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shadow-xs"
                  >
                    <Lock className="w-3.5 h-3.5" />
                    <span>{isCheckingPassword ? 'Verificando...' : 'Validar Senha'}</span>
                  </button>
                </div>
              </form>
            )}

            {/* ETAPA 2: CONFIRMAÇÃO EXPLÍCITA ANTES DE EXECUTAR */}
            {restoreStep === 'confirm' && (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center font-bold">
                    <AlertTriangle className="w-6 h-6 text-amber-600" />
                  </div>
                  <div>
                    <h3 className="text-base font-black text-slate-900">Confirmar Restauração de Dados</h3>
                    <p className="text-xs text-emerald-700 font-semibold flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Identidade de Administrador confirmada
                    </p>
                  </div>
                </div>

                <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-900 space-y-2">
                  <p className="font-bold">
                    Atenção: A restauração pode substituir dados existentes!
                  </p>
                  <p className="leading-relaxed opacity-90">
                    Ao confirmar, os pedidos locais, turnos de caixa e configurações temporárias serão substituídos pela base inicial de demonstração da Amandita Sabores.
                  </p>
                </div>

                <label className="flex items-start gap-2.5 p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={confirmUnderstand}
                    onChange={(e) => setConfirmUnderstand(e.target.checked)}
                    className="mt-0.5 rounded border-slate-300 text-rose-600 focus:ring-rose-500"
                  />
                  <span>
                    Confirmo expressamente que sou o Administrador e desejo restaurar os dados iniciais do sistema.
                  </span>
                </label>

                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setIsRestoreModalOpen(false)}
                    className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={handleExecuteRestore}
                    disabled={!confirmUnderstand || isRestoring}
                    className="px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-xl transition flex items-center gap-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shadow-xs"
                  >
                    <RotateCcw className={`w-3.5 h-3.5 ${isRestoring ? 'animate-spin' : ''}`} />
                    <span>{isRestoring ? 'Restaurando...' : 'Confirmar e Restaurar Dados'}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <FirebaseStatusModal
        isOpen={isFirebaseModalOpen}
        onClose={() => setIsFirebaseModalOpen(false)}
      />
    </form>
  );
};
