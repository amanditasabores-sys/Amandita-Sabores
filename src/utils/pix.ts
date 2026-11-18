/**
 * Brazilian Central Bank PIX (BR Code / EMV) Payload Generator
 * Strictly complies with Banco Central do Brasil (BACEN) Manual de Padrões para Iniciação do Pix.
 *
 * Key standards:
 * - Field 00: '01' (Format Indicator - EMV version 01)
 * - Field 01: '11' (Point of Initiation Method - 11 = Static QR Code, allows direct Pix Key + value)
 *   NOTE: '12' is Dynamic Pix and strictly requires a PSP URL endpoint. Using '12' with a raw Pix Key
 *   causes banking apps (Nubank, Itaú, BB, Inter, Caixa, Bradesco) to fail with scanning errors.
 * - Field 26: Merchant Account Information
 *     00: 'br.gov.bcb.pix'
 *     01: Normalized PIX key (Phone: strictly +55DDDNUMBER; CPF: 11 digits; CNPJ: 14 digits; Email/UUID: trimmed)
 *     02: (Optional) Short description (alphanumeric ASCII only, max 20 chars)
 * - Field 52: '0000' (Merchant Category Code)
 * - Field 53: '986' (Transaction Currency - BRL)
 * - Field 54: Transaction Amount (formatted as 0.00, omitted if <= 0)
 * - Field 58: 'BR' (Country Code)
 * - Field 59: Merchant Name (strictly ASCII uppercase [A-Z0-9 ], max 25 chars, no accents/symbols)
 * - Field 60: Merchant City (strictly ASCII uppercase [A-Z0-9 ], max 15 chars, no accents/symbols)
 * - Field 62: Additional Data Field
 *     05: Reference Label / TxID (strictly alphanumeric [A-Za-z0-9], max 25 chars, or '***' for generic)
 * - Field 63: CRC16-CCITT (polynomial 0x1021, init 0xFFFF) on the full payload ending with '6304'
 */

export type PixKeyType = 'CPF' | 'CNPJ' | 'EMAIL' | 'TELEFONE' | 'ALEATORIA';

export interface PixPayloadParams {
  pixKey: string;
  keyType?: PixKeyType;
  receiverName: string;
  receiverCity: string;
  amount: number;
  txId?: string;
  description?: string;
}

const MAX_PIX_AMOUNT = 999999999.99;

const utf8Encoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
const utf8Decoder = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8', { fatal: true }) : null;

export function encodeUtf8(value: string): Uint8Array {
  if (utf8Encoder) {
    return utf8Encoder.encode(value);
  }
  const encoded = unescape(encodeURIComponent(value));
  const bytes = new Uint8Array(encoded.length);
  for (let i = 0; i < encoded.length; i++) {
    bytes[i] = encoded.charCodeAt(i);
  }
  return bytes;
}

export function decodeUtf8(bytes: Uint8Array): string {
  if (utf8Decoder) {
    return utf8Decoder.decode(bytes);
  }
  let bin = '';
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return decodeURIComponent(escape(bin));
}

export function getUtf8ByteLength(value: string): number {
  return encodeUtf8(value).length;
}

function sliceToMaxUtf8Bytes(value: string, maxBytes: number): string {
  if (maxBytes <= 0 || !value) return '';
  if (getUtf8ByteLength(value) <= maxBytes) return value;
  let result = '';
  let usedBytes = 0;
  for (const ch of value) {
    const chBytes = getUtf8ByteLength(ch);
    if (usedBytes + chBytes > maxBytes) break;
    result += ch;
    usedBytes += chBytes;
  }
  return result;
}

