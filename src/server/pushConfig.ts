import webpush from 'web-push';

// Configuration constants
export const DEV_FALLBACK_PUBLIC_KEY = 'BJoRmXFaMXFlCcWPH9spcZds3eVoyOmKGsSwW6dyZJyTZR8F7oKJNNWVpkmEaQHf0TXu9bAgnCsLmDV0RIs7bBM';
export const DEV_FALLBACK_PRIVATE_KEY = 'ybqwkEcDC1gF4CmWeNItQ0hEI_fxgKgnvhYPqsYAeQI';

export interface VapidConfigResult {
  publicKey: string;
  privateKey: string;
  subject: string;
  isConfigured: boolean;
  isProductionActive: boolean;
  statusMessage: string;
}

export function getVapidConfig(): VapidConfigResult {
  const rawPub = process.env.VAPID_PUBLIC_KEY || process.env.VITE_FIREBASE_VAPID_KEY || '';
  const rawPriv = process.env.VAPID_PRIVATE_KEY || process.env.FIREBASE_VAPID_PRIVATE_KEY || '';

  const cleanedPub = rawPub.trim().replace(/\s+/g, '');
  const cleanedPriv = rawPriv.trim().replace(/\s+/g, '');

  const rawSubject = (process.env.VAPID_SUBJECT || process.env.ASSUNTO_VAPID || '').trim();
  const defaultAdmin = (process.env.VITE_INITIAL_ADMIN_EMAIL || 'dvrmercadinho@gmail.com').trim().toLowerCase();
  const vapidSubject = rawSubject
    ? (rawSubject.startsWith('mailto:') || rawSubject.startsWith('https:') ? rawSubject : `mailto:${rawSubject}`)
    : `mailto:${defaultAdmin}`;

  let activePublicKey = DEV_FALLBACK_PUBLIC_KEY;
  let activePrivateKey = DEV_FALLBACK_PRIVATE_KEY;
  let isConfigured = false;
  let isProductionActive = false;
  let statusMessage = '';

  if (cleanedPub && cleanedPriv) {
    try {
      webpush.setVapidDetails(vapidSubject, cleanedPub, cleanedPriv);
      activePublicKey = cleanedPub;
      activePrivateKey = cleanedPriv;
      isConfigured = true;
      isProductionActive = true;
      statusMessage = 'VAPID de produção configurado e validado com sucesso.';
    } catch (prodErr: unknown) {
      const msg = prodErr instanceof Error ? prodErr.message : String(prodErr);
      statusMessage = `Chave VAPID recebida inválida (${msg}). Ativando contingência operacional.`;
      try {
        webpush.setVapidDetails(vapidSubject, DEV_FALLBACK_PUBLIC_KEY, DEV_FALLBACK_PRIVATE_KEY);
        activePublicKey = DEV_FALLBACK_PUBLIC_KEY;
        activePrivateKey = DEV_FALLBACK_PRIVATE_KEY;
        isConfigured = true;
      } catch {}
    }
  } else {
    try {
      webpush.setVapidDetails(vapidSubject, DEV_FALLBACK_PUBLIC_KEY, DEV_FALLBACK_PRIVATE_KEY);
      activePublicKey = DEV_FALLBACK_PUBLIC_KEY;
      activePrivateKey = DEV_FALLBACK_PRIVATE_KEY;
      isConfigured = true;
      statusMessage = 'VAPID padrão de contingência carregado (variáveis de produção não informadas).';
    } catch {}
  }

  return {
    publicKey: activePublicKey,
    privateKey: activePrivateKey,
    subject: vapidSubject,
    isConfigured,
    isProductionActive,
    statusMessage,
  };
}

export function sendJson(res: any, statusCode: number, data: unknown) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (typeof res.status === 'function' && typeof res.json === 'function') {
    return res.status(statusCode).json(data);
  }
  res.statusCode = statusCode;
  res.end(JSON.stringify(data));
}

