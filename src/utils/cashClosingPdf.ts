/**
 * Gerador de PDF 1.4 vetorial em TypeScript puro (zero dependências externas)
 * para o demonstrativo de Fechamento e Apuração de Caixa — Amandita Sabores.
 *
 * Características:
 * - Fontes padrão embutidas do PDF (Helvetica e Helvetica-Bold) com codificação WinAnsiEncoding,
 *   preservando integralmente a acentuação em português (á, é, í, ó, ú, ã, õ, ç, —, R$).
 * - Paginação automática em formato A4 (595 x 842 pt) com quebra automática de linhas
 *   para observações longas.
 * - Compartilhamento nativo no celular via Web Share API Level 2 (navigator.share com files)
 *   e fallback automático para download direto do arquivo .pdf.
 */

import { CashClosingReportData, formatReportCurrency } from './cashClosingReport';
import { formatDateTime } from './formatters';

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN_LEFT = 46;
const MARGIN_RIGHT = 46;
const MARGIN_TOP = 48;
const MARGIN_BOTTOM = 52;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;

// Mapeamento de caracteres Unicode (fora da faixa Latin-1) suportados pelo WinAnsiEncoding (Windows-1252)
const WIN_ANSI_EXTRA: Record<number, number> = {
  0x20ac: 0x80, // €
  0x201a: 0x82, // ‚
  0x0192: 0x83, // ƒ
  0x201e: 0x84, // „
  0x2026: 0x85, // …
  0x2020: 0x86, // †
  0x2021: 0x87, // ‡
  0x02c6: 0x88, // ˆ
  0x2030: 0x89, // ‰
  0x0160: 0x8a, // Š
  0x2039: 0x8b, // ‹
  0x0152: 0x8c, // Œ
  0x017d: 0x8e, // Ž
  0x2018: 0x91, // ‘
  0x2019: 0x92, // ’
  0x201c: 0x93, // “
  0x201d: 0x94, // ”
  0x2022: 0x95, // •
  0x2013: 0x96, // –
  0x2014: 0x97, // —
  0x02dc: 0x98, // ˜
  0x2122: 0x99, // ™
  0x0161: 0x9a, // š
  0x203a: 0x9b, // ›
  0x0153: 0x9c, // œ
  0x017e: 0x9e, // ž
  0x0178: 0x9f, // Ÿ
};

function charToWinAnsiByte(ch: string): number {
  const code = ch.charCodeAt(0);
  if (code === 0x00a0) return 0x20; // espaço não-quebrável -> espaço padrão
  if (code >= 0x20 && code <= 0x7e) return code;
  if (code >= 0xa1 && code <= 0xff) return code;
  if (WIN_ANSI_EXTRA[code] !== undefined) return WIN_ANSI_EXTRA[code];

  // Fallback seguro: remove diacríticos caso apareça algum caractere Unicode fora de WinAnsi
  const stripped = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (stripped.length > 0) {
    const fallbackCode = stripped.charCodeAt(0);
    if (fallbackCode >= 0x20 && fallbackCode <= 0x7e) return fallbackCode;
  }
  return 0x3f; // '?'
}

/**
 * Converte uma string UTF-16 para literal PDF com escapes octais WinAnsi.
 * A saída é 100% ASCII de 7 bits, garantindo que o comprimento em caracteres seja
 * exatamente igual ao comprimento em bytes para a tabela xref do PDF.
 */
export function encodePdfWinAnsiLiteral(text: string): string {
  const clean = (text ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\t/g, '  ');
  let out = '(';
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (ch === '\n') continue;
    const byte = charToWinAnsiByte(ch);
    if (byte === 0x5c) {
      out += '\\\\';
    } else if (byte === 0x28) {
      out += '\\(';
    } else if (byte === 0x29) {
      out += '\\)';
    } else if (byte >= 0x20 && byte <= 0x7e) {
      out += String.fromCharCode(byte);
    } else {
      out += '\\' + byte.toString(8).padStart(3, '0');
    }
  }
  out += ')';
  return out;
}

/**
 * Estima a largura de uma string em pontos PDF para Helvetica / Helvetica-Bold.
 */