export function roundPixAmount(amount: number): number {
  if (!Number.isFinite(amount)) return NaN;
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

export function formatField(id: string, value: string): string {
  if (!/^\d{2}$/.test(id)) {
    throw new Error(`Tag TLV inválida: '${id}'.`);
  }
  const byteLength = getUtf8ByteLength(value);
  if (byteLength > 99) {
    throw new Error(`Campo TLV '${id}' excede o limite de 99 bytes UTF-8 (${byteLength} bytes).`);
  }
  const len = byteLength.toString().padStart(2, '0');
  return `${id}${len}${value}`;
}

export function calculateCRC16(payload: string): string {
  let crc = 0xffff;
  const polynomial = 0x1021;
  const bytes = encodeUtf8(payload);

  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i] << 8;
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ polynomial) & 0xffff;
      } else {
        crc = (crc << 1) & 0xffff;
      }
    }
  }

  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * Normalizes PIX key to comply with BACEN requirements:
 * - TELEFONE: Strictly +55 followed by 2-digit DDD and phone digits (e.g. +5583991234567)
 * - CPF: Strictly 11 digits without dots or hyphens
 * - CNPJ: Strictly 14 digits without symbols
 * - EMAIL / ALEATORIA: Trimmed, lowercase, without whitespace
 */
export function sanitizePixKey(rawKey: string, keyType?: PixKeyType): string {
  if (!rawKey) return '';
  const trimmed = rawKey.trim();
  const digitsOnly = trimmed.replace(/\D/g, '');

  const isPhone =
    keyType === 'TELEFONE' ||
    (!keyType &&
      (trimmed.startsWith('+') ||
        trimmed.includes('(') ||
        (digitsOnly.length >= 10 && digitsOnly.length <= 13 && !trimmed.includes('@'))));

  if (isPhone) {
    if (!digitsOnly) return '';
    if (digitsOnly.length === 10 || digitsOnly.length === 11) {
      return `+55${digitsOnly}`;
    }
    if (digitsOnly.length >= 12 && digitsOnly.startsWith('55')) {
      return `+${digitsOnly}`;
    }
    return `+${digitsOnly}`;
  }

  if (keyType === 'CPF' || (!keyType && digitsOnly.length === 11 && !trimmed.includes('@'))) {
    return digitsOnly.slice(0, 11);
  }

  if (keyType === 'CNPJ' || (!keyType && (digitsOnly.length === 14 || trimmed.includes('/')))) {
    return digitsOnly.slice(0, 14);
  }

  if (keyType === 'EMAIL' || trimmed.includes('@')) {
    return trimmed.toLowerCase();
  }

  if (keyType === 'ALEATORIA') {
    return trimmed.toLowerCase().replace(/\s+/g, '');
  }

  return trimmed;
}

function isValidCpfDigits(digits: string): boolean {
  if (!/^\d{11}$/.test(digits) || /^(\d)\1{10}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(digits[i]) * (10 - i);
  let check1 = (sum * 10) % 11;
  if (check1 === 10) check1 = 0;
  if (check1 !== Number(digits[9])) return false;

  sum = 0;
  for (let i = 0; i < 10; i++) sum += Number(digits[i]) * (11 - i);
  let check2 = (sum * 10) % 11;
  if (check2 === 10) check2 = 0;
  return check2 === Number(digits[10]);
}

function isValidCnpjDigits(digits: string): boolean {
  if (!/^\d{14}$/.test(digits) || /^(\d)\1{13}$/.test(digits)) return false;
  const calc = (sliceLen: number): number => {
    const weights =
      sliceLen === 12
        ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let i = 0; i < sliceLen; i++) {
      sum += Number(digits[i]) * weights[i];
    }
    const rem = sum % 11;
    return rem < 2 ? 0 : 11 - rem;
  };
  return calc(12) === Number(digits[12]) && calc(13) === Number(digits[13]);
}

export interface PixValidationResult {
  valid: boolean;
  normalized: string;
  error?: string;
}

/**
 * Validates and normalizes a PIX key strictly according to the selected keyType.
 * Discards formatting assumptions from other key types.
 */
