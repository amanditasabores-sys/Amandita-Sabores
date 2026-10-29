import React, { useState, useEffect } from 'react';
import { 
  thermalPrinterService, 
  ThermalPrinterConfig, 
  ThermalPrinterStatus, 
  PrinterConnectionMode, 
  PrinterPaperWidth 
} from '../../services/thermalPrinter';
import { 
  Printer, 
  Bluetooth, 
  CheckCircle2, 
  AlertCircle, 
  RefreshCw, 
  Play, 
  FileText, 
  Smartphone, 
  Info, 
  Check, 
  HelpCircle,
  Unplug
} from 'lucide-react';

export const PrinterSettings: React.FC = () => {
  const [config, setConfig] = useState<ThermalPrinterConfig>(() => thermalPrinterService.getConfig());
  const [status, setStatus] = useState<ThermalPrinterStatus>(() => thermalPrinterService.getStatus());
  const [isConnecting, setIsConnecting] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    const unsub = thermalPrinterService.subscribe((newStatus) => {
      setStatus(newStatus);
    });
    return unsub;
  }, []);

  const handleConnectBle = async () => {
    setIsConnecting(true);
    setActionFeedback(null);
    try {
      const res = await thermalPrinterService.connectBluetoothBLE();
      if (res.success) {
        setActionFeedback({ type: 'success', message: res.message });
        setConfig(thermalPrinterService.getConfig());
      } else {
        setActionFeedback({ type: 'error', message: res.message });
      }
    } catch (err: any) {
      setActionFeedback({ type: 'error', message: err.message || 'Falha ao buscar dispositivos Bluetooth.' });
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    await thermalPrinterService.disconnectBluetooth();
    setActionFeedback({ type: 'success', message: 'Impressora desconectada.' });
    setConfig(thermalPrinterService.getConfig());
  };

  const handlePrintTest = async () => {
    setIsTesting(true);
    setActionFeedback(null);
    try {
      const res = await thermalPrinterService.printTestReceipt();
      if (res.success) {
        setActionFeedback({ type: 'success', message: res.message });
      } else {
        setActionFeedback({ type: 'error', message: res.message });
      }
    } catch (err: any) {
      setActionFeedback({ type: 'error', message: err.message || 'Falha no teste de impressão.' });
    } finally {
      setIsTesting(false);
    }
  };

  const updateSetting = <K extends keyof ThermalPrinterConfig>(key: K, value: ThermalPrinterConfig[K]) => {
    const updated = thermalPrinterService.saveConfig({ [key]: value });
    setConfig(updated);
  };

  return (
    <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-xs space-y-6">
      {/* Top Title */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-100">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-[#C86D3B] flex items-center justify-center font-bold">
            <Printer className="w-5 h-5 text-[#C86D3B]" />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-900">Impressora de Pedidos (Térmica 58mm Bluetooth)</h3>
            <p className="text-xs text-slate-500">
              Conexão sem fio para impressão automática e manual de comprovantes de produção para Retirada no Balcão.
            </p>
          </div>
        </div>

        {/* Status Badge */}
        <div className="flex items-center gap-2">
          {status.connected ? (
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full text-xs font-bold">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>Conectada: {status.deviceName || 'Impressora 58mm'}</span>
            </div>
          ) : !status.bluetoothSupported && config.connectionMode === 'bluetooth_ble' ? (
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 text-slate-600 border border-slate-200 rounded-full text-xs font-semibold">
              <AlertCircle className="w-3.5 h-3.5 text-slate-400" />
              <span>Web Bluetooth Indisponível</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 text-amber-800 border border-amber-200 rounded-full text-xs font-semibold">
              <span className="w-2 h-2 rounded-full bg-amber-400" />
              <span>Desconectada</span>
            </div>
          )}
        </div>
      </div>

      {/* Action Feedback Banner */}
      {actionFeedback && (
        <div className={`p-3.5 rounded-xl text-xs flex items-center justify-between gap-2 ${
          actionFeedback.type === 'success' 
            ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' 
            : 'bg-red-50 text-red-800 border border-red-200'
        }`}>
          <div className="flex items-center gap-2">
            {actionFeedback.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            )}
            <span>{actionFeedback.message}</span>
          </div>
          <button 
            type="button" 
            onClick={() => setActionFeedback(null)} 
            className="text-slate-400 hover:text-slate-600 font-bold px-1"
          >
            ✕
          </button>
        </div>
      )}

      {/* Main Connection Controls */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Bluetooth Device Pairing Box */}
        <div className="p-4 bg-slate-50 rounded-xl border border-slate-200/90 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
              <Bluetooth className="w-4 h-4 text-blue-600" />
              Dispositivo Bluetooth
            </span>
            <span className="text-[11px] text-slate-500 font-mono">
              {config.lastDeviceName || 'Nenhum'}
            </span>
          </div>

          <p className="text-xs text-slate-600 leading-relaxed">
            Clique no botão abaixo para buscar e conectar sua impressora térmica portátil pareada no Bluetooth do dispositivo.
          </p>

          <div className="flex flex-wrap gap-2 pt-1">
            {!status.connected ? (
              <button
                type="button"
                onClick={handleConnectBle}
                disabled={isConnecting}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-xs transition cursor-pointer"
              >
                {isConnecting ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Buscando impressora...</span>
                  </>
                ) : (
                  <>
                    <Bluetooth className="w-3.5 h-3.5" />
                    <span>Conectar Bluetooth</span>
                  </>
                )}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleDisconnect}
                className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-xl text-xs font-bold flex items-center gap-2 transition cursor-pointer"
              >
                <Unplug className="w-3.5 h-3.5 text-slate-600" />
                <span>Desconectar</span>
              </button>
            )}

            <button
              type="button"
              onClick={handlePrintTest}
              disabled={isTesting}
              className="px-3.5 py-2 bg-white border border-slate-300 hover:bg-slate-100 text-slate-800 rounded-xl text-xs font-bold flex items-center gap-1.5 transition cursor-pointer"
            >
              <Play className="w-3.5 h-3.5 text-amber-600" />
              <span>{isTesting ? 'Imprimindo...' : 'Teste de Impressão'}</span>
            </button>
          </div>
        </div>

        {/* Paper & Specs Box */}
        <div className="p-4 bg-slate-50 rounded-xl border border-slate-200/90 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
              <FileText className="w-4 h-4 text-emerald-600" />
              Especificações do Papel
            </span>
          </div>

          <div className="space-y-2">
            <div>
              <label className="block text-[11px] font-bold text-slate-600 mb-1">
                Largura da Bobina Térmica:
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => updateSetting('paperWidth', '58mm')}
                  className={`py-2 px-3 rounded-xl text-xs font-bold border transition text-center ${
                    config.paperWidth === '58mm'
                      ? 'bg-amber-500/10 border-amber-500 text-amber-900 shadow-xs'
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  58 mm (32 colunas)
                </button>
                <button
                  type="button"
                  onClick={() => updateSetting('paperWidth', '80mm')}
                  className={`py-2 px-3 rounded-xl text-xs font-bold border transition text-center ${
                    config.paperWidth === '80mm'
                      ? 'bg-amber-500/10 border-amber-500 text-amber-900 shadow-xs'
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  80 mm (48 colunas)
                </button>
              </div>
            </div>

            <p className="text-[11px] text-slate-500">
              Formatação monoespaçada calibrada para evitar cortes de palavras e quebras irregulares no cabeçote de 58 mm.
            </p>
          </div>
        </div>
      </div>

      {/* Connection Technology Selection (Triple Compatibility) */}
      <div className="space-y-3">
        <label className="block text-xs font-bold text-slate-800">
          Tecnologia de Conexão Utilizada:
        </label>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* Option 1: Web Bluetooth Direct (BLE) */}
          <div 
            onClick={() => updateSetting('connectionMode', 'bluetooth_ble')}
            className={`p-3.5 rounded-xl border cursor-pointer transition flex flex-col justify-between ${
              config.connectionMode === 'bluetooth_ble'
                ? 'bg-blue-50/60 border-blue-500 text-blue-950 ring-1 ring-blue-500'
                : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300'
            }`}
          >
            <div>
              <div className="flex items-center justify-between pb-1.5">
                <span className="font-bold text-xs flex items-center gap-1.5">
                  <Bluetooth className="w-4 h-4 text-blue-600" />
                  Web Bluetooth Direto
                </span>
                {config.connectionMode === 'bluetooth_ble' && (
                  <Check className="w-4 h-4 text-blue-600" />
                )}
              </div>
              <p className="text-[11px] text-slate-600 leading-relaxed">
                Conexão nativa via Chrome (Android/PC) para impressoras com Bluetooth Low Energy (BLE / GATT). Sem apps auxiliares.
              </p>
            </div>
            <span className="mt-2 text-[10px] font-bold text-blue-700 uppercase tracking-wide">
              Recomendado se suportar BLE
            </span>
          </div>

          {/* Option 2: Android RawBT / QuickPrinter */}
          <div 
            onClick={() => updateSetting('connectionMode', 'android_rawbt')}
            className={`p-3.5 rounded-xl border cursor-pointer transition flex flex-col justify-between ${
              config.connectionMode === 'android_rawbt'
                ? 'bg-amber-50/60 border-amber-500 text-amber-950 ring-1 ring-amber-500'
                : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300'
            }`}
          >
            <div>
              <div className="flex items-center justify-between pb-1.5">
                <span className="font-bold text-xs flex items-center gap-1.5">
                  <Smartphone className="w-4 h-4 text-amber-600" />
                  Android RawBT (Classic SPP)
                </span>
                {config.connectionMode === 'android_rawbt' && (
                  <Check className="w-4 h-4 text-amber-600" />
                )}
              </div>
              <p className="text-[11px] text-slate-600 leading-relaxed">
                Para impressoras Bluetooth 2.0/3.0 que usam protocolo Serial (SPP). Envia o comando térmico via aplicativo RawBT no Android.
              </p>
            </div>
            <span className="mt-2 text-[10px] font-bold text-amber-700 uppercase tracking-wide">
              Compatibilidade 100% no celular
            </span>
          </div>

          {/* Option 3: Browser Print Spooler */}
          <div 
            onClick={() => updateSetting('connectionMode', 'system_print')}
            className={`p-3.5 rounded-xl border cursor-pointer transition flex flex-col justify-between ${
              config.connectionMode === 'system_print'
                ? 'bg-emerald-50/60 border-emerald-500 text-emerald-950 ring-1 ring-emerald-500'
                : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300'
            }`}
          >
            <div>
              <div className="flex items-center justify-between pb-1.5">
                <span className="font-bold text-xs flex items-center gap-1.5">
                  <Printer className="w-4 h-4 text-emerald-600" />
                  Spooler do Sistema (58mm)
                </span>
                {config.connectionMode === 'system_print' && (
                  <Check className="w-4 h-4 text-emerald-600" />
                )}
              </div>
              <p className="text-[11px] text-slate-600 leading-relaxed">
                Utiliza a janela de impressão nativa do navegador pré-configurada para 58 mm. Funciona com qualquer driver do Windows ou serviço de impressão Android.
              </p>
            </div>
            <span className="mt-2 text-[10px] font-bold text-emerald-700 uppercase tracking-wide">
              Universal / Qualquer Sistema
            </span>
          </div>
        </div>
      </div>

      {/* Automation Rules */}
      <div className="space-y-3 pt-2 border-t border-slate-100">
        <label className="block text-xs font-bold text-slate-800">
          Regras de Automação & Balcão:
        </label>

        <div className="space-y-2.5">
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={config.autoPrintPickup}
              onChange={(e) => updateSetting('autoPrintPickup', e.target.checked)}
              className="mt-0.5 rounded text-[#C86D3B] focus:ring-[#C86D3B]"
            />
            <div>
              <span className="text-xs font-bold text-slate-800">
                Imprimir automaticamente novos pedidos de "Retirada no Balcão"
              </span>
              <p className="text-[11px] text-slate-500">
                Assim que um cliente enviar um pedido de retirada e ele for gravado com sucesso no sistema, o comprovante será despachado para a impressora. Pedidos de entrega (delivery) não são impressos automaticamente nesta modalidade.
              </p>
            </div>
          </label>

          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={config.reprintBadge}
              onChange={(e) => updateSetting('reprintBadge', e.target.checked)}
              className="mt-0.5 rounded text-[#C86D3B] focus:ring-[#C86D3B]"
            />
            <div>
              <span className="text-xs font-bold text-slate-800">
                Identificar reimpressões com o texto "*** REIMPRESSÃO ***"
              </span>
              <p className="text-[11px] text-slate-500">
                Evita confusão na cozinha ou no balcão caso um colaborador clique em imprimir uma segunda vez.
              </p>
            </div>
          </label>

          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={config.cutPaper}
              onChange={(e) => updateSetting('cutPaper', e.target.checked)}
              className="mt-0.5 rounded text-[#C86D3B] focus:ring-[#C86D3B]"
            />
            <div>
              <span className="text-xs font-bold text-slate-800">
                Emitir comando de corte / avanço de papel térmico (ESC/POS)
              </span>
              <p className="text-[11px] text-slate-500">
                Envia comando de alimentação de 4 linhas e corte automático para impressoras com guilhotina ou serrilha.
              </p>
            </div>
          </label>
        </div>
      </div>

      {/* Guide Note on Mobile Setup */}
      <div className="p-3.5 bg-blue-50/70 border border-blue-200/80 rounded-xl text-xs space-y-2 text-blue-900">
        <div className="flex items-center gap-2 font-bold text-blue-800">
          <HelpCircle className="w-4 h-4 text-blue-600 shrink-0" />
          <span>Orientações para uso no celular Android</span>
        </div>
        <p className="text-[11px] leading-relaxed text-blue-800">
          <strong>1. Pareamento inicial:</strong> Ligue a impressora portátil e faça o pareamento nas <em>Configurações de Bluetooth do Android</em> (PIN padrão costuma ser <code>0000</code> ou <code>1234</code>).
          <br />
          <strong>2. Se a impressora for Bluetooth BLE:</strong> Use o modo <strong>Web Bluetooth Direto</strong> diretamente no Chrome.
          <br />
          <strong>3. Se a impressora for Bluetooth Clássico (SPP):</strong> O navegador Chrome não permite conexão serial direta. Basta instalar o aplicativo gratuito <strong>RawBT Print Service</strong> na Google Play Store e selecionar o modo <strong>Android RawBT</strong> acima.
        </p>
      </div>
    </div>
  );
};