function estimateTextWidth(text: string, fontSize: number, bold = false): number {
  let units = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if ('ilI.,:;!|\'` '.includes(ch)) {
      units += 0.28;
    } else if ('fjrt()[]/\\-'.includes(ch)) {
      units += 0.34;
    } else if ('mwMW@%—'.includes(ch)) {
      units += 0.84;
    } else if (ch >= 'A' && ch <= 'Z') {
      units += 0.67;
    } else if (ch >= '0' && ch <= '9') {
      units += 0.56;
    } else if ('ÁÀÂÃÉÊÍÓÔÕÚÜÇ'.includes(ch)) {
      units += 0.68;
    } else {
      units += 0.54;
    }
  }
  const boldFactor = bold ? 1.05 : 1.0;
  return units * fontSize * boldFactor;
}

/**
 * Quebra texto longo em linhas respeitando largura máxima em pontos PDF,
 * preservando parágrafos (quebras de linha explícitas) e fatiando palavras muito longas.
 */
export function wrapPdfText(text: string, maxWidthPt: number, fontSize: number, bold = false): string[] {
  const normalized = (text ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const paragraphs = normalized.split('\n');
  const result: string[] = [];

  for (const paragraph of paragraphs) {
    const trimmedRight = paragraph.replace(/\s+$/g, '');
    if (!trimmedRight.trim()) {
      result.push('');
      continue;
    }

    const words = trimmedRight.split(/\s+/);
    let currentLine = '';

    for (const word of words) {
      const candidate = currentLine ? `${currentLine} ${word}` : word;
      if (estimateTextWidth(candidate, fontSize, bold) <= maxWidthPt) {
        currentLine = candidate;
      } else {
        if (currentLine) {
          result.push(currentLine);
          currentLine = '';
        }

        // Palavra maior que a largura útil: quebra por caracteres
        if (estimateTextWidth(word, fontSize, bold) > maxWidthPt) {
          let chunk = '';
          for (let i = 0; i < word.length; i++) {
            const nextChunk = chunk + word[i];
            if (estimateTextWidth(nextChunk, fontSize, bold) <= maxWidthPt || !chunk) {
              chunk = nextChunk;
            } else {
              result.push(chunk);
              chunk = word[i];
            }
          }
          currentLine = chunk;
        } else {
          currentLine = word;
        }
      }
    }

    if (currentLine) {
      result.push(currentLine);
    }
  }

  return result;
}

type RgbColor = [number, number, number];

const COLOR_SLATE_900: RgbColor = [0.06, 0.09, 0.16];
const COLOR_SLATE_700: RgbColor = [0.2, 0.25, 0.33];
const COLOR_SLATE_500: RgbColor = [0.39, 0.45, 0.55];
const COLOR_BORDER: RgbColor = [0.85, 0.88, 0.92];
const COLOR_BG_LIGHT: RgbColor = [0.97, 0.98, 0.99];
const COLOR_BG_AMBER: RgbColor = [0.996, 0.96, 0.89];
const COLOR_AMBER_DARK: RgbColor = [0.57, 0.25, 0.05];
const COLOR_EMERALD: RgbColor = [0.02, 0.47, 0.34];
const COLOR_ROSE: RgbColor = [0.75, 0.09, 0.24];
const COLOR_PURPLE: RgbColor = [0.43, 0.16, 0.65];
const COLOR_BLUE: RgbColor = [0.11, 0.31, 0.85];
const COLOR_INDIGO: RgbColor = [0.26, 0.22, 0.79];

function fmtNum(n: number): string {
  return n.toFixed(2);
}

class SimplePdfDocumentBuilder {
  private pages: string[][] = [[]];
  private currentPageIndex = 0;
  private cursorY = PAGE_HEIGHT - MARGIN_TOP;

  private get cmds(): string[] {
    return this.pages[this.currentPageIndex];
  }

  public getY(): number {
    return this.cursorY;
  }

  public advanceY(deltaPt: number): void {
    this.cursorY -= deltaPt;
  }

  public ensureSpace(requiredHeightPt: number): void {
    if (this.cursorY - requiredHeightPt < MARGIN_BOTTOM) {
      this.addPage();
    }
  }

  public addPage(): void {
    this.pages.push([]);
    this.currentPageIndex = this.pages.length - 1;
    this.cursorY = PAGE_HEIGHT - MARGIN_TOP;
  }

  public drawFilledRect(
    x: number,
    yTop: number,
    width: number,
    height: number,
    fillColor: RgbColor,
    strokeColor?: RgbColor
  ): void {
    const yBottom = yTop - height;
    this.cmds.push('q');
    this.cmds.push(`${fillColor[0]} ${fillColor[1]} ${fillColor[2]} rg`);
    if (strokeColor) {
      this.cmds.push(`${strokeColor[0]} ${strokeColor[1]} ${strokeColor[2]} RG`);
      this.cmds.push('0.7 w');
      this.cmds.push(`${fmtNum(x)} ${fmtNum(yBottom)} ${fmtNum(width)} ${fmtNum(height)} re B`);
    } else {
      this.cmds.push(`${fmtNum(x)} ${fmtNum(yBottom)} ${fmtNum(width)} ${fmtNum(height)} re f`);
    }
    this.cmds.push('Q');
  }

  public drawLine(x1: number, y: number, x2: number, color: RgbColor = COLOR_BORDER, lineWidth = 0.7): void {
    this.cmds.push('q');
    this.cmds.push(`${color[0]} ${color[1]} ${color[2]} RG`);
    this.cmds.push(`${fmtNum(lineWidth)} w`);
    this.cmds.push(`${fmtNum(x1)} ${fmtNum(y)} m ${fmtNum(x2)} ${fmtNum(y)} l S`);
    this.cmds.push('Q');
  }

  public drawText(
    text: string,
    x: number,
    y: number,
    options?: { fontSize?: number; bold?: boolean; color?: RgbColor }
  ): void {
    const fontSize = options?.fontSize ?? 10;
    const fontKey = options?.bold ? '/F2' : '/F1';
    const color = options?.color ?? COLOR_SLATE_900;
    const literal = encodePdfWinAnsiLiteral(text);

    this.cmds.push('BT');
    this.cmds.push(`${color[0]} ${color[1]} ${color[2]} rg`);
    this.cmds.push(`${fontKey} ${fmtNum(fontSize)} Tf`);
    this.cmds.push(`1 0 0 1 ${fmtNum(x)} ${fmtNum(y)} Tm`);
    this.cmds.push(`${literal} Tj`);
    this.cmds.push('ET');
  }

  public drawRightAlignedText(
    text: string,
    rightX: number,
    y: number,
    options?: { fontSize?: number; bold?: boolean; color?: RgbColor }
  ): void {
    const fontSize = options?.fontSize ?? 10;
    const bold = Boolean(options?.bold);
    const width = estimateTextWidth(text, fontSize, bold);
    const x = Math.max(MARGIN_LEFT, rightX - width);
    this.drawText(text, x, y, options);
  }

  public drawCenteredText(
    text: string,
    y: number,
    options?: { fontSize?: number; bold?: boolean; color?: RgbColor }
  ): void {
    const fontSize = options?.fontSize ?? 10;
    const bold = Boolean(options?.bold);
    const width = estimateTextWidth(text, fontSize, bold);
    const x = Math.max(MARGIN_LEFT, (PAGE_WIDTH - width) / 2);
    this.drawText(text, x, y, options);
  }

  public drawKeyValueRow(
    label: string,
    value: string,
    options?: {
      fontSize?: number;
      boldLabel?: boolean;
      boldValue?: boolean;
      labelColor?: RgbColor;
      valueColor?: RgbColor;
      rowHeight?: number;
      indent?: number;
    }
  ): void {
    const fontSize = options?.fontSize ?? 10;
    const rowHeight = options?.rowHeight ?? 18;
    const indent = options?.indent ?? 0;

    this.ensureSpace(rowHeight + 4);
    const baselineY = this.cursorY - fontSize;

    const valueWidth = estimateTextWidth(value, fontSize, Boolean(options?.boldValue));
    const maxLabelWidth = Math.max(120, CONTENT_WIDTH - indent - valueWidth - 16);
    const labelLines = wrapPdfText(label, maxLabelWidth, fontSize, Boolean(options?.boldLabel));

    if (labelLines.length <= 1) {
      this.drawText(label, MARGIN_LEFT + indent, baselineY, {
        fontSize,
        bold: options?.boldLabel,
        color: options?.labelColor ?? COLOR_SLATE_700,
      });
      this.drawRightAlignedText(value, PAGE_WIDTH - MARGIN_RIGHT, baselineY, {
        fontSize,
        bold: options?.boldValue,
        color: options?.valueColor ?? COLOR_SLATE_900,
      });
      this.advanceY(rowHeight);
    } else {
      const lineStep = fontSize + 4;
      labelLines.forEach((line, idx) => {
        this.ensureSpace(lineStep + 2);
        const y = this.cursorY - fontSize;
        this.drawText(line, MARGIN_LEFT + indent, y, {
          fontSize,
          bold: options?.boldLabel,
          color: options?.labelColor ?? COLOR_SLATE_700,
        });
        if (idx === 0) {
          this.drawRightAlignedText(value, PAGE_WIDTH - MARGIN_RIGHT, y, {
            fontSize,
            bold: options?.boldValue,
            color: options?.valueColor ?? COLOR_SLATE_900,
          });
        }
        this.advanceY(lineStep);
      });
      this.advanceY(4);
    }
  }

  public buildPdfBytes(): Uint8Array<ArrayBuffer> {
    // Adiciona rodapé de paginação em todas as páginas
    const totalPages = this.pages.length;
    this.pages.forEach((pageCmds, idx) => {
      const footerY = 26;
      pageCmds.push('q');
      pageCmds.push(`${COLOR_BORDER[0]} ${COLOR_BORDER[1]} ${COLOR_BORDER[2]} RG`);
      pageCmds.push('0.5 w');
      pageCmds.push(`${fmtNum(MARGIN_LEFT)} ${fmtNum(footerY + 12)} m ${fmtNum(PAGE_WIDTH - MARGIN_RIGHT)} ${fmtNum(footerY + 12)} l S`);
      pageCmds.push('Q');

      const leftText = encodePdfWinAnsiLiteral('Amandita Sabores — Relatório de Apuração de Caixa');
      const rightText = encodePdfWinAnsiLiteral(`Página ${idx + 1} de ${totalPages}`);
      const rightW = estimateTextWidth(`Página ${idx + 1} de ${totalPages}`, 8, false);

      pageCmds.push('BT');
      pageCmds.push(`${COLOR_SLATE_500[0]} ${COLOR_SLATE_500[1]} ${COLOR_SLATE_500[2]} rg`);
      pageCmds.push('/F1 8 Tf');
      pageCmds.push(`1 0 0 1 ${fmtNum(MARGIN_LEFT)} ${fmtNum(footerY)} Tm`);
      pageCmds.push(`${leftText} Tj`);
      pageCmds.push('ET');

      pageCmds.push('BT');
      pageCmds.push(`${COLOR_SLATE_500[0]} ${COLOR_SLATE_500[1]} ${COLOR_SLATE_500[2]} rg`);
      pageCmds.push('/F1 8 Tf');
      pageCmds.push(`1 0 0 1 ${fmtNum(PAGE_WIDTH - MARGIN_RIGHT - rightW)} ${fmtNum(footerY)} Tm`);
      pageCmds.push(`${rightText} Tj`);
      pageCmds.push('ET');
    });

    // Monta objetos PDF 1.4
    // 1: Catalog, 2: Pages, 3: Font Helvetica (/F1), 4: Font Helvetica-Bold (/F2)
    // A partir de 5: pares [PageObj, ContentStreamObj]
    const objects: string[] = [];
    const pageObjectIds: number[] = [];

    const firstPageObjId = 5;
    for (let i = 0; i < this.pages.length; i++) {
      pageObjectIds.push(firstPageObjId + i * 2);
    }

    objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
    objects.push(
      `2 0 obj\n<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageObjectIds.length} >>\nendobj\n`
    );
    objects.push(
      '3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n'
    );
    objects.push(
      '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj\n'
    );

    this.pages.forEach((pageCmds, i) => {
      const pageObjId = firstPageObjId + i * 2;
      const contentObjId = pageObjId + 1;
      const streamBody = pageCmds.join('\n') + '\n';

      objects.push(
        `${pageObjId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${fmtNum(PAGE_WIDTH)} ${fmtNum(PAGE_HEIGHT)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObjId} 0 R >>\nendobj\n`
      );
      objects.push(
        `${contentObjId} 0 obj\n<< /Length ${streamBody.length} >>\nstream\n${streamBody}endstream\nendobj\n`
      );
    });

    let pdfStr = '%PDF-1.4\n%AMANDITA\n';
    const offsets: number[] = [0]; // objeto 0 livre

    for (const obj of objects) {
      offsets.push(pdfStr.length);
      pdfStr += obj;
    }

    const xrefStart = pdfStr.length;
    pdfStr += `xref\n0 ${objects.length + 1}\n`;
    pdfStr += '0000000000 65535 f \n';
    for (let i = 1; i <= objects.length; i++) {
      pdfStr += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    }

    pdfStr += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

    const bytes = new Uint8Array(new ArrayBuffer(pdfStr.length));
    for (let i = 0; i < pdfStr.length; i++) {
      bytes[i] = pdfStr.charCodeAt(i) & 0xff;
    }
    return bytes;
  }
}

/**
 * Gera os bytes de um PDF A4 vetorial fiel à janela de Fechamento e Apuração de Caixa.
 */
export function generateCashClosingPdfBytes(report: CashClosingReportData): Uint8Array<ArrayBuffer> {
  const doc = new SimplePdfDocumentBuilder();

  // Cabeçalho da loja
  doc.drawCenteredText('AMANDITA SABORES', doc.getY() - 16, {
    fontSize: 16,
    bold: true,
    color: COLOR_SLATE_900,
  });
  doc.advanceY(22);

  doc.drawCenteredText(report.documentTitle, doc.getY() - 12, {
    fontSize: 12,
    bold: true,
    color: COLOR_SLATE_700,
  });
  doc.advanceY(20);

  // Faixa de identificação do status do documento (Turno Aberto vs Caixa Fechado)
  const bannerHeight = 24;
  const isOpenPreview = report.mode === 'OPEN_PREVIEW';
  doc.drawFilledRect(
    MARGIN_LEFT,
    doc.getY(),
    CONTENT_WIDTH,
    bannerHeight,
    isOpenPreview ? COLOR_BG_AMBER : COLOR_BG_LIGHT,
    isOpenPreview ? [0.92, 0.72, 0.35] : COLOR_BORDER
  );
  doc.drawCenteredText(report.statusBanner, doc.getY() - 15.5, {
    fontSize: 9.5,
    bold: true,
    color: isOpenPreview ? COLOR_AMBER_DARK : COLOR_SLATE_900,
  });
  doc.advanceY(bannerHeight + 12);

  // Metadados do turno
  const metaStartTop = doc.getY();
  const metaLines: string[] = [
    `Abertura do turno: ${formatDateTime(report.openedAt)} — Operador: ${report.openedBy}`,
  ];
  if (report.mode === 'CLOSED_OFFICIAL' && report.closedAt) {
    metaLines.push(
      `Fechamento oficial: ${formatDateTime(report.closedAt)} — Operador: ${report.closedBy || report.openedBy}`
    );
  } else {
    metaLines.push(
      `Emitido em: ${formatDateTime(report.generatedAt)}${report.closedBy ? ` — Operador: ${report.closedBy}` : ''}`
    );
  }
  metaLines.push(`Lançamentos no turno: ${report.movementsCount}   |   ID do turno: ${report.shiftId}`);

  const metaBoxHeight = metaLines.length * 14 + 14;
  doc.drawFilledRect(MARGIN_LEFT, metaStartTop, CONTENT_WIDTH, metaBoxHeight, COLOR_BG_LIGHT, COLOR_BORDER);
  doc.advanceY(9);
  metaLines.forEach((line) => {
    doc.drawText(line, MARGIN_LEFT + 10, doc.getY() - 9, {
      fontSize: 8.8,
      color: COLOR_SLATE_700,
    });
    doc.advanceY(14);
  });
  doc.advanceY(14);

  // Seção 1: Apuração de Caixa / Gaveta
  doc.drawText('APURAÇÃO DA GAVETA (DINHEIRO)', MARGIN_LEFT, doc.getY() - 10, {
    fontSize: 10,
    bold: true,
    color: COLOR_SLATE_900,
  });
  doc.advanceY(15);
  doc.drawLine(MARGIN_LEFT, doc.getY(), PAGE_WIDTH - MARGIN_RIGHT, COLOR_BORDER, 0.8);
  doc.advanceY(10);

  doc.drawKeyValueRow('Fundo inicial de troco:', formatReportCurrency(report.initialBalance), {
    boldValue: true,
  });

  doc.drawKeyValueRow('Vendas em dinheiro (bruto):', `+${formatReportCurrency(report.grossCashSales)}`, {
    boldValue: true,
    valueColor: COLOR_EMERALD,
  });

  if (report.cashRefunds > 0) {
    doc.drawKeyValueRow('Estornos/Devoluções em dinheiro:', `-${formatReportCurrency(report.cashRefunds)}`, {
      boldLabel: true,
      boldValue: true,
      labelColor: COLOR_ROSE,
      valueColor: COLOR_ROSE,
    });
  }

  doc.drawKeyValueRow('Vendas líquidas em dinheiro:', `+${formatReportCurrency(report.netCashSales)}`, {
    boldLabel: true,
    boldValue: true,
    labelColor: COLOR_SLATE_900,
    valueColor: COLOR_EMERALD,
  });

  doc.drawKeyValueRow('Suprimentos adicionados:', `+${formatReportCurrency(report.totalSuprimentos)}`, {
    boldValue: true,
    valueColor: COLOR_EMERALD,
  });

  doc.drawKeyValueRow('Sangrias (retiradas realizadas):', `-${formatReportCurrency(report.totalSangrias)}`, {
    boldValue: true,
    valueColor: COLOR_ROSE,
  });

  doc.drawKeyValueRow('Vales a funcionários:', `-${formatReportCurrency(report.totalVales)}`, {
    boldValue: true,
    valueColor: COLOR_PURPLE,
  });

  if (report.totalAjustes !== 0) {
    const adjPrefix = report.totalAjustes > 0 ? '+' : '';
    doc.drawKeyValueRow('Ajustes manuais da gaveta:', `${adjPrefix}${formatReportCurrency(report.totalAjustes)}`, {
      boldValue: true,
      valueColor: report.totalAjustes > 0 ? COLOR_EMERALD : COLOR_ROSE,
    });
  }

  // Destaque: Gaveta (Dinheiro Físico Esperado)
  doc.advanceY(4);
  doc.ensureSpace(32);
  const drawerBoxTop = doc.getY();
  doc.drawFilledRect(MARGIN_LEFT, drawerBoxTop, CONTENT_WIDTH, 26, COLOR_BG_AMBER, [0.92, 0.72, 0.35]);
  doc.drawText('Gaveta (Dinheiro Físico Esperado):', MARGIN_LEFT + 10, drawerBoxTop - 16.5, {
    fontSize: 10.5,
    bold: true,
    color: COLOR_SLATE_900,
  });
  doc.drawRightAlignedText(formatReportCurrency(report.expectedCashInDrawer), PAGE_WIDTH - MARGIN_RIGHT - 10, drawerBoxTop - 16.5, {
    fontSize: 11,
    bold: true,
    color: COLOR_AMBER_DARK,
  });
  doc.advanceY(36);

  // Seção 2: Meios Digitais e Receita Total Líquida
  doc.ensureSpace(88);
  doc.drawText('MEIOS DIGITAIS E RECEITA DO TURNO', MARGIN_LEFT, doc.getY() - 10, {
    fontSize: 10,
    bold: true,
    color: COLOR_SLATE_900,
  });
  doc.advanceY(15);
  doc.drawLine(MARGIN_LEFT, doc.getY(), PAGE_WIDTH - MARGIN_RIGHT, COLOR_BORDER, 0.8);
  doc.advanceY(10);

  const pixValueText =
    report.pixRefunds > 0
      ? `Bruto: ${formatReportCurrency(report.grossPixSales)} | Devol: -${formatReportCurrency(report.pixRefunds)} | Líq: ${formatReportCurrency(report.netPixSales)}`
      : `Bruto: ${formatReportCurrency(report.grossPixSales)}`;

  doc.drawKeyValueRow('Vendas PIX:', pixValueText, {
    fontSize: 9.5,
    boldValue: true,
    valueColor: COLOR_BLUE,
  });

  const creditCardValueText =
    report.creditCardRefunds > 0
      ? `Bruto: ${formatReportCurrency(report.grossCreditCardSales)} | Devol: -${formatReportCurrency(report.creditCardRefunds)} | Líq: ${formatReportCurrency(report.netCreditCardSales)}`
      : `Bruto: ${formatReportCurrency(report.grossCreditCardSales)}`;

  doc.drawKeyValueRow('Vendas Cartão de Crédito:', creditCardValueText, {
    fontSize: 9.5,
    boldValue: true,
    valueColor: COLOR_INDIGO,
  });

  const debitCardValueText =
    report.debitCardRefunds > 0
      ? `Bruto: ${formatReportCurrency(report.grossDebitCardSales)} | Devol: -${formatReportCurrency(report.debitCardRefunds)} | Líq: ${formatReportCurrency(report.netDebitCardSales)}`
      : `Bruto: ${formatReportCurrency(report.grossDebitCardSales)}`;

  doc.drawKeyValueRow('Vendas Cartão de Débito:', debitCardValueText, {
    fontSize: 9.5,
    boldValue: true,
    valueColor: COLOR_INDIGO,
  });

  if (report.grossOtherCardOrMixedSales > 0 || report.otherCardOrMixedRefunds > 0) {
    const otherValueText =
      report.otherCardOrMixedRefunds > 0
        ? `Bruto: ${formatReportCurrency(report.grossOtherCardOrMixedSales)} | Devol: -${formatReportCurrency(report.otherCardOrMixedRefunds)} | Líq: ${formatReportCurrency(report.netOtherCardOrMixedSales)}`
        : `Bruto: ${formatReportCurrency(report.grossOtherCardOrMixedSales)}`;

    doc.drawKeyValueRow('Outros / Pagamento Misto (não separado):', otherValueText, {
      fontSize: 9,
      boldValue: true,
      valueColor: COLOR_SLATE_700,
    });
  }

  const cardValueText =
    report.cardRefunds > 0
      ? `Bruto: ${formatReportCurrency(report.grossCardSales)} | Devol: -${formatReportCurrency(report.cardRefunds)} | Líq: ${formatReportCurrency(report.netCardSales)}`
      : `Bruto: ${formatReportCurrency(report.grossCardSales)}`;

  doc.drawKeyValueRow('Total Cartões:', cardValueText, {
    fontSize: 9.5,
    boldLabel: true,
    boldValue: true,
    labelColor: COLOR_SLATE_900,
    valueColor: COLOR_INDIGO,
  });

  doc.advanceY(3);
  doc.drawLine(MARGIN_LEFT, doc.getY(), PAGE_WIDTH - MARGIN_RIGHT, COLOR_BORDER, 0.6);
  doc.advanceY(8);

  doc.drawKeyValueRow('Receita Total Líquida do Turno:', formatReportCurrency(report.totalNetRevenue), {
    fontSize: 11,
    boldLabel: true,
    boldValue: true,
    labelColor: COLOR_SLATE_900,
    valueColor: COLOR_EMERALD,
    rowHeight: 22,
  });

  doc.advanceY(10);

  // Seção 3: Conferência Física da Gaveta e Diferença Apurada
  doc.ensureSpace(78);
  doc.drawText('CONFERÊNCIA FÍSICA DA GAVETA', MARGIN_LEFT, doc.getY() - 10, {
    fontSize: 10,
    bold: true,
    color: COLOR_SLATE_900,
  });
  doc.advanceY(15);
  doc.drawLine(MARGIN_LEFT, doc.getY(), PAGE_WIDTH - MARGIN_RIGHT, COLOR_BORDER, 0.8);
  doc.advanceY(10);

  doc.drawKeyValueRow('Valor em Dinheiro Contado na Gaveta:', formatReportCurrency(report.countedCash), {
    fontSize: 10.5,
    boldLabel: true,
    boldValue: true,
    labelColor: COLOR_SLATE_900,
    valueColor: COLOR_SLATE_900,
    rowHeight: 20,
  });

  const diffColor =
    report.differenceStatus === 'SHORTAGE' ? COLOR_ROSE : COLOR_EMERALD;

  doc.drawKeyValueRow('Diferença apurada:', report.differenceLabel, {
    fontSize: 10.5,
    boldLabel: true,
    boldValue: true,
    labelColor: COLOR_SLATE_900,
    valueColor: diffColor,
    rowHeight: 22,
  });

  doc.advanceY(10);

  // Seção 4: Observações de Fechamento (com quebra automática de linhas e páginas)
  doc.ensureSpace(46);
  doc.drawText('Observações de Fechamento', MARGIN_LEFT, doc.getY() - 10, {
    fontSize: 10,
    bold: true,
    color: COLOR_SLATE_900,
  });
  doc.advanceY(15);
  doc.drawLine(MARGIN_LEFT, doc.getY(), PAGE_WIDTH - MARGIN_RIGHT, COLOR_BORDER, 0.8);
  doc.advanceY(10);

  const notesText = report.closingNotes ? report.closingNotes : 'Nenhuma observação registrada.';
  const noteLines = wrapPdfText(notesText, CONTENT_WIDTH - 16, 9.5, false);
  const noteLineHeight = 14;

  for (const line of noteLines) {
    doc.ensureSpace(noteLineHeight + 4);
    if (line) {
      doc.drawText(line, MARGIN_LEFT + 8, doc.getY() - 9.5, {
        fontSize: 9.5,
        color: report.closingNotes ? COLOR_SLATE_700 : COLOR_SLATE_500,
      });
    }
    doc.advanceY(noteLineHeight);
  }

  return doc.buildPdfBytes();
}

export function buildCashClosingPdfFilename(report: CashClosingReportData): string {
  const refDate = new Date(report.closedAt || report.generatedAt || Date.now());
  const validDate = Number.isNaN(refDate.getTime()) ? new Date() : refDate;
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${validDate.getFullYear()}-${pad(validDate.getMonth() + 1)}-${pad(validDate.getDate())}_${pad(validDate.getHours())}h${pad(validDate.getMinutes())}`;
  const prefix = report.mode === 'OPEN_PREVIEW' ? 'conferencia-caixa' : 'fechamento-caixa';
  return `${prefix}-${stamp}.pdf`;
}

export interface SharePdfResult {
  success: boolean;
  cancelled?: boolean;
  method: 'web_share' | 'download' | 'error';
  filename: string;
  message: string;
}

/**
 * Gera o PDF em memória e compartilha nativamente no celular via Web Share API Level 2
 * (WhatsApp, e-mail, Google Drive, Salvar em Arquivos). Quando não suportado, faz download direto.
 * Cancelamento pelo usuário (AbortError) não gera erro.
 */
export async function shareOrDownloadCashClosingPdf(
  report: CashClosingReportData
): Promise<SharePdfResult> {
  const filename = buildCashClosingPdfFilename(report);

  try {
    const pdfBytes = generateCashClosingPdfBytes(report);
    const pdfBlob = new Blob([pdfBytes], { type: 'application/pdf' });

    const shareTitle =
      report.mode === 'OPEN_PREVIEW'
        ? 'Amandita Sabores — Conferência de Fechamento de Caixa'
        : 'Amandita Sabores — Espelho de Caixa Fechado';

    const shareText = `${report.statusBanner} | Gaveta: ${formatReportCurrency(report.expectedCashInDrawer)} | Contado: ${formatReportCurrency(report.countedCash)} | Receita Líquida: ${formatReportCurrency(report.totalNetRevenue)}`;

    // 1. Tentativa de compartilhamento nativo de arquivo (Android/iOS modernos)
    if (
      typeof navigator !== 'undefined' &&
      typeof File !== 'undefined' &&
      typeof navigator.share === 'function'
    ) {
      const pdfFile = new File([pdfBlob], filename, { type: 'application/pdf' });
      const canShareFile =
        typeof navigator.canShare === 'function' ? navigator.canShare({ files: [pdfFile] }) : false;

      if (canShareFile) {
        try {
          await navigator.share({
            title: shareTitle,
            text: shareText,
            files: [pdfFile],
          });
          return {
            success: true,
            method: 'web_share',
            filename,
            message: 'PDF compartilhado com sucesso!',
          };
        } catch (err: any) {
          // Usuário fechou a folha de compartilhamento intencionalmente
          if (err && (err.name === 'AbortError' || err.name === 'NotAllowedError')) {
            if (err.name === 'AbortError') {
              return {
                success: true,
                cancelled: true,
                method: 'web_share',
                filename,
                message: '',
              };
            }
          }
          // Outros erros da Web Share API caem no fallback de download direto
        }
      }
    }

    // 2. Fallback universal: download direto do arquivo .pdf
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      const url = URL.createObjectURL(pdfBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.rel = 'noopener noreferrer';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // ignore
        }
      }, 2000);

      return {
        success: true,
        method: 'download',
        filename,
        message: `PDF "${filename}" baixado no dispositivo para envio ou arquivamento.`,
      };
    }

    return {
      success: false,
      method: 'error',
      filename,
      message: 'Ambiente sem suporte para download ou compartilhamento de PDF.',
    };
  } catch (err: any) {
    return {
      success: false,
      method: 'error',
      filename,
      message: `Não foi possível gerar o PDF: ${err?.message || String(err)}`,
    };
  }
}