export function validatePixKey(rawKey: string, keyType: PixKeyType): PixValidationResult {
  const trimmed = (rawKey || '').trim();
  if (!trimmed) {
    return { valid: false, normalized: '', error: 'Informe a chave PIX.' };
  }

  switch (keyType) {
    case 'CPF': {
      const digits = trimmed.replace(/\D/g, '');
      if (digits.length !== 11) {
        return { valid: false, normalized: digits, error: 'Chave CPF deve conter exatamente 11 dígitos.' };
      }
      if (!isValidCpfDigits(digits)) {
        return { valid: false, normalized: digits, error: 'CPF inválido. Verifique os dígitos informados.' };
      }
      return { valid: true, normalized: digits };
    }

    case 'CNPJ': {
      const digits = trimmed.replace(/\D/g, '');
      if (digits.length !== 14) {
        return { valid: false, normalized: digits, error: 'Chave CNPJ deve conter exatamente 14 dígitos.' };
      }
      if (!isValidCnpjDigits(digits)) {
        return { valid: false, normalized: digits, error: 'CNPJ inválido. Verifique os dígitos informados.' };
      }
      return { valid: true, normalized: digits };
    }

    case 'EMAIL': {
      const normalized = trimmed.toLowerCase();
      if (
        getUtf8ByteLength(normalized) > 77 ||
        /\s/.test(normalized) ||
        !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(normalized)
      ) {
        return {
          valid: false,
          normalized,
          error: 'E-mail PIX inválido. Informe um endereço ASCII completo sem espaços ou acentos (ex: loja@dominio.com).',
        };
      }
      return { valid: true, normalized };
    }

    case 'TELEFONE': {
      const digits = trimmed.replace(/\D/g, '');
      let national = digits;
      if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) {
        national = digits.slice(2);
      }
      if (national.length !== 10 && national.length !== 11) {
        return {
          valid: false,
          normalized: national ? `+55${national}` : '',
          error: 'Telefone PIX deve ter DDD + número (10 ou 11 dígitos, ex: (83) 99123-4567).',
        };
      }
      const ddd = Number(national.slice(0, 2));
      if (ddd < 11 || ddd > 99) {
        return {
          valid: false,
          normalized: `+55${national}`,
          error: 'DDD inválido na chave de telefone PIX.',
        };
      }
      if (national.length === 11 && national[2] !== '9') {
        return {
          valid: false,
          normalized: `+55${national}`,
          error: 'Celular com 11 dígitos deve iniciar o número com 9 após o DDD.',
        };
      }
      return { valid: true, normalized: `+55${national}` };
    }

    case 'ALEATORIA': {
      const clean = trimmed.toLowerCase().replace(/\s+/g, '');
      const formattedUuid = /^[0-9a-f]{32}$/.test(clean)
        ? `${clean.slice(0, 8)}-${clean.slice(8, 12)}-${clean.slice(12, 16)}-${clean.slice(16, 20)}-${clean.slice(20)}`
        : clean;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(formattedUuid)) {
        return {
          valid: false,
          normalized: clean,
          error: 'Chave Aleatória (EVP) deve seguir o formato UUID (ex: 123e4567-e89b-12d3-a456-426614174000).',
        };
      }
      return { valid: true, normalized: formattedUuid };
    }

    default:
      return { valid: false, normalized: trimmed, error: 'Tipo de chave PIX não suportado.' };
  }
}

export function getPixKeyHint(keyType?: PixKeyType): string {
  switch (keyType) {
    case 'CPF':
      return 'Informe os 11 dígitos do CPF (com ou sem pontuação).';
    case 'CNPJ':
      return 'Informe os 14 dígitos do CNPJ (com ou sem pontuação).';
    case 'TELEFONE':
      return 'Informe DDD + número (ex: (83) 99123-4567). Será salvo no padrão +55.';
    case 'ALEATORIA':
      return 'Informe o código UUID de 36 caracteres gerado pelo seu banco.';
    case 'EMAIL':
    default:
      return 'Informe um e-mail válido cadastrado como chave PIX.';
  }
}

