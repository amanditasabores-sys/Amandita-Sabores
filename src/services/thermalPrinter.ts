/**
 * Serviço de Gerenciamento da Impressora Térmica Portátil 58mm (Bluetooth & Spooler)
 * Amandita Sabores - Comprovante de Produção & Balcão
 * 
 * Suporta 3 tecnologias de conexão:
 * 1. Web Bluetooth Direct (BLE / GATT): Conexão direta pelo Google Chrome sem aplicativos extras.
 * 2. Android RawBT / QuickPrinter Intent (Bluetooth Classic SPP): Para impressoras Bluetooth 2.0/3.0.
 * 3. Spooler do Sistema / Navegador (58mm): Impressão gráfica com largura e margens de 58mm.
 */

import { Order, CustomerAddress, OrderRefundInfo } from '../types';
import { formatCurrency, formatDateTime, getPaymentMethodLabel } from '../utils/formatters';
import { CashClosingReportData, formatReportCurrency } from '../utils/cashClosingReport';

export type PrinterPaperWidth = '58mm' | '80mm';
export type PrinterConnectionMode = 'bluetooth_ble' | 'android_rawbt' | 'system_print';

export interface ThermalPrinterConfig {
  enabled: boolean;
  paperWidth: PrinterPaperWidth;
  connectionMode: PrinterConnectionMode;
  autoPrintPickup: boolean;
  soundOnPrint: boolean;
  cutPaper: boolean;
  reprintBadge: boolean;
  copies: number;
  lastDeviceName?: string;
  lastDeviceId?: string;
  bleServiceUuid?: string;
  bleCharUuid?: string;
}

export interface ThermalPrinterStatus {
  connected: boolean;
  reconnecting: boolean;
  hasSavedDevice: boolean;
  deviceName: string | null;
  mode: PrinterConnectionMode;
  bluetoothSupported: boolean;
  isPrinting: boolean;
  lastError: string | null;
  lastPrintedAt: string | null;
}

// Conjunto de UUIDs comuns de impressoras térmicas chinesas e genéricas BLE
const COMMON_BLE_PRINT_SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb', // Standard Printer Service
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2', // POS-58 / MPT-II / Goojprt
  '49535343-fe7d-4ae5-8fa9-9fafd205e455', // ISSC Transparent UART
  '0000ffe0-0000-1000-8000-00805f9b34fb', // HM-10 / CC2540 BLE Serial
  '0000ff00-0000-1000-8000-00805f9b34fb', // Generic POS BLE
  '0000fff0-0000-1000-8000-00805f9b34fb', // Vendor Specific 1
  '0000ae00-0000-1000-8000-00805f9b34fb', // Vendor Specific 2
  '0000fee7-0000-1000-8000-00805f9b34fb', // Tencent / Chinese POS
  '0000af30-0000-1000-8000-00805f9b34fb', // Zjiang / PeriPage / Paperang
  '00001800-0000-1000-8000-00805f9b34fb', // Generic Access
  '0000180a-0000-1000-8000-00805f9b34fb', // Device Information
];

const COMMON_BLE_WRITE_CHARS = [
  '00002af1-0000-1000-8000-00805f9b34fb',
  'bef8d6c9-9c21-4c9e-b632-bd58c1009f9f',
  '49535343-1e4d-4bd9-ba61-23c647249616',
  '0000ffe1-0000-1000-8000-00805f9b34fb',
  '0000ff02-0000-1000-8000-00805f9b34fb',
  '0000fff2-0000-1000-8000-00805f9b34fb',
  '0000ae01-0000-1000-8000-00805f9b34fb',
  '0000fee1-0000-1000-8000-00805f9b34fb',
  '0000af31-0000-1000-8000-00805f9b34fb',
];

const DEFAULT_CONFIG: ThermalPrinterConfig = {
  enabled: true,
  paperWidth: '58mm',
  connectionMode: 'bluetooth_ble',
  autoPrintPickup: true,
  soundOnPrint: true,
  cutPaper: true,
  reprintBadge: true,
  copies: 1,
};

class ThermalPrinterService {
  private config: ThermalPrinterConfig;
  private bleDevice: any = null;
  private gattServer: any = null;
  private writeCharacteristic: any = null;
  private listeners: ((status: ThermalPrinterStatus) => void)[] = [];
  private isPrinting = false;
  private isReconnecting = false;
  private lastError: string | null = null;
  private lastPrintedAt: string | null = null;
  private activeReconnectPromise: Promise<{ success: boolean; message: string }> | null = null;
  private registeredDisconnectDevices: WeakSet<object> = new WeakSet();
  private lastAutoReconnectAttemptAt = 0;
  private readonly AUTO_RECONNECT_COOLDOWN_MS = 4000;

  constructor() {
    this.config = this.loadConfig();
    if (typeof window !== 'undefined' && typeof navigator !== 'undefined') {
      setTimeout(() => {
        this.tryAutoReconnectOnStartup({ silent: true }).catch(() => {});
      }, 300);
      this.setupLifecycleAutoReconnectListeners();
    }
  }

  // ==========================================
  // CONFIGURAÇÃO E PERSISTÊNCIA
  // ==========================================
  public getConfig(): ThermalPrinterConfig {
    return { ...this.config };
  }

  public saveConfig(partial: Partial<ThermalPrinterConfig>): ThermalPrinterConfig {
    this.config = { ...this.config, ...partial };
    try {
      localStorage.setItem('gf_thermal_printer_config', JSON.stringify(this.config));
    } catch {
      // Ignorar erro em ambiente privado
    }
    this.notifyStatus();
    return this.getConfig();
  }

  private loadConfig(): ThermalPrinterConfig {
    try {
      const raw = localStorage.getItem('gf_thermal_printer_config');
      if (raw) {
        return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
      }
    } catch {
      // fallback
    }
    return DEFAULT_CONFIG;
  }

  // ==========================================
  // VERIFICAÇÃO DE SUPORTE DO NAVEGADOR
  // ==========================================
  public isBluetoothSupported(): boolean {
    return typeof navigator !== 'undefined' && Boolean((navigator as any).bluetooth);
  }

  public getStatus(): ThermalPrinterStatus {
    const isConnected = Boolean(
      this.gattServer &&
      this.gattServer.connected &&
      this.writeCharacteristic
    );

    return {
      connected: isConnected,
      reconnecting: this.isReconnecting,
      hasSavedDevice: Boolean(this.config.lastDeviceId || this.bleDevice),
      deviceName: this.bleDevice?.name || this.config.lastDeviceName || null,
      mode: this.config.connectionMode,
      bluetoothSupported: this.isBluetoothSupported(),
      isPrinting: this.isPrinting,
      lastError: this.lastError,
      lastPrintedAt: this.lastPrintedAt,
    };
  }

  public subscribe(callback: (status: ThermalPrinterStatus) => void): () => void {
    this.listeners.push(callback);
    callback(this.getStatus());
    return () => {
      this.listeners = this.listeners.filter((cb) => cb !== callback);
    };
  }

  private notifyStatus(): void {
    const status = this.getStatus();
    this.listeners.forEach((cb) => cb(status));
  }

  // ==========================================
  // CONEXÃO WEB BLUETOOTH (BLE GATT)
  // ==========================================
  public async connectBluetoothBLE(): Promise<{ success: boolean; message: string; deviceName?: string }> {
    if (!this.isBluetoothSupported()) {
      const err = 'O seu navegador não possui suporte ao Web Bluetooth. No Android, use o Google Chrome ou alterne para o modo "Android RawBT".';
      this.lastError = err;
      this.notifyStatus();
      return { success: false, message: err };
    }

    const nav = navigator as any;

    // 1. Verifica se o hardware Bluetooth está ligado no dispositivo
    try {
      if (typeof nav.bluetooth.getAvailability === 'function') {
        const isAvailable = await nav.bluetooth.getAvailability();
        if (!isAvailable) {
          const msg = 'O Bluetooth do seu aparelho está desligado. Por favor, ative o Bluetooth nas configurações do celular/computador e certifique-se de que a impressora está ligada.';
          this.lastError = msg;
          this.notifyStatus();
          return { success: false, message: msg };
        }
      }
    } catch {
      // Ignora erro de checagem prévia caso não suportado
    }

    try {
      this.lastError = null;
      this.notifyStatus();

      // Solicita seleção nativa no Google Chrome
      const device = await nav.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: COMMON_BLE_PRINT_SERVICES,
      });

      if (!device) {
        return { success: false, message: 'Nenhuma impressora Bluetooth foi selecionada.' };
      }

      this.bleDevice = device;
      this.setupDeviceDisconnectionListener(device);

      // Conecta ao GATT Server
      const server = await device.gatt.connect();
      this.gattServer = server;

      // Descobre serviço e característica de escrita ESC/POS
      const foundCharacteristic = await this.discoverWriteCharacteristic(server);

      if (!foundCharacteristic) {
        await this.disconnectBluetooth();
        const err = `Impressora pareada (${device.name || 'Dispositivo'}), mas não foi encontrada a característica de escrita BLE ESC/POS. A maioria das impressoras portáteis de 58mm utiliza Bluetooth clássico (SPP). Selecione o modo "Android RawBT" para imprimir via RawBT.`;
        this.lastError = err;
        this.notifyStatus();
        return { success: false, message: err };
      }

      this.writeCharacteristic = foundCharacteristic;

      this.saveConfig({
        lastDeviceName: device.name || 'Impressora Térmica 58mm',
        lastDeviceId: device.id,
        connectionMode: 'bluetooth_ble',
      });

