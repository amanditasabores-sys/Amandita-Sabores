import QRCode from 'qrcode';

export async function generateQRCodeDataUrl(text: string, options?: QRCode.QRCodeToDataURLOptions): Promise<string> {
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('Conteúdo vazio ou inválido para geração de QR Code.');
  }
  try {
    const dataUrl = await QRCode.toDataURL(text, {
      width: 320,
      margin: 2,
      color: {
        dark: '#0f172a',
        light: '#ffffff',
      },
      ...options,
    });
    if (!dataUrl || !dataUrl.startsWith('data:image/')) {
      throw new Error('QR Code gerado em formato inválido.');
    }
    return dataUrl;
  } catch (err) {
    console.error('Failed to generate QR code', err);
    throw err instanceof Error ? err : new Error('Falha ao gerar imagem do QR Code.');
  }
}