/**
 * Sanitizes ASCII merchant text (uppercase, strips diacritics and special chars)
 * WITHOUT applying any fallback string so empty/invalid user input is detectable.
 */
export function cleanMerchantText(rawText: string | undefined, maxLength: number): string {
  if (!rawText) return '';
  return rawText
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
    .slice(0, maxLength)
    .trim();
}

export interface PixReceiverValidationResult {
  valid: boolean;
  receiverName: string;
  receiverCity: string;
  error?: string;
}

/**
 * Validates Merchant Name (Field 59) and City (Field 60) BEFORE applying fallbacks.
 */
export function validatePixReceiver(
  rawName?: string,
  rawCity?: string
): PixReceiverValidationResult {
  const receiverName = cleanMerchantText(rawName, 25);
  if (!receiverName || receiverName.length < 2) {
    return {
      valid: false,
      receiverName,
      receiverCity: cleanMerchantText(rawCity, 15),
      error: 'Informe o Nome do Titular / Razão Social da conta PIX (mínimo 2 caracteres).',
    };
  }

  const receiverCity = cleanMerchantText(rawCity, 15);
  if (!receiverCity || receiverCity.length < 2) {
    return {
      valid: false,
      receiverName,
      receiverCity,
      error: 'Informe a Cidade do Titular da conta PIX (mínimo 2 caracteres).',
    };
  }

  return {
    valid: true,
    receiverName,
    receiverCity,
  };
}

/**
 * Normalizes Merchant Name (Field 59):
 * BACEN EMVCo spec: Max 25 chars, uppercase ASCII alphanumeric and spaces only, no diacritics.
 */
export function sanitizeMerchantName(rawName?: string): string {
  return cleanMerchantText(rawName, 25);
}

/**
 * Normalizes Merchant City (Field 60):
 * BACEN EMVCo spec: Max 15 chars, uppercase ASCII alphanumeric and spaces only, no diacritics.
 */
export function sanitizeMerchantCity(rawCity?: string): string {
  return cleanMerchantText(rawCity, 15);
}

/**
 * Normalizes TxID / Reference Label (Field 62, subfield 05):
 * BACEN EMVCo spec: Alphanumeric [A-Za-z0-9] only, max 25 chars.
 * If empty or generic, BACEN specifies '***'.
 */
export function sanitizeTxId(rawTxId?: string): string {
  if (!rawTxId) return '***';
  const clean = rawTxId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 25);
  return clean || '***';
}

/**
 * Builds a unique, BACEN-compliant alphanumeric TxID (1..25 chars) for a specific order or PDV sale.
 */
export function generateOrderPixTxId(orderNumber?: string, orderId?: string): string {
  const numPart = (orderNumber || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 6);
  const idPart = (orderId || '').replace(/[^a-zA-Z0-9]/g, '');

  if (numPart && idPart) {
    const prefix = `AS${numPart}`;
    const remaining = Math.max(0, 25 - prefix.length);
    const suffix = remaining > 0 ? idPart.slice(-remaining) : '';
    return `${prefix}${suffix}`.slice(0, 25);
  }

  if (idPart) {
    return `AS${idPart}`.slice(0, 25);
  }

  if (numPart) {
    const timeSuffix = Date.now().toString(36).toUpperCase().slice(-6);
    return `AS${numPart}${timeSuffix}`.slice(0, 25);
  }

  const timeBase36 = Date.now().toString(36).toUpperCase();
  const randPart = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `AS${timeBase36}${randPart}`.replace(/[^a-zA-Z0-9]/g, '').slice(0, 25);
}

/**
 * Infers a probable PixKeyType when legacy config omitted pixKeyType.
 */
