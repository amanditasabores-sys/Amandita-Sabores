import React, { useState, useEffect } from 'react';
import { store } from '../../services/store';
import { RestaurantConfig } from '../../types';
import { generatePixCopiaECola } from '../../utils/pix';
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
  Database
} from 'lucide-react';
import { FirebaseStatusModal } from './FirebaseStatusModal';

export const StoreSettings: React.FC = () => {
  const [config, setConfig] = useState<RestaurantConfig>(() => store.getRestaurantConfig());
  const [isFirebaseModalOpen, setIsFirebaseModalOpen] = useState(false);
  const [isSaved, setIsSaved] = useState(false);

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
        receiverName: config.pixReceiverName?.trim() || config.name,
        receiverCity: config.pixReceiverCity?.trim() || 'SAO PAULO',
        amount: amt,
        txId: 'TESTEPIX',
        description: 'Teste PIX GestaoFood',
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
  }, [config.pixKey, config.pixReceiverName, config.pixReceiverCity, testAmount]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    store.updateRestaurantConfig(config);
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
                  <option value="CPF">CPF (Somente números)</option>
                  <option value="CNPJ">CNPJ (Somente números)</option>
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
                  placeholder="Ex: 11987654321 ou loja@email.com"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono font-bold text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
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
                  placeholder="Ex: RESTAURANTE BRASA E SABOR"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500 uppercase"
                />
                <span className="text-[10px] text-slate-400 mt-1 block">Nome que aparece no banco do cliente (máx 25 caracteres)</span>
              </div>

              {/* Cidade do Beneficiário */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Cidade do Titular da Conta *
                </label>
                <input
                  type="text"
                  value={config.pixReceiverCity || 'SAO PAULO'}
                  onChange={(e) => setConfig({ ...config, pixReceiverCity: e.target.value })}
                  placeholder="Ex: SAO PAULO"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500 uppercase"
                />
                <span className="text-[10px] text-slate-400 mt-1 block">Cidade da agência/conta bancária (sem acentos)</span>
              </div>
            </div>

            <div className="p-3 bg-amber-50/70 border border-amber-200/80 rounded-xl text-xs text-amber-900 flex items-start gap-2">
              <Sparkles className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <span>
                <strong>Como funciona o PIX dinâmico:</strong> Quando o cliente finalizar um pedido no cardápio ou o operador registrar uma venda balcão, o sistema criará na hora um QR Code oficial do Banco Central com o <strong>valor exato</strong> daquela compra, agilizando a conferência e o pagamento sem erros de digitação.
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

      <FirebaseStatusModal
        isOpen={isFirebaseModalOpen}
        onClose={() => setIsFirebaseModalOpen(false)}
      />
    </form>
  );
};
