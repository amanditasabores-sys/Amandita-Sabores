/**
 * Serviço de Gerenciamento da Impressora Térmica Portátil 58mm (Bluetooth & Spooler)
 * Amandita Sabores - Comprovante de Produção & Balcão
 * 
 * Suporta 3 tecnologias de conexão:
 * 1. Web Bluetooth Direct (BLE / GATT): Conexão direta pelo Google Chrome sem aplicativos extras.
 * 2. Android RawBT / QuickPrinter Intent (Bluetooth Classic SPP): Para impressoras Bluetooth 2.0/3.0.
 * 3. Spooler do Sistema / Navegador (58mm): Impressão gráfica com largura e margens de 58mm.
 */

import { Order } from '../types';
import { formatCurrency, formatDateTime } from '../utils/formatters';

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
];

const COMMON_BLE_WRITE_CHARS = [
  '00002af1-0000-1000-8000-00805f9b34fb',
  'bef8d6c9-9c21-4c9e-b632-bd58c1009f9f',
  '49535343-1e4d-4bd9-ba61-23c647249616',
  '0000ffe1-0000-1000-8000-00805f9b34fb',
  '0000ff02-0000-1000-8000-00805f9b34fb',
  '0000fff2-0000-1000-8000-00805f9b34fb',
  '0000ae01-0000-1000-8000-00805f9b34fb',
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

    try {
      this.lastError = null;
      this.notifyStatus();

      // Solicita seleção de dispositivo com filtros de serviços térmicos
      const nav = navigator as any;
      const device = await nav.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: COMMON_BLE_PRINT_SERVICES,
      });

      if (!device) {
        return { success: false, message: 'Nenhuma impressora Bluetooth foi selecionada.' };
      }

      this.bleDevice = device;

      device.addEventListener('gattserverdisconnected', () => {
        this.writeCharacteristic = null;
        this.gattServer = null;
        this.notifyStatus();
      });

      // Conecta ao GATT Server
      const server = await device.gatt.connect();
      this.gattServer = server;

      // Descobre serviço e característica de escrita
      let foundCharacteristic: any = null;

      for (const serviceUuid of COMMON_BLE_PRINT_SERVICES) {
        try {
          const service = await server.getPrimaryService(serviceUuid);
          if (service) {
            const characteristics = await service.getCharacteristics();
            for (const char of characteristics) {
              if (char.properties.write || char.properties.writeWithoutResponse) {
                foundCharacteristic = char;
                break;
              }
            }
          }
        } catch {
          // Continua tentando próximo serviço
        }
        if (foundCharacteristic) break;
      }

      // Se não encontrou por UUID conhecido, tenta obter todos os serviços primários
      if (!foundCharacteristic) {
        try {
          const services = await server.getPrimaryServices();
          for (const s of services) {
            const chars = await s.getCharacteristics();
            for (const c of chars) {
              if (c.properties.write || c.properties.writeWithoutResponse) {
                foundCharacteristic = c;
                break;
              }
            }
            if (foundCharacteristic) break;
          }
        } catch {
          // fallback
        }
      }

      if (!foundCharacteristic) {
        await this.disconnectBluetooth();
        const err = `Impressora conectada (${device.name || 'Dispositivo'}), mas não foi encontrada a característica de escrita ESC/POS. Verifique se o modelo suporta BLE ou utilize o modo RawBT.`;
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
      const msg = err.name === 'NotFoundError'
        ? 'Busca cancelada pelo usuário.'
        : `Erro ao conectar Bluetooth: ${err.message || err}`;
      this.lastError = msg;
      this.notifyStatus();
      return { success: false, message: msg };
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
   * Gera o texto plano do comprovante formatado exatamente em 32 colunas (58 mm)
   */
  public generateReceiptPlainText(order: Order, options?: { isReprint?: boolean }): string {
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

    // MODALIDADE
    lines.push(separator);
    lines.push(this.centerText('*** RETIRADA NO BALCAO ***'));
    lines.push(separator);

    // PEDIDO E DATA
    lines.push(this.formatLine(`PEDIDO: ${order.orderNumber}`, dateFormatted.split(' ')[1] || ''));
    lines.push(`DATA: ${dateFormatted}`);

    // DADOS DO CLIENTE
    lines.push(`CLIENTE: ${this.sanitizeText(order.customer.name || 'Cliente Balcao')}`);
    if (order.customer.phone) {
      lines.push(`CONTATO: ${this.sanitizeText(order.customer.phone)}`);
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
    if (order.discount && order.discount > 0) {
      lines.push(this.formatLine('DESCONTO:', `- ${formatCurrency(order.discount)}`));
    }
    lines.push(this.formatLine('TOTAL:', formatCurrency(order.totalAmount)));
    lines.push(separator);

    // FORMA DE PAGAMENTO E SITUAÇÃO
    lines.push(`FORMA: ${this.sanitizeText(order.paymentMethod)}`);
    if (order.paymentChangeFor) {
      lines.push(`TROCO PARA: ${formatCurrency(order.paymentChangeFor)}`);
    }

    const situacao = order.paymentStatus === 'PAGO'
      ? 'SITUACAO: PAGO (CONFIRMADO)'
      : 'SITUACAO: PENDENTE NO BALCAO';
    lines.push(situacao);

    lines.push(separator);
    lines.push(this.centerText('Obrigado pela preferencia!'));
    lines.push(this.centerText('amanditasabores.com.br'));
    lines.push('');
    lines.push('');
    lines.push('');

    return lines.join('\n');
  }

  /**
   * Gera comandos binários ESC/POS para impressoras térmicas de 58 mm
   */
  public generateReceiptEscPos(order: Order, options?: { isReprint?: boolean }): Uint8Array {
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

    // 3. Modalidade Destaque
    append(GS, 0x21, 0x01); // Double height
    append(ESC, 0x45, 0x01); // Bold ON
    appendLine('RETIRADA NO BALCAO');
    append(GS, 0x21, 0x00); // Normal
    append(ESC, 0x45, 0x00); // Bold OFF
    appendLine('--------------------------------');

    // 4. Pedido em Fonte Normal com Alinhamento à Esquerda
    append(ESC, 0x61, 0x00); // Left align
    append(ESC, 0x45, 0x01); // Bold ON
    appendLine(`PEDIDO: ${order.orderNumber}`);
    append(ESC, 0x45, 0x00); // Bold OFF
    appendLine(`DATA: ${formatDateTime(order.createdAt)}`);
    appendLine(`CLIENTE: ${this.sanitizeText(order.customer.name || 'Cliente Balcao')}`);
    if (order.customer.phone) {
      appendLine(`CONTATO: ${this.sanitizeText(order.customer.phone)}`);
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
    if (order.discount && order.discount > 0) {
      appendLine(this.formatLine('DESCONTO:', `- ${formatCurrency(order.discount)}`));
    }

    append(ESC, 0x45, 0x01); // Bold ON
    append(GS, 0x21, 0x01); // Double height
    appendLine(this.formatLine('TOTAL:', formatCurrency(order.totalAmount)));
    append(GS, 0x21, 0x00); // Normal
    append(ESC, 0x45, 0x00); // Bold OFF

    appendLine('--------------------------------');
    appendLine(`FORMA: ${this.sanitizeText(order.paymentMethod)}`);
    if (order.paymentChangeFor) {
      appendLine(`TROCO PARA: ${formatCurrency(order.paymentChangeFor)}`);
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
    appendLine('amanditasabores.com.br');

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
      // Tenta reconectar se tiver dispositivo salvo
      if (this.bleDevice?.gatt) {
        try {
          const server = await this.bleDevice.gatt.connect();
          this.gattServer = server;
          // Recupera característica
          const service = await server.getPrimaryService(this.config.bleServiceUuid || COMMON_BLE_PRINT_SERVICES[0]);
          this.writeCharacteristic = await service.getCharacteristic(this.config.bleCharUuid || COMMON_BLE_WRITE_CHARS[0]);
        } catch {
          return { success: false, message: 'Impressora Bluetooth desconectada.' };
        }
      } else {
        return { success: false, message: 'Nenhuma impressora Bluetooth conectada no momento.' };
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
}

export const thermalPrinterService = new ThermalPrinterService();