export function inferPixKeyType(rawKey: string): PixKeyType | undefined {
  const trimmed = (rawKey || '').trim();
  if (!trimmed) return undefined;
  if (trimmed.includes('@')) return 'EMAIL';
  const compact = trimmed.toLowerCase().replace(/\s+/g, '');
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(compact) ||
    /^[0-9a-f]{32}$/.test(compact)
  ) {
    return 'ALEATORIA';
  }
  const digits = trimmed.replace(/\D/g, '');
  if (trimmed.startsWith('+') || trimmed.includes('(') || trimmed.includes(')')) {
    return 'TELEFONE';
  }
  if (digits.length === 14) return 'CNPJ';
  if (digits.length === 11) {
    return isValidCpfDigits(digits) ? 'CPF' : 'TELEFONE';
  }
  if (digits.length === 10 || digits.length === 12 || digits.length === 13) {
    return 'TELEFONE';
  }
  return undefined;
}

/**
 * Normalizes Description (Field 26, subfield 02):
 * Optional, alphanumeric ASCII only, max 20 chars.
 */
export function sanitizeDescription(rawDesc?: string): string {
  if (!rawDesc) return '';
  return rawDesc
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 20)
    .trim();
}

/**
 * Generates an official, 100% BACEN-compliant Pix Copia e Cola / BR Code string.
 */
export function generatePixCopiaECola(params: PixPayloadParams): string {
  const effectiveType = params.keyType || inferPixKeyType(params.pixKey);
  if (!effectiveType) {
    throw new Error('Tipo de chave PIX não reconhecido ou chave inválida.');
  }

  const keyCheck = validatePixKey(params.pixKey, effectiveType);
  if (!keyCheck.valid) {
    throw new Error(keyCheck.error || 'Chave PIX inválida ou não informada.');
  }
  const cleanKey = keyCheck.normalized;

  const receiverCheck = validatePixReceiver(params.receiverName, params.receiverCity);
  if (!receiverCheck.valid) {
    throw new Error(receiverCheck.error || 'Nome e cidade do recebedor PIX inválidos.');
  }
  const cleanName = receiverCheck.receiverName;
  const cleanCity = receiverCheck.receiverCity;

  if (!Number.isFinite(params.amount) || params.amount < 0) {
    throw new Error('Valor PIX inválido.');
  }
  const roundedAmount = roundPixAmount(params.amount);
  if (!Number.isFinite(roundedAmount) || roundedAmount > MAX_PIX_AMOUNT) {
    throw new Error('Valor PIX excede o limite suportado pelo BR Code.');
  }
  const cleanAmount = roundedAmount > 0 ? roundedAmount.toFixed(2) : '';
  const txId = sanitizeTxId(params.txId);
  const cleanDesc = params.description ? sanitizeDescription(params.description) : '';

  // Field 00: Payload Format Indicator (Version 01)
  const payloadFormat = formatField('00', '01');

  // Field 01: Point of Initiation Method
  // '11' = Static BR Code (allows raw Pix Key + fixed purchase amount + TxID across all Brazilian banks)
  const pointOfInitiation = formatField('01', '11');

  // Field 26: Merchant Account Information (max total value length 99 UTF-8 bytes per EMVCo TLV)
  const gui = formatField('00', 'br.gov.bcb.pix');
  const key = formatField('01', cleanKey);
  const maxRemainingForDesc = 99 - (getUtf8ByteLength(gui) + getUtf8ByteLength(key)) - 4;
  const trimmedDesc =
    cleanDesc && maxRemainingForDesc >= 1
      ? sliceToMaxUtf8Bytes(cleanDesc, maxRemainingForDesc).trim()
      : '';
  const desc = trimmedDesc ? formatField('02', trimmedDesc) : '';
  const merchantAccountValue = `${gui}${key}${desc}`;
  if (getUtf8ByteLength(merchantAccountValue) > 99) {
    throw new Error('Campo 26 (Merchant Account Info) excede 99 bytes UTF-8.');
  }
  const merchantAccountInfo = formatField('26', merchantAccountValue);

  // Field 52: Merchant Category Code (0000 = ISO 18245 default)
  const merchantCategory = formatField('52', '0000');

  // Field 53: Transaction Currency (986 = BRL)
  const transactionCurrency = formatField('53', '986');

  // Field 54: Transaction Amount
  const transactionAmount = cleanAmount ? formatField('54', cleanAmount) : '';

  // Field 58: Country Code (BR)
  const countryCode = formatField('58', 'BR');

  // Field 59: Merchant Name (Max 25 ASCII chars)
  const merchantName = formatField('59', cleanName);

  // Field 60: Merchant City (Max 15 ASCII chars)
  const merchantCity = formatField('60', cleanCity);

  // Field 62: Additional Data Field Template (TxID)
  const additionalDataField = formatField('62', formatField('05', txId));

  // Assemble payload before CRC
  const rawPayload = `${payloadFormat}${pointOfInitiation}${merchantAccountInfo}${merchantCategory}${transactionCurrency}${transactionAmount}${countryCode}${merchantName}${merchantCity}${additionalDataField}6304`;

  // Calculate CRC16 checksum over UTF-8 bytes
  const crc16 = calculateCRC16(rawPayload);
  const finalPayload = `${rawPayload}${crc16}`;

  // Self-audit final EMV/BR Code before returning
  const audit = validatePixPayload(finalPayload);
  if (!audit.valid) {
    throw new Error(audit.error || 'Falha na auditoria interna do payload PIX gerado.');
  }

  return finalPayload;
}

