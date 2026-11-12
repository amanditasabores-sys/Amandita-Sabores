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
  private lastError: string | null = null;
  private lastPrintedAt: string | null = null;

  constructor() {
    this.config = this.loadConfig();
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

  private setupDeviceDisconnectionListener(device: any): void {
    if (!device) return;
    device.addEventListener('gattserverdisconnected', () => {
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

  /**
   * Reconexão resiliente sem reabrir diálogo nativo do Chrome:
   * Restaura gattServer, recupera dispositivo via getDevices() se perdido após reload,
   * e redescobre a característica de escrita ESC/POS para evitar falha de characteristic nula.
   */
  public async reconnectSavedBLE(): Promise<{ success: boolean; message: string }> {
    const nav = typeof navigator !== 'undefined' ? (navigator as any) : null;
    if (!nav?.bluetooth) {
      return { success: false, message: 'Web Bluetooth não suportado neste navegador.' };
    }

    // Se já estiver conectado e com característica pronta, retorna sucesso
    if (this.gattServer && this.gattServer.connected && this.writeCharacteristic) {
      return { success: true, message: 'Impressora já conectada e pronta.' };
    }

    try {
      // 1. Se o objeto de dispositivo em memória foi perdido, tenta recuperar via getDevices()
      if (!this.bleDevice && nav.bluetooth.getDevices && this.config.lastDeviceId) {
        try {
          const devices = await nav.bluetooth.getDevices();
          const matched = devices.find((d: any) => d.id === this.config.lastDeviceId);
          if (matched) {
            this.bleDevice = matched;
            this.setupDeviceDisconnectionListener(matched);
          }
        } catch (e) {
          console.warn('[BLE Reconnect] getDevices aviso:', e);
        }
      }

      if (!this.bleDevice || !this.bleDevice.gatt) {
        return {
          success: false,
          message: 'Nenhuma impressora pareada salva. Clique em "Localizar e Parear Impressora".',
        };
      }

      this.lastError = null;
      this.notifyStatus();

      // 2. Reconecta ao GATT Server
      const server = await this.bleDevice.gatt.connect();
      this.gattServer = server;

      // 3. Redescobre a característica de escrita ESC/POS (CORREÇÃO CRÍTICA DO BUG DE CARACTERÍSTICA NULA)
      const foundChar = await this.discoverWriteCharacteristic(server);
      if (!foundChar) {
        await this.disconnectBluetooth();
        const err = 'Impressora reconectada, mas a característica de escrita BLE não foi encontrada.';
        this.lastError = err;
        this.notifyStatus();
        return { success: false, message: err };
      }

      this.writeCharacteristic = foundChar;
      this.notifyStatus();

      return {
        success: true,
        message: `Impressora "${this.bleDevice.name || 'Térmica 58mm'}" reconectada com sucesso!`,
      };
    } catch (err: any) {
      const msg = err?.message || String(err);
      this.lastError = `Falha ao reconectar impressora: ${msg}`;
      this.notifyStatus();
      return { success: false, message: this.lastError };
    }
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

  private wrapText(text: string, maxLen = 32, indent = ''): string[] {
    const sanitized = this.sanitizeText(text);
    const words = sanitized.split(' ');
    const lines: string[] = [];
    let currentLine = indent;

    for (const w of words) {
      if ((currentLine + (currentLine === indent ? '' : ' ') + w).length <= maxLen) {
        currentLine += (currentLine === indent ? '' : ' ') + w;
      } else {
        if (currentLine.trim()) lines.push(currentLine);
        currentLine = indent + w;
      }
    }
    if (currentLine.trim()) lines.push(currentLine);
    return lines;
  }

  /**
   * Monta o endereço de entrega deduplicando campos para garantir que
   * condomínio, bloco, apartamento, número e complemento não apareçam repetidos.
   */
  public formatReceiptAddressLines(addr?: CustomerAddress): string[] {
    if (!addr) return [];
    const lines: string[] = [];

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
      lines.push(...this.wrapText(`Cond: ${cleanCond}`, 32, '  '));
      printedCond = true;
    }

    // 2. Rua / Logradouro / Identificação Principal
    if (streetRaw) {
      const isSameAsCondo = condRaw && (
        streetRaw.toLowerCase().includes(condRaw.toLowerCase()) || 
        condRaw.toLowerCase().includes(streetRaw.toLowerCase())
      );
      if (!isSameAsCondo || !printedCond) {
        lines.push(...this.wrapText(streetRaw, 32, '  '));
        if (/condom[íi]nio/i.test(streetRaw)) {
          printedCond = true;
        }
      }
    }

    // 3. Número predial / residencial (se não for apenas 'Ap ...' ou 'Bloco ...' que já isolamos)
    if (numRaw) {
      const isOnlyApOrBloco = /^(?:ap(?:to|\.)?\s*[:\-]?\s*[0-9a-zA-Z]+|bloco\s*[:\-]?\s*[0-9a-zA-Z]+|s\/?n)$/i.test(numRaw.trim());
      if (!isOnlyApOrBloco) {
        lines.push(`  Numero: ${this.sanitizeText(numRaw)}`);
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
      lines.push(`  ${blockAptParts.join(' - ')}`);
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
        lines.push(...this.wrapText(`Compl: ${cleanComp}`, 32, '  '));
      }
    }

    // 6. Bairro (se não for redundante com condomínio ou placeholder 'Bairro')
    if (neighRaw && neighRaw !== 'Bairro') {
      const isSameAsCondo = condRaw && neighRaw.toLowerCase().includes(condRaw.toLowerCase());
      if (!isSameAsCondo) {
        lines.push(`  Bairro: ${this.sanitizeText(neighRaw)}`);
      }
    }

    // 7. Cidade
    if (cityRaw) {
      lines.push(`  Cidade: ${this.sanitizeText(cityRaw)}`);
    }

    // 8. Ponto de Referência
    if (refRaw) {
      lines.push(...this.wrapText(`Ref: ${refRaw}`, 32, '  '));
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
    const separator = '--------------------------------';
    const lines: string[] = [];

    // CABEÇALHO
    lines.push(this.centerText('AMANDITA SABORES'));
    lines.push(this.centerText('Cardapio & Cozinha'));
    lines.push('');

    if (isReprint) {
      lines.push(this.centerText('*** REIMPRESSAO ***'));
      lines.push('');
    }

    const isDelivery = order.fulfillmentType === 'DELIVERY';

    // MODALIDADE
    lines.push(separator);
    if (isDelivery) {
      lines.push(this.centerText('*** ENTREGA ***'));
    } else {
      lines.push(this.centerText('*** RETIRADA NO BALCAO ***'));
    }
    lines.push(separator);

    // PEDIDO E DATA
    lines.push(this.formatLine(`PEDIDO: ${order.orderNumber}`, dateFormatted.split(' ')[1] || ''));
    lines.push(`DATA: ${dateFormatted}`);

    // DADOS DO CLIENTE
    lines.push(`CLIENTE: ${this.sanitizeText(order.customer.name || (isDelivery ? 'Cliente' : 'Cliente Balcao'))}`);
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
    lines.push(this.formatLine('QTD DESCRICAO', 'VALOR'));
    lines.push(separator);

    for (const it of order.items) {
      const itemTitle = `${it.quantity}x ${it.name}`;
      const itemPrice = formatCurrency(it.subtotal);
      
      if (itemTitle.length + itemPrice.length + 1 <= 32) {
        lines.push(this.formatLine(itemTitle, itemPrice));
      } else {
        const titleLines = this.wrapText(itemTitle, 22);
        lines.push(this.formatLine(titleLines[0], itemPrice));
        for (let i = 1; i < titleLines.length; i++) {
          lines.push(titleLines[i]);
        }
      }

      // Adicionais
      if (it.addons && it.addons.length > 0) {
        for (const ad of it.addons) {
          const adText = `+ ${ad.name} (R$ ${ad.price.toFixed(2)})`;
          const wrapped = this.wrapText(adText, 30, '  ');
          lines.push(...wrapped);
        }
      }

      // Componentes de combo
      if (it.isCombo && it.comboComponents && it.comboComponents.length > 0) {
        for (const comp of it.comboComponents) {
          const compText = `  > ${comp.quantity * it.quantity}x ${comp.name}`;
          const wrapped = this.wrapText(compText, 30, '   ');
          lines.push(...wrapped);
        }
      }

      // Observações do item
      if (it.notes && it.notes.trim()) {
        const noteText = `Obs: ${it.notes.trim()}`;
        const wrapped = this.wrapText(noteText, 30, '  * ');
        lines.push(...wrapped);
      }
    }

    // OBSERVAÇÃO GERAL DO PEDIDO
    if (order.customer.notes && order.customer.notes.trim()) {
      lines.push(separator);
      lines.push('OBSERVACOES GERAIS:');
      const obsLines = this.wrapText(order.customer.notes.trim(), 32, '  ');
      lines.push(...obsLines);
    }

    // TOTAIS E PAGAMENTO
    lines.push(separator);
    lines.push(this.formatLine('SUBTOTAL:', formatCurrency(order.subtotal)));
    if (isDelivery && typeof order.deliveryFee === 'number' && order.deliveryFee > 0) {
      lines.push(this.formatLine('TAXA DE ENTREGA:', formatCurrency(order.deliveryFee)));
    }
    if (order.discount && order.discount > 0) {
      lines.push(this.formatLine('DESCONTO:', `- ${formatCurrency(order.discount)}`));
    }
    lines.push(this.formatLine('TOTAL:', formatCurrency(order.totalAmount)));
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

      lines.push(this.formatLine('RECEBIDO:', formatCurrency(received)));
      lines.push(this.formatLine('TROCO:', formatCurrency(change)));
    } else if (order.paymentMethod === 'MISTO' && order.paymentSplits && order.paymentSplits.length > 0) {
      lines.push('DETALHAMENTO DO PAGAMENTO:');
      for (const split of order.paymentSplits) {
        lines.push(this.formatLine(`- ${this.sanitizeText(getPaymentMethodLabel(split.method))}:`, formatCurrency(split.amount)));
        if (split.method === 'DINHEIRO' && split.cashReceived !== undefined) {
          lines.push(this.formatLine('  RECEBIDO:', formatCurrency(split.cashReceived)));
          lines.push(this.formatLine('  TROCO:', formatCurrency(split.change || 0)));
        }
      }
    }

    const situacao = order.paymentStatus === 'PAGO'
      ? 'SITUACAO: PAGO (CONFIRMADO)'
      : 'SITUACAO: PENDENTE NO BALCAO';
    lines.push(situacao);

    lines.push(separator);
    lines.push(this.centerText('Obrigado pela preferencia!'));
    const footerText = this.getEffectiveFooterText(options?.footerText);
    if (footerText) {
      lines.push(this.centerText(footerText));
    }
    lines.push('');
    lines.push('');
    lines.push('');

    return lines.join('\n');
  }

  /**
   * Gera comandos binários ESC/POS para impressoras térmicas de 58 mm
   */
  public generateReceiptEscPos(order: Order, options?: { isReprint?: boolean; footerText?: string }): Uint8Array {
    const ESC = 0x1b;
    const GS = 0x1d;
    const LF = 0x0a;

    const buffer: number[] = [];

    const append = (...bytes: number[]) => {
      for (const b of bytes) buffer.push(b);
    };

    const appendText = (text: string) => {
      const sanitized = this.sanitizeText(text);
      for (let i = 0; i < sanitized.length; i++) {
        buffer.push(sanitized.charCodeAt(i));
      }
    };

    const appendLine = (text: string) => {
      appendText(text);
      append(LF);
    };

    // 1. Inicializar impressora
    append(ESC, 0x40); // ESC @ (Initialize)
    append(ESC, 0x74, 0x02); // ESC t 2 (CP860 Português)

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

    append(LF);

    const isDelivery = order.fulfillmentType === 'DELIVERY';

    // 3. Modalidade Destaque
    append(GS, 0x21, 0x01); // Double height
    append(ESC, 0x45, 0x01); // Bold ON
    if (isDelivery) {
      appendLine('ENTREGA');
    } else {
      appendLine('RETIRADA NO BALCAO');
    }
    append(GS, 0x21, 0x00); // Normal
    append(ESC, 0x45, 0x00); // Bold OFF
    appendLine('--------------------------------');

    // 4. Pedido em Fonte Normal com Alinhamento à Esquerda
    append(ESC, 0x61, 0x00); // Left align
    append(ESC, 0x45, 0x01); // Bold ON
    appendLine(`PEDIDO: ${order.orderNumber}`);
    append(ESC, 0x45, 0x00); // Bold OFF
    appendLine(`DATA: ${formatDateTime(order.createdAt)}`);
    appendLine(`CLIENTE: ${this.sanitizeText(order.customer.name || (isDelivery ? 'Cliente' : 'Cliente Balcao'))}`);
    if (order.customer.phone) {
      appendLine(`CONTATO: ${this.sanitizeText(order.customer.phone)}`);
    }

    // Endereço de Entrega (Exclusivo para modalidade DELIVERY - nunca inventar dados)
    if (isDelivery && order.customer.address) {
      appendLine('--------------------------------');
      append(ESC, 0x45, 0x01); // Bold ON
      appendLine('ENDERECO DE ENTREGA:');
      append(ESC, 0x45, 0x00); // Bold OFF
      const addressLines = this.formatReceiptAddressLines(order.customer.address);
      for (const al of addressLines) {
        appendLine(al);
      }
    }

    // 5. Itens
    appendLine('--------------------------------');
    appendLine(this.formatLine('QTD DESCRICAO', 'VALOR'));
    appendLine('--------------------------------');

    for (const it of order.items) {
      const itemTitle = `${it.quantity}x ${it.name}`;
      const itemPrice = formatCurrency(it.subtotal);

      append(ESC, 0x45, 0x01); // Bold ON
      if (itemTitle.length + itemPrice.length + 1 <= 32) {
        appendLine(this.formatLine(itemTitle, itemPrice));
      } else {
        const titleLines = this.wrapText(itemTitle, 22);
        appendLine(this.formatLine(titleLines[0], itemPrice));
        for (let i = 1; i < titleLines.length; i++) {
          appendLine(titleLines[i]);
        }
      }
      append(ESC, 0x45, 0x00); // Bold OFF

      if (it.addons && it.addons.length > 0) {
        for (const ad of it.addons) {
          const adText = `+ ${ad.name} (R$ ${ad.price.toFixed(2)})`;
          const wrapped = this.wrapText(adText, 30, '  ');
          for (const wl of wrapped) appendLine(wl);
        }
      }

      if (it.isCombo && it.comboComponents && it.comboComponents.length > 0) {
        for (const comp of it.comboComponents) {
          const compText = `  > ${comp.quantity * it.quantity}x ${comp.name}`;
          const wrapped = this.wrapText(compText, 30, '   ');
          for (const wl of wrapped) appendLine(wl);
        }
      }

      if (it.notes && it.notes.trim()) {
        const noteText = `Obs: ${it.notes.trim()}`;
        const wrapped = this.wrapText(noteText, 30, '  * ');
        for (const wl of wrapped) appendLine(wl);
      }
    }

    // 6. Observações do Pedido
    if (order.customer.notes && order.customer.notes.trim()) {
      appendLine('--------------------------------');
      appendLine('OBSERVACOES GERAIS:');
      const obsLines = this.wrapText(order.customer.notes.trim(), 32, '  ');
      for (const ol of obsLines) appendLine(ol);
    }

    // 7. Totais e Pagamento
    appendLine('--------------------------------');
    appendLine(this.formatLine('SUBTOTAL:', formatCurrency(order.subtotal)));
    if (isDelivery && typeof order.deliveryFee === 'number' && order.deliveryFee > 0) {
      appendLine(this.formatLine('TAXA DE ENTREGA:', formatCurrency(order.deliveryFee)));
    }
    if (order.discount && order.discount > 0) {
      appendLine(this.formatLine('DESCONTO:', `- ${formatCurrency(order.discount)}`));
    }

    append(ESC, 0x45, 0x01); // Bold ON
    append(GS, 0x21, 0x01); // Double height
    appendLine(this.formatLine('TOTAL:', formatCurrency(order.totalAmount)));
    append(GS, 0x21, 0x00); // Normal
    append(ESC, 0x45, 0x00); // Bold OFF

    appendLine(this.config.paperWidth === '80mm' ? '------------------------------------------------' : '--------------------------------');
    appendLine(`FORMA: ${this.sanitizeText(getPaymentMethodLabel(order.paymentMethod))}`);

    if (order.paymentMethod === 'DINHEIRO') {
      const received = order.cashReceived !== undefined 
        ? order.cashReceived 
        : (order.paymentChangeFor !== undefined ? order.paymentChangeFor : order.totalAmount);
      const change = order.changeAmount !== undefined
        ? order.changeAmount
        : (received > order.totalAmount ? received - order.totalAmount : 0);

      appendLine(this.formatLine('RECEBIDO:', formatCurrency(received)));
      appendLine(this.formatLine('TROCO:', formatCurrency(change)));
    } else if (order.paymentMethod === 'MISTO' && order.paymentSplits && order.paymentSplits.length > 0) {
      appendLine('DETALHAMENTO DO PAGAMENTO:');
      for (const split of order.paymentSplits) {
        appendLine(this.formatLine(`- ${this.sanitizeText(getPaymentMethodLabel(split.method))}:`, formatCurrency(split.amount)));
        if (split.method === 'DINHEIRO' && split.cashReceived !== undefined) {
          appendLine(this.formatLine('  RECEBIDO:', formatCurrency(split.cashReceived)));
          appendLine(this.formatLine('  TROCO:', formatCurrency(split.change || 0)));
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
    appendLine('--------------------------------');
    append(ESC, 0x61, 0x01); // Center
    appendLine('Obrigado pela preferencia!');
    const footerText = this.getEffectiveFooterText(options?.footerText);
    if (footerText) {
      appendLine(footerText);
    }

    // 9. Avanço de Papel (Feed 4 linhas) & Corte
    append(ESC, 0x64, 0x04); // Feed 4 lines
    if (this.config.cutPaper) {
      append(GS, 0x56, 0x41, 0x00); // Cut paper (GS V A 0)
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
   * Envia dados ESC/POS via BLE characteristic com chunking (fatiamento de 20-50 bytes)
   */
  private async sendEscPosOverBluetooth(data: Uint8Array): Promise<{ success: boolean; message?: string }> {
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
      return { success: false, message: err.message || 'Erro durante envio de pacotes BLE' };
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
          <title>Comprovante Pedido ${order.orderNumber} - 58mm</title>
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
}

export const thermalPrinterService = new ThermalPrinterService();
