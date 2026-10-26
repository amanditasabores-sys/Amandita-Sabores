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

export function formatField(id: string, value: string): string {
  const len = value.length.toString().padStart(2, '0');
  return `${id}${len}${value}`;
}

export function calculateCRC16(payload: string): string {
  let crc = 0xffff;
  const polynomial = 0x1021;

  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
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
    return trimmed.toLowerCase().replace(/\s+/g, '');
  }

  if (keyType === 'ALEATORIA') {
    return trimmed.toLowerCase().replace(/\s+/g, '');
  }

  return trimmed;
}

/**
 * Normalizes Merchant Name (Field 59):
 * BACEN EMVCo spec: Max 25 chars, uppercase ASCII alphanumeric and spaces only, no diacritics.
 */
export function sanitizeMerchantName(rawName?: string): string {
  if (!rawName) return 'AMANDITA SABORES';
  const clean = rawName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
    .slice(0, 25)
    .trim();
  return clean || 'AMANDITA SABORES';
}

/**
 * Normalizes Merchant City (Field 60):
 * BACEN EMVCo spec: Max 15 chars, uppercase ASCII alphanumeric and spaces only, no diacritics.
 */
export function sanitizeMerchantCity(rawCity?: string): string {
  if (!rawCity) return 'CAMPINA GRANDE';
  const clean = rawCity
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
    .slice(0, 15)
    .trim();
  return clean || 'CAMPINA GRANDE';
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
 * Normalizes Description (Field 26, subfield 02):
 * Optional, alphanumeric ASCII only, max 20 chars.
 */
export function sanitizeDescription(rawDesc?: string): string {
  if (!rawDesc) return '';
  return rawDesc
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9 ]/g, '')
    .slice(0, 20)
    .trim();
}

/**
 * Generates an official, 100% BACEN-compliant Pix Copia e Cola / BR Code string.
 */
export function generatePixCopiaECola(params: PixPayloadParams): string {
  const cleanKey = sanitizePixKey(params.pixKey, params.keyType);
  if (!cleanKey) {
    throw new Error('Chave PIX inválida ou não informada');
  }

  const cleanName = sanitizeMerchantName(params.receiverName);
  const cleanCity = sanitizeMerchantCity(params.receiverCity);
  const cleanAmount = params.amount > 0 ? params.amount.toFixed(2) : '';
  const txId = sanitizeTxId(params.txId);
  const cleanDesc = params.description ? sanitizeDescription(params.description) : '';

  // Field 00: Payload Format Indicator (Version 01)
  const payloadFormat = formatField('00', '01');

  // Field 01: Point of Initiation Method
  // '11' = Static QR Code (predefined key with or without exact value, accepted by all banking apps)
  const pointOfInitiation = formatField('01', '11');

  // Field 26: Merchant Account Information
  const gui = formatField('00', 'br.gov.bcb.pix');
  const key = formatField('01', cleanKey);
  const desc = cleanDesc ? formatField('02', cleanDesc) : '';
  const merchantAccountInfo = formatField('26', `${gui}${key}${desc}`);

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

  // Calculate CRC16 checksum
  const crc16 = calculateCRC16(rawPayload);

  return `${rawPayload}${crc16}`;
}