export interface GeneratePurchasePixInput {
  pixKey?: string;
  keyType?: PixKeyType;
  receiverName?: string;
  receiverCity?: string;
  storeName?: string;
  amount: number;
  txId?: string;
  orderNumber?: string;
  orderId?: string;
  description?: string;
}

export type GeneratePurchasePixResult =
  | {
      success: true;
      payload: string;
      txId: string;
      normalizedKey: string;
      receiverName: string;
      receiverCity: string;
      amount: number;
    }
  | {
      success: false;
      error: string;
    };

/**
 * Single centralized entry point for generating purchase PIX payloads
 * shared identically across PDV, Customer Menu, Order Creation, and Settings Simulator.
 */
export function generatePurchasePixPayload(
  input: GeneratePurchasePixInput
): GeneratePurchasePixResult {
  const rawKey = (input.pixKey || '').trim();
  if (!rawKey) {
    return {
      success: false,
      error: 'Nenhuma chave PIX configurada em Configurações.',
    };
  }

  const effectiveType = input.keyType || inferPixKeyType(rawKey);
  if (!effectiveType) {
    return {
      success: false,
      error: 'Tipo de chave PIX não reconhecido. Revise o cadastro PIX em Configurações.',
    };
  }

  const keyCheck = validatePixKey(rawKey, effectiveType);
  if (!keyCheck.valid) {
    return {
      success: false,
      error: keyCheck.error || 'Chave PIX configurada é inválida.',
    };
  }

  const roundedAmount = roundPixAmount(input.amount);
  if (!Number.isFinite(roundedAmount) || roundedAmount <= 0) {
    return {
      success: false,
      error: 'O valor do pedido deve ser maior que zero para gerar o PIX.',
    };
  }
  if (roundedAmount > MAX_PIX_AMOUNT) {
    return {
      success: false,
      error: 'O valor do pedido excede o limite suportado pelo PIX.',
    };
  }

  const receiverCheck = validatePixReceiver(input.receiverName, input.receiverCity);
  if (!receiverCheck.valid) {
    return {
      success: false,
      error: receiverCheck.error || 'Nome e cidade do titular da conta PIX são obrigatórios.',
    };
  }

  const txId = input.txId
    ? sanitizeTxId(input.txId)
    : generateOrderPixTxId(input.orderNumber, input.orderId);

  try {
    const payload = generatePixCopiaECola({
      pixKey: keyCheck.normalized,
      keyType: effectiveType,
      receiverName: receiverCheck.receiverName,
      receiverCity: receiverCheck.receiverCity,
      amount: roundedAmount,
      txId,
      description: input.description,
    });

    const audit = validatePixPayload(payload);
    if (!audit.valid) {
      return {
        success: false,
        error: audit.error || 'Payload PIX gerado falhou na validação estrutural.',
      };
    }

    return {
      success: true,
      payload,
      txId,
      normalizedKey: keyCheck.normalized,
      receiverName: receiverCheck.receiverName,
      receiverCity: receiverCheck.receiverCity,
      amount: roundedAmount,
    };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Falha ao gerar payload PIX.',
    };
  }
}