      this.notifyStatus();
      return {
        success: true,
        message: `Impressora "${device.name || 'Térmica 58mm'}" conectada com sucesso via Bluetooth BLE!`,
        deviceName: device.name,
      };
    } catch (err: any) {
      let msg = err?.message || String(err);
      if (err?.name === 'NotFoundError') {
        msg = 'Nenhuma impressora foi selecionada ou a busca foi cancelada. Se sua impressora não apareceu na lista: 1) Verifique se a impressora está ligada com luz indicadora piscando; 2) No Android, certifique-se de que a Localização/GPS e "Dispositivos Próximos" estão autorizados para o Chrome; 3) Se sua impressora for Bluetooth 2.0/3.0 Clássico (SPP), ela não opera por BLE — utilize o modo "Android RawBT" nas opções.';
      } else if (err?.name === 'SecurityError') {
        msg = 'Permissão de Bluetooth negada pelo navegador. Conceda a permissão de Bluetooth nas configurações do site no Chrome.';
      } else if (err?.name === 'NotSupportedError') {
        msg = 'Web Bluetooth não é suportado nesta plataforma. Utilize o modo "Android RawBT" ou "Spooler do Sistema".';
      }
      this.lastError = msg;
      this.notifyStatus();
      return { success: false, message: msg };
    }
  }

  private isBleConnectionHealthy(): boolean {
    return Boolean(this.gattServer && this.gattServer.connected && this.writeCharacteristic);
  }

  private setupLifecycleAutoReconnectListeners(): void {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const triggerPassiveResumeReconnect = () => {
      if (document.visibilityState === 'hidden') return;
      if (this.config.connectionMode !== 'bluetooth_ble') return;
      if (!this.bleDevice && !this.config.lastDeviceId && !this.config.lastDeviceName) return;
      if (this.isPrinting) return;
      if (this.isBleConnectionHealthy()) return;
      if (this.activeReconnectPromise) return;

      const now = Date.now();
      if (now - this.lastAutoReconnectAttemptAt < this.AUTO_RECONNECT_COOLDOWN_MS) return;

      this.tryAutoReconnectOnStartup({ silent: true }).catch(() => {});
    };

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        triggerPassiveResumeReconnect();
      }
    });

    window.addEventListener('pageshow', (event: PageTransitionEvent) => {
      if (event.persisted || document.visibilityState === 'visible') {
        triggerPassiveResumeReconnect();
      }
    });
  }

  private setupDeviceDisconnectionListener(device: any): void {
    if (!device || typeof device !== 'object' || typeof device.addEventListener !== 'function') return;
    if (this.registeredDisconnectDevices.has(device)) return;
    this.registeredDisconnectDevices.add(device);

    device.addEventListener('gattserverdisconnected', () => {
      // Proteção: ignora evento se pertencer a uma referência antiga já substituída
      if (this.bleDevice && this.bleDevice !== device) return;
      console.info('[BLE] Conexão GATT com a impressora encerrada pelo hardware ou economia de energia.');
      this.writeCharacteristic = null;
      this.gattServer = null;
      this.notifyStatus();
    });
  }

  private async discoverWriteCharacteristic(server: any): Promise<any> {
    let foundCharacteristic: any = null;

    // Prioridade 1: Inspeciona todos os serviços primários expostos
    try {
      const services = await server.getPrimaryServices();
      for (const s of services) {
        try {
          const chars = await s.getCharacteristics();
          for (const c of chars) {
            if (c.properties && (c.properties.write || c.properties.writeWithoutResponse)) {
              foundCharacteristic = c;
              break;
            }
          }
        } catch {
          // Continua busca nos outros serviços
        }
        if (foundCharacteristic) break;
      }
    } catch {
      // Fallback para UUIDs conhecidos
    }

    // Prioridade 2: Consulta serviços conhecidos de impressoras térmicas
    if (!foundCharacteristic) {
      for (const serviceUuid of COMMON_BLE_PRINT_SERVICES) {
        try {
          const service = await server.getPrimaryService(serviceUuid);
          if (service) {
            const characteristics = await service.getCharacteristics();
            for (const char of characteristics) {
              if (char.properties && (char.properties.write || char.properties.writeWithoutResponse)) {
                foundCharacteristic = char;
                break;
              }
            }
          }
        } catch {
          // Continua
        }
        if (foundCharacteristic) break;
      }
    }

    return foundCharacteristic;
  }

  private async connectGattWithTimeout(device: any, timeoutMs: number): Promise<any> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      return await Promise.race([
        device.gatt.connect(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('Tempo limite ao reconectar BLE')), timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Aguarda brevemente um pacote de anúncio BLE (somente se watchAdvertisements for suportado),
   * ajudando o Chrome a localizar dispositivos autorizados devolvidos por getDevices() após reload.
   */
  private async waitForAdvertisementBriefly(device: any, timeoutMs = 3000): Promise<void> {
    if (!device || typeof device.watchAdvertisements !== 'function') return;

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let onAd: (() => void) | null = null;

    try {
      await new Promise<void>((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          if (timer) clearTimeout(timer);
          if (onAd && typeof device.removeEventListener === 'function') {
            device.removeEventListener('advertisementreceived', onAd);
          }
          resolve();
        };

        onAd = () => finish();
        if (typeof device.addEventListener === 'function') {
          device.addEventListener('advertisementreceived', onAd, { once: true });
        }

        timer = setTimeout(finish, timeoutMs);

        const watchPromise = controller
          ? device.watchAdvertisements({ signal: controller.signal })
          : device.watchAdvertisements();

        Promise.resolve(watchPromise).catch(() => finish());
      });
    } catch {
      // Ignora erro caso o navegador não permita watchAdvertisements neste contexto
    } finally {
      if (timer) clearTimeout(timer);
      if (onAd && typeof device.removeEventListener === 'function') {
        device.removeEventListener('advertisementreceived', onAd);
      }
      if (controller) {
        try {
          controller.abort();
        } catch {
          // ignore
        }
      }
    }
  }

  private async resolveSavedBleDevice(nav: any): Promise<any | null> {
    if (this.bleDevice && this.bleDevice.gatt) {
      this.setupDeviceDisconnectionListener(this.bleDevice);
      return this.bleDevice;
    }

    if (
      !nav?.bluetooth ||
      typeof nav.bluetooth.getDevices !== 'function' ||
      (!this.config.lastDeviceId && !this.config.lastDeviceName)
    ) {
      return null;
    }

    try {
      const devices = await nav.bluetooth.getDevices();
      if (!Array.isArray(devices) || devices.length === 0) return null;

      // Prefere correspondência exata por ID salvo; fallback por nome salvo
      const matched =
        (this.config.lastDeviceId ? devices.find((d: any) => d && d.id === this.config.lastDeviceId) : null) ||
        (this.config.lastDeviceName ? devices.find((d: any) => d && d.name === this.config.lastDeviceName) : null);

      if (matched && matched.gatt) {
        this.bleDevice = matched;
        this.setupDeviceDisconnectionListener(matched);
        return matched;
      }
    } catch (e) {
      console.warn('[BLE Reconnect] getDevices aviso:', e);
    }

    return null;
  }

  private async performSerializedBleReconnect(options: {
    silent: boolean;
    timeoutMs: number;
    allowWatchAdvertisements: boolean;
  }): Promise<{ success: boolean; message: string }> {
    // Nunca perturba nem desconecta uma conexão que já está funcionando
    if (this.isBleConnectionHealthy()) {
      return { success: true, message: 'Impressora já conectada e pronta.' };
    }

    // Serialização: se já há uma reconexão em andamento, compartilha a mesma Promise
    if (this.activeReconnectPromise) {
      return this.activeReconnectPromise;
    }

    const nav = typeof navigator !== 'undefined' ? (navigator as any) : null;
    if (!nav?.bluetooth) {
      return { success: false, message: 'Web Bluetooth não suportado neste navegador.' };
    }

    const run = (async (): Promise<{ success: boolean; message: string }> => {
      this.lastAutoReconnectAttemptAt = Date.now();
      this.isReconnecting = true;
      this.notifyStatus();

      try {
        const hadDeviceInMemory = Boolean(this.bleDevice);
        const device = await this.resolveSavedBleDevice(nav);

        if (!device || !device.gatt) {
          return {
            success: false,
            message: options.silent
              ? 'Sessão Bluetooth encerrada pelo recarregamento. Clique em Reconectar Impressora.'
              : 'Handle Bluetooth encerrado pelo navegador ou dispositivo fora de alcance. Clique em "Parear / Reconectar" para autorizar novamente.',
          };
        }

        if (!options.silent) {
          this.lastError = null;
          this.notifyStatus();
        }

        // Até 2 tentativas controladas (nunca loop infinito):
        // Tentativa 1: conexão GATT direta
        // Tentativa 2 (somente se a 1ª falhar): aguarda anúncio BLE se suportado (útil após getDevices()/reload) ou breve pausa
        let lastConnectError: any = null;
        for (let attempt = 1; attempt <= 2; attempt++) {
          if (this.isBleConnectionHealthy()) {
            return {
              success: true,
              message: `Impressora "${device.name || 'Térmica 58mm'}" já conectada e pronta.`,
            };
          }

          if (attempt === 2) {
            if (options.allowWatchAdvertisements && !hadDeviceInMemory && typeof device.watchAdvertisements === 'function') {
              await this.waitForAdvertisementBriefly(device, 3000);
            } else {
              await new Promise((r) => setTimeout(r, 350));
            }
          }

          try {
            const server = await this.connectGattWithTimeout(device, options.timeoutMs);
            this.gattServer = server;

            let foundChar = await this.discoverWriteCharacteristic(server);
            if (!foundChar) {
              // Pequena pausa para impressoras BLE que demoram alguns ms para expor serviços após acordar
              await new Promise((r) => setTimeout(r, 250));
              if (server?.connected) {
                foundChar = await this.discoverWriteCharacteristic(server);
              }
            }

            if (foundChar) {
              this.writeCharacteristic = foundChar;
              this.lastError = null;
              return {
                success: true,
                message: options.silent
                  ? `Impressora "${device.name || 'Térmica 58mm'}" reconectada automaticamente.`
                  : `Impressora "${device.name || 'Térmica 58mm'}" reconectada com sucesso!`,
              };
            }

            // Falha transitória na descoberta da característica:
            // NÃO chama disconnectBluetooth() para preservar this.bleDevice em memória!
            this.writeCharacteristic = null;
            this.gattServer = null;
            lastConnectError = new Error('Impressora reconectada, mas a característica de escrita BLE não foi encontrada.');
          } catch (err: any) {
            this.writeCharacteristic = null;
            this.gattServer = null;
            lastConnectError = err;
          }
        }

        const msg = lastConnectError?.message || String(lastConnectError || 'Falha ao reconectar BLE');
        if (!options.silent) {
          const errorMessage = msg.startsWith('Impressora reconectada')
            ? msg
            : `Falha ao reconectar impressora: ${msg}`;
          this.lastError = errorMessage;
          return { success: false, message: errorMessage };
        }

        return {
          success: false,
          message: 'Conexão BLE aguardando reconexão. Use o botão Reconectar Impressora se necessário.',
        };
      } finally {
        this.isReconnecting = false;
        this.activeReconnectPromise = null;
        this.notifyStatus();
      }
    })();

    this.activeReconnectPromise = run;
    return run;
  }

  /**
   * Tentativa passiva de restauração ao iniciar/recarregar a página ou retornar do segundo plano:
   * Reutiliza this.bleDevice se presente em memória ou recupera via navigator.bluetooth.getDevices().
   * Serializada por activeReconnectPromise para evitar múltiplas conexões GATT simultâneas.
   */
  public async tryAutoReconnectOnStartup(options?: { silent?: boolean }): Promise<{ success: boolean; message: string }> {
    const nav = typeof navigator !== 'undefined' ? (navigator as any) : null;
    if (
      !nav?.bluetooth ||
      this.config.connectionMode !== 'bluetooth_ble' ||
      (!this.bleDevice && !this.config.lastDeviceId && !this.config.lastDeviceName)
    ) {
      return { success: false, message: 'Sem dispositivo BLE prévio para restauração automática.' };
    }

    if (!this.bleDevice && typeof nav.bluetooth.getDevices !== 'function') {
      return { success: false, message: 'Navegador sem suporte a getDevices() para restauração automática.' };
    }

    if (this.isBleConnectionHealthy()) {
      return { success: true, message: 'Impressora já conectada.' };
    }

    return this.performSerializedBleReconnect({
      silent: options?.silent !== false,
      timeoutMs: 5000,
      allowWatchAdvertisements: true,
    });
  }

  /**
   * Reconexão resiliente sem reabrir diálogo nativo do Chrome:
   * Restaura gattServer, preserva this.bleDevice em falhas transitórias,
   * recupera dispositivo via getDevices() se perdido após reload e redescobre a característica ESC/POS.
   */
  public async reconnectSavedBLE(): Promise<{ success: boolean; message: string }> {
    return this.performSerializedBleReconnect({
      silent: false,
      timeoutMs: 6000,
      allowWatchAdvertisements: true,
    });
  }

  public async disconnectBluetooth(): Promise<void> {
    try {
      if (this.gattServer && this.gattServer.connected) {
        this.gattServer.disconnect();
      }
    } catch {
      // ignore
    } finally {
      this.writeCharacteristic = null;
      this.gattServer = null;
      this.bleDevice = null;
      this.notifyStatus();
    }
  }

  // ==========================================
  // DEDUPLICAÇÃO DE IMPRESSÃO
  // ==========================================
  public hasOrderBeenPrinted(orderId: string): boolean {
    try {
      const printed = this.getPrintedOrderIds();
      return printed.has(orderId);
    } catch {
      return false;
    }
  }

  public markOrderAsPrinted(orderId: string): void {
    try {
      const printed = this.getPrintedOrderIds();
      printed.add(orderId);
      const list = Array.from(printed).slice(-300); // Mantém até 300 IDs recentes
      localStorage.setItem('gf_printed_order_ids', JSON.stringify(list));
      this.lastPrintedAt = new Date().toISOString();
      this.notifyStatus();
    } catch {
      // ignore
    }
  }

  public clearPrintedHistory(): void {
    try {
      localStorage.removeItem('gf_printed_order_ids');
    } catch {
      // ignore
    }
  }

  private getPrintedOrderIds(): Set<string> {
    try {
      const data = localStorage.getItem('gf_printed_order_ids');
      if (data) {
        return new Set(JSON.parse(data));
      }
    } catch {
      // ignore
    }
    return new Set<string>();
  }

  // ==========================================
  // FORMATAÇÃO DO COMPROVANTE (58mm / 32 COLUNAS)
  // ==========================================
  private sanitizeText(str: string): string {
    if (!str) return '';
    // Remove diacríticos e normaliza para compatibilidade com código de página CP860/ASCII
    return str
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\x20-\x7E\n\r]/g, '');
  }

  private formatLine(left: string, right: string, maxLen = 32): string {
    const sLeft = this.sanitizeText(left);
    const sRight = this.sanitizeText(right);
    const spaceCount = Math.max(1, maxLen - sLeft.length - sRight.length);
    return sLeft + ' '.repeat(spaceCount) + sRight;
  }

  private centerText(text: string, maxLen = 32): string {
    const s = this.sanitizeText(text);
    if (s.length >= maxLen) return s.slice(0, maxLen);
    const leftPad = Math.floor((maxLen - s.length) / 2);
    return ' '.repeat(leftPad) + s;
  }

  private wrapText(text: string, maxLen = 31, indent = ''): string[] {
    const normalized = (text || '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/\u00A0/g, ' ');
    const paragraphs = normalized.split('\n');
    const lines: string[] = [];

    for (const para of paragraphs) {
      const sanitized = this.sanitizeText(para).replace(/\s+/g, ' ').trim();
      if (!sanitized) continue;
      const words = sanitized.split(' ');
      let currentLine = indent;

      for (const w of words) {
        const candidate = currentLine === indent ? indent + w : `${currentLine} ${w}`;
        if (candidate.length <= maxLen) {
          currentLine = candidate;
        } else {
          if (currentLine.trim()) lines.push(currentLine);
          const usable = Math.max(1, maxLen - indent.length);
          if (w.length > usable) {
            let pos = 0;
            while (pos < w.length) {
              const part = w.slice(pos, pos + usable);
              if (pos + usable < w.length) {
                lines.push(indent + part);
              } else {
                currentLine = indent + part;
              }
              pos += usable;
            }
          } else {
            currentLine = indent + w;
          }
        }
      }
      if (currentLine.trim()) lines.push(currentLine);
    }
    return lines;
  }

  /**
   * Largura segura para recibos de pedido (1 coluna abaixo do limite físico de 32/48 col)
   * evitando auto-wrap de hardware + LF que gera linhas em branco fantasmas em 58 mm.
   */
  private getSafeOrderColumns(): number {
    return this.config.paperWidth === '80mm' ? 47 : 31;
  }

  /**
   * Formata título do item com preço à direita na 1ª linha e continuação
   * aproveitando a largura útil completa (evitando quebras excessivas em 22 colunas).
   */
  private formatOrderItemTitleLines(itemTitle: string, itemPrice: string, cols: number): string[] {
    const cleanTitle = this.sanitizeText(itemTitle.replace(/\u00A0/g, ' ')).replace(/\s+/g, ' ').trim();
    const cleanPrice = this.sanitizeText(itemPrice.replace(/\u00A0/g, ' ')).trim();

    if (cleanTitle.length + cleanPrice.length + 1 <= cols) {
      return [this.formatLine(cleanTitle, cleanPrice, cols)];
    }

    const firstLineMax = Math.max(10, cols - cleanPrice.length - 1);
    const words = cleanTitle.split(' ');
    let firstLine = '';
    let idx = 0;

    while (idx < words.length) {
      const candidate = firstLine ? `${firstLine} ${words[idx]}` : words[idx];
      if (candidate.length <= firstLineMax) {
        firstLine = candidate;
        idx++;
      } else {
        break;
      }
    }

    if (!firstLine) {
      // Primeira palavra muito longa: fatia para caber com o preço na linha 1
      const firstWord = words[0];
      firstLine = firstWord.slice(0, firstLineMax);
      const remainderWord = firstWord.slice(firstLineMax);
      const remainingText = [remainderWord, ...words.slice(1)].filter(Boolean).join(' ');
      const restLines = remainingText ? this.wrapText(remainingText, cols, '  ') : [];
      return [this.formatLine(firstLine, cleanPrice, cols), ...restLines];
    }

    const remainingText = words.slice(idx).join(' ');
    const restLines = remainingText ? this.wrapText(remainingText, cols, '  ') : [];
    return [this.formatLine(firstLine, cleanPrice, cols), ...restLines];
  }

  /**
   * Monta o endereço de entrega deduplicando campos para garantir que
   * condomínio, bloco, apartamento, número e complemento não apareçam repetidos.
   */
  public formatReceiptAddressLines(addr?: CustomerAddress): string[] {
    if (!addr) return [];
    const lines: string[] = [];
    const cols = this.getSafeOrderColumns();

    const condRaw = (addr.condominium || '').trim();
    const streetRaw = (addr.street || '').trim();
    const numRaw = (addr.number || '').trim();
    const blockRaw = (addr.block || '').trim();
    const aptRaw = (addr.apartment || '').trim();
    const compRaw = (addr.complement || '').trim();
    const neighRaw = (addr.neighborhood || '').trim();
    const cityRaw = (addr.city || '').trim();
    const refRaw = (addr.reference || '').trim();

    let printedCond = false;
    let effectiveBlock = blockRaw;
    let effectiveApt = aptRaw;

    // Detect if apartment or block is embedded in number or complement
    if (!effectiveApt && /ap(?:to|\.)?\s*[:\-]?\s*([0-9a-zA-Z]+)/i.test(numRaw)) {
      const match = numRaw.match(/ap(?:to|\.)?\s*[:\-]?\s*([0-9a-zA-Z]+)/i);
      if (match) effectiveApt = match[1];
    }
    if (!effectiveBlock && /bloco\s*[:\-]?\s*([0-9a-zA-Z]+)/i.test(numRaw)) {
      const match = numRaw.match(/bloco\s*[:\-]?\s*([0-9a-zA-Z]+)/i);
      if (match) effectiveBlock = match[1];
    }
    if (!effectiveApt && /ap(?:to|\.)?\s*[:\-]?\s*([0-9a-zA-Z]+)/i.test(compRaw)) {
      const match = compRaw.match(/ap(?:to|\.)?\s*[:\-]?\s*([0-9a-zA-Z]+)/i);
      if (match) effectiveApt = match[1];
    }
    if (!effectiveBlock && /bloco\s*[:\-]?\s*([0-9a-zA-Z]+)/i.test(compRaw)) {
      const match = compRaw.match(/bloco\s*[:\-]?\s*([0-9a-zA-Z]+)/i);
      if (match) effectiveBlock = match[1];
    }

    // 1. Condomínio (se informado)
    if (condRaw) {
      const cleanCond = condRaw.replace(/^condom[íi]nio\s*/i, '').trim();
      lines.push(...this.wrapText(`Cond: ${cleanCond}`, cols, '  '));
      printedCond = true;
    }

    // 2. Rua / Logradouro / Identificação Principal
    if (streetRaw) {
      const isSameAsCondo = condRaw && (
        streetRaw.toLowerCase().includes(condRaw.toLowerCase()) || 
        condRaw.toLowerCase().includes(streetRaw.toLowerCase())
      );
      if (!isSameAsCondo || !printedCond) {
        lines.push(...this.wrapText(streetRaw, cols, '  '));
        if (/condom[íi]nio/i.test(streetRaw)) {
          printedCond = true;
        }
      }
    }

    // 3. Número predial / residencial (se não for apenas 'Ap ...' ou 'Bloco ...' que já isolamos)
    if (numRaw) {
      const isOnlyApOrBloco = /^(?:ap(?:to|\.)?\s*[:\-]?\s*[0-9a-zA-Z]+|bloco\s*[:\-]?\s*[0-9a-zA-Z]+|s\/?n)$/i.test(numRaw.trim());
      if (!isOnlyApOrBloco) {
        lines.push(...this.wrapText(`Numero: ${numRaw}`, cols, '  '));
      } else if (/^s\/?n$/i.test(numRaw.trim()) && !effectiveApt && !effectiveBlock) {
        lines.push(`  Numero: S/N`);
      }
    }

    // 4. Bloco e Apartamento (exibido exatamente uma vez)
    const blockAptParts: string[] = [];
    if (effectiveBlock) {
      blockAptParts.push(`Bloco: ${effectiveBlock.replace(/^bloco\s*/i, '').trim()}`);
    }
    if (effectiveApt) {
      blockAptParts.push(`Apto: ${effectiveApt.replace(/^ap(?:to|\.)?\s*/i, '').trim()}`);
    }
    if (blockAptParts.length > 0) {
      lines.push(...this.wrapText(blockAptParts.join(' - '), cols, '  '));
    }

    // 5. Complemento (remove redundâncias de Bloco e Ap já impressos)
    if (compRaw) {
      let cleanComp = compRaw;
      if (effectiveBlock) {
        cleanComp = cleanComp.replace(new RegExp(`bloco\\s*[:\\-]?\\s*${effectiveBlock}`, 'ig'), '');
      }
      if (effectiveApt) {
        cleanComp = cleanComp.replace(new RegExp(`ap(?:to|\\.)?\\s*[:\\-]?\\s*${effectiveApt}`, 'ig'), '');
      }
      cleanComp = cleanComp.replace(/^[\s\-–—:,]+|[\s\-–—:,]+$/g, '').trim();
      if (cleanComp) {
        lines.push(...this.wrapText(`Compl: ${cleanComp}`, cols, '  '));
      }
    }

    // 6. Bairro (se não for redundante com condomínio ou placeholder 'Bairro')
    if (neighRaw && neighRaw !== 'Bairro') {
      const isSameAsCondo = condRaw && neighRaw.toLowerCase().includes(condRaw.toLowerCase());
      if (!isSameAsCondo) {
        lines.push(...this.wrapText(`Bairro: ${neighRaw}`, cols, '  '));
      }
    }

    // 7. Cidade
    if (cityRaw) {
      lines.push(...this.wrapText(`Cidade: ${cityRaw}`, cols, '  '));
    }

    // 8. Ponto de Referência
    if (refRaw) {
      lines.push(...this.wrapText(`Ref: ${refRaw}`, cols, '  '));
    }

    return lines;
  }

  /**
   * Recupera o texto customizado do rodapé do cupom configurado na loja.
   * Se vazio, retorna string vazia para omitir a linha do rodapé.
   */
  public getEffectiveFooterText(explicitFooter?: string): string {
    if (explicitFooter !== undefined) {
      return explicitFooter.trim();
    }
    if (typeof localStorage !== 'undefined') {
      try {
        const raw = localStorage.getItem('gf_restaurant_config');
        if (raw) {
          const cfg = JSON.parse(raw);
          if (cfg && cfg.receiptFooterText !== undefined) {
            return (cfg.receiptFooterText || '').trim();
          }
        }
      } catch {}
    }
    return '';
  }

  /**
   * Gera o texto plano do comprovante formatado exatamente em 32 colunas (58 mm)
   */
  public generateReceiptPlainText(order: Order, options?: { isReprint?: boolean; footerText?: string }): string {
    const isReprint = Boolean(options?.isReprint);
    const dateFormatted = formatDateTime(order.createdAt);
    const cols = this.getSafeOrderColumns();
    const separator = '-'.repeat(cols);
    const lines: string[] = [];

    // CABEÇALHO
    lines.push(this.centerText('AMANDITA SABORES', cols));
    lines.push(this.centerText('Cardapio & Cozinha', cols));

    if (isReprint) {
      lines.push(this.centerText('*** REIMPRESSAO ***', cols));
    }

    const isDelivery = order.fulfillmentType === 'DELIVERY';

    // MODALIDADE
    lines.push(separator);
    if (isDelivery) {
      lines.push(this.centerText('*** ENTREGA ***', cols));
    } else {
      lines.push(this.centerText('*** RETIRADA NO BALCAO ***', cols));
    }
    lines.push(separator);

    // PEDIDO E DATA
    lines.push(this.formatLine(`PEDIDO: ${order.orderNumber}`, dateFormatted.split(' ')[1] || '', cols));
    lines.push(`DATA: ${dateFormatted}`);

    // DADOS DO CLIENTE
    lines.push(...this.wrapText(`CLIENTE: ${order.customer.name || (isDelivery ? 'Cliente' : 'Cliente Balcao')}`, cols));
    if (order.customer.phone) {
      lines.push(`CONTATO: ${this.sanitizeText(order.customer.phone)}`);
    }

    // ENDEREÇO DE ENTREGA (Exclusivo para modalidade DELIVERY - nunca inventar dados)
    if (isDelivery && order.customer.address) {
      lines.push(separator);
      lines.push('ENDERECO DE ENTREGA:');
      const addressLines = this.formatReceiptAddressLines(order.customer.address);
      lines.push(...addressLines);
    }

    // ITENS DO PEDIDO
    lines.push(separator);
    lines.push(this.formatLine('QTD DESCRICAO', 'VALOR', cols));
    lines.push(separator);

    for (const it of order.items) {
      const itemTitle = `${it.quantity}x ${it.name}`;
      const itemPrice = formatReportCurrency(it.subtotal);
      lines.push(...this.formatOrderItemTitleLines(itemTitle, itemPrice, cols));

      // Adicionais
      if (it.addons && it.addons.length > 0) {
        for (const ad of it.addons) {
          const adText = `+ ${ad.name} (R$ ${ad.price.toFixed(2)})`;
          const wrapped = this.wrapText(adText, cols, '  ');
          lines.push(...wrapped);
        }
      }

      // Componentes de combo
      if (it.isCombo && it.comboComponents && it.comboComponents.length > 0) {
        for (const comp of it.comboComponents) {
          const compText = `> ${comp.quantity * it.quantity}x ${comp.name}`;
          const wrapped = this.wrapText(compText, cols, '  ');
          lines.push(...wrapped);
        }
      }

      // Observações do item
      if (it.notes && it.notes.trim()) {
        const noteText = `Obs: ${it.notes.trim()}`;
        const wrapped = this.wrapText(noteText, cols, '  * ');
        lines.push(...wrapped);
      }
    }

    // OBSERVAÇÃO GERAL DO PEDIDO
    if (order.customer.notes && order.customer.notes.trim()) {
      lines.push(separator);
      lines.push('OBSERVACOES GERAIS:');
      const obsLines = this.wrapText(order.customer.notes.trim(), cols, '  ');
      lines.push(...obsLines);
    }

    // TOTAIS E PAGAMENTO
    lines.push(separator);
    lines.push(this.formatLine('SUBTOTAL:', formatReportCurrency(order.subtotal), cols));
    if (isDelivery && typeof order.deliveryFee === 'number' && order.deliveryFee > 0) {
      lines.push(this.formatLine('TAXA DE ENTREGA:', formatReportCurrency(order.deliveryFee), cols));
    }
    if (order.discount && order.discount > 0) {
      lines.push(this.formatLine('DESCONTO:', `- ${formatReportCurrency(order.discount)}`, cols));
    }
    lines.push(this.formatLine('TOTAL:', formatReportCurrency(order.totalAmount), cols));
    lines.push(separator);

    // FORMA DE PAGAMENTO E DETALHAMENTO FINANCEIRO
    lines.push(`FORMA: ${this.sanitizeText(getPaymentMethodLabel(order.paymentMethod))}`);

    if (order.paymentMethod === 'DINHEIRO') {
      const received = order.cashReceived !== undefined 
        ? order.cashReceived 
        : (order.paymentChangeFor !== undefined ? order.paymentChangeFor : order.totalAmount);
      const change = order.changeAmount !== undefined
        ? order.changeAmount
        : (received > order.totalAmount ? received - order.totalAmount : 0);

      lines.push(this.formatLine('RECEBIDO:', formatReportCurrency(received), cols));
      lines.push(this.formatLine('TROCO:', formatReportCurrency(change), cols));
    } else if (order.paymentMethod === 'MISTO' && order.paymentSplits && order.paymentSplits.length > 0) {
      lines.push('DETALHAMENTO DO PAGAMENTO:');
      for (const split of order.paymentSplits) {
        lines.push(this.formatLine(`- ${this.sanitizeText(getPaymentMethodLabel(split.method))}:`, formatReportCurrency(split.amount), cols));
        if (split.method === 'DINHEIRO' && split.cashReceived !== undefined) {
          lines.push(this.formatLine('  RECEBIDO:', formatReportCurrency(split.cashReceived), cols));
          lines.push(this.formatLine('  TROCO:', formatReportCurrency(split.change || 0), cols));
        }
      }
    }

    const situacao = order.paymentStatus === 'PAGO'
      ? 'SITUACAO: PAGO (CONFIRMADO)'
      : 'SITUACAO: PENDENTE NO BALCAO';
    lines.push(situacao);

    lines.push(separator);
    lines.push(this.centerText('Obrigado pela preferencia!', cols));
    const footerText = this.getEffectiveFooterText(options?.footerText);
    if (footerText) {
      lines.push(this.centerText(footerText, cols));
    }
    lines.push('');

    return lines.join('\n');
  }

  /**
   * Gera comandos binários ESC/POS para impressoras térmicas (58 mm / 80 mm)
   * com espaçamento moderado, sem linhas vazias fantasmas e preservando todo o conteúdo.
   */
  public generateReceiptEscPos(order: Order, options?: { isReprint?: boolean; footerText?: string }): Uint8Array {
    const ESC = 0x1b;
    const GS = 0x1d;
    const LF = 0x0a;
    const cols = this.getSafeOrderColumns();
    const separator = '-'.repeat(cols);

    const buffer: number[] = [];

    const append = (...bytes: number[]) => {
      for (const b of bytes) buffer.push(b);
    };

    const appendText = (text: string) => {
      const sanitized = this.sanitizeText(text.replace(/\u00A0/g, ' '));
      for (let i = 0; i < sanitized.length; i++) {
        buffer.push(sanitized.charCodeAt(i));
      }
    };

    const appendLine = (text: string) => {
      appendText(text);
      append(LF);
    };

    // 1. Inicializar impressora + tabela CP860 + entrelinhamento moderado (ESC 3 24)
    append(ESC, 0x40); // ESC @ (Initialize)
    append(ESC, 0x74, 0x02); // ESC t 2 (CP860 Português)
    append(ESC, 0x33, 0x18); // ESC 3 24 (entrelinhamento confortável e econômico)

    // 2. Cabeçalho Centralizado em Negrito / Altura Dupla
    append(ESC, 0x61, 0x01); // Center align
    append(GS, 0x21, 0x11); // Double width & height
    appendLine('AMANDITA SABORES');
    append(GS, 0x21, 0x00); // Normal text
    appendLine('Cardapio & Cozinha');

    if (options?.isReprint) {
      append(ESC, 0x45, 0x01); // Bold ON
      appendLine('*** REIMPRESSAO ***');
      append(ESC, 0x45, 0x00); // Bold OFF
    }

    const isDelivery = order.fulfillmentType === 'DELIVERY';

    // 3. Modalidade Destaque
    appendLine(separator);
    append(GS, 0x21, 0x01); // Double height
    append(ESC, 0x45, 0x01); // Bold ON
    if (isDelivery) {
      appendLine('ENTREGA');
    } else {
      appendLine('RETIRADA NO BALCAO');
    }
    append(GS, 0x21, 0x00); // Normal
    append(ESC, 0x45, 0x00); // Bold OFF
    appendLine(separator);

    // 4. Pedido em Fonte Normal com Alinhamento à Esquerda
    append(ESC, 0x61, 0x00); // Left align
    append(ESC, 0x45, 0x01); // Bold ON
    appendLine(`PEDIDO: ${order.orderNumber}`);
    append(ESC, 0x45, 0x00); // Bold OFF
    appendLine(`DATA: ${formatDateTime(order.createdAt)}`);
    for (const cl of this.wrapText(`CLIENTE: ${order.customer.name || (isDelivery ? 'Cliente' : 'Cliente Balcao')}`, cols)) {
      appendLine(cl);
    }
    if (order.customer.phone) {
      appendLine(`CONTATO: ${this.sanitizeText(order.customer.phone)}`);
    }

    // Endereço de Entrega (Exclusivo para modalidade DELIVERY - nunca inventar dados)
    if (isDelivery && order.customer.address) {
      appendLine(separator);
      append(ESC, 0x45, 0x01); // Bold ON
      appendLine('ENDERECO DE ENTREGA:');
      append(ESC, 0x45, 0x00); // Bold OFF
      const addressLines = this.formatReceiptAddressLines(order.customer.address);
      for (const al of addressLines) {
        appendLine(al);
      }
    }

    // 5. Itens (largura segura de 31/47 colunas evita auto-wrap + LF com linha vazia)
    appendLine(separator);
    appendLine(this.formatLine('QTD DESCRICAO', 'VALOR', cols));
    appendLine(separator);

    for (const it of order.items) {
      const itemTitle = `${it.quantity}x ${it.name}`;
      const itemPrice = formatReportCurrency(it.subtotal);

      append(ESC, 0x45, 0x01); // Bold ON
      for (const tl of this.formatOrderItemTitleLines(itemTitle, itemPrice, cols)) {
        appendLine(tl);
      }
      append(ESC, 0x45, 0x00); // Bold OFF

      if (it.addons && it.addons.length > 0) {
        for (const ad of it.addons) {
          const adText = `+ ${ad.name} (R$ ${ad.price.toFixed(2)})`;
          const wrapped = this.wrapText(adText, cols, '  ');
          for (const wl of wrapped) appendLine(wl);
        }
      }

      if (it.isCombo && it.comboComponents && it.comboComponents.length > 0) {
        for (const comp of it.comboComponents) {
          const compText = `> ${comp.quantity * it.quantity}x ${comp.name}`;
          const wrapped = this.wrapText(compText, cols, '  ');
          for (const wl of wrapped) appendLine(wl);
        }
      }

      if (it.notes && it.notes.trim()) {
        const noteText = `Obs: ${it.notes.trim()}`;
        const wrapped = this.wrapText(noteText, cols, '  * ');
        for (const wl of wrapped) appendLine(wl);
      }
    }

    // 6. Observações do Pedido
    if (order.customer.notes && order.customer.notes.trim()) {
      appendLine(separator);
      appendLine('OBSERVACOES GERAIS:');
      const obsLines = this.wrapText(order.customer.notes.trim(), cols, '  ');
      for (const ol of obsLines) appendLine(ol);
    }

    // 7. Totais e Pagamento
    appendLine(separator);
    appendLine(this.formatLine('SUBTOTAL:', formatReportCurrency(order.subtotal), cols));
    if (isDelivery && typeof order.deliveryFee === 'number' && order.deliveryFee > 0) {
      appendLine(this.formatLine('TAXA DE ENTREGA:', formatReportCurrency(order.deliveryFee), cols));
    }
    if (order.discount && order.discount > 0) {
      appendLine(this.formatLine('DESCONTO:', `- ${formatReportCurrency(order.discount)}`, cols));
    }

    append(ESC, 0x45, 0x01); // Bold ON
    append(GS, 0x21, 0x01); // Double height
    appendLine(this.formatLine('TOTAL:', formatReportCurrency(order.totalAmount), cols));
    append(GS, 0x21, 0x00); // Normal
    append(ESC, 0x45, 0x00); // Bold OFF

    appendLine(separator);
    appendLine(`FORMA: ${this.sanitizeText(getPaymentMethodLabel(order.paymentMethod))}`);

    if (order.paymentMethod === 'DINHEIRO') {
      const received = order.cashReceived !== undefined 
        ? order.cashReceived 
        : (order.paymentChangeFor !== undefined ? order.paymentChangeFor : order.totalAmount);
      const change = order.changeAmount !== undefined
        ? order.changeAmount
        : (received > order.totalAmount ? received - order.totalAmount : 0);

      appendLine(this.formatLine('RECEBIDO:', formatReportCurrency(received), cols));
      appendLine(this.formatLine('TROCO:', formatReportCurrency(change), cols));
    } else if (order.paymentMethod === 'MISTO' && order.paymentSplits && order.paymentSplits.length > 0) {
      appendLine('DETALHAMENTO DO PAGAMENTO:');
      for (const split of order.paymentSplits) {
        appendLine(this.formatLine(`- ${this.sanitizeText(getPaymentMethodLabel(split.method))}:`, formatReportCurrency(split.amount), cols));
        if (split.method === 'DINHEIRO' && split.cashReceived !== undefined) {
          appendLine(this.formatLine('  RECEBIDO:', formatReportCurrency(split.cashReceived), cols));
          appendLine(this.formatLine('  TROCO:', formatReportCurrency(split.change || 0), cols));
        }
      }
    }

    append(ESC, 0x45, 0x01); // Bold ON
    const situacao = order.paymentStatus === 'PAGO'
      ? 'SITUACAO: PAGO (CONFIRMADO)'
      : 'SITUACAO: PENDENTE NO BALCAO';
    appendLine(situacao);
    append(ESC, 0x45, 0x00); // Bold OFF

    // 8. Rodapé
    appendLine(separator);
    append(ESC, 0x61, 0x01); // Center
    appendLine('Obrigado pela preferencia!');
    const footerText = this.getEffectiveFooterText(options?.footerText);
    if (footerText) {
      appendLine(footerText);
    }

    // 9. Avanço de Papel moderado (evita feed duplicado quando corte automático está ativo)
    if (this.config.cutPaper) {
      append(ESC, 0x64, 0x01); // 1 linha antes do corte (GS V A 0 já avança até a lâmina/serrilha)
      append(GS, 0x56, 0x41, 0x00); // Cut paper (GS V A 0)
    } else {
      append(ESC, 0x64, 0x02); // 2 linhas para destaque confortável sem corte automático
    }

    return new Uint8Array(buffer);
  }

  // ==========================================
  // DISPATCH E EXECUÇÃO DA IMPRESSÃO
  // ==========================================
  public async printOrder(
    order: Order,
    options?: {
      forceReprint?: boolean;
      mode?: PrinterConnectionMode;
    }
  ): Promise<{ success: boolean; message: string; printMode: PrinterConnectionMode }> {
    const isReprint = Boolean(options?.forceReprint);
    const targetMode = options?.mode || this.config.connectionMode;

    // Proteção contra duplicação: se já foi impresso e não é reimpressão forçada, ignora
    if (!isReprint && this.hasOrderBeenPrinted(order.id)) {
      return {
        success: true,
        message: `Pedido ${order.orderNumber} já foi impresso anteriormente.`,
        printMode: targetMode,
      };
    }

    this.isPrinting = true;
    this.notifyStatus();

    try {
      // MODO 1: WEB BLUETOOTH BLE
      if (targetMode === 'bluetooth_ble') {
        const escposBytes = this.generateReceiptEscPos(order, { isReprint });
        const bleResult = await this.sendEscPosOverBluetooth(escposBytes);

        if (!bleResult.success) {
          // Se falhar o BLE (ex: desconectado), exibe aviso e oferece alternativa
          this.isPrinting = false;
          this.notifyStatus();
          return {
            success: false,
            message: `Impressão via Bluetooth falhou: ${bleResult.message}. Verifique se a impressora está ligada e conectada.`,
            printMode: 'bluetooth_ble',
          };
        }

        this.markOrderAsPrinted(order.id);
        this.isPrinting = false;
        this.notifyStatus();
        return {
          success: true,
          message: `Comprovante do pedido ${order.orderNumber} impresso via Bluetooth BLE!`,
          printMode: 'bluetooth_ble',
        };
      }

      // MODO 2: ANDROID RAWBT INTENT (Bluetooth Classic SPP)
      if (targetMode === 'android_rawbt') {
        const escposBytes = this.generateReceiptEscPos(order, { isReprint });
        this.sendToAndroidRawBT(escposBytes);
        this.markOrderAsPrinted(order.id);
        this.isPrinting = false;
        this.notifyStatus();
        return {
          success: true,
          message: `Comprovante do pedido ${order.orderNumber} enviado para o serviço de impressão RawBT!`,
          printMode: 'android_rawbt',
        };
      }

      // MODO 3: SPOOLER DO SISTEMA / NAVEGADOR
      this.printViaSystemSpooler(order, isReprint);
      this.markOrderAsPrinted(order.id);
      this.isPrinting = false;
      this.notifyStatus();
      return {
        success: true,
        message: `Comprovante do pedido ${order.orderNumber} aberto no spooler de impressão 58mm.`,
        printMode: 'system_print',
      };
    } catch (err: any) {
      this.isPrinting = false;
      this.lastError = err.message || String(err);
      this.notifyStatus();
      return {
        success: false,
        message: `Falha ao imprimir: ${err.message || err}`,
        printMode: targetMode,
      };
    }
  }

  /**
   * Envia dados ESC/POS via BLE characteristic com chunking (fatiamento de 32 bytes)
   * e tentativa automática de recuperação caso a conexão GATT tenha caído por inatividade.
   */
  private async sendEscPosOverBluetooth(data: Uint8Array, allowRetry = true): Promise<{ success: boolean; message?: string }> {
    if (!this.writeCharacteristic || !this.gattServer?.connected) {
      const reconn = await this.reconnectSavedBLE();
      if (!reconn.success || !this.writeCharacteristic) {
        return {
          success: false,
          message: reconn.message || 'Impressora Bluetooth desconectada. Clique em Reconectar Impressora.',
        };
      }
    }

    try {
      // Fatiamento em blocos de 32 bytes para respeitar MTU de impressoras térmicas BLE
      const CHUNK_SIZE = 32;
      for (let i = 0; i < data.length; i += CHUNK_SIZE) {
        const chunk = data.slice(i, i + CHUNK_SIZE);
        if (this.writeCharacteristic.writeValueWithoutResponse) {
          await this.writeCharacteristic.writeValueWithoutResponse(chunk);
        } else {
          await this.writeCharacteristic.writeValue(chunk);
        }
        // Pequena pausa para buffer do hardware térmico não estourar
        await new Promise((r) => setTimeout(r, 20));
      }
      return { success: true };
    } catch (err: any) {
      // Limpa handles inválidos e tenta 1 reconexão limpa se permitido
      this.writeCharacteristic = null;
      this.gattServer = null;
      this.notifyStatus();

      if (allowRetry) {
        const retryReconn = await this.reconnectSavedBLE();
        if (retryReconn.success && this.writeCharacteristic) {
          return this.sendEscPosOverBluetooth(data, false);
        }
      }

      return { success: false, message: err?.message || 'Erro durante envio de pacotes BLE' };
    }
  }

  /**
   * Envia comando ESC/POS codificado em Base64 para o aplicativo Android RawBT
   */
  private sendToAndroidRawBT(data: Uint8Array): void {
    if (typeof window === 'undefined') return;

    let binary = '';
    for (let i = 0; i < data.length; i++) {
      binary += String.fromCharCode(data[i]);
    }
    const base64Data = window.btoa(binary);

    // Intent URL do Android RawBT
    const rawBtUrl = `intent:base64,${base64Data}#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end;`;

    // Redireciona via iframe ou window.location
    try {
      const link = document.createElement('a');
      link.href = rawBtUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch {
      window.location.href = rawBtUrl;
    }
  }

  /**
   * Abre janela de impressão do navegador estilizada para largura térmica de 58 mm
   */
  private printViaSystemSpooler(order: Order, isReprint: boolean): void {
    if (typeof window === 'undefined') return;

    const widthCss = this.config.paperWidth === '80mm' ? '80mm' : '58mm';
    const fontSizeCss = this.config.paperWidth === '80mm' ? '12px' : '11px';
    const receiptText = this.generateReceiptPlainText(order, { isReprint });
    const printWindow = window.open('', '_blank', 'width=380,height=600');
    if (!printWindow) {
      // Se pop-up bloqueado, usa window.print atual
      window.print();
      return;
    }

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Comprovante Pedido ${order.orderNumber} - ${widthCss}</title>
          <meta charset="utf-8">
          <style>
            @page {
              size: ${widthCss} auto;
              margin: 0mm;
            }
            body {
              font-family: 'Courier New', Courier, monospace;
              font-size: ${fontSizeCss};
              line-height: 1.15;
              color: #000;
              background: #fff;
              margin: 0;
              padding: 1.5mm 2.5mm;
              width: ${widthCss};
              max-width: ${widthCss};
              box-sizing: border-box;
            }
            pre {
              white-space: pre-wrap;
              word-wrap: break-word;
              margin: 0;
              font-family: inherit;
              font-size: inherit;
            }
          </style>
        </head>
        <body>
          <pre>${receiptText.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
          <script>
            window.onload = function() {
              window.print();
              setTimeout(function() { window.close(); }, 500);
            };
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  }

  /**
   * Executa uma impressão de teste para validar o cabeçote térmico e alinhamento
   */
  public async printTestReceipt(): Promise<{ success: boolean; message: string }> {
    const testOrder: Order = {
      id: `test-print-${Date.now()}`,
      orderNumber: '#TESTE-58MM',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      estimatedDeliveryMinutes: 0,
      fulfillmentType: 'RETIRADA',
      customer: {
        name: 'Impressão de Teste Amandita',
        phone: '(83) 98888-0000',
        notes: 'Teste de calibração do papel térmico 58mm',
      },
      items: [
        {
          id: 'item-test-1',
          menuItemId: 'cuscuz-manteiga',
          name: 'Cuscuz Tradicional',
          quantity: 1,
          unitPrice: 5.00,
          subtotal: 5.00,
          addons: [{ id: 'ad-queijo', name: 'Queijo Coalho', price: 3.00 }],
          notes: 'Aquecer bem',
        },
      ],
      subtotal: 8.00,
      deliveryFee: 0,
      discount: 0,
      totalAmount: 8.00,
      paymentMethod: 'PIX',
      paymentStatus: 'PAGO',
      status: 'NOVO',
      movements: [],
    };

    return this.printOrder(testOrder, { forceReprint: true });
  }

  /**
   * Gera o texto do comprovante de cancelamento / estorno formatado em 32 colunas (58 mm)
   */
  public generateRefundReceiptPlainText(order: Order, refundInfo?: OrderRefundInfo): string {
    const info = refundInfo || order.refundInfo;
    const separator = '--------------------------------';
    const lines: string[] = [];
    const cancelDate = info?.timestamp ? formatDateTime(info.timestamp) : formatDateTime(order.updatedAt || new Date().toISOString());
    const originalDate = formatDateTime(order.createdAt);

    // Cabeçalho
    lines.push(this.centerText('AMANDITA SABORES'));
    lines.push(this.centerText('Cardapio & Cozinha'));
    lines.push('');
    lines.push(separator);
    lines.push(this.centerText('*** COMPROVANTE DE ESTORNO ***'));
    lines.push(this.centerText('CANCELAMENTO & DEVOLUCAO'));
    lines.push(separator);
    lines.push('');

    // Pedido e Datas
    lines.push(this.formatLine(`PEDIDO ORIGINAL:`, order.orderNumber));
    lines.push(`DATA DO PEDIDO: ${originalDate}`);
    lines.push(`DATA CANCELAMENTO: ${cancelDate}`);
    lines.push(separator);

    // Cliente
    lines.push(`CLIENTE: ${this.sanitizeText(order.customer.name || 'Cliente Balcao')}`);
    if (order.customer.phone) {
      lines.push(`CONTATO: ${this.sanitizeText(order.customer.phone)}`);
    }
    lines.push(separator);

    // Valores Financeiros
    const originalAmt = info?.originalAmount ?? order.totalAmount;
    const refundAmt = info?.refundAmount ?? order.totalAmount;
    const originalMethod = info?.originalPaymentMethod || order.paymentMethod;
    const refundMethod = info?.refundPaymentMethod || originalMethod;

    lines.push(this.formatLine('VALOR ORIGINAL:', formatCurrency(originalAmt)));
    lines.push(this.formatLine('VALOR ESTORNADO:', formatCurrency(refundAmt)));
    lines.push(this.formatLine('FORMA ORIGINAL:', getPaymentMethodLabel(originalMethod)));
    lines.push(this.formatLine('FORMA DEVOLUCAO:', getPaymentMethodLabel(refundMethod)));
    lines.push(separator);

    // Motivo e Responsabilidade
    lines.push('MOTIVO DO CANCELAMENTO:');
    const reasonText = info?.reason || 'Cancelamento solicitado pelo operador';
    const reasonLines = this.wrapText(reasonText, 32, '  ');
    lines.push(...reasonLines);
    lines.push('');

    const authorText = info?.author || order.operatorName || 'Administrador';
    lines.push(`AUTORIZADO POR: ${this.sanitizeText(authorText)}`);

    // Impacto no Caixa
    lines.push(separator);
    if (refundMethod === 'DINHEIRO') {
      lines.push(this.centerText('IMPACTO NO CAIXA:'));
      lines.push(this.centerText('VALOR DEDUZIDO DA GAVETA'));
    } else if (refundMethod === 'PIX') {
      lines.push(this.centerText('IMPACTO NO CAIXA:'));
      lines.push(this.centerText('DEVOLUCAO BANCARIA PIX'));
      lines.push(this.centerText('(SEM ALTERAR GAVETA FISICA)'));
    } else {
      lines.push(this.centerText('IMPACTO NO CAIXA:'));
      lines.push(this.centerText('ESTORNO EM CARTAO / POS'));
    }

    if (info?.status === 'PENDENTE_CAIXA') {
      lines.push('');
      lines.push(this.centerText('** PENDENTE DE COMPENSACAO **'));
      lines.push(this.centerText('(Nenhum turno de caixa aberto)'));
    }

    lines.push(separator);
    lines.push(this.centerText('DOCUMENTO PARA AUDITORIA'));
    lines.push(this.centerText('Amandita Sabores Artesanais'));

    return lines.join('\n');
  }

  /**
   * Imprime comprovante de cancelamento / estorno
   */
  public async printRefundReceipt(
    order: Order,
    refundInfo?: OrderRefundInfo
  ): Promise<{ success: boolean; message: string; printMode?: string }> {
    const info = refundInfo || order.refundInfo;
    const targetMode = this.config.connectionMode;

    try {
      this.isPrinting = true;
      this.lastError = null;
      this.notifyStatus();

      const receiptText = this.generateRefundReceiptPlainText(order, info);

      // 1. Spooler do Sistema / Navegador
      if (targetMode === 'system_print') {
        this.printRefundViaSystemSpooler(order, receiptText);
        this.isPrinting = false;
        this.lastPrintedAt = new Date().toISOString();
        this.notifyStatus();
        return {
          success: true,
          message: `Comprovante de estorno do pedido ${order.orderNumber} aberto para impressão.`,
          printMode: 'system_print',
        };
      }

      // Converte para binário ESC/POS
      const encoder = new TextEncoder();
      const textBytes = encoder.encode(receiptText + '\n\n\n\n\x1dV\x00');

      // 2. Android RawBT
      if (targetMode === 'android_rawbt') {
        this.sendToAndroidRawBT(textBytes);
        this.isPrinting = false;
        this.lastPrintedAt = new Date().toISOString();
        this.notifyStatus();
        return {
          success: true,
          message: `Comprovante de estorno enviado ao aplicativo Android RawBT.`,
          printMode: 'android_rawbt',
        };
      }

      // 3. Bluetooth BLE
      const bleResult = await this.sendEscPosOverBluetooth(textBytes);
      if (bleResult.success) {
        this.isPrinting = false;
        this.lastPrintedAt = new Date().toISOString();
        this.notifyStatus();
        return {
          success: true,
          message: `Comprovante de estorno do pedido ${order.orderNumber} impresso via Bluetooth!`,
          printMode: 'bluetooth_ble',
        };
      } else {
        // Fallback para spooler
        this.printRefundViaSystemSpooler(order, receiptText);
        this.isPrinting = false;
        this.lastPrintedAt = new Date().toISOString();
        this.notifyStatus();
        return {
          success: true,
          message: `Bluetooth indisponível. Comprovante de estorno aberto no spooler de impressão.`,
          printMode: 'system_print',
        };
      }
    } catch (err: any) {
      this.isPrinting = false;
      this.lastError = err.message || String(err);
      this.notifyStatus();
      return {
        success: false,
        message: `Falha ao imprimir comprovante de estorno: ${err.message || err}`,
        printMode: targetMode,
      };
    }
  }

  private printRefundViaSystemSpooler(order: Order, receiptText: string): void {
    if (typeof window === 'undefined') return;

    const printWindow = window.open('', '_blank', 'width=380,height=600');
    if (!printWindow) {
      window.print();
      return;
    }

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Comprovante de Estorno - Pedido ${order.orderNumber} - 58mm</title>
          <meta charset="utf-8">
          <style>
            @page {
              size: 58mm auto;
              margin: 0mm;
            }
            body {
              font-family: 'Courier New', Courier, monospace;
              font-size: 11px;
              line-height: 1.25;
              color: #000;
              background: #fff;
              margin: 0;
              padding: 2mm 3mm;
              width: 58mm;
              max-width: 58mm;
              box-sizing: border-box;
            }
            pre {
              white-space: pre-wrap;
              word-wrap: break-word;
              margin: 0;
              font-family: inherit;
              font-size: inherit;
            }
          </style>
        </head>
        <body>
          <pre>${receiptText.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
          <script>
            window.onload = function() {
              window.print();
              setTimeout(function() { window.close(); }, 500);
            };
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  }

  // ==========================================
  // COMPROVANTE DE FECHAMENTO / APURAÇÃO DE CAIXA
  // ==========================================
  private getPaperColumns(paperWidth?: PrinterPaperWidth): number {
    const effectiveWidth = paperWidth || this.config.paperWidth;
    return effectiveWidth === '80mm' ? 48 : 32;
  }

  private wrapMultilineText(text: string, maxLen: number, indent = ''): string[] {
    const normalized = (text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const paragraphs = normalized.split('\n');
    const out: string[] = [];

    for (const para of paragraphs) {
      const sanitized = this.sanitizeText(
        para
          .replace(/\u00A0/g, ' ')
          .replace(/[—–]/g, '-')
      );
      if (!sanitized.trim()) {
        out.push('');
        continue;
      }
      const words = sanitized.trim().split(/\s+/);
      let current = indent;
      for (const word of words) {
        const candidate = current === indent ? indent + word : `${current} ${word}`;
        if (candidate.length <= maxLen) {
          current = candidate;
        } else {
          if (current.trim()) {
            out.push(current);
          }
          // Se uma única palavra ultrapassar maxLen, fatia com segurança
          const usable = Math.max(1, maxLen - indent.length);
          if (word.length > usable) {
            let pos = 0;
            while (pos < word.length) {
              const part = word.slice(pos, pos + usable);
              if (pos + usable < word.length) {
                out.push(indent + part);
              } else {
                current = indent + part;
              }
              pos += usable;
            }
          } else {
            current = indent + word;
          }
        }
      }
      if (current.trim()) {
        out.push(current);
      }
    }
    return out;
  }

  private formatCashClosingPair(label: string, value: string, maxLen: number): string[] {
    const sLabel = this.sanitizeText(label.replace(/\u00A0/g, ' ').replace(/[—–]/g, '-'));
    const sValue = this.sanitizeText(value.replace(/\u00A0/g, ' ').replace(/[—–]/g, '-'));

    if (sLabel.length + 1 + sValue.length <= maxLen) {
      return [this.formatLine(sLabel, sValue, maxLen)];
    }

    const lines = this.wrapMultilineText(sLabel, maxLen);
    const pad = Math.max(0, maxLen - sValue.length);
    lines.push(' '.repeat(pad) + sValue);
    return lines;
  }

  /**
   * Gera o texto do demonstrativo de Fechamento e Apuração de Caixa
   * adaptado automaticamente à largura configurada (58 mm = 32 col / 80 mm = 48 col).
   */
  public generateCashClosingPlainText(
    report: CashClosingReportData,
    options?: { paperWidth?: PrinterPaperWidth }
  ): string {
    const maxLen = this.getPaperColumns(options?.paperWidth);
    const separator = '-'.repeat(maxLen);
    const doubleSep = '='.repeat(maxLen);
    const lines: string[] = [];

    // Cabeçalho
    lines.push(this.centerText('AMANDITA SABORES', maxLen));
    lines.push(this.centerText(report.documentTitle.toUpperCase(), maxLen));
    lines.push(doubleSep);
    const bannerNormalized = this.sanitizeText(
      report.statusBanner.toUpperCase().replace(/\u00A0/g, ' ').replace(/[—–]/g, '-')
    );
    if (bannerNormalized.length <= maxLen) {
      lines.push(this.centerText(bannerNormalized, maxLen));
    } else {
      const bannerParts = bannerNormalized
        .split(/\s*-\s*/)
        .map((p) => p.trim())
        .filter(Boolean);
      bannerParts.forEach((part) => {
        lines.push(...this.wrapMultilineText(part, maxLen).map((l) => this.centerText(l, maxLen)));
      });
    }
    lines.push(doubleSep);

    // Dados do turno
    lines.push(...this.wrapMultilineText(`Abertura: ${formatDateTime(report.openedAt)}`, maxLen));
    lines.push(...this.wrapMultilineText(`Operador abertura: ${report.openedBy}`, maxLen));
    if (report.mode === 'CLOSED_OFFICIAL' && report.closedAt) {
      lines.push(...this.wrapMultilineText(`Fechamento: ${formatDateTime(report.closedAt)}`, maxLen));
      if (report.closedBy) {
        lines.push(...this.wrapMultilineText(`Operador fechamento: ${report.closedBy}`, maxLen));
      }
    } else {
      lines.push(...this.wrapMultilineText(`Emissao: ${formatDateTime(report.generatedAt)}`, maxLen));
      if (report.closedBy) {
        lines.push(...this.wrapMultilineText(`Operador: ${report.closedBy}`, maxLen));
      }
    }
    lines.push(separator);

    // Apuração da gaveta (exatamente os mesmos valores da tela)
    lines.push(...this.formatCashClosingPair('Fundo inicial de troco:', formatReportCurrency(report.initialBalance), maxLen));
    lines.push(...this.formatCashClosingPair('Vendas em dinheiro (bruto):', `+${formatReportCurrency(report.grossCashSales)}`, maxLen));
    if (report.cashRefunds > 0) {
      lines.push(...this.formatCashClosingPair('Estornos em dinheiro:', `-${formatReportCurrency(report.cashRefunds)}`, maxLen));
    }
    lines.push(...this.formatCashClosingPair('Vendas liquidas dinheiro:', `+${formatReportCurrency(report.netCashSales)}`, maxLen));
    lines.push(...this.formatCashClosingPair('Suprimentos adicionados:', `+${formatReportCurrency(report.totalSuprimentos)}`, maxLen));
    lines.push(...this.formatCashClosingPair('Sangrias (retiradas):', `-${formatReportCurrency(report.totalSangrias)}`, maxLen));
    lines.push(...this.formatCashClosingPair('Vales a funcionarios:', `-${formatReportCurrency(report.totalVales)}`, maxLen));
    if (report.totalAjustes !== 0) {
      const adjPrefix = report.totalAjustes > 0 ? '+' : '';
      lines.push(...this.formatCashClosingPair('Ajustes manuais gaveta:', `${adjPrefix}${formatReportCurrency(report.totalAjustes)}`, maxLen));
    }
    lines.push(separator);

    lines.push(...this.formatCashClosingPair('Gaveta (Dinheiro Esperado):', formatReportCurrency(report.expectedCashInDrawer), maxLen));
    lines.push(separator);

    // Meios digitais e receita líquida
    lines.push(...this.formatCashClosingPair('Vendas PIX (bruto):', formatReportCurrency(report.grossPixSales), maxLen));
    if (report.pixRefunds > 0) {
      lines.push(...this.formatCashClosingPair('  Devol PIX:', `-${formatReportCurrency(report.pixRefunds)}`, maxLen));
      lines.push(...this.formatCashClosingPair('  Liq PIX:', formatReportCurrency(report.netPixSales), maxLen));
    }

    lines.push(...this.formatCashClosingPair('Cartao Credito (bruto):', formatReportCurrency(report.grossCreditCardSales), maxLen));
    if (report.creditCardRefunds > 0) {
      lines.push(...this.formatCashClosingPair('  Devol Credito:', `-${formatReportCurrency(report.creditCardRefunds)}`, maxLen));
      lines.push(...this.formatCashClosingPair('  Liq Credito:', formatReportCurrency(report.netCreditCardSales), maxLen));
    }

    lines.push(...this.formatCashClosingPair('Cartao Debito (bruto):', formatReportCurrency(report.grossDebitCardSales), maxLen));
    if (report.debitCardRefunds > 0) {
      lines.push(...this.formatCashClosingPair('  Devol Debito:', `-${formatReportCurrency(report.debitCardRefunds)}`, maxLen));
      lines.push(...this.formatCashClosingPair('  Liq Debito:', formatReportCurrency(report.netDebitCardSales), maxLen));
    }

    if (report.grossOtherCardOrMixedSales > 0 || report.otherCardOrMixedRefunds > 0) {
      lines.push(...this.formatCashClosingPair('Outros/Misto (bruto):', formatReportCurrency(report.grossOtherCardOrMixedSales), maxLen));
      if (report.otherCardOrMixedRefunds > 0) {
        lines.push(...this.formatCashClosingPair('  Devol Outros/Misto:', `-${formatReportCurrency(report.otherCardOrMixedRefunds)}`, maxLen));
        lines.push(...this.formatCashClosingPair('  Liq Outros/Misto:', formatReportCurrency(report.netOtherCardOrMixedSales), maxLen));
      }
    }

    lines.push(...this.formatCashClosingPair('Total Cartoes (bruto):', formatReportCurrency(report.grossCardSales), maxLen));
    if (report.cardRefunds > 0) {
      lines.push(...this.formatCashClosingPair('  Devol Cartoes:', `-${formatReportCurrency(report.cardRefunds)}`, maxLen));
      lines.push(...this.formatCashClosingPair('  Liq Cartoes:', formatReportCurrency(report.netCardSales), maxLen));
    }

    lines.push(separator);
    lines.push(...this.formatCashClosingPair('Receita Total Liquida:', formatReportCurrency(report.totalNetRevenue), maxLen));
    lines.push(doubleSep);

    // Conferência física e diferença
    lines.push(...this.formatCashClosingPair('Dinheiro Contado Gaveta:', formatReportCurrency(report.countedCash), maxLen));
    lines.push('Diferenca apurada:');
    lines.push(...this.wrapMultilineText(report.differenceLabel, maxLen, '  '));
    lines.push(separator);

    // Observações de fechamento
    lines.push('Observacoes de Fechamento:');
    const obsText = report.closingNotes ? report.closingNotes : 'Nenhuma observacao registrada.';
    lines.push(...this.wrapMultilineText(obsText, maxLen, '  '));
    lines.push(separator);

    lines.push(this.centerText('Amandita Sabores', maxLen));
    return lines.join('\n');
  }

  /**
   * Gera o payload binário ESC/POS do comprovante de Fechamento / Apuração de Caixa.
   */
  public generateCashClosingEscPos(
    report: CashClosingReportData,
    options?: { paperWidth?: PrinterPaperWidth }
  ): Uint8Array {
    const ESC = 0x1b;
    const GS = 0x1d;
    const LF = 0x0a;
    const buffer: number[] = [];

    const pushBytes = (...bytes: number[]) => buffer.push(...bytes);
    const pushText = (text: string) => {
      const sanitized = this.sanitizeText(text.replace(/\u00A0/g, ' '));
      for (let i = 0; i < sanitized.length; i++) {
        buffer.push(sanitized.charCodeAt(i));
      }
      buffer.push(LF);
    };

    const maxLen = this.getPaperColumns(options?.paperWidth);
    const plainLines = this.generateCashClosingPlainText(report, options).split('\n');

    // Reset da impressora + Tabela CP860 (Português) + Alinhamento esquerda
    pushBytes(ESC, 0x40);
    pushBytes(ESC, 0x74, 0x02);
    pushBytes(ESC, 0x61, 0x00);

    plainLines.forEach((line, idx) => {
      const isStrongLine =
        idx <= 1 ||
        line.includes('CONFERENCIA DE FECHAMENTO') ||
        line.includes('TURNO ABERTO') ||
        line.includes('FECHAMENTO OFICIAL') ||
        line.includes('CAIXA FECHADO') ||
        line.startsWith('Gaveta (Dinheiro') ||
        line.startsWith('Receita Total Liquida') ||
        line.startsWith('Dinheiro Contado Gaveta') ||
        line.startsWith('Diferenca apurada');

      if (isStrongLine) {
        pushBytes(ESC, 0x45, 0x01); // Negrito ON
        pushText(line);
        pushBytes(ESC, 0x45, 0x00); // Negrito OFF
      } else {
        pushText(line);
      }
    });

    // Avanço de papel
    pushBytes(ESC, 0x64, 0x04);

    // Corte de papel (se habilitado nas configurações da impressora)
    if (this.config.cutPaper) {
      pushBytes(GS, 0x56, 0x41, 0x00);
    }

    // Evita variável não usada caso maxLen seja necessário em extensões
    void maxLen;

    return new Uint8Array(buffer);
  }

  /**
   * Imprime o demonstrativo de fechamento/conferência de caixa usando exatamente
   * o modo e a largura configurados na impressora térmica (BLE, RawBT ou Spooler).
   * Operação estritamente somente leitura: não altera turnos, pedidos nem histórico.
   */
  public async printCashClosingReceipt(
    report: CashClosingReportData,
    options?: {
      mode?: PrinterConnectionMode;
      paperWidth?: PrinterPaperWidth;
    }
  ): Promise<{ success: boolean; message: string; printMode: PrinterConnectionMode }> {
    const targetMode = options?.mode || this.config.connectionMode;
    const effectiveWidth = options?.paperWidth || this.config.paperWidth;

    this.isPrinting = true;
    this.lastError = null;
    this.notifyStatus();

    try {
      // MODO 1: WEB BLUETOOTH BLE
      if (targetMode === 'bluetooth_ble') {
        const escposBytes = this.generateCashClosingEscPos(report, { paperWidth: effectiveWidth });
        const bleResult = await this.sendEscPosOverBluetooth(escposBytes);

        if (!bleResult.success) {
          this.isPrinting = false;
          this.lastError = bleResult.message || 'Impressora Bluetooth desconectada.';
          this.notifyStatus();
          return {
            success: false,
            message: `Impressão via Bluetooth falhou: ${bleResult.message || 'Impressora desconectada'}. Verifique se a impressora está ligada e conectada em Configurações > Impressora.`,
            printMode: 'bluetooth_ble',
          };
        }

        this.isPrinting = false;
        this.lastPrintedAt = new Date().toISOString();
        this.notifyStatus();
        return {
          success: true,
          message:
            report.mode === 'OPEN_PREVIEW'
              ? 'Conferência de fechamento impressa via Bluetooth BLE!'
              : 'Espelho de fechamento de caixa impresso via Bluetooth BLE!',
          printMode: 'bluetooth_ble',
        };
      }

      // MODO 2: ANDROID RAWBT INTENT (Bluetooth Classic SPP)
      if (targetMode === 'android_rawbt') {
        const escposBytes = this.generateCashClosingEscPos(report, { paperWidth: effectiveWidth });
        this.sendToAndroidRawBT(escposBytes);
        this.isPrinting = false;
        this.lastPrintedAt = new Date().toISOString();
        this.notifyStatus();
        return {
          success: true,
          message:
            report.mode === 'OPEN_PREVIEW'
              ? 'Conferência de fechamento enviada para o aplicativo Android RawBT!'
              : 'Espelho de fechamento de caixa enviado para o aplicativo Android RawBT!',
          printMode: 'android_rawbt',
        };
      }

      // MODO 3: SPOOLER DO SISTEMA / NAVEGADOR (58 mm ou 80 mm)
      const receiptText = this.generateCashClosingPlainText(report, { paperWidth: effectiveWidth });
      this.printCashClosingViaSystemSpooler(report, receiptText, effectiveWidth);
      this.isPrinting = false;
      this.lastPrintedAt = new Date().toISOString();
      this.notifyStatus();
      return {
        success: true,
        message: `Comprovante de caixa aberto no spooler de impressão (${effectiveWidth}).`,
        printMode: 'system_print',
      };
    } catch (err: any) {
      this.isPrinting = false;
      this.lastError = err?.message || String(err);
      this.notifyStatus();
      return {
        success: false,
        message: `Falha ao imprimir comprovante de caixa: ${err?.message || err}`,
        printMode: targetMode,
      };
    }
  }

  private printCashClosingViaSystemSpooler(
    report: CashClosingReportData,
    receiptText: string,
    paperWidth: PrinterPaperWidth
  ): void {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const widthCss = paperWidth === '80mm' ? '80mm' : '58mm';
    const fontSizeCss = paperWidth === '80mm' ? '12px' : '11px';
    const safeTitle = `${report.documentTitle} - ${widthCss}`.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const safeBody = receiptText.replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>${safeTitle}</title>
          <meta charset="utf-8">
          <style>
            @page {
              size: ${widthCss} auto;
              margin: 0mm;
            }
            body {
              font-family: 'Courier New', Courier, monospace;
              font-size: ${fontSizeCss};
              line-height: 1.25;
              color: #000;
              background: #fff;
              margin: 0;
              padding: 2mm 3mm;
              width: ${widthCss};
              max-width: ${widthCss};
              box-sizing: border-box;
            }
            pre {
              white-space: pre-wrap;
              word-wrap: break-word;
              margin: 0;
              font-family: inherit;
              font-size: inherit;
            }
          </style>
        </head>
        <body>
          <pre>${safeBody}</pre>
          <script>
            window.onload = function() {
              window.print();
              setTimeout(function() { window.close(); }, 500);
            };
          </script>
        </body>
      </html>
    `;

    const printWindow = window.open('', '_blank', 'width=420,height=640');
    if (printWindow) {
      printWindow.document.write(html);
      printWindow.document.close();
      return;
    }

    // Fallback seguro sem pop-up (ex.: PWA instalado / bloqueador de pop-up): iframe oculto
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);

    const frameDoc = iframe.contentWindow?.document;
    if (frameDoc) {
      frameDoc.open();
      frameDoc.write(html.replace('setTimeout(function() { window.close(); }, 500);', ''));
      frameDoc.close();
      setTimeout(() => {
        try {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
        } catch {
          // ignore
        } finally {
          setTimeout(() => {
            if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
          }, 1500);
        }
      }, 250);
    } else if (iframe.parentNode) {
      iframe.parentNode.removeChild(iframe);
    }
  }
}

export const thermalPrinterService = new ThermalPrinterService();
