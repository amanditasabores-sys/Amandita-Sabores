/**
 * Brazilian Central Bank PIX (BR Code / EMV) Payload Generator
 * Generates official standard Pix Copia e Cola strings with exact amount and CRC16 checksum.
 */

function formatField(id: string, value: string): string {
  const len = value.length.toString().padStart(2, '0');
  return `${id}${len}${value}`;
}

function calculateCRC16(payload: string): string {
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

export interface PixPayloadParams {
  pixKey: string;
  receiverName: string;
  receiverCity: string;
  amount: number;
  txId?: string;
  description?: string;
}

export function generatePixCopiaECola(params: PixPayloadParams): string {
  const cleanKey = params.pixKey.trim();
  const cleanName = params.receiverName.trim().slice(0, 25).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase() || 'RECEBEDOR';
  const cleanCity = params.receiverCity.trim().slice(0, 15).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase() || 'SAO PAULO';
  const cleanAmount = params.amount > 0 ? params.amount.toFixed(2) : '';
  const txId = (params.txId || '***').slice(0, 25).replace(/[^A-Za-z0-9]/g, '') || '***';

  // Format 26: Merchant Account Information
  const gui = formatField('00', 'br.gov.bcb.pix');
  const key = formatField('01', cleanKey);
  const infoDesc = params.description ? formatField('02', params.description.slice(0, 40)) : '';
  const merchantAccountInfo = formatField('26', `${gui}${key}${infoDesc}`);

  // Base fields
  const payloadFormat = formatField('00', '01'); // Version 01
  const pointOfInitiation = formatField('01', '12'); // 12 = Dynamic / Unique payment
  const merchantCategory = formatField('52', '0000'); // Merchant category code
  const transactionCurrency = formatField('53', '986'); // BRL
  const transactionAmount = cleanAmount ? formatField('54', cleanAmount) : '';
  const countryCode = formatField('58', 'BR');
  const merchantName = formatField('59', cleanName);
  const merchantCity = formatField('60', cleanCity);

  // Field 62: Additional Data Field Template (TxID)
  const additionalDataField = formatField('62', formatField('05', txId));

  // Assemble before CRC
  const rawPayload = `${payloadFormat}${pointOfInitiation}${merchantAccountInfo}${merchantCategory}${transactionCurrency}${transactionAmount}${countryCode}${merchantName}${merchantCity}${additionalDataField}6304`;

  // Calculate CRC16 checksum
  const crc16 = calculateCRC16(rawPayload);

  return `${rawPayload}${crc16}`;
}