export interface ParsedPixTLV {
  [tag: string]: string;
}

/**
 * Parses an EMVCo / BACEN BR Code TLV sequence strictly by declared UTF-8 byte lengths,
 * rejecting malformed tags, truncated blocks, and duplicate tags.
 */
export function parseTLVFields(raw: string): { valid: boolean; fields: ParsedPixTLV; error?: string } {
  const fields: ParsedPixTLV = {};
  const rawBytes = encodeUtf8(raw);
  let byteIndex = 0;

  while (byteIndex < rawBytes.length) {
    if (byteIndex + 4 > rawBytes.length) {
      return { valid: false, fields, error: `Cabeçalho TLV truncado na posição de byte ${byteIndex}.` };
    }
    let headerStr = '';
    try {
      headerStr = decodeUtf8(rawBytes.slice(byteIndex, byteIndex + 4));
    } catch {
      return { valid: false, fields, error: `Cabeçalho TLV com UTF-8 inválido na posição ${byteIndex}.` };
    }
    const tag = headerStr.slice(0, 2);
    const lenStr = headerStr.slice(2, 4);
    if (!/^\d{2}$/.test(tag) || !/^\d{2}$/.test(lenStr)) {
      return {
        valid: false,
        fields,
        error: `Tag ou comprimento inválido na posição de byte ${byteIndex}: '${tag}${lenStr}'.`,
      };
    }
    if (Object.prototype.hasOwnProperty.call(fields, tag)) {
      return {
        valid: false,
        fields,
        error: `Tag TLV duplicada detectada: '${tag}'.`,
      };
    }

    const len = parseInt(lenStr, 10);
    const valStart = byteIndex + 4;
    const valEnd = valStart + len;
    if (valEnd > rawBytes.length) {
      return {
        valid: false,
        fields,
        error: `Campo '${tag}' declara tamanho ${len} bytes, mas excede o payload.`,
      };
    }

    let val = '';
    try {
      val = decodeUtf8(rawBytes.slice(valStart, valEnd));
    } catch {
      return {
        valid: false,
        fields,
        error: `Valor do campo '${tag}' contém sequência UTF-8 inválida.`,
      };
    }

    fields[tag] = val;
    byteIndex = valEnd;
  }

  return { valid: true, fields };
}

export interface PixPayloadAuditResult {
  valid: boolean;
  error?: string;
  fields?: ParsedPixTLV;
  merchantAccountInfo?: ParsedPixTLV;
  additionalData?: ParsedPixTLV;
  pixKey?: string;
  amount?: string;
  txId?: string;
  receiverName?: string;
  receiverCity?: string;
  crcProvided?: string;
  crcExpected?: string;
}

/**
 * Validates the complete EMV/BR Code structure and CRC16-CCITT checksum of a generated PIX string.
 */
export function validatePixPayload(payload: string): PixPayloadAuditResult {
  if (!payload || getUtf8ByteLength(payload) < 16) {
    return { valid: false, error: 'Payload PIX vazio ou muito curto.' };
  }

  const parsed = parseTLVFields(payload);
  if (!parsed.valid) {
    return { valid: false, error: parsed.error };
  }

  const f = parsed.fields;
  if (f['00'] !== '01') return { valid: false, error: 'Campo 00 (Format Indicator) deve ser 01.' };
  if (f['01'] !== undefined && f['01'] !== '11' && f['01'] !== '12') {
    return { valid: false, error: 'Campo 01 (Point of Initiation) deve ser 11 ou 12.' };
  }
  if (f['52'] !== '0000') return { valid: false, error: 'Campo 52 (MCC) deve ser 0000.' };
  if (f['53'] !== '986') return { valid: false, error: 'Campo 53 (Moeda BRL) deve ser 986.' };

  if (f['54'] !== undefined) {
    if (!/^\d+\.\d{2}$/.test(f['54']) || getUtf8ByteLength(f['54']) > 13) {
      return { valid: false, error: 'Campo 54 (Valor) possui formato inválido.' };
    }
    const parsedAmount = Number(f['54']);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0 || parsedAmount > MAX_PIX_AMOUNT) {
      return { valid: false, error: 'Campo 54 (Valor) deve ser maior que zero e dentro do limite.' };
    }
  }

  if (f['58'] !== 'BR') return { valid: false, error: 'Campo 58 (País) deve ser BR.' };
  const nameBytes = f['59'] ? getUtf8ByteLength(f['59']) : 0;
  if (!f['59'] || nameBytes < 1 || nameBytes > 25) {
    return { valid: false, error: 'Campo 59 (Recebedor) ausente ou > 25 bytes.' };
  }
  const cityBytes = f['60'] ? getUtf8ByteLength(f['60']) : 0;
  if (!f['60'] || cityBytes < 1 || cityBytes > 15) {
    return { valid: false, error: 'Campo 60 (Cidade) ausente ou > 15 bytes.' };
  }

  if (!f['26']) return { valid: false, error: 'Campo 26 (Merchant Account Info) ausente.' };
  if (getUtf8ByteLength(f['26']) > 99) {
    return { valid: false, error: 'Campo 26 (Merchant Account Info) excede 99 bytes.' };
  }
  const mai = parseTLVFields(f['26']);
  if (!mai.valid) return { valid: false, error: `Campo 26 inválido: ${mai.error}` };
  if (mai.fields['00'] !== 'br.gov.bcb.pix') {
    return { valid: false, error: 'Subcampo 26.00 deve ser br.gov.bcb.pix.' };
  }
  if (!mai.fields['01'] || getUtf8ByteLength(mai.fields['01']) > 77) {
    return { valid: false, error: 'Subcampo 26.01 (Chave PIX) ausente ou inválido.' };
  }

  let addData: ParsedPixTLV | undefined;
  if (f['62']) {
    if (getUtf8ByteLength(f['62']) > 99) {
      return { valid: false, error: 'Campo 62 (Additional Data) excede 99 bytes.' };
    }
    const parsed62 = parseTLVFields(f['62']);
    if (!parsed62.valid) return { valid: false, error: `Campo 62 inválido: ${parsed62.error}` };
    if (
      parsed62.fields['05'] !== undefined &&
      (parsed62.fields['05'].length === 0 || getUtf8ByteLength(parsed62.fields['05']) > 25)
    ) {
      return { valid: false, error: 'Subcampo 62.05 (TXID) vazio ou > 25 bytes.' };
    }
    addData = parsed62.fields;
  }

  const crcProvided = f['63'];
  if (!crcProvided || !/^[0-9A-F]{4}$/.test(crcProvided) || !payload.endsWith(`6304${crcProvided}`)) {
    return { valid: false, error: 'Campo 63 (CRC16) ausente ou mal posicionado.' };
  }

  const crcExpected = calculateCRC16(payload.slice(0, -4));
  if (crcProvided !== crcExpected) {
    return {
      valid: false,
      error: `CRC16 inválido (esperado ${crcExpected}, obtido ${crcProvided}).`,
      crcProvided,
      crcExpected,
    };
  }

  return {
    valid: true,
    fields: f,
    merchantAccountInfo: mai.fields,
    additionalData: addData,
    pixKey: mai.fields['01'],
    amount: f['54'],
    txId: addData?.['05'],
    receiverName: f['59'],
    receiverCity: f['60'],
    crcProvided,
    crcExpected,
  };
}
