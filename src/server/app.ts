import express, { type Request, type Response } from 'express';
import fs from 'fs';
import path from 'path';
import webpush from 'web-push';
import crypto from 'crypto';
import { getFirebaseAdminInstances, getFirebaseClientConfigStatus } from './firebaseAdmin.js';
import type { Auth as AdminAuth } from 'firebase-admin/auth';
import { INITIAL_MENU, OFFICIAL_ADDONS } from '../data/initialData.js';
import { getVapidConfig } from './pushConfig.js';
import {
  DEFAULT_CLOSED_PRIMARY_MESSAGE,
  DEFAULT_CLOSED_SECONDARY_MESSAGE,
  DEFAULT_OPERATING_HOURS,
  normalizeClosedSettings,
  validateOperatingHours,
  validateWhatsAppNumber,
} from '../utils/storeHours.js';
import {
  type PixKeyType,
  inferPixKeyType,
  sanitizeTxId,
  validatePixKey,
  validatePixPayload,
  validatePixReceiver,
} from '../utils/pix.js';

// Shared Firebase Admin & Client Env Config (Client SDK is never loaded in serverless backend)
const firebaseAdmin = getFirebaseAdminInstances();
const firebaseClientConfig = getFirebaseClientConfigStatus(firebaseAdmin.projectId);
const PROJECT_ID = firebaseAdmin.projectId;
const API_KEY = firebaseClientConfig.apiKey;
const AUTH_DOMAIN = firebaseClientConfig.authDomain;
const STORAGE_BUCKET = firebaseClientConfig.storageBucket;
const SENDER_ID = firebaseClientConfig.messagingSenderId;
const APP_ID = firebaseClientConfig.appId;
const INITIAL_ADMIN_EMAIL = (process.env.VITE_INITIAL_ADMIN_EMAIL || 'dvrmercadinho@gmail.com').trim().toLowerCase();

// Official Catalog Reference Map (For strict O(1) price, product existence & addon verification)
const catalogMap = new Map<string, { id: string; name: string; price: number; available: boolean }>();
for (const item of INITIAL_MENU) {
  catalogMap.set(item.id, {
    id: item.id,
    name: item.name,
    price: item.price,
    available: item.available,
  });
}

// ---------------------------------------------------------------------------
// Web Push & Background Notification Configuration
// ---------------------------------------------------------------------------
// Resolve VAPID keys: prioritize environment variables (with trim and whitespace cleanup)
const rawVapidPub = process.env.VAPID_PUBLIC_KEY || process.env.VITE_FIREBASE_VAPID_KEY;
const rawVapidPriv = process.env.VAPID_PRIVATE_KEY || process.env.FIREBASE_VAPID_PRIVATE_KEY;

// Valid cryptographic P-256 fallback keypair for local/preview execution if production env is pending
const DEV_FALLBACK_PUBLIC_KEY = 'BJoRmXFaMXFlCcWPH9spcZds3eVoyOmKGsSwW6dyZJyTZR8F7oKJNNWVpkmEaQHf0TXu9bAgnCsLmDV0RIs7bBM';
const DEV_FALLBACK_PRIVATE_KEY = 'ybqwkEcDC1gF4CmWeNItQ0hEI_fxgKgnvhYPqsYAeQI';

const cleanedPub = (rawVapidPub ? rawVapidPub.trim().replace(/\s+/g, '') : '');
const cleanedPriv = (rawVapidPriv ? rawVapidPriv.trim().replace(/\s+/g, '') : '');

let activeVapidPublicKey = DEV_FALLBACK_PUBLIC_KEY;
let activeVapidPrivateKey = DEV_FALLBACK_PRIVATE_KEY;
let isVapidConfigured = false;
let isProductionVapidActive = false;
let vapidConfigMessage = '';

// Support both standard VAPID_SUBJECT and ASSUNTO_VAPID environment variables
const rawSubject = (process.env.VAPID_SUBJECT || process.env.ASSUNTO_VAPID || '').trim();
const VAPID_SUBJECT = rawSubject
  ? (rawSubject.startsWith('mailto:') || rawSubject.startsWith('https:') ? rawSubject : `mailto:${rawSubject}`)
  : `mailto:${INITIAL_ADMIN_EMAIL}`;

// Check if production environment keys were provided and are mathematically valid
if (cleanedPub && cleanedPriv) {
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, cleanedPub, cleanedPriv);
    activeVapidPublicKey = cleanedPub;
    activeVapidPrivateKey = cleanedPriv;
    isVapidConfigured = true;
    isProductionVapidActive = true;
    vapidConfigMessage = 'VAPID de produção configurado e validado com sucesso.';
    console.log('[Web Push]', vapidConfigMessage);
  } catch (prodVapidErr: unknown) {
    const errMsg = prodVapidErr instanceof Error ? prodVapidErr.message : String(prodVapidErr);
    vapidConfigMessage = `Chave VAPID recebida inválida (${errMsg}). Ativando contingência operacional.`;
    console.warn('[Web Push]', vapidConfigMessage);
    try {
      webpush.setVapidDetails(VAPID_SUBJECT, DEV_FALLBACK_PUBLIC_KEY, DEV_FALLBACK_PRIVATE_KEY);
      activeVapidPublicKey = DEV_FALLBACK_PUBLIC_KEY;
      activeVapidPrivateKey = DEV_FALLBACK_PRIVATE_KEY;
      isVapidConfigured = true;
      console.log('[Web Push] Contingência VAPID ativada com sucesso.');
    } catch (fallbackErr) {
      console.error('[Web Push] Falha crítica na contingência VAPID:', fallbackErr);
    }
  }
} else {
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, DEV_FALLBACK_PUBLIC_KEY, DEV_FALLBACK_PRIVATE_KEY);
    activeVapidPublicKey = DEV_FALLBACK_PUBLIC_KEY;
    activeVapidPrivateKey = DEV_FALLBACK_PRIVATE_KEY;
    isVapidConfigured = true;
    vapidConfigMessage = 'VAPID padrão de contingência carregado (variáveis de produção não informadas).';
    console.log('[Web Push]', vapidConfigMessage);
  } catch (fallbackErr) {
    console.error('[Web Push] Falha ao configurar VAPID de contingência:', fallbackErr);
  }
}

const VAPID_PUBLIC_KEY = activeVapidPublicKey;
const VAPID_PRIVATE_KEY = activeVapidPrivateKey;

interface PushSubscriptionData {
  subscription: webpush.PushSubscription;
  role?: string;
  userAgent?: string;
  subscribedAt: string;
}

const PUSH_SUBS_CACHE_FILE = process.env.VERCEL
  ? path.join('/tmp', '.push_subscriptions_cache.json')
  : path.join(process.cwd(), '.push_subscriptions_cache.json');
const activePushSubscriptions: Map<string, PushSubscriptionData> = new Map();
try {
  if (fs.existsSync(PUSH_SUBS_CACHE_FILE)) {
    const raw = fs.readFileSync(PUSH_SUBS_CACHE_FILE, 'utf8');
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) {
      arr.forEach((sub: PushSubscriptionData) => {
        if (sub?.subscription?.endpoint) {
          activePushSubscriptions.set(sub.subscription.endpoint, sub);
        }
      });
    }
  }
} catch {}

function savePushSubsCacheFile() {
  try {
    fs.writeFileSync(
      PUSH_SUBS_CACHE_FILE,
      JSON.stringify(Array.from(activePushSubscriptions.values())),
      'utf8'
    );
  } catch {}
}

const sentNotificationOrderIds = new Set<string>();

// Cross-device Deleted Order Tombstone Registry (Server-backed + Admin/REST Firestore)
const TOMBSTONES_CACHE_FILE = process.env.VERCEL
  ? '/tmp/.deleted_orders_cache.json'
  : path.resolve(process.cwd(), '.deleted_orders_cache.json');
const serverDeletedOrderIds = new Set<string>();
try {
  if (fs.existsSync(TOMBSTONES_CACHE_FILE)) {
    const raw = fs.readFileSync(TOMBSTONES_CACHE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      parsed.forEach((id) => {
        if (typeof id === 'string' && id.trim()) serverDeletedOrderIds.add(id.trim());
      });
    }
  }
} catch {}

// ---------------------------------------------------------------------------
// Firebase Admin SDK Setup (Unified via src/server/firebaseAdmin)
// ---------------------------------------------------------------------------
let adminDb: FirebaseFirestore.Firestore | null = firebaseAdmin.adminDb;
let adminAuth: AdminAuth | null = firebaseAdmin.adminAuth;

// Strictly gated test harness hook (only active when both DISABLE_AUTO_LISTEN=1 and ALLOW_TEST_FIREBASE_OVERRIDES=1)
export function __setTestFirebaseAdminServices(overrides: {
  adminDb?: FirebaseFirestore.Firestore | null;
  adminAuth?: AdminAuth | null;
}): void {
  if (process.env.DISABLE_AUTO_LISTEN !== '1' || process.env.ALLOW_TEST_FIREBASE_OVERRIDES !== '1') {
    throw new Error('Test Firebase admin overrides are strictly disabled outside test harness.');
  }
  if ('adminDb' in overrides) {
    adminDb = overrides.adminDb ?? null;
  }
  if ('adminAuth' in overrides) {
    adminAuth = overrides.adminAuth ?? null;
  }
}

const roundCurrencyServer = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
};

async function recordOrderTombstoneServer(orderId: string, staffToken?: string | null): Promise<void> {
  serverDeletedOrderIds.add(orderId);
  try {
    const trimmed = Array.from(serverDeletedOrderIds).slice(-1000);
    fs.writeFileSync(TOMBSTONES_CACHE_FILE, JSON.stringify(trimmed), 'utf8');
  } catch {}
  const tombstonePayload = {
    id: orderId,
    deletedAt: new Date().toISOString(),
  };
  if (adminDb) {
    try {
      await adminDb.collection('order_tombstones').doc(orderId).set(tombstonePayload);
      return;
    } catch {}
  }
  if (staffToken && PROJECT_ID) {
    try {
      const baseUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
      await fetch(`${baseUrl}/order_tombstones/${orderId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${staffToken}`,
        },
        body: JSON.stringify(jsonToFirestoreDocument(tombstonePayload)),
      });
    } catch {}
  }
}

async function getOrderTombstonesServer(staffToken?: string | null): Promise<string[]> {
  if (adminDb) {
    try {
      const snap = await adminDb.collection('order_tombstones').limit(500).get();
      snap.forEach((d) => {
        if (d.id) serverDeletedOrderIds.add(d.id);
      });
      return Array.from(serverDeletedOrderIds);
    } catch {}
  }
  if (staffToken && PROJECT_ID) {
    try {
      const baseUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
      const restRes = await fetch(`${baseUrl}/order_tombstones?pageSize=500`, {
        headers: {
          Authorization: `Bearer ${staffToken}`,
        },
      });
      if (restRes.ok) {
        const data = await restRes.json().catch(() => ({}));
        if (Array.isArray(data.documents)) {
          data.documents.forEach((doc: any) => {
            const docId = typeof doc?.name === 'string' ? doc.name.split('/').pop() : '';
            if (docId) serverDeletedOrderIds.add(docId);
          });
        }
      }
    } catch {}
  }
  return Array.from(serverDeletedOrderIds);
}

// ---------------------------------------------------------------------------
// Helper: Serialization to Firestore REST Document Format
// ---------------------------------------------------------------------------
function toFirestoreValue(val: unknown): Record<string, unknown> {
  if (val === null || val === undefined) {
    return { nullValue: null };
  }
  if (typeof val === 'string') {
    return { stringValue: val };
  }
  if (typeof val === 'boolean') {
    return { booleanValue: val };
  }
  if (typeof val === 'number') {
    if (Number.isInteger(val)) {
      return { integerValue: String(val) };
    }
    return { doubleValue: val };
  }
  if (Array.isArray(val)) {
    return {
      arrayValue: {
        values: val.map(toFirestoreValue),
      },
    };
  }
  if (typeof val === 'object') {
    const fields: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      if (!k.startsWith('_') && v !== undefined) {
        fields[k] = toFirestoreValue(v);
      }
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

function jsonToFirestoreDocument(obj: Record<string, unknown>): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!k.startsWith('_') && v !== undefined) {
      fields[k] = toFirestoreValue(v);
    }
  }
  return { fields };
}

function fromFirestoreValue(val: any): any {
  if (!val || typeof val !== 'object') return val;
  if ('stringValue' in val) return val.stringValue;
  if ('booleanValue' in val) return val.booleanValue;
  if ('integerValue' in val) return parseInt(val.integerValue, 10);
  if ('doubleValue' in val) return parseFloat(val.doubleValue);
  if ('nullValue' in val) return null;
  if ('arrayValue' in val) {
    const list = val.arrayValue?.values || [];
    return list.map(fromFirestoreValue);
  }
  if ('mapValue' in val) {
    const res: Record<string, any> = {};
    const fields = val.mapValue?.fields || {};
    for (const [k, v] of Object.entries(fields)) {
      res[k] = fromFirestoreValue(v);
    }
    return res;
  }
  return null;
}

function firestoreDocumentToJson(doc: any): any {
  if (!doc || !doc.fields) return null;
  const res: Record<string, any> = {};
  for (const [k, v] of Object.entries(doc.fields)) {
    res[k] = fromFirestoreValue(v);
  }
  return res;
}

// ---------------------------------------------------------------------------
// Helper: Cloud Firestore Persistent Push Subscriptions (Vercel Multi-Worker Safe)
// ---------------------------------------------------------------------------
async function savePushSubscription(subData: PushSubscriptionData, staffToken?: string): Promise<boolean> {
  const endpoint = subData.subscription.endpoint;
  const endpointHash = crypto.createHash('sha256').update(endpoint).digest('hex');
  const record = {
    id: endpointHash,
    endpoint,
    keys: {
      p256dh: subData.subscription.keys?.p256dh || '',
      auth: subData.subscription.keys?.auth || '',
    },
    role: subData.role || 'staff',
    userAgent: subData.userAgent || '',
    updatedAt: new Date().toISOString(),
  };

  // In-memory & local file cache
  activePushSubscriptions.set(endpoint, subData);
  savePushSubsCacheFile();

  // Strategy 1: Firebase Admin SDK (Privileged backend bypass)
  if (adminDb) {
    try {
      await adminDb.collection('push_subscriptions').doc(endpointHash).set(record);
      return true;
    } catch (adminErr) {
      console.warn('[Push Store AdminDb] Fallback necessário:', adminErr);
    }
  }

  // Strategy 2: Firestore REST API with authenticated Staff Bearer token
  if (staffToken && PROJECT_ID) {
    try {
      const baseUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
      const docPayload = jsonToFirestoreDocument(record);
      const res = await fetch(`${baseUrl}/push_subscriptions/${endpointHash}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${staffToken}`,
        },
        body: JSON.stringify(docPayload),
      });
      if (res.ok) return true;
    } catch (restErr) {
      console.warn('[Push Store REST] Falha ao persistir inscrição push com token:', restErr);
    }
  }

  return true;
}

async function getAllPushSubscriptions(staffToken?: string): Promise<PushSubscriptionData[]> {
  const results: PushSubscriptionData[] = [];
  const seenEndpoints = new Set<string>();

  // Strategy 1: Firebase Admin SDK
  if (adminDb) {
    try {
      const snap = await adminDb.collection('push_subscriptions').get();
      snap.forEach((doc) => {
        const d = doc.data();
        if (d && d.endpoint && d.keys && !seenEndpoints.has(d.endpoint)) {
          seenEndpoints.add(d.endpoint);
          results.push({
            subscription: {
              endpoint: d.endpoint,
              keys: d.keys,
            } as any,
            role: d.role,
            userAgent: d.userAgent,
            subscribedAt: d.updatedAt || '',
          });
        }
      });
      if (results.length > 0) return results;
    } catch (e) {
      console.warn('[Push Get AdminDb] Erro ao recuperar inscrições:', e);
    }
  }

  // Strategy 2: Firestore REST API with authenticated Staff Bearer token
  if (staffToken && PROJECT_ID) {
    try {
      const baseUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/push_subscriptions`;
      const res = await fetch(baseUrl, {
        headers: {
          Authorization: `Bearer ${staffToken}`,
        },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.documents && Array.isArray(data.documents)) {
          for (const doc of data.documents) {
            const fields = doc.fields || {};
            const endpoint = fields.endpoint?.stringValue;
            const p256dh = fields.keys?.mapValue?.fields?.p256dh?.stringValue;
            const auth = fields.keys?.mapValue?.fields?.auth?.stringValue;
            if (endpoint && p256dh && auth && !seenEndpoints.has(endpoint)) {
              seenEndpoints.add(endpoint);
              results.push({
                subscription: {
                  endpoint,
                  keys: { p256dh, auth },
                } as any,
                role: fields.role?.stringValue,
                userAgent: fields.userAgent?.stringValue,
                subscribedAt: fields.updatedAt?.stringValue || '',
              });
            }
          }
        }
        if (results.length > 0) return results;
      }
    } catch (err) {
      console.warn('[Push Get REST] Erro ao recuperar inscrições com token:', err);
    }
  }

  // Strategy 3: Local memory / disk cache (populated by /api/push/subscribe)
  for (const [endpoint, sub] of activePushSubscriptions.entries()) {
    if (!seenEndpoints.has(endpoint)) {
      results.push(sub);
    }
  }

  return results;
}

async function deletePushSubscription(endpoint: string, staffToken?: string): Promise<void> {
  activePushSubscriptions.delete(endpoint);
  savePushSubsCacheFile();
  const endpointHash = crypto.createHash('sha256').update(endpoint).digest('hex');
  if (adminDb) {
    try {
      await adminDb.collection('push_subscriptions').doc(endpointHash).delete();
      return;
    } catch {}
  }
  if (staffToken && PROJECT_ID) {
    try {
      const baseUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/push_subscriptions/${endpointHash}`;
      await fetch(baseUrl, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${staffToken}` },
      });
    } catch {}
  }
}

// ---------------------------------------------------------------------------
// Persistent Push Dispatch Idempotency (Cross-Instance / Multi-Worker Safe)
// Prevents duplicate notifications for the same order and event across Vercel serverless containers
// ---------------------------------------------------------------------------
const DISPATCHES_CACHE_FILE = process.env.VERCEL
  ? path.join('/tmp', '.push_dispatches_cache.json')
  : path.join(process.cwd(), '.push_dispatches_cache.json');
let pushDispatchesCache: Set<string> = new Set();
try {
  if (fs.existsSync(DISPATCHES_CACHE_FILE)) {
    const raw = fs.readFileSync(DISPATCHES_CACHE_FILE, 'utf8');
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) {
      pushDispatchesCache = new Set(arr);
    }
  }
} catch {}

function saveDispatchesCacheFile() {
  try {
    fs.writeFileSync(DISPATCHES_CACHE_FILE, JSON.stringify(Array.from(pushDispatchesCache)), 'utf8');
  } catch {}
}

async function isPushAlreadyDispatched(key: string): Promise<boolean> {
  if (pushDispatchesCache.has(key)) return true;

  if (adminDb) {
    try {
      const snap = await adminDb.collection('push_dispatches').doc(key).get();
      if (snap.exists) {
        pushDispatchesCache.add(key);
        saveDispatchesCacheFile();
        return true;
      }
    } catch {}
  }

  if (API_KEY && PROJECT_ID) {
    try {
      const baseUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
      const res = await fetch(`${baseUrl}/push_dispatches/${key}?key=${API_KEY}`);
      if (res.ok) {
        pushDispatchesCache.add(key);
        saveDispatchesCacheFile();
        return true;
      }
    } catch {}
  }

  return false;
}

async function markPushDispatched(key: string, orderId: string, event: string): Promise<void> {
  pushDispatchesCache.add(key);
  saveDispatchesCacheFile();

  const record = {
    id: key,
    orderId,
    event,
    dispatchedAt: new Date().toISOString(),
  };

  if (adminDb) {
    try {
      await adminDb.collection('push_dispatches').doc(key).set(record);
      return;
    } catch {}
  }

  if (API_KEY && PROJECT_ID) {
    try {
      const baseUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
      const docPayload = jsonToFirestoreDocument(record);
      await fetch(`${baseUrl}/push_dispatches/${key}?key=${API_KEY}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(docPayload),
      });
    } catch {}
  }
}

async function sendOrderPushNotification(
  order: any,
  event: 'NEW_ORDER' | 'DELIVERY_CONFIRMED' | 'READY_FOR_DELIVERY' = 'NEW_ORDER',
  staffToken?: string
) {
  if (!order || !order.id) {
    return { sent: 0, failed: 0, total: 0 };
  }

  // 1. Strictly restrict notifications to ONLY the authorized business events
  if (event !== 'NEW_ORDER' && event !== 'DELIVERY_CONFIRMED' && event !== 'READY_FOR_DELIVERY') {
    return { sent: 0, failed: 0, total: 0 };
  }

  // 2. Persistent Cross-Instance Idempotency Lock
  const idempotencyKey = `notif_${order.id}_${event}`;
  const alreadySent = await isPushAlreadyDispatched(idempotencyKey);
  if (alreadySent) {
    console.info(`[Web Push Idempotency] Notificação '${event}' para pedido #${order.orderNumber} já enviada. Ignorando duplicata.`);
    return { sent: 0, failed: 0, total: 0 };
  }

  // Mark immediately as dispatched to avoid race conditions between parallel workers
  await markPushDispatched(idempotencyKey, order.id, event);

  // 3. Retrieve subscriptions
  const allSubscriptions = await getAllPushSubscriptions(staffToken);
  if (allSubscriptions.length === 0) {
    console.info(`[Web Push] Pedido #${order.orderNumber}: Nenhuma inscrição push registrada para alerta.`);
    return { sent: 0, failed: 0, total: 0 };
  }

  // STRICT PRIVACY SHIELD & EVENT-SPECIFIC ROLE TARGETING:
  // - NEW_ORDER: Kitchen & attendants responsible for receiving and prepping (exclui entregadores)
  // - READY_FOR_DELIVERY: Delivery drivers responsible for delivery & supervisors
  // - DELIVERY_CONFIRMED: Admin, gerente, cashier & attendants
  const staffSubscriptions = allSubscriptions.filter((s) => {
    const r = (s.role || '').toUpperCase();
    if (event === 'NEW_ORDER') {
      return ['ADMINISTRADOR', 'GERENTE', 'CAIXA', 'COZINHA', 'ATENDENTE'].includes(r);
    }
    if (event === 'READY_FOR_DELIVERY') {
      return ['ENTREGADOR', 'ADMINISTRADOR', 'GERENTE'].includes(r);
    }
    if (event === 'DELIVERY_CONFIRMED') {
      return ['ADMINISTRADOR', 'GERENTE', 'CAIXA', 'ATENDENTE', 'STAFF'].includes(r);
    }
    return false;
  });

  if (staffSubscriptions.length === 0) {
    console.info(`[Web Push] Pedido #${order.orderNumber}: Nenhuma inscrição autorizada ativa para o evento '${event}'.`);
    return { sent: 0, failed: 0, total: 0 };
  }

  // Chronological integrity: respect order's real creation or delivery time
  const orderTimestamp = order.createdAt ? new Date(order.createdAt).getTime() : Date.now();

  let title = '';
  let body = '';
  let tag = '';
  let targetUrl = '/?view=producao';

  if (event === 'NEW_ORDER') {
    title = `Novo Pedido #${order.orderNumber}!`;
    body = `${order.customer?.name || 'Cliente'} · R$ ${(order.totalAmount || 0).toFixed(2)} · ${order.fulfillmentType === 'RETIRADA' ? 'Retirada no Balcão' : 'Entrega'}`;
    tag = `order-${order.id}`;
    targetUrl = '/?view=producao';
  } else if (event === 'READY_FOR_DELIVERY') {
    const a = order.customer?.address;
    const addrParts: string[] = [];
    if (a?.condominium && !/outros|resid[eê]ncia/i.test(a.condominium)) addrParts.push(a.condominium);
    if (a?.street && !/outros|resid[eê]ncia/i.test(a.street) && a.street !== a?.condominium) {
      addrParts.push(a.number ? `${a.street}, ${a.number}` : a.street);
    } else if (a?.number) {
      addrParts.push(`Nº ${a.number}`);
    }
    if (a?.block) addrParts.push(`Bloco ${a.block}`);
    if (a?.apartment) addrParts.push(`Ap ${a.apartment}`);
    if (a?.neighborhood && !/outros/i.test(a.neighborhood) && a.neighborhood !== a?.condominium) {
      addrParts.push(a.neighborhood);
    }
    const addressText = addrParts.length > 0 ? addrParts.join(' · ') : 'Endereço no pedido';
    title = `Pedido #${order.orderNumber} pronto para entrega!`;
    body = `${order.customer?.name || 'Cliente'} · ${addressText} · Pronto para retirada.`;
    tag = `ready-${order.id}`;
    targetUrl = `/?view=entregador&pedido=${order.id}`;
  } else {
    // DELIVERY_CONFIRMED
    const driverName = order.deliveryPersonName || order.deliveryPerson?.name || 'Entregador';
    title = `Entrega Concluída! Pedido #${order.orderNumber}`;
    body = `Entregador ${driverName} confirmou a entrega para ${order.customer?.name || 'Cliente'}.`;
    tag = `delivery-${order.id}`;
    targetUrl = '/?view=admin';
  }

  console.info(`[Web Push] Disparando alerta (${event}) pedido #${order.orderNumber} para ${staffSubscriptions.length} dispositivo(s) da equipe...`);

  const payload = JSON.stringify({
    title,
    body,
    icon: '/pwa-192x192.png',
    badge: '/favicon-32x32.png',
    tag,
    orderId: order.id,
    orderNumber: order.orderNumber,
    eventType: event,
    url: targetUrl,
    timestamp: orderTimestamp,
  });

  const pushOptions = {
    TTL: 86400, // 24 horas de retenção nos gateways FCM/Apple
    urgency: 'high' as const, // Força acordar o dispositivo mesmo em modo Doze/economia de bateria no Android
  };

  const deadEndpoints: string[] = [];
  let successfulDeliveries = 0;

  for (const subData of staffSubscriptions) {
    try {
      const res = await webpush.sendNotification(subData.subscription, payload, pushOptions);
      successfulDeliveries++;
      console.log(`[Web Push] Alerta (${event}) entregue ao gateway push (Status: ${res.statusCode || 201}) para dispositivo ${subData.role || 'staff'}`);
    } catch (err: any) {
      console.warn(`[Web Push] Falha ao enviar para endpoint (${err.statusCode || 'erro'}):`, err.message);
      if (err.statusCode === 404 || err.statusCode === 410) {
        deadEndpoints.push(subData.subscription.endpoint);
      }
    }
  }

  console.info(`[Web Push] Resumo de envio pedido #${order.orderNumber} (${event}): ${successfulDeliveries}/${staffSubscriptions.length} entregas confirmadas.`);

  for (const endpoint of deadEndpoints) {
    await deletePushSubscription(endpoint, staffToken);
  }
}

async function sendTestPushNotification(staffToken?: string): Promise<{ sent: number; failed: number }> {
  const subscriptions = await getAllPushSubscriptions(staffToken);
  if (subscriptions.length === 0) {
    console.info('[Web Push Test] Nenhuma inscrição push encontrada no Firestore.');
    return { sent: 0, failed: 0 };
  }

  console.info(`[Web Push Test] Disparando teste para ${subscriptions.length} dispositivo(s)...`);

  const payload = JSON.stringify({
    title: '🔔 Teste de Notificação - Amandita Sabores',
    body: 'Notificação em segundo plano ativa com prioridade alta! O aparelho acordará com tela bloqueada.',
    icon: '/pwa-192x192.png',
    badge: '/favicon-32x32.png',
    tag: `test-push-${Date.now()}`,
    url: '/?view=producao',
    timestamp: Date.now(),
  });

  const pushOptions = {
    TTL: 86400,
    urgency: 'high' as const,
    topic: 'system-tests',
  };

  let sent = 0;
  let failed = 0;
  const deadEndpoints: string[] = [];

  for (const subData of subscriptions) {
    try {
      const res = await webpush.sendNotification(subData.subscription, payload, pushOptions);
      sent++;
      console.log(`[Web Push Test] Teste entregue ao gateway (Status: ${res.statusCode || 201})`);
    } catch (err: any) {
      failed++;
      console.warn(`[Web Push Test] Falha no envio (${err.statusCode || 'erro'}):`, err.message);
      if (err.statusCode === 404 || err.statusCode === 410) {
        deadEndpoints.push(subData.subscription.endpoint);
      }
    }
  }

  for (const endpoint of deadEndpoints) {
    await deletePushSubscription(endpoint, staffToken);
  }

  return { sent, failed };
}

// ---------------------------------------------------------------------------
// Helper: Verify Authentication & Role from Server Request (RBAC Enforcement)
// ---------------------------------------------------------------------------
interface AuthVerificationResult {
  isStaff: boolean;
  role: string;
  uid: string | null;
  email: string | null;
  token: string | null;
}

const AUTHORIZED_STAFF_ROLES = new Set([
  'ADMINISTRADOR',
  'GERENTE',
  'CAIXA',
  'COZINHA',
  'ENTREGADOR',
  'ATENDENTE',
]);

function isBootstrappedAdminEmailServer(email: string): boolean {
  return (
    email === INITIAL_ADMIN_EMAIL ||
    email === 'admin@amanditasabores.com.br' ||
    email === 'amanditasabore@gmail.com' ||
    email === 'amanditasabores@gmail.com' ||
    email === 'dvrmercadinho@gmail.com'
  );
}

async function fetchUserProfileServer(
  uid: string,
  email: string,
  token: string
): Promise<Record<string, any> | null> {
  if (adminDb) {
    try {
      const snap = await adminDb.collection('users').doc(uid).get();
      if (snap.exists) {
        return snap.data() || null;
      }
      if (email) {
        const byEmail = await adminDb.collection('users').where('email', '==', email).limit(1).get();
        if (!byEmail.empty) {
          return byEmail.docs[0].data() || null;
        }
      }
    } catch {}
  }

  if (PROJECT_ID && token) {
    try {
      const baseUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
      const restRes = await fetch(`${baseUrl}/users/${uid}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (restRes.ok) {
        const rawDoc = await restRes.json();
        return firestoreDocumentToJson(rawDoc);
      }
    } catch {}
  }

  return null;
}

async function verifyStaffAuth(req: Request): Promise<AuthVerificationResult> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { isStaff: false, role: 'ANONYMOUS', uid: null, email: null, token: null };
  }

  const token = authHeader.substring(7).trim();
  if (!token) {
    return { isStaff: false, role: 'ANONYMOUS', uid: null, email: null, token: null };
  }

  try {
    let uid = '';
    let email = '';

    if (API_KEY) {
      // Verify bearer token with Google Identity Toolkit REST API
      const verifyRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: token }),
      });

      if (!verifyRes.ok) {
        return { isStaff: false, role: 'ANONYMOUS', uid: null, email: null, token: null };
      }

      const verifyData = await verifyRes.json();
      if (!verifyData.users || verifyData.users.length === 0) {
        return { isStaff: false, role: 'ANONYMOUS', uid: null, email: null, token: null };
      }

      const fbUser = verifyData.users[0];
      email = (fbUser.email || '').trim().toLowerCase();
      uid = fbUser.localId || '';
    } else if (adminAuth) {
      const decoded = await adminAuth.verifyIdToken(token);
      uid = decoded.uid || '';
      email = (decoded.email || '').trim().toLowerCase();
    } else {
      return { isStaff: false, role: 'ANONYMOUS', uid: null, email: null, token: null };
    }

    if (!uid) {
      return { isStaff: false, role: 'ANONYMOUS', uid: null, email: null, token: null };
    }

    // 1. Check authoritative Firestore /users profile first (enforces real role & ATIVO status)
    const userProfile = await fetchUserProfileServer(uid, email, token);
    if (userProfile) {
      const profileStatus = String(userProfile.status || 'ATIVO').trim().toUpperCase();
      const profileRole = String(userProfile.role || '').trim().toUpperCase();

      if (profileStatus !== 'ATIVO') {
        return { isStaff: false, role: profileStatus === 'BLOQUEADO' ? 'BLOCKED' : 'INACTIVE', uid, email, token };
      }
      if (AUTHORIZED_STAFF_ROLES.has(profileRole)) {
        return { isStaff: true, role: profileRole, uid, email, token };
      }
      if (profileRole === 'ADMIN') {
        return { isStaff: true, role: 'ADMINISTRADOR', uid, email, token };
      }
      return { isStaff: false, role: 'CUSTOMER', uid, email, token };
    }

    // 2. Designated Bootstrap Administrators (first login before /users/{uid} is created)
    if (email && isBootstrappedAdminEmailServer(email)) {
      return { isStaff: true, role: 'ADMINISTRADOR', uid, email, token };
    }

    // 3. Seeded Gerente bootstrap account
    if (email === 'gerente@amanditasabores.com.br') {
      return { isStaff: true, role: 'GERENTE', uid, email, token };
    }

    // 4. Staff Domain Check (only maps built-in operational fallback roles; never elevates arbitrary accounts to Admin)
    if (email.endsWith('@staff.amanditasabores.com.br') || email.endsWith('@amanditasabores.com.br')) {
      const username = email.split('@')[0];
      let role = 'ATENDENTE';
      if (username === 'cozinha' || username.startsWith('cozinha')) role = 'COZINHA';
      else if (username === 'entregador' || username.startsWith('entregador')) role = 'ENTREGADOR';
      else if (username === 'caixa' || username.startsWith('caixa')) role = 'CAIXA';
      return { isStaff: true, role, uid, email, token };
    }

    return { isStaff: false, role: 'CUSTOMER', uid, email, token };
  } catch (authErr) {
    console.warn('[Server Auth] Token validation error:', authErr instanceof Error ? authErr.message : authErr);
    return { isStaff: false, role: 'ANONYMOUS', uid: null, email: null, token: null };
  }
}

// ---------------------------------------------------------------------------
// Helper: Transactional & Idempotent Order + Public Tracking Write
// For public menu orders (requireOpenCashShift = true), verifies inside the SAME
// adminDb.runTransaction that exactly 1 cash_shifts document is ABERTO, eliminating
// TOCTOU races against concurrent cash closing.
// ---------------------------------------------------------------------------
async function persistOrderToFirestoreServer(
  order: Record<string, any>,
  publicTrackingDoc: Record<string, any>,
  staffToken: string | null,
  options?: { requireOpenCashShift?: boolean }
): Promise<{
  success: boolean;
  alreadyExists?: boolean;
  existingOrder?: Record<string, any>;
  error?: string;
  status?: number;
  isStoreClosed?: boolean;
  code?: string;
  reason?: string;
}> {
  const requireOpenCashShift = Boolean(options?.requireOpenCashShift);

  if (requireOpenCashShift && !adminDb) {
    return {
      success: false,
      status: 403,
      isStoreClosed: true,
      code: 'STORE_AVAILABILITY_UNVERIFIED',
      reason: 'UNABLE_TO_VERIFY_CASH',
      error:
        'Não foi possível confirmar no servidor se o caixa está aberto no momento. Por segurança, novos pedidos públicos foram bloqueados.',
    };
  }

  // Strategy 1: Firebase Admin SDK (Real Firestore Transaction)
  if (adminDb) {
    const db = adminDb;
    try {
      let txResult: {
        success: boolean;
        alreadyExists?: boolean;
        existingOrder?: Record<string, any>;
        error?: string;
        status?: number;
        isStoreClosed?: boolean;
        code?: string;
        reason?: string;
      } = { success: false, status: 500, error: 'Erro interno na transação do pedido.' };

      await db.runTransaction(async (tx: FirebaseFirestore.Transaction) => {
        const orderRef = db.collection('orders').doc(order.id);
        const orderSnap = await tx.get(orderRef);

        const trackRef = order.trackingCode ? db.collection('public_tracking').doc(order.trackingCode) : null;
        const trackSnap = trackRef ? await tx.get(trackRef) : null;

        let openShiftsSnap: FirebaseFirestore.QuerySnapshot | null = null;
        let activeShiftSnap: FirebaseFirestore.DocumentSnapshot | null = null;
        if (requireOpenCashShift) {
          openShiftsSnap = await tx.get(db.collection('cash_shifts').where('status', '==', 'ABERTO'));
          if (openShiftsSnap.docs.length === 1) {
            activeShiftSnap = await tx.get(openShiftsSnap.docs[0].ref);
          }
        }

        // Idempotent retry: preserve already-committed order cleanly even if shift closed afterwards
        if (orderSnap.exists) {
          const existingData = (orderSnap.data() || {}) as Record<string, any>;
          if (existingData.trackingCode && order.trackingCode && existingData.trackingCode !== order.trackingCode) {
            txResult = {
              success: false,
              error: 'Conflito de identificador de pedido: este ID já pertence a outro pedido.',
              status: 409,
            };
            return;
          }
          if (existingData.trackingCode && (!trackSnap || !trackSnap.exists) && trackRef) {
            tx.set(trackRef, publicTrackingDoc);
          }
          txResult = { success: true, alreadyExists: true, existingOrder: existingData };
          return;
        }

        // Atomic closed-store guard inside the SAME transaction as order creation
        if (requireOpenCashShift) {
          if (
            !openShiftsSnap ||
            openShiftsSnap.empty ||
            !activeShiftSnap ||
            !activeShiftSnap.exists ||
            activeShiftSnap.data()?.status !== 'ABERTO'
          ) {
            txResult = {
              success: false,
              status: 403,
              isStoreClosed: true,
              code: 'STORE_CLOSED',
              reason: 'CASH_CLOSED',
              error:
                'O estabelecimento está fechado no momento. Novos pedidos pelo cardápio estão temporariamente indisponíveis até a abertura do caixa.',
            };
            return;
          }

          if (openShiftsSnap.docs.length > 1) {
            txResult = {
              success: false,
              status: 403,
              isStoreClosed: true,
              code: 'STORE_CLOSED',
              reason: 'MULTIPLE_OPEN_SHIFTS',
              error: 'Inconsistência operacional: múltiplos turnos de caixa abertos simultaneamente.',
            };
            return;
          }
        }

        if (trackSnap && trackSnap.exists && trackSnap.data()?.id !== order.id) {
          txResult = {
            success: false,
            error: 'Conflito no código de rastreamento do pedido.',
            status: 409,
          };
          return;
        }

        tx.set(orderRef, order);
        if (trackRef) {
          tx.set(trackRef, publicTrackingDoc);
        }
        txResult = { success: true, alreadyExists: false };
      });

      return txResult;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (requireOpenCashShift) {
        return {
          success: false,
          status: 500,
          error: `Falha na transação do pedido no Firestore: ${msg}`,
        };
      }
      console.warn('[Server Admin SDK Transaction Failed, trying fallback]:', msg);
    }
  }

  if (requireOpenCashShift) {
    return {
      success: false,
      status: 403,
      isStoreClosed: true,
      code: 'STORE_AVAILABILITY_UNVERIFIED',
      reason: 'UNABLE_TO_VERIFY_CASH',
      error: 'Não foi possível confirmar o turno de caixa aberto no servidor.',
    };
  }

  // Strategy 2: Firestore REST API with Authenticated Staff Token (Staff PDV fallback when Admin SDK is absent)
  if (staffToken) {
    try {
      const baseUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
      const orderDocPayload = jsonToFirestoreDocument(order);
      const trackingDocPayload = jsonToFirestoreDocument(publicTrackingDoc);

      const orderRes = await fetch(`${baseUrl}/orders/${order.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${staffToken}`,
        },
        body: JSON.stringify(orderDocPayload),
      });

      if (!orderRes.ok) {
        const errText = await orderRes.text();
        return { success: false, error: `Firestore REST /orders erro (${orderRes.status}): ${errText}`, status: orderRes.status };
      }

      if (order.trackingCode) {
        await fetch(`${baseUrl}/public_tracking/${order.trackingCode}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${staffToken}`,
          },
          body: JSON.stringify(trackingDocPayload),
        }).catch(() => {});
      }

      return { success: true, alreadyExists: false };
    } catch (restErr: unknown) {
      const msg = restErr instanceof Error ? restErr.message : String(restErr);
      return { success: false, error: msg, status: 500 };
    }
  }

  return { success: false, error: 'Nenhum conector Firestore disponível no servidor (verifique autenticação de equipe ou service account).', status: 500 };
}

// ---------------------------------------------------------------------------
// Server Bootstrap & Route Definitions
// ---------------------------------------------------------------------------
export const app = express();

app.use(express.json());

// Ensure Content-Type: application/json for all API routes
app.use(['/api', '/push', '/orders', '/auth', '/health', '/store'], (_req: Request, res: Response, next) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  next();
});

// Health and Status API
app.get(['/api/health', '/health'], (_req: Request, res: Response) => {
  const hasAdmin = Boolean(adminDb);
  const currentClientCfg = getFirebaseClientConfigStatus(PROJECT_ID);
  if (!hasAdmin && firebaseAdmin.adminError) {
    res.status(500).json({
      status: 'error',
      system: 'Amandita Sabores - Diagnóstico Serverless',
      projectId: PROJECT_ID,
      hasAdminSdk: false,
      adminSdkInitialized: false,
      adminSdkConfigured: firebaseAdmin.adminConfigured,
      hasClientSdk: false,
      clientSdkInitialized: false,
      clientConfigured: currentClientCfg.configured,
      error: 'Falha ao inicializar Firebase Admin SDK.',
      details: firebaseAdmin.adminError,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  res.json({
    status: 'online',
    system: 'Amandita Sabores - Diagnóstico Serverless',
    projectId: PROJECT_ID,
    hasAdminSdk: hasAdmin,
    adminSdkInitialized: hasAdmin,
    adminSdkConfigured: firebaseAdmin.adminConfigured,
    hasClientSdk: false,
    clientSdkInitialized: false,
    clientConfigured: currentClientCfg.configured,
    timestamp: new Date().toISOString(),
  });
});

// Web Push Configuration & Subscription Endpoints
app.get(['/api/push/vapid-key', '/push/vapid-key'], (_req: Request, res: Response) => {
  const cfg = getVapidConfig();
  res.json({
    publicKey: cfg.publicKey,
    isConfigured: cfg.isConfigured,
    isProductionActive: cfg.isProductionActive,
    statusMessage: cfg.statusMessage,
  });
});

app.post(['/api/push/subscribe', '/push/subscribe'], async (req: Request, res: Response) => {
    try {
      const authHeader = req.headers.authorization || '';
      const staffToken = authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : undefined;
      const { subscription, role, userAgent } = req.body;
      if (!subscription || !subscription.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) {
        res.status(400).json({ success: false, message: 'Assinatura Push incompleta ou inválida.' });
        return;
      }
      await savePushSubscription({
        subscription,
        role: role || 'staff',
        userAgent,
        subscribedAt: new Date().toISOString(),
      }, staffToken);
      res.json({ success: true, message: 'Dispositivo registrado com sucesso no Firestore para notificações em segundo plano.' });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, message: msg });
    }
  });

  // Background Push Trigger for Newly Ingested Orders (Called automatically on all orders)
  app.post(['/api/push/notify-order', '/push/notify-order'], async (req: Request, res: Response) => {
    try {
      const authHeader = req.headers.authorization || '';
      const staffToken = authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : undefined;
      const { order, event } = req.body;
      if (!order || !order.id) {
        res.status(400).json({ success: false, message: 'Pedido ausente ou sem identificador.' });
        return;
      }
      let eventType: 'NEW_ORDER' | 'DELIVERY_CONFIRMED' | 'READY_FOR_DELIVERY' = 'NEW_ORDER';
      if (event === 'DELIVERY_CONFIRMED') {
        eventType = 'DELIVERY_CONFIRMED';
      } else if (event === 'READY_FOR_DELIVERY') {
        eventType = 'READY_FOR_DELIVERY';
      }
      const stats = await sendOrderPushNotification(order, eventType, staffToken);
      res.json({
        success: true,
        message: `Notificação push do evento ${eventType} despachada com sucesso aos dispositivos autorizados.`,
        stats,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, message: msg });
    }
  });

  // Background Push Status and Diagnostic API
  app.get(['/api/push/status', '/push/status'], async (req: Request, res: Response) => {
    const authHeader = req.headers.authorization || '';
    const staffToken = authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : undefined;
    const cfg = getVapidConfig();
    const subs = await getAllPushSubscriptions(staffToken);
    res.json({
      configured: cfg.isConfigured,
      active: cfg.isProductionActive,
      statusMessage: cfg.statusMessage,
      publicKeyPreview: cfg.publicKey ? `${cfg.publicKey.substring(0, 12)}...` : null,
      registeredDevicesCount: subs.length,
      allowedEvents: ['NEW_ORDER', 'DELIVERY_CONFIRMED', 'READY_FOR_DELIVERY'],
      timestamp: new Date().toISOString(),
    });
  });

  // Background Push Diagnostic & Testing Endpoint
  app.post(['/api/push/test', '/push/test'], async (req: Request, res: Response) => {
    try {
      const authHeader = req.headers.authorization || '';
      const staffToken = authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : undefined;
      const result = await sendTestPushNotification(staffToken);
      res.json({
        success: true,
        message: result.sent > 0 
          ? `Notificação de teste enviada com sucesso para ${result.sent} dispositivo(s)!`
          : 'Nenhum dispositivo com notificação push registrado no momento.',
        sent: result.sent,
        failed: result.failed,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, message: msg });
    }
  });

  // Secure Backend API: Staff Registration and Credential Administration
  // Enforces RBAC on server side: only authenticated ADMINISTRADOR or GERENTE
  app.post(['/api/auth/register-staff', '/auth/register-staff'], async (req: Request, res: Response) => {
    try {
      const auth = await verifyStaffAuth(req);
      const isAuthorizedManager = auth.isStaff && ['ADMINISTRADOR', 'GERENTE'].includes(auth.role.toUpperCase());

      if (!isAuthorizedManager) {
        res.status(403).json({
          success: false,
          message: 'Acesso negado: requer perfil autenticado de Administrador ou Gerente.',
        });
        return;
      }

      const { username, name, role, allowedModules } = req.body;

      if (!username || !role) {
        res.status(400).json({
          success: false,
          message: 'Dados incompletos: nome de usuário e cargo são obrigatórios.',
        });
        return;
      }

      // Enforce RBAC: Gerente cannot create an Administrador
      if (auth.role.toUpperCase() === 'GERENTE' && String(role).toUpperCase() === 'ADMINISTRADOR') {
        res.status(403).json({
          success: false,
          message: 'Permissão insuficiente: Gerente não possui autorização para criar contas de Administrador Geral.',
        });
        return;
      }

      const cleanUsername = String(username).trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '');
      const syntheticEmail = `${cleanUsername}@staff.amanditasabores.com.br`;

      res.json({
        success: true,
        message: 'Credencial de funcionário validada com sucesso pelo backend seguro.',
        user: {
          username: cleanUsername,
          name: name ? String(name).trim() : cleanUsername,
          email: syntheticEmail,
          role,
          allowedModules: allowedModules || ['pdv'],
          status: 'ATIVO',
          createdAt: new Date().toISOString(),
        },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, message: `Erro interno no backend: ${msg}` });
    }
  });

  // Secure Backend API: Password Reset Authorization
  app.post(['/api/auth/reset-password', '/auth/reset-password'], async (req: Request, res: Response) => {
    try {
      const auth = await verifyStaffAuth(req);
      const isAuthorizedManager = auth.isStaff && ['ADMINISTRADOR', 'GERENTE'].includes(auth.role.toUpperCase());

      if (!isAuthorizedManager) {
        res.status(403).json({
          success: false,
          message: 'Acesso negado: apenas Administrador ou Gerente autenticados podem autorizar redefinições de senha.',
        });
        return;
      }

      const { targetUserRole, newPassword } = req.body;

      if (auth.role.toUpperCase() === 'GERENTE' && String(targetUserRole).toUpperCase() === 'ADMINISTRADOR') {
        res.status(403).json({
          success: false,
          message: 'Permissão insuficiente: Gerente não pode redefinir a senha do Administrador Geral.',
        });
        return;
      }

      if (!newPassword || String(newPassword).trim().length < 4) {
        res.status(400).json({
          success: false,
          message: 'A nova senha deve possuir no mínimo 4 caracteres.',
        });
        return;
      }

      res.json({
        success: true,
        message: 'Redefinição de senha autorizada com sucesso pelo backend seguro.',
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, message: `Erro interno no backend: ${msg}` });
    }
  });

  // Sync / Link Staff Firestore Profile to Firebase Auth UID (resolves usr-... vs uid mismatch)
  app.post(['/api/auth/sync-profile', '/auth/sync-profile'], async (req: Request, res: Response) => {
    try {
      const auth = await verifyStaffAuth(req);
      if (!auth.uid || !auth.token) {
        res.status(401).json({ success: false, message: 'Token Firebase inválido ou ausente.' });
        return;
      }
      if (!auth.isStaff) {
        res.status(403).json({ success: false, message: 'Conta autenticada não pertence à equipe autorizada ou está inativa.' });
        return;
      }

      if (adminDb) {
        const uidRef = adminDb.collection('users').doc(auth.uid);
        const uidSnap = await uidRef.get();
        if (uidSnap.exists) {
          const existingProfile = uidSnap.data() || {};
          res.json({ success: true, profile: existingProfile });
          return;
        }

        let sourceProfile: Record<string, any> | null = null;
        if (auth.email) {
          const emailSnap = await adminDb.collection('users').where('email', '==', auth.email).limit(1).get();
          if (!emailSnap.empty) {
            sourceProfile = emailSnap.docs[0].data() || null;
          }
        }

        const now = new Date().toISOString();
        const normalizedRole = auth.role;
        const linkedProfile: Record<string, any> = {
          ...(sourceProfile || {}),
          id: auth.uid,
          firebaseUid: auth.uid,
          email: auth.email || sourceProfile?.email || '',
          name: sourceProfile?.name || req.body?.name || (auth.email ? auth.email.split('@')[0] : 'Colaborador'),
          username: sourceProfile?.username || req.body?.username || (auth.email ? auth.email.split('@')[0] : 'colaborador'),
          role: sourceProfile?.role || normalizedRole,
          status: sourceProfile?.status || 'ATIVO',
          allowedModules: Array.isArray(sourceProfile?.allowedModules)
            ? sourceProfile.allowedModules
            : (Array.isArray(req.body?.allowedModules) ? req.body.allowedModules : ['pdv', 'kanban']),
          isEmailVerified: true,
          createdAt: sourceProfile?.createdAt || now,
          lastLoginAt: now,
        };

        await uidRef.set(linkedProfile, { merge: true });
        res.json({ success: true, profile: linkedProfile, linked: true });
        return;
      }

      const existing = await fetchUserProfileServer(auth.uid, auth.email || '', auth.token);
      if (existing) {
        res.json({ success: true, profile: existing });
        return;
      }

      res.json({
        success: false,
        needsClientBootstrap: true,
        role: auth.role,
        message: 'Perfil ainda não provisionado no Firestore (Admin SDK indisponível para vinculação cruzada).',
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, message: `Erro ao sincronizar perfil: ${msg}` });
    }
  });

  // ---------------------------------------------------------------------------
  // Cardápio do Dia: Sincronização em Nuvem Multi-Dispositivo
  // Permite que a publicação feita pelo celular do administrador se propague
  // instantaneamente para computadores, clientes e outros dispositivos.
  // ---------------------------------------------------------------------------
  let activeDailyMenuCache: any = null;
  const DAILY_MENU_FILE = process.env.VERCEL
    ? path.join('/tmp', '.daily_menu_cache.json')
    : path.join(process.cwd(), '.daily_menu_cache.json');

  try {
    if (fs.existsSync(DAILY_MENU_FILE)) {
      const raw = fs.readFileSync(DAILY_MENU_FILE, 'utf8');
      activeDailyMenuCache = JSON.parse(raw);
    }
  } catch {}

  app.get(['/api/daily-menu', '/daily-menu'], async (_req: Request, res: Response) => {
    try {
      if (activeDailyMenuCache && typeof activeDailyMenuCache.enabled === 'boolean') {
        res.json({ success: true, dailyMenu: activeDailyMenuCache });
        return;
      }

      if (adminDb) {
        try {
          const snap = await adminDb.collection('configs').doc('daily_menu').get();
          if (snap.exists) {
            activeDailyMenuCache = snap.data();
            res.json({ success: true, dailyMenu: activeDailyMenuCache });
            return;
          }
        } catch (dbErr) {
          console.warn('[Daily Menu] Leitura via adminDb:', dbErr);
        }
      }

      if (API_KEY && PROJECT_ID) {
        try {
          const baseUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
          const restRes = await fetch(`${baseUrl}/configs/daily_menu?key=${API_KEY}`);
          if (restRes.ok) {
            const rawDoc = await restRes.json();
            if (rawDoc && rawDoc.fields) {
              activeDailyMenuCache = firestoreDocumentToJson(rawDoc);
              res.json({ success: true, dailyMenu: activeDailyMenuCache });
              return;
            }
          }
        } catch {}
      }

      res.json({ success: true, dailyMenu: activeDailyMenuCache || null });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, message: `Erro ao recuperar cardápio do dia: ${msg}` });
    }
  });

  app.post(['/api/daily-menu', '/daily-menu'], async (req: Request, res: Response) => {
    try {
      const config = req.body;
      if (!config || typeof config !== 'object') {
        res.status(400).json({ success: false, message: 'Configuração inválida.' });
        return;
      }

      activeDailyMenuCache = {
        enabled: Boolean(config.enabled),
        selectedItemIds: Array.isArray(config.selectedItemIds) ? config.selectedItemIds : [],
        selectedComboIds: Array.isArray(config.selectedComboIds) ? config.selectedComboIds : [],
        draftItemIds: Array.isArray(config.draftItemIds) ? config.draftItemIds : [],
        draftComboIds: Array.isArray(config.draftComboIds) ? config.draftComboIds : [],
        publishedAt: config.publishedAt || new Date().toISOString(),
        referenceDate: config.referenceDate || new Date().toISOString().split('T')[0],
        updatedAt: new Date().toISOString(),
      };

      try {
        fs.writeFileSync(DAILY_MENU_FILE, JSON.stringify(activeDailyMenuCache, null, 2), 'utf8');
      } catch {}

      if (adminDb) {
        try {
          await adminDb.collection('configs').doc('daily_menu').set(activeDailyMenuCache);
        } catch (dbErr) {
          console.warn('[Daily Menu] Persistência via adminDb:', dbErr);
        }
      } else if (API_KEY && PROJECT_ID) {
        try {
          const baseUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
          const docPayload = jsonToFirestoreDocument(activeDailyMenuCache);
          await fetch(`${baseUrl}/configs/daily_menu?key=${API_KEY}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(docPayload),
          });
        } catch {}
      }

      res.json({ success: true, message: 'Cardápio do dia sincronizado com sucesso!', dailyMenu: activeDailyMenuCache });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, message: `Erro ao salvar cardápio do dia: ${msg}` });
    }
  });

  // ---------------------------------------------------------------------------
  // Store Availability, Cash Register Public Guard & Operating Hours Schedule
  // Single authoritative source of truth for public menu availability:
  // Public menu is ONLY open when Firebase/server confirms 1 open cash shift.
  // Schedule & store settings are read/written directly against Cloud Firestore
  // (never treating local disk cache as official persistence).
  // ---------------------------------------------------------------------------
  async function syncRestaurantOpenStatusDoc(
    db: FirebaseFirestore.Firestore,
    isOpen: boolean
  ): Promise<void> {
    try {
      await db.collection('configs').doc('restaurant').set(
        {
          isOpen: Boolean(isOpen),
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
    } catch (err) {
      console.warn('[Store Availability] Aviso ao sincronizar configs/restaurant.isOpen:', err);
    }
  }

  async function getAuthoritativeCashRegisterAvailabilityServer(): Promise<{
    verified: boolean;
    isOpen: boolean;
    reason: 'CASH_OPEN' | 'CASH_CLOSED' | 'MULTIPLE_OPEN_SHIFTS' | 'UNABLE_TO_VERIFY_CASH';
    activeShiftId: string | null;
    message?: string;
  }> {
    if (!adminDb) {
      return {
        verified: false,
        isOpen: false,
        reason: 'UNABLE_TO_VERIFY_CASH',
        activeShiftId: null,
        message: 'Não foi possível verificar o estado do caixa no servidor (Admin SDK indisponível).',
      };
    }

    try {
      const openShiftsSnap = await adminDb.collection('cash_shifts').where('status', '==', 'ABERTO').get();
      if (openShiftsSnap.empty) {
        return {
          verified: true,
          isOpen: false,
          reason: 'CASH_CLOSED',
          activeShiftId: null,
          message: 'Nenhum turno de caixa aberto no momento.',
        };
      }
      if (openShiftsSnap.docs.length > 1) {
        return {
          verified: true,
          isOpen: false,
          reason: 'MULTIPLE_OPEN_SHIFTS',
          activeShiftId: null,
          message: 'Inconsistência operacional: múltiplos turnos de caixa abertos simultaneamente.',
        };
      }
      return {
        verified: true,
        isOpen: true,
        reason: 'CASH_OPEN',
        activeShiftId: openShiftsSnap.docs[0].id,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        verified: false,
        isOpen: false,
        reason: 'UNABLE_TO_VERIFY_CASH',
        activeShiftId: null,
        message: `Erro ao verificar turno de caixa no Firestore: ${msg}`,
      };
    }
  }

  const ALLOWED_RESTAURANT_PUBLIC_KEYS = [
    'name',
    'phone',
    'whatsapp',
    'address',
    'city',
    'pixKey',
    'pixKeyType',
    'pixReceiverName',
    'pixReceiverCity',
    'deliveryFeeBase',
    'avgPrepTimeMinutes',
    'avgDeliveryTimeMinutes',
    'isOpen',
    'customPublicUrl',
    'updatedAt',
  ] as const;

  function pickWhitelistedRestaurantFields(raw: Record<string, any> | null | undefined): Record<string, any> {
    if (!raw || typeof raw !== 'object') return {};
    const out: Record<string, any> = {};
    for (const k of ALLOWED_RESTAURANT_PUBLIC_KEYS) {
      if (raw[k] !== undefined) {
        out[k] = raw[k];
      }
    }
    return out;
  }

  async function readStoreScheduleAndRestaurantFromFirestore(staffToken?: string | null): Promise<{
    closedSettings: ReturnType<typeof normalizeClosedSettings>;
    restaurantPublicInfo: {
      name: string;
      whatsapp: string;
      phone: string;
      address: string;
      city: string;
    };
    restaurantConfig: Record<string, any> | null;
    hasServerRestaurantInfo: boolean;
    hasScheduleDoc: boolean;
    hasRestaurantDoc: boolean;
    scheduleLoadOk: boolean;
    restaurantLoadOk: boolean;
    errorStatus?: number;
    errorMessage?: string;
  }> {
    let closedSettings = normalizeClosedSettings({
      operatingHours: DEFAULT_OPERATING_HOURS,
      closedPrimaryMessage: DEFAULT_CLOSED_PRIMARY_MESSAGE,
      closedSecondaryMessage: DEFAULT_CLOSED_SECONDARY_MESSAGE,
    });

    const restaurantPublicInfo = {
      name: 'Amandita Sabores',
      whatsapp: '',
      phone: '',
      address: '',
      city: '',
    };
    let restaurantConfig: Record<string, any> | null = null;
    let hasServerRestaurantInfo = false;
    let hasScheduleDoc = false;
    let hasRestaurantDoc = false;
    let scheduleLoadOk = false;
    let restaurantLoadOk = false;
    let errorStatus: number | undefined;
    let errorMessage: string | undefined;

    if (adminDb) {
      try {
        const schedSnap = await adminDb.collection('configs').doc('store_schedule').get();
        scheduleLoadOk = true;
        if (schedSnap.exists) {
          hasScheduleDoc = true;
          const data = (schedSnap.data() || {}) as Record<string, any>;
          closedSettings = normalizeClosedSettings(data);
        }
      } catch (err) {
        scheduleLoadOk = false;
        errorStatus = 500;
        errorMessage = err instanceof Error ? err.message : String(err);
        console.warn('[Store Schedule] Leitura via adminDb falhou:', err);
      }

      try {
        const restSnap = await adminDb.collection('configs').doc('restaurant').get();
        restaurantLoadOk = true;
        if (restSnap.exists) {
          hasRestaurantDoc = true;
          const data = (restSnap.data() || {}) as Record<string, any>;
          restaurantConfig = pickWhitelistedRestaurantFields(data);
          const hasAnyField = Boolean(data.name || data.whatsapp || data.phone || data.address || data.city);
          if (hasAnyField) {
            hasServerRestaurantInfo = true;
            if (typeof data.name === 'string' && data.name.trim()) restaurantPublicInfo.name = data.name.trim();
            if (typeof data.whatsapp === 'string') restaurantPublicInfo.whatsapp = data.whatsapp.replace(/\D/g, '');
            if (typeof data.phone === 'string') restaurantPublicInfo.phone = data.phone.trim();
            if (typeof data.address === 'string') restaurantPublicInfo.address = data.address.trim();
            if (typeof data.city === 'string') restaurantPublicInfo.city = data.city.trim();
          }
        }
      } catch (err) {
        restaurantLoadOk = false;
        errorStatus = 500;
        errorMessage = err instanceof Error ? err.message : String(err);
        console.warn('[Store Public Info] Leitura via adminDb falhou:', err);
      }
    } else if (PROJECT_ID && (staffToken || API_KEY)) {
      try {
        const baseUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
        const headers: Record<string, string> = {};
        if (staffToken) headers.Authorization = `Bearer ${staffToken}`;
        const keyQs = !staffToken && API_KEY ? `?key=${API_KEY}` : '';

        const [schedRes, restRes] = await Promise.all([
          staffToken
            ? fetch(`${baseUrl}/configs/store_schedule`, { headers }).catch(() => null)
            : Promise.resolve(null),
          fetch(`${baseUrl}/configs/restaurant${keyQs}`, staffToken ? { headers } : undefined).catch(() => null),
        ]);

        if (schedRes) {
          if (schedRes.ok) {
            scheduleLoadOk = true;
            const rawDoc = await schedRes.json().catch(() => null);
            if (rawDoc?.fields) {
              hasScheduleDoc = true;
              closedSettings = normalizeClosedSettings(firestoreDocumentToJson(rawDoc));
            }
          } else if (schedRes.status === 404) {
            scheduleLoadOk = true;
            hasScheduleDoc = false;
          } else {
            scheduleLoadOk = false;
            errorStatus = schedRes.status === 403 ? 403 : 502;
            errorMessage = `Firestore REST /configs/store_schedule retornou HTTP ${schedRes.status}`;
          }
        }

        if (restRes) {
          if (restRes.ok) {
            restaurantLoadOk = true;
            const rawDoc = await restRes.json().catch(() => null);
            if (rawDoc?.fields) {
              hasRestaurantDoc = true;
              const data = firestoreDocumentToJson(rawDoc) || {};
              restaurantConfig = pickWhitelistedRestaurantFields(data);
              if (data.name || data.whatsapp || data.phone || data.address || data.city) {
                hasServerRestaurantInfo = true;
                if (typeof data.name === 'string' && data.name.trim()) restaurantPublicInfo.name = data.name.trim();
                if (typeof data.whatsapp === 'string') restaurantPublicInfo.whatsapp = data.whatsapp.replace(/\D/g, '');
                if (typeof data.phone === 'string') restaurantPublicInfo.phone = data.phone.trim();
                if (typeof data.address === 'string') restaurantPublicInfo.address = data.address.trim();
                if (typeof data.city === 'string') restaurantPublicInfo.city = data.city.trim();
              }
            }
          } else if (restRes.status === 404) {
            restaurantLoadOk = true;
            hasRestaurantDoc = false;
          } else {
            restaurantLoadOk = false;
            errorStatus = errorStatus || (restRes.status === 403 ? 403 : 502);
            errorMessage = errorMessage || `Firestore REST /configs/restaurant retornou HTTP ${restRes.status}`;
          }
        }
      } catch (err) {
        errorStatus = 502;
        errorMessage = err instanceof Error ? err.message : String(err);
      }
    } else {
      errorStatus = 503;
      errorMessage = 'Conector Firestore indisponível no servidor para leitura de configurações.';
    }

    return {
      closedSettings,
      restaurantPublicInfo,
      restaurantConfig,
      hasServerRestaurantInfo,
      hasScheduleDoc,
      hasRestaurantDoc,
      scheduleLoadOk,
      restaurantLoadOk,
      errorStatus,
      errorMessage,
    };
  }

  app.get(['/api/store/availability', '/store/availability'], async (_req: Request, res: Response) => {
    try {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      const [cashState, publicMeta] = await Promise.all([
        getAuthoritativeCashRegisterAvailabilityServer(),
        readStoreScheduleAndRestaurantFromFirestore(null),
      ]);

      res.json({
        success: true,
        verified: cashState.verified,
        isOpen: Boolean(cashState.verified && cashState.isOpen),
        reason: cashState.reason,
        message: cashState.message,
        activeShiftId: cashState.activeShiftId,
        closedSettings: publicMeta.closedSettings,
        restaurantPublicInfo: publicMeta.restaurantPublicInfo,
        hasServerRestaurantInfo: publicMeta.hasServerRestaurantInfo,
        scheduleLoadOk: publicMeta.scheduleLoadOk,
        restaurantLoadOk: publicMeta.restaurantLoadOk,
        checkedAt: new Date().toISOString(),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({
        success: false,
        verified: false,
        isOpen: false,
        reason: 'UNABLE_TO_VERIFY_CASH',
        message: `Erro ao verificar disponibilidade da loja: ${msg}`,
        closedSettings: normalizeClosedSettings(null),
        restaurantPublicInfo: { name: 'Amandita Sabores', whatsapp: '', phone: '', address: '', city: '' },
        hasServerRestaurantInfo: false,
        scheduleLoadOk: false,
        restaurantLoadOk: false,
        checkedAt: new Date().toISOString(),
      });
    }
  });

  app.get(['/api/store/schedule', '/store/schedule'], async (req: Request, res: Response) => {
    try {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      const auth = await verifyStaffAuth(req);
      if (!auth.isStaff || !['ADMINISTRADOR', 'GERENTE'].includes(auth.role.toUpperCase())) {
        res.status(403).json({
          success: false,
          scheduleLoadOk: false,
          restaurantLoadOk: false,
          message: 'Permissão insuficiente: apenas Administrador ou Gerente podem consultar configurações da loja.',
        });
        return;
      }

      if (!adminDb && (!PROJECT_ID || !auth.token)) {
        res.status(503).json({
          success: false,
          code: 'ADMIN_SDK_UNAVAILABLE',
          scheduleLoadOk: false,
          restaurantLoadOk: false,
          message: 'Leitura em nuvem indisponível: Firestore Admin SDK e sessão Firebase não configurados no servidor.',
        });
        return;
      }

      const cloudMeta = await readStoreScheduleAndRestaurantFromFirestore(auth.token);
      if (!cloudMeta.scheduleLoadOk || !cloudMeta.restaurantLoadOk) {
        res.status(cloudMeta.errorStatus || 503).json({
          success: false,
          scheduleLoadOk: cloudMeta.scheduleLoadOk,
          restaurantLoadOk: cloudMeta.restaurantLoadOk,
          message: cloudMeta.errorMessage || 'Falha ao carregar configurações persistidas no Cloud Firestore.',
        });
        return;
      }

      res.json({
        success: true,
        scheduleLoadOk: cloudMeta.scheduleLoadOk,
        restaurantLoadOk: cloudMeta.restaurantLoadOk,
        hasScheduleDoc: cloudMeta.hasScheduleDoc,
        hasRestaurantDoc: cloudMeta.hasRestaurantDoc,
        closedSettings: cloudMeta.closedSettings,
        restaurantPublicInfo: cloudMeta.restaurantPublicInfo,
        restaurantConfig: cloudMeta.restaurantConfig,
        checkedAt: new Date().toISOString(),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({
        success: false,
        scheduleLoadOk: false,
        restaurantLoadOk: false,
        message: `Erro ao consultar configurações da loja: ${msg}`,
      });
    }
  });

  app.post(['/api/store/schedule', '/store/schedule'], async (req: Request, res: Response) => {
    try {
      const auth = await verifyStaffAuth(req);
      if (!auth.isStaff || !['ADMINISTRADOR', 'GERENTE'].includes(auth.role.toUpperCase())) {
        res.status(403).json({
          success: false,
          persistedToFirestore: false,
          message: 'Permissão insuficiente: apenas Administrador ou Gerente podem alterar horários e configurações da loja.',
        });
        return;
      }

      const body = req.body || {};
      const hoursCheck = validateOperatingHours(body.operatingHours);
      if (!hoursCheck.valid) {
        res.status(400).json({
          success: false,
          persistedToFirestore: false,
          message: hoursCheck.error || 'Horários de funcionamento inválidos.',
        });
        return;
      }

      const primaryMsg = typeof body.closedPrimaryMessage === 'string' ? body.closedPrimaryMessage.trim() : '';
      if (!primaryMsg) {
        res.status(400).json({
          success: false,
          persistedToFirestore: false,
          message: 'Informe a mensagem principal exibida quando o estabelecimento estiver fechado.',
        });
        return;
      }

      let normalizedWhatsapp: string | undefined = undefined;
      if (body.whatsapp !== undefined) {
        const waCheck = validateWhatsAppNumber(String(body.whatsapp || ''));
        if (!waCheck.valid) {
          res.status(400).json({
            success: false,
            persistedToFirestore: false,
            message: waCheck.error || 'Número de WhatsApp inválido.',
          });
          return;
        }
        normalizedWhatsapp = waCheck.normalized;
      }

      let validatedRestaurantPayload: Record<string, any> | null = null;
      if (body.restaurantConfig !== undefined) {
        if (!body.restaurantConfig || typeof body.restaurantConfig !== 'object') {
          res.status(400).json({
            success: false,
            persistedToFirestore: false,
            message: 'Dados de configuração do estabelecimento inválidos.',
          });
          return;
        }

        const rawRest = pickWhitelistedRestaurantFields(body.restaurantConfig);
        if (rawRest.whatsapp !== undefined) {
          const waRestCheck = validateWhatsAppNumber(String(rawRest.whatsapp || ''));
          if (!waRestCheck.valid) {
            res.status(400).json({
              success: false,
              persistedToFirestore: false,
              message: waRestCheck.error || 'Número de WhatsApp inválido nas configurações da loja.',
            });
            return;
          }
          rawRest.whatsapp = waRestCheck.normalized;
          if (!normalizedWhatsapp) normalizedWhatsapp = waRestCheck.normalized;
        } else if (normalizedWhatsapp !== undefined) {
          rawRest.whatsapp = normalizedWhatsapp;
        }

        if (typeof rawRest.name !== 'string' || !rawRest.name.trim()) {
          res.status(400).json({
            success: false,
            persistedToFirestore: false,
            message: 'Nome do estabelecimento é obrigatório.',
          });
          return;
        }
        rawRest.name = rawRest.name.trim().slice(0, 150);

        const VALID_PIX_TYPES = new Set<PixKeyType>(['CPF', 'CNPJ', 'EMAIL', 'TELEFONE', 'ALEATORIA']);
        const rawPixKey = typeof rawRest.pixKey === 'string' ? rawRest.pixKey.trim() : '';
        if (!rawPixKey) {
          res.status(400).json({
            success: false,
            persistedToFirestore: false,
            message: 'Chave PIX é obrigatória.',
          });
          return;
        }

        const requestedType =
          typeof rawRest.pixKeyType === 'string' && rawRest.pixKeyType.trim()
            ? rawRest.pixKeyType.trim().toUpperCase()
            : undefined;
        if (requestedType && !VALID_PIX_TYPES.has(requestedType as PixKeyType)) {
          res.status(400).json({
            success: false,
            persistedToFirestore: false,
            message: 'Tipo de chave PIX inválido.',
          });
          return;
        }

        const resolvedPixType = (requestedType as PixKeyType | undefined) || inferPixKeyType(rawPixKey);
        if (!resolvedPixType) {
          res.status(400).json({
            success: false,
            persistedToFirestore: false,
            message: 'Tipo de chave PIX não reconhecido para a chave informada.',
          });
          return;
        }

        const pixKeyCheck = validatePixKey(rawPixKey, resolvedPixType);
        if (!pixKeyCheck.valid) {
          res.status(400).json({
            success: false,
            persistedToFirestore: false,
            message: pixKeyCheck.error || 'Chave PIX inválida para o tipo selecionado.',
          });
          return;
        }

        const receiverCheck = validatePixReceiver(
          typeof rawRest.pixReceiverName === 'string' ? rawRest.pixReceiverName : '',
          typeof rawRest.pixReceiverCity === 'string' ? rawRest.pixReceiverCity : ''
        );
        if (!receiverCheck.valid) {
          res.status(400).json({
            success: false,
            persistedToFirestore: false,
            message: receiverCheck.error || 'Nome e cidade do recebedor PIX são obrigatórios.',
          });
          return;
        }

        const fee = Number(rawRest.deliveryFeeBase ?? 0);
        const prepMin = Number(rawRest.avgPrepTimeMinutes ?? 15);
        const delivMin = Number(rawRest.avgDeliveryTimeMinutes ?? 25);
        if (!Number.isFinite(fee) || fee < 0 || !Number.isFinite(prepMin) || prepMin < 1 || !Number.isFinite(delivMin) || delivMin < 1) {
          res.status(400).json({
            success: false,
            persistedToFirestore: false,
            message: 'Valores de taxa de entrega ou tempo médio inválidos.',
          });
          return;
        }

        validatedRestaurantPayload = {
          name: rawRest.name,
          phone: typeof rawRest.phone === 'string' ? rawRest.phone.trim() : '',
          whatsapp: rawRest.whatsapp ?? normalizedWhatsapp ?? '',
          address: typeof rawRest.address === 'string' ? rawRest.address.trim() : '',
          city: typeof rawRest.city === 'string' ? rawRest.city.trim() : '',
          pixKey: pixKeyCheck.normalized,
          pixKeyType: resolvedPixType,
          pixReceiverName: receiverCheck.receiverName,
          pixReceiverCity: receiverCheck.receiverCity,
          deliveryFeeBase: roundCurrencyServer(fee),
          avgPrepTimeMinutes: Math.round(prepMin),
          avgDeliveryTimeMinutes: Math.round(delivMin),
          ...(typeof rawRest.customPublicUrl === 'string' && rawRest.customPublicUrl.trim()
            ? { customPublicUrl: rawRest.customPublicUrl.trim() }
            : {}),
        };
      }

      const secondaryMsg = typeof body.closedSecondaryMessage === 'string'
        ? body.closedSecondaryMessage.trim().slice(0, 500)
        : '';

      const updatedAt = new Date().toISOString();
      const schedulePayload = {
        operatingHours: hoursCheck.hours,
        closedPrimaryMessage: primaryMsg.slice(0, 200),
        closedSecondaryMessage: secondaryMsg,
        updatedAt,
        updatedBy: String(auth.email || auth.role).slice(0, 128),
      };

      if (adminDb) {
        const db = adminDb;
        try {
          await db.runTransaction(async (tx: FirebaseFirestore.Transaction) => {
            const schedRef = db.collection('configs').doc('store_schedule');
            const restRef = db.collection('configs').doc('restaurant');

            const restSnap = await tx.get(restRef);
            const openShiftsSnap = await tx.get(db.collection('cash_shifts').where('status', '==', 'ABERTO'));
            const authoritativeIsOpen = openShiftsSnap.docs.length === 1;

            if (validatedRestaurantPayload) {
              const existingRest = restSnap.exists ? pickWhitelistedRestaurantFields(restSnap.data()) : {};
              const mergedRestaurant: Record<string, any> = {
                ...existingRest,
                ...validatedRestaurantPayload,
                isOpen: authoritativeIsOpen,
                updatedAt,
              };
              tx.set(restRef, mergedRestaurant);
            } else if (normalizedWhatsapp !== undefined) {
              tx.set(
                restRef,
                { whatsapp: normalizedWhatsapp, isOpen: authoritativeIsOpen, updatedAt },
                { merge: true }
              );
            }

            tx.set(schedRef, schedulePayload);
          });

          res.json({
            success: true,
            persistedToFirestore: true,
            closedSettings: {
              operatingHours: schedulePayload.operatingHours,
              closedPrimaryMessage: schedulePayload.closedPrimaryMessage,
              closedSecondaryMessage: schedulePayload.closedSecondaryMessage,
            },
            ...(normalizedWhatsapp ? { whatsapp: normalizedWhatsapp } : {}),
            message: 'Horários e configurações salvos e confirmados no Cloud Firestore!',
          });
          return;
        } catch (dbErr: unknown) {
          const msg = dbErr instanceof Error ? dbErr.message : String(dbErr);
          res.status(500).json({
            success: false,
            persistedToFirestore: false,
            code: 'FIRESTORE_WRITE_FAILED',
            message: `Falha ao persistir configurações atomicamente no Cloud Firestore: ${msg}`,
          });
          return;
        }
      }

      // Fallback when Admin SDK is absent: atomic Firestore REST documents:commit with authenticated Staff Bearer token
      if (!PROJECT_ID || !auth.token) {
        res.status(503).json({
          success: false,
          persistedToFirestore: false,
          code: 'FIRESTORE_UNAVAILABLE',
          message: 'Persistência no Cloud Firestore indisponível no servidor (Admin SDK e sessão Firebase ausentes).',
        });
        return;
      }

      try {
        const docBasePath = `projects/${PROJECT_ID}/databases/(default)/documents`;
        const commitUrl = `https://firestore.googleapis.com/v1/${docBasePath}:commit`;
        const writes: Array<Record<string, any>> = [
          {
            update: {
              name: `${docBasePath}/configs/store_schedule`,
              ...jsonToFirestoreDocument(schedulePayload),
            },
          },
        ];

        if (validatedRestaurantPayload) {
          const restFields = { ...validatedRestaurantPayload, updatedAt };
          writes.push({
            update: {
              name: `${docBasePath}/configs/restaurant`,
              ...jsonToFirestoreDocument(restFields),
            },
            updateMask: {
              fieldPaths: Object.keys(restFields),
            },
          });
        } else if (normalizedWhatsapp !== undefined) {
          const waFields = { whatsapp: normalizedWhatsapp, updatedAt };
          writes.push({
            update: {
              name: `${docBasePath}/configs/restaurant`,
              ...jsonToFirestoreDocument(waFields),
            },
            updateMask: {
              fieldPaths: ['whatsapp', 'updatedAt'],
            },
          });
        }

        const commitRes = await fetch(commitUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${auth.token}`,
          },
          body: JSON.stringify({ writes }),
        });

        if (!commitRes.ok) {
          const errText = await commitRes.text().catch(() => '');
          const status = commitRes.status === 403 || commitRes.status === 401 ? commitRes.status : 502;
          res.status(status).json({
            success: false,
            persistedToFirestore: false,
            code: 'FIRESTORE_REST_WRITE_FAILED',
            message: `Cloud Firestore recusou a gravação das configurações (HTTP ${commitRes.status}): ${errText.slice(0, 180)}`,
          });
          return;
        }

        res.json({
          success: true,
          persistedToFirestore: true,
          closedSettings: {
            operatingHours: schedulePayload.operatingHours,
            closedPrimaryMessage: schedulePayload.closedPrimaryMessage,
            closedSecondaryMessage: schedulePayload.closedSecondaryMessage,
          },
          ...(normalizedWhatsapp ? { whatsapp: normalizedWhatsapp } : {}),
          message: 'Horários e configurações salvos e confirmados no Cloud Firestore!',
        });
      } catch (restErr: unknown) {
        const msg = restErr instanceof Error ? restErr.message : String(restErr);
        res.status(502).json({
          success: false,
          persistedToFirestore: false,
          code: 'FIRESTORE_REST_ERROR',
          message: `Erro ao confirmar gravação das configurações no Cloud Firestore: ${msg}`,
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({
        success: false,
        persistedToFirestore: false,
        message: `Erro ao salvar horários da loja: ${msg}`,
      });
    }
  });

  async function validateAndBuildOrderServer(
    order: Record<string, any>,
    isStaffRequester: boolean
  ): Promise<
    | { ok: true; cleanOrder: Record<string, any>; publicTrackingDoc: Record<string, any> }
    | { ok: false; status: number; message: string }
  > {
    if (!order || typeof order !== 'object') {
      return { ok: false, status: 400, message: 'Dados do pedido ausentes ou inválidos.' };
    }

    if (
      !order.id ||
      typeof order.id !== 'string' ||
      !/^[a-zA-Z0-9_\-]+$/.test(order.id) ||
      order.id.length > 128 ||
      !order.orderNumber ||
      typeof order.orderNumber !== 'string' ||
      !Array.isArray(order.items) ||
      order.items.length === 0 ||
      order.items.length > 50
    ) {
      return { ok: false, status: 400, message: 'Estrutura básica do pedido incompleta ou inválida.' };
    }

    if (!order.trackingCode || typeof order.trackingCode !== 'string' || order.trackingCode.length < 20) {
      return { ok: false, status: 400, message: 'Código de rastreamento inválido ou insuficiente (mínimo 20 caracteres).' };
    }

    if (!order.customer || typeof order.customer.name !== 'string' || order.customer.name.trim().length === 0) {
      return { ok: false, status: 400, message: 'Nome do cliente é obrigatório.' };
    }

    if (!['DELIVERY', 'RETIRADA'].includes(String(order.fulfillmentType))) {
      return { ok: false, status: 400, message: 'Modalidade de entrega inválida.' };
    }

    if (!['PIX', 'CARTAO_CREDITO', 'CARTAO_DEBITO', 'DINHEIRO'].includes(String(order.paymentMethod))) {
      return { ok: false, status: 400, message: 'Forma de pagamento inválida.' };
    }

    // Security Check: Role-specific bounds and anti-injection
    if (!isStaffRequester) {
      if (order.status !== 'NOVO') {
        return { ok: false, status: 400, message: 'Pedidos do cardápio público devem iniciar com status NOVO.' };
      }
      if (order.paymentStatus !== 'PENDENTE') {
        return { ok: false, status: 400, message: 'Pedidos do cardápio público não podem ser criados como já pagos.' };
      }
      if (order.discount && order.discount !== 0) {
        return { ok: false, status: 400, message: 'Descontos não são permitidos para pedidos enviados pelo cardápio público.' };
      }
      if (order.operatorName || order.cancellationReason || order.cancelledBy || order.deliveryPerson) {
        return { ok: false, status: 400, message: 'Campos administrativos de uso interno não são autorizados para clientes.' };
      }
    } else {
      const allowedStatuses = ['NOVO', 'EM_PREPARO'];
      if (!allowedStatuses.includes(String(order.status))) {
        return { ok: false, status: 400, message: `Status inicial inválido para novo pedido: ${order.status}` };
      }
    }

    // Mathematical item and official catalog price invariant verification
    let calculatedSubtotal = 0;
    for (const item of order.items) {
      if (
        !item ||
        !item.id ||
        !item.menuItemId ||
        !item.name ||
        typeof item.quantity !== 'number' ||
        !Number.isInteger(item.quantity) ||
        item.quantity < 1 ||
        item.quantity > 50 ||
        typeof item.unitPrice !== 'number' ||
        item.unitPrice <= 0 ||
        typeof item.subtotal !== 'number'
      ) {
        return {
          ok: false,
          status: 400,
          message: `Item inválido no pedido: ${item?.name || 'desconhecido'}. Quantidade permitida entre 1 e 50.`,
        };
      }

      let officialPrice: number | null = null;
      if (adminDb) {
        try {
          const liveDoc = await adminDb.collection('menu_items').doc(item.menuItemId).get();
          if (liveDoc.exists && typeof liveDoc.data()?.price === 'number') {
            officialPrice = liveDoc.data()?.price;
          }
        } catch {}
      } else if (PROJECT_ID && API_KEY) {
        try {
          const restRes = await fetch(
            `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/menu_items/${encodeURIComponent(item.menuItemId)}?key=${API_KEY}`
          );
          if (restRes.ok) {
            const rawDoc = await restRes.json();
            const parsedDoc = firestoreDocumentToJson(rawDoc);
            if (parsedDoc && typeof parsedDoc.price === 'number') {
              officialPrice = parsedDoc.price;
            }
          }
        } catch {}
      }
      const catalogItem = catalogMap.get(item.menuItemId) || catalogMap.get(item.id);
      if (officialPrice === null && catalogItem) {
        officialPrice = catalogItem.price;
      }

      let addonsPerUnit = 0;
      if (item.addons !== undefined) {
        if (!Array.isArray(item.addons) || item.addons.length > 10) {
          return { ok: false, status: 400, message: `Lista de adicionais inválida no item '${item.name}'.` };
        }
        for (const addon of item.addons) {
          if (
            !addon ||
            typeof addon.price !== 'number' ||
            (Math.abs(addon.price - 3.0) > 0.001 && Math.abs(addon.price - 0.0) > 0.001)
          ) {
            return {
              ok: false,
              status: 400,
              message: `Preço de adicional inválido: ${addon?.name || 'desconhecido'}. Apenas R$ 3,00 (recheios) ou R$ 0,00 (sabores) são autorizados.`,
            };
          }
          addonsPerUnit = roundCurrencyServer(addonsPerUnit + addon.price);
        }
      }

      let expectedItemSubtotal = 0;
      if (officialPrice !== null) {
        const expectedCombinedUnitPrice = roundCurrencyServer(officialPrice + addonsPerUnit);
        const matchesCombinedUnit = Math.abs(item.unitPrice - expectedCombinedUnitPrice) <= 0.001;
        const matchesBaseUnit = Math.abs(item.unitPrice - officialPrice) <= 0.001;
        if (!matchesCombinedUnit && !matchesBaseUnit) {
          return {
            ok: false,
            status: 400,
            message: `Preço unitário divergente do cardápio oficial para '${item.name}'. Esperado: R$ ${expectedCombinedUnitPrice.toFixed(2)} (ou base R$ ${officialPrice.toFixed(2)}), recebido: R$ ${item.unitPrice.toFixed(2)}.`,
          };
        }
        expectedItemSubtotal = roundCurrencyServer((officialPrice + addonsPerUnit) * item.quantity);
      } else {
        // Fallback when custom catalog item wasn't preloaded in catalogMap: accept either combined or base+addons
        const subCombined = roundCurrencyServer(item.unitPrice * item.quantity);
        const subWithAddons = roundCurrencyServer((item.unitPrice + addonsPerUnit) * item.quantity);
        expectedItemSubtotal =
          Math.abs(item.subtotal - subCombined) <= 0.01 ? subCombined : subWithAddons;
      }

      if (Math.abs(item.subtotal - expectedItemSubtotal) > 0.01) {
        return {
          ok: false,
          status: 400,
          message: `Subtotal incorreto para o item ${item.name}. Esperado: ${expectedItemSubtotal.toFixed(2)}, recebido: ${item.subtotal}.`,
        };
      }

      calculatedSubtotal = roundCurrencyServer(calculatedSubtotal + item.subtotal);
    }

    if (Math.abs((Number(order.subtotal) || 0) - calculatedSubtotal) > 0.01) {
      return { ok: false, status: 400, message: 'Subtotal geral do pedido não confere com a soma dos itens.' };
    }

    const expectedDeliveryFee =
      order.fulfillmentType === 'RETIRADA' ? 0 : roundCurrencyServer(Number(order.deliveryFee) || 0);
    if (expectedDeliveryFee < 0 || expectedDeliveryFee > 1000 || Math.abs((Number(order.deliveryFee) || 0) - expectedDeliveryFee) > 0.01) {
      return { ok: false, status: 400, message: 'Taxa de entrega incorreta para a modalidade.' };
    }

    const effectiveDiscount = isStaffRequester ? roundCurrencyServer(Number(order.discount) || 0) : 0;
    if (effectiveDiscount < 0 || effectiveDiscount > calculatedSubtotal) {
      return { ok: false, status: 400, message: 'Desconto inválido ou superior ao subtotal.' };
    }

    const expectedTotal = roundCurrencyServer(calculatedSubtotal + expectedDeliveryFee - effectiveDiscount);
    if (Math.abs((Number(order.totalAmount) || 0) - expectedTotal) > 0.01) {
      return { ok: false, status: 400, message: 'Valor total do pedido não confere matematicamente.' };
    }

    if (String(order.paymentMethod) === 'PIX' && order.pixCode !== undefined && order.pixCode !== null) {
      if (typeof order.pixCode !== 'string' || !order.pixCode.trim()) {
        return { ok: false, status: 400, message: 'Código PIX informado no pedido é inválido.' };
      }

      const pixAudit = validatePixPayload(order.pixCode.trim());
      if (!pixAudit.valid) {
        return {
          ok: false,
          status: 400,
          message: `Código PIX (BR Code) inválido: ${pixAudit.error || 'estrutura ou CRC16 incorreto'}.`,
        };
      }

      if (!pixAudit.amount) {
        return {
          ok: false,
          status: 400,
          message: 'Código PIX do pedido não contém o valor exato da cobrança.',
        };
      }

      const pixAmount = roundCurrencyServer(Number(pixAudit.amount));
      if (!Number.isFinite(pixAmount) || Math.abs(pixAmount - expectedTotal) > 0.01) {
        return {
          ok: false,
          status: 400,
          message: `Valor do código PIX (R$ ${pixAudit.amount}) diverge do total do pedido (R$ ${expectedTotal.toFixed(2)}).`,
        };
      }

      if (order.pixTxId !== undefined && order.pixTxId !== null && String(order.pixTxId).trim() !== '') {
        if (!pixAudit.txId || sanitizeTxId(String(order.pixTxId)) !== pixAudit.txId) {
          return {
            ok: false,
            status: 400,
            message: 'TXID do pedido diverge do payload PIX informado.',
          };
        }
      }

      if (adminDb) {
        try {
          const restSnap = await adminDb.collection('configs').doc('restaurant').get();
          if (restSnap.exists) {
            const restData = (restSnap.data() || {}) as Record<string, any>;
            const officialRawKey = typeof restData.pixKey === 'string' ? restData.pixKey.trim() : '';
            if (officialRawKey) {
              const officialType =
                (typeof restData.pixKeyType === 'string' && restData.pixKeyType.trim()
                  ? (restData.pixKeyType.trim().toUpperCase() as PixKeyType)
                  : undefined) || inferPixKeyType(officialRawKey);
              if (officialType) {
                const officialKeyCheck = validatePixKey(officialRawKey, officialType);
                if (officialKeyCheck.valid && pixAudit.pixKey !== officialKeyCheck.normalized) {
                  return {
                    ok: false,
                    status: 400,
                    message: 'A chave PIX do payload não corresponde à chave oficial cadastrada no estabelecimento.',
                  };
                }
              }
            }
          }
        } catch {
          // Do not mask Firestore read errors here when order persistence itself checks Firestore atomically
        }
      }
    }

    const cleanOrder: Record<string, any> = {};
    for (const [key, val] of Object.entries(order)) {
      if (!key.startsWith('_') && val !== undefined) {
        cleanOrder[key] = val;
      }
    }
    cleanOrder.subtotal = calculatedSubtotal;
    cleanOrder.deliveryFee = expectedDeliveryFee;
    cleanOrder.discount = effectiveDiscount;
    cleanOrder.totalAmount = expectedTotal;

    const publicTrackingDoc = buildPublicTrackingDocServer(cleanOrder);
    return { ok: true, cleanOrder, publicTrackingDoc };
  }

  // Secure Backend API: Order Ingestion, Mathematical Validation & Real Firestore Persistence
  // Only returns success AFTER real document persistence is confirmed in Cloud Firestore.
  app.post(['/api/orders', '/orders'], async (req: Request, res: Response) => {
    try {
      const auth = await verifyStaffAuth(req);
      const isStaffRequester = auth.isStaff;

      const { order } = req.body;
      if (!order || typeof order !== 'object') {
        res.status(400).json({ success: false, message: 'Dados do pedido ausentes ou inválidos.' });
        return;
      }

      if (order.paymentStatus !== 'PENDENTE') {
        res.status(400).json({
          success: false,
          message: 'Pedidos criados por /api/orders devem iniciar com paymentStatus PENDENTE; vendas pagas devem usar a confirmação atômica /api/orders/:id/confirm-payment.',
        });
        return;
      }

      const validation = await validateAndBuildOrderServer(order, isStaffRequester);
      if (validation.ok === false) {
        res.status(validation.status).json({ success: false, message: validation.message });
        return;
      }

      const tombstones = await getOrderTombstonesServer(auth.token);
      if (serverDeletedOrderIds.has(order.id) || tombstones.includes(order.id)) {
        res.status(410).json({
          success: false,
          deleted: true,
          message: 'Este pedido foi excluído definitivamente em outro dispositivo e não pode ser reenviado.',
        });
        return;
      }

      const { cleanOrder, publicTrackingDoc } = validation;

      // Mandatory server-side transactional closed-store protection for ALL public menu orders
      const isPublicMenuSubmission = !isStaffRequester || req.body?.source === 'PUBLIC_MENU';

      // Persist to Cloud Firestore inside a single transaction (for public menu orders, checks open cash_shifts inside the SAME tx)
      const persistResult = await persistOrderToFirestoreServer(cleanOrder, publicTrackingDoc, auth.token, {
        requireOpenCashShift: isPublicMenuSubmission,
      });

      if (!persistResult.success) {
        const failStatus = persistResult.status === 409 ? 409 : persistResult.status === 403 ? 403 : 500;
        res.status(failStatus).json({
          success: false,
          ...(persistResult.isStoreClosed ? { isStoreClosed: true } : {}),
          ...(persistResult.code ? { code: persistResult.code } : {}),
          ...(persistResult.reason ? { reason: persistResult.reason } : {}),
          message: persistResult.isStoreClosed
            ? persistResult.error
            : `Não foi possível persistir o pedido no Cloud Firestore: ${persistResult.error}.`,
          error: persistResult.error,
        });
        return;
      }

      const finalOrder = persistResult.existingOrder || cleanOrder;

      // Document write is confirmed (avoid duplicate push notification on idempotent retry)
      if (!persistResult.alreadyExists) {
        sendOrderPushNotification(finalOrder).catch((pushErr) => {
          console.warn('[Web Push] Falha ao enviar notificação aos dispositivos:', pushErr?.message || pushErr);
        });
      }

      res.json({
        success: true,
        alreadyExists: Boolean(persistResult.alreadyExists),
        message: persistResult.alreadyExists
          ? 'Pedido já confirmado e gravado no Cloud Firestore.'
          : 'Pedido verificado e gravado com sucesso no Cloud Firestore.',
        orderId: finalOrder.id,
        trackingCode: finalOrder.trackingCode,
        order: finalOrder,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, message: `Erro interno no backend ao processar pedido: ${msg}` });
    }
  });

  // Public Order Persistence Confirmation Endpoint (Sanitized non-PII response validated by orderId + trackingCode)
  app.get(['/api/orders/:id/public-confirmation', '/orders/:id/public-confirmation'], async (req: Request, res: Response) => {
    try {
      const orderId = String(req.params.id || '').trim();
      const trackingCode = typeof req.query?.trackingCode === 'string' ? req.query.trackingCode.trim() : '';

      if (!orderId || !/^[a-zA-Z0-9_\-]+$/.test(orderId) || orderId.length > 128) {
        res.status(400).json({ success: false, confirmed: false, message: 'Identificador de pedido inválido.' });
        return;
      }
      if (!trackingCode || !/^[a-zA-Z0-9_\-]+$/.test(trackingCode) || trackingCode.length < 20 || trackingCode.length > 128) {
        res.status(400).json({ success: false, confirmed: false, message: 'Código de rastreamento inválido.' });
        return;
      }

      if (adminDb) {
        const orderSnap = await adminDb.collection('orders').doc(orderId).get();
        if (!orderSnap.exists) {
          res.json({ success: true, confirmed: false });
          return;
        }
        const data = (orderSnap.data() || {}) as Record<string, any>;
        if (data.trackingCode !== trackingCode) {
          res.status(403).json({ success: false, confirmed: false, message: 'Código de rastreamento não corresponde ao pedido.' });
          return;
        }
        res.json({
          success: true,
          confirmed: true,
          orderId: data.id,
          orderNumber: data.orderNumber,
          trackingCode: data.trackingCode,
          status: data.status,
          paymentMethod: data.paymentMethod,
          paymentStatus: data.paymentStatus,
          totalAmount: data.totalAmount,
          pixCode: data.pixCode,
          pixTxId: data.pixTxId,
          createdAt: data.createdAt,
        });
        return;
      }

      if (PROJECT_ID && API_KEY) {
        const restRes = await fetch(
          `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/public_tracking/${encodeURIComponent(trackingCode)}?key=${API_KEY}`
        );
        if (restRes.status === 404) {
          res.json({ success: true, confirmed: false });
          return;
        }
        if (restRes.ok) {
          const rawDoc = await restRes.json();
          const tData = (firestoreDocumentToJson(rawDoc) || {}) as Record<string, any>;
          if (tData.id !== orderId) {
            res.status(403).json({ success: false, confirmed: false, message: 'Código de rastreamento não corresponde ao pedido.' });
            return;
          }
          res.json({
            success: true,
            confirmed: true,
            orderId: tData.id,
            orderNumber: tData.orderNumber,
            trackingCode: tData.trackingCode || trackingCode,
            status: tData.status,
            paymentMethod: tData.paymentMethod,
            paymentStatus: tData.paymentStatus,
            totalAmount: tData.totalAmount,
            createdAt: tData.createdAt,
          });
          return;
        }
      }

      res.status(503).json({
        success: false,
        confirmed: false,
        code: 'FIRESTORE_UNAVAILABLE',
        message: 'Nenhum conector Firestore disponível no servidor.',
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, confirmed: false, message: `Erro ao verificar confirmação pública do pedido: ${msg}` });
    }
  });

  // Helper: Fetch existing order document from Firestore (Admin SDK or REST)
  async function fetchOrderFromFirestoreServer(
    orderId: string,
    staffToken: string | null
  ): Promise<{ exists: boolean; data: Record<string, any> | null; error?: string; status?: number }> {
    if (adminDb) {
      try {
        const snap = await adminDb.collection('orders').doc(orderId).get();
        return { exists: snap.exists, data: snap.exists ? (snap.data() || null) : null };
      } catch (err) {
        console.warn('[Server Admin SDK Read Order Failed]:', err instanceof Error ? err.message : err);
      }
    }

    if (staffToken && PROJECT_ID) {
      try {
        const baseUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
        const restRes = await fetch(`${baseUrl}/orders/${orderId}`, {
          headers: { Authorization: `Bearer ${staffToken}` },
        });
        if (restRes.status === 404) {
          return { exists: false, data: null };
        }
        if (restRes.ok) {
          const rawDoc = await restRes.json();
          return { exists: true, data: firestoreDocumentToJson(rawDoc) };
        }
        const errTxt = await restRes.text().catch(() => '');
        return { exists: false, data: null, error: `Firestore REST GET (${restRes.status}): ${errTxt.slice(0, 140)}`, status: restRes.status };
      } catch (restErr) {
        return { exists: false, data: null, error: restErr instanceof Error ? restErr.message : String(restErr), status: 500 };
      }
    }

    return { exists: false, data: null, error: 'Conector Firestore indisponível no servidor.', status: 500 };
  }

  function buildPublicTrackingDocServer(order: Record<string, any>): Record<string, any> {
    const destinationSummary = order.customer?.address
      ? `${order.customer.address.neighborhood || ''}${order.customer.address.city ? ` · ${order.customer.address.city}` : ''}`.trim() || undefined
      : (order.fulfillmentType === 'RETIRADA' ? 'Retirada no Balcão' : undefined);

    const trackingDoc: Record<string, any> = {
      id: order.id,
      orderNumber: order.orderNumber,
      createdAt: order.createdAt,
      estimatedDeliveryMinutes: order.estimatedDeliveryMinutes || 45,
      fulfillmentType: order.fulfillmentType,
      status: order.status,
      items: Array.isArray(order.items)
        ? order.items.map((i: any) => ({
            id: i.id,
            name: i.name,
            quantity: i.quantity,
            subtotal: i.subtotal,
            addons: i.addons || [],
            notes: i.notes || '',
          }))
        : [],
      subtotal: order.subtotal,
      deliveryFee: order.deliveryFee,
      discount: order.discount || 0,
      totalAmount: order.totalAmount,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      trackingCode: order.trackingCode || '',
    };
    if (order.deliveryPerson && order.deliveryPerson.name) {
      trackingDoc.deliveryPerson = { name: order.deliveryPerson.name };
    }
    if (destinationSummary) {
      trackingDoc.destinationSummary = destinationSummary;
    }
    return trackingDoc;
  }

  function canRoleTransitionOrderStatusServer(role: string, targetStatus: string): boolean {
    const upperRole = role.toUpperCase();
    if (upperRole === 'ADMINISTRADOR' || upperRole === 'GERENTE') {
      return ['NOVO', 'EM_PREPARO', 'PRONTO', 'EM_ROTA', 'ENTREGUE'].includes(targetStatus);
    }
    if (upperRole === 'COZINHA') {
      return targetStatus === 'EM_PREPARO' || targetStatus === 'PRONTO';
    }
    if (upperRole === 'ENTREGADOR') {
      return targetStatus === 'EM_ROTA' || targetStatus === 'ENTREGUE';
    }
    if (upperRole === 'CAIXA' || upperRole === 'ATENDENTE') {
      return ['NOVO', 'EM_PREPARO', 'PRONTO', 'EM_ROTA', 'ENTREGUE'].includes(targetStatus);
    }
    return false;
  }

  // Dedicated Status & Operational Update Route (preserves historical order items/prices without catalog price conflict)
  const handleOrderStatusUpdate = async (req: Request, res: Response) => {
    try {
      const auth = await verifyStaffAuth(req);
      if (!auth.isStaff) {
        res.status(403).json({ success: false, message: 'Acesso restrito a colaboradores autorizados e ativos.' });
        return;
      }

      const orderId = req.params.id || req.body?.orderId || req.body?.id;
      if (!orderId || typeof orderId !== 'string' || !/^[a-zA-Z0-9_\-]+$/.test(orderId) || orderId.length > 128) {
        res.status(400).json({ success: false, message: 'Identificador de pedido inválido.' });
        return;
      }

      const targetStatus = String(req.body?.status || '').trim().toUpperCase();
      if (targetStatus === 'CANCELADO' || String(req.body?.order?.status || '').trim().toUpperCase() === 'CANCELADO') {
        res.status(403).json({
          success: false,
          code: 'USE_ATOMIC_ORDER_CANCELLATION',
          message: 'Cancelamento de pedidos (pagos ou pendentes) deve ser executado exclusivamente pelo procedimento oficial /api/orders/:id/cancel.',
        });
        return;
      }

      const allowedStatuses = ['NOVO', 'EM_PREPARO', 'PRONTO', 'EM_ROTA', 'ENTREGUE'];
      if (!allowedStatuses.includes(targetStatus)) {
        res.status(400).json({ success: false, message: `Status inválido para pedido: ${targetStatus || '(vazio)'}.` });
        return;
      }

      if (!canRoleTransitionOrderStatusServer(auth.role, targetStatus)) {
        res.status(403).json({
          success: false,
          message: `Permissão insuficiente: perfil ${auth.role} não tem autorização para alterar pedido para '${targetStatus}'.`,
        });
        return;
      }

      const tombstones = await getOrderTombstonesServer(auth.token);
      if (serverDeletedOrderIds.has(orderId) || tombstones.includes(orderId)) {
        res.status(410).json({
          success: false,
          deleted: true,
          message: 'Este pedido foi excluído definitivamente em outro dispositivo.',
        });
        return;
      }

      const existingLookup = await fetchOrderFromFirestoreServer(orderId, auth.token);
      if (existingLookup.error && existingLookup.status === 403) {
        res.status(403).json({
          success: false,
          message: `Permissão negada no Cloud Firestore ao consultar pedido: ${existingLookup.error}`,
        });
        return;
      }

      const now = new Date().toISOString();
      const upperRole = auth.role.toUpperCase();
      let updatedOrder: Record<string, any> | null = null;

      if (existingLookup.exists && existingLookup.data) {
        const prev = existingLookup.data;
        if (prev.status === 'CANCELADO') {
          res.status(409).json({
            success: false,
            message: 'Este pedido já se encontra cancelado no servidor e não pode mais ser alterado.',
          });
          return;
        }

        // Payment status transitions are strictly forbidden on /status; must execute via /confirm-payment atomic transaction
        if (req.body?.paymentStatus !== undefined && req.body.paymentStatus !== prev.paymentStatus) {
          res.status(403).json({
            success: false,
            code: 'USE_ATOMIC_PAYMENT_CONFIRMATION',
            message: 'Alteração de status de pagamento deve ser executada exclusivamente pela transação atômica /api/orders/:id/confirm-payment.',
          });
          return;
        }

        updatedOrder = {
          ...prev,
          status: targetStatus,
          updatedAt: String(req.body?.updatedAt || now),
        };

        if (Array.isArray(req.body?.movements) && req.body.movements.length >= (prev.movements?.length || 0)) {
          updatedOrder.movements = req.body.movements;
        } else {
          const prevMoves = Array.isArray(prev.movements) ? [...prev.movements] : [];
          prevMoves.push({
            id: `mov-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            timestamp: now,
            fromStatus: prev.status,
            toStatus: targetStatus,
            author: String(req.body?.author || auth.email || auth.role),
            notes: String(req.body?.notes || `Status alterado de ${prev.status} para ${targetStatus}`),
          });
          updatedOrder.movements = prevMoves;
        }

        // Delivery metadata (forbidden for COZINHA, allowed for ENTREGADOR/CAIXA/ATENDENTE/GERENTE/ADMIN)
        if (upperRole !== 'COZINHA') {
          if (req.body?.deliveryPerson !== undefined) updatedOrder.deliveryPerson = req.body.deliveryPerson;
          if (req.body?.deliveryPersonId !== undefined) updatedOrder.deliveryPersonId = req.body.deliveryPersonId;
          if (req.body?.deliveryPersonName !== undefined) updatedOrder.deliveryPersonName = req.body.deliveryPersonName;
          if (Array.isArray(req.body?.deliveryAssignmentHistory)) {
            updatedOrder.deliveryAssignmentHistory = req.body.deliveryAssignmentHistory;
          }
        }
      } else {
        // Order does not exist yet on Firestore (e.g. offline-created order transitioning straight from queue)
        const fallbackOrder = req.body?.order;
        if (!fallbackOrder || typeof fallbackOrder !== 'object' || fallbackOrder.id !== orderId) {
          res.status(404).json({ success: false, message: 'Pedido não encontrado no Cloud Firestore para atualização de status.' });
          return;
        }

        if (fallbackOrder.paymentStatus && fallbackOrder.paymentStatus !== 'PENDENTE') {
          res.status(403).json({
            success: false,
            code: 'USE_ATOMIC_PAYMENT_CONFIRMATION',
            message: 'Pedidos pagos devem ser criados e confirmados exclusivamente pela transação atômica /api/orders/:id/confirm-payment.',
          });
          return;
        }

        const cleanFallback: Record<string, any> = {};
        for (const [k, v] of Object.entries(fallbackOrder)) {
          if (!k.startsWith('_') && v !== undefined) {
            cleanFallback[k] = v;
          }
        }
        cleanFallback.paymentStatus = 'PENDENTE';
        cleanFallback.status = targetStatus;
        cleanFallback.updatedAt = String(req.body?.updatedAt || cleanFallback.updatedAt || now);

        // If REST mode (no adminDb) and targetStatus isn't NOVO/EM_PREPARO, bootstrap doc as EM_PREPARO first so rules allow creation, then transition to targetStatus
        if (!adminDb && !['NOVO', 'EM_PREPARO'].includes(targetStatus) && auth.token) {
          const seedDoc = { ...cleanFallback, status: 'EM_PREPARO' };
          const seedTracking = buildPublicTrackingDocServer(seedDoc);
          const seedRes = await persistOrderToFirestoreServer(seedDoc, seedTracking, auth.token);
          if (!seedRes.success) {
            res.status(seedRes.status === 403 ? 403 : 400).json({
              success: false,
              message: `Não foi possível inicializar o pedido no Cloud Firestore antes de avançar status: ${seedRes.error}`,
            });
            return;
          }
        }

        updatedOrder = cleanFallback;
      }

      // Remove undefined fields cleanly
      const sanitizedOrder: Record<string, any> = {};
      for (const [k, v] of Object.entries(updatedOrder)) {
        if (!k.startsWith('_') && v !== undefined) {
          sanitizedOrder[k] = v;
        }
      }

      const publicTrackingDoc = sanitizedOrder.trackingCode ? buildPublicTrackingDocServer(sanitizedOrder) : null;

      // Persist strictly via Admin SDK or authenticated Staff REST token (never silent anonymous fallback!)
      let persistResult: { success: boolean; error?: string; status?: number } = {
        success: false,
        error: 'Conector autenticado indisponível.',
        status: 500,
      };

      if (adminDb) {
        try {
          await adminDb.collection('orders').doc(orderId).set(sanitizedOrder);
          if (sanitizedOrder.trackingCode && publicTrackingDoc) {
            await adminDb.collection('public_tracking').doc(sanitizedOrder.trackingCode).set(publicTrackingDoc);
          }
          persistResult = { success: true };
        } catch (adminErr) {
          persistResult = {
            success: false,
            error: adminErr instanceof Error ? adminErr.message : String(adminErr),
            status: 500,
          };
        }
      }

      if (!persistResult.success && auth.token && PROJECT_ID) {
        try {
          const baseUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
          let patchUrl = `${baseUrl}/orders/${orderId}`;
          if (existingLookup.exists) {
            const maskFields = ['status', 'updatedAt', 'movements'];
            if (req.body?.deliveryPerson && ['ADMINISTRADOR', 'GERENTE', 'CAIXA', 'ATENDENTE', 'ENTREGADOR'].includes(upperRole)) {
              maskFields.push('deliveryPerson', 'deliveryPersonId', 'deliveryPersonName');
            }
            const maskQuery = maskFields.map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&');
            patchUrl = `${patchUrl}?${maskQuery}`;
          }
          const restRes = await fetch(patchUrl, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${auth.token}`,
            },
            body: JSON.stringify(jsonToFirestoreDocument(sanitizedOrder)),
          });

          if (restRes.ok) {
            if (sanitizedOrder.trackingCode && publicTrackingDoc) {
              await fetch(`${baseUrl}/public_tracking/${sanitizedOrder.trackingCode}`, {
                method: 'PATCH',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${auth.token}`,
                },
                body: JSON.stringify(jsonToFirestoreDocument(publicTrackingDoc)),
              }).catch(() => {});
            }
            persistResult = { success: true };
          } else {
            const errTxt = await restRes.text().catch(() => '');
            persistResult = {
              success: false,
              error: `Firestore REST /orders (${restRes.status}): ${errTxt.slice(0, 180)}`,
              status: restRes.status,
            };
          }
        } catch (restErr) {
          persistResult = {
            success: false,
            error: restErr instanceof Error ? restErr.message : String(restErr),
            status: 500,
          };
        }
      }

      if (!persistResult.success) {
        const httpStatus = persistResult.status === 403 || persistResult.status === 400 ? persistResult.status : 500;
        res.status(httpStatus).json({
          success: false,
          message: persistResult.error || 'Falha ao gravar atualização de status no Cloud Firestore.',
        });
        return;
      }

      if (targetStatus === 'ENTREGUE') {
        sendOrderPushNotification(sanitizedOrder, 'DELIVERY_CONFIRMED', auth.token || undefined).catch(() => {});
      } else if (targetStatus === 'PRONTO' && sanitizedOrder.fulfillmentType === 'DELIVERY') {
        sendOrderPushNotification(sanitizedOrder, 'READY_FOR_DELIVERY', auth.token || undefined).catch(() => {});
      }

      res.json({
        success: true,
        orderId,
        status: targetStatus,
        order: sanitizedOrder,
        message: `Status do pedido atualizado para ${targetStatus} no Cloud Firestore.`,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, message: `Erro ao atualizar status do pedido: ${msg}` });
    }
  };

  app.patch(['/api/orders/:id/status', '/orders/:id/status'], handleOrderStatusUpdate);
  app.post(['/api/orders/:id/status', '/orders/:id/status'], handleOrderStatusUpdate);

  // Delivery Person Assignment Route (Admin / Gerente / Caixa / Atendente)
  const handleAssignDeliveryPerson = async (req: Request, res: Response) => {
    try {
      const auth = await verifyStaffAuth(req);
      if (!auth.isStaff || !['ADMINISTRADOR', 'GERENTE', 'CAIXA', 'ATENDENTE'].includes(auth.role.toUpperCase())) {
        res.status(403).json({
          success: false,
          message: 'Permissão insuficiente para atribuir ou desvincular entregador.',
        });
        return;
      }

      const orderId = req.params.id || req.body?.orderId || req.body?.id;
      if (!orderId || typeof orderId !== 'string' || !/^[a-zA-Z0-9_\-]+$/.test(orderId) || orderId.length > 128) {
        res.status(400).json({ success: false, message: 'Identificador de pedido inválido.' });
        return;
      }

      const existingLookup = await fetchOrderFromFirestoreServer(orderId, auth.token);
      if (!existingLookup.exists || !existingLookup.data) {
        res.status(existingLookup.status === 403 ? 403 : 404).json({
          success: false,
          message: existingLookup.error || 'Pedido não encontrado no Cloud Firestore.',
        });
        return;
      }

      const prev = existingLookup.data;
      const now = new Date().toISOString();
      const updatedOrder: Record<string, any> = {
        ...prev,
        updatedAt: String(req.body?.updatedAt || now),
      };

      const dp = req.body?.deliveryPerson;
      if (!dp) {
        delete updatedOrder.deliveryPerson;
        delete updatedOrder.deliveryPersonId;
        delete updatedOrder.deliveryPersonName;
      } else {
        updatedOrder.deliveryPerson = dp;
        updatedOrder.deliveryPersonId = dp.id;
        updatedOrder.deliveryPersonName = dp.name;
      }

      if (Array.isArray(req.body?.deliveryAssignmentHistory)) {
        updatedOrder.deliveryAssignmentHistory = req.body.deliveryAssignmentHistory;
      }
      if (Array.isArray(req.body?.movements)) {
        updatedOrder.movements = req.body.movements;
      }

      const cleanUpdated: Record<string, any> = {};
      for (const [k, v] of Object.entries(updatedOrder)) {
        if (!k.startsWith('_') && v !== undefined) {
          cleanUpdated[k] = v;
        }
      }

      const trackingDoc = cleanUpdated.trackingCode ? buildPublicTrackingDocServer(cleanUpdated) : null;

      if (adminDb) {
        await adminDb.collection('orders').doc(orderId).set(cleanUpdated);
        if (cleanUpdated.trackingCode && trackingDoc) {
          await adminDb.collection('public_tracking').doc(cleanUpdated.trackingCode).set(trackingDoc);
        }
        res.json({ success: true, orderId, order: cleanUpdated });
        return;
      }

      if (auth.token && PROJECT_ID) {
        const baseUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
        const maskFields = [
          'deliveryPerson',
          'deliveryPersonId',
          'deliveryPersonName',
          'deliveryAssignmentHistory',
          'movements',
          'updatedAt',
        ];
        const maskQuery = maskFields.map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&');
        const restRes = await fetch(`${baseUrl}/orders/${orderId}?${maskQuery}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${auth.token}`,
          },
          body: JSON.stringify(jsonToFirestoreDocument(cleanUpdated)),
        });
        if (restRes.ok) {
          if (cleanUpdated.trackingCode && trackingDoc) {
            await fetch(`${baseUrl}/public_tracking/${cleanUpdated.trackingCode}`, {
              method: 'PATCH',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${auth.token}`,
              },
              body: JSON.stringify(jsonToFirestoreDocument(trackingDoc)),
            }).catch(() => {});
          }
          res.json({ success: true, orderId, order: cleanUpdated });
          return;
        }
        const errTxt = await restRes.text().catch(() => '');
        res.status(restRes.status).json({
          success: false,
          message: `Firestore REST (${restRes.status}): ${errTxt.slice(0, 180)}`,
        });
        return;
      }

      res.status(500).json({ success: false, message: 'Conector Firestore autenticado indisponível no servidor.' });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, message: `Erro ao atualizar entregador: ${msg}` });
    }
  };

  app.patch(['/api/orders/:id/assign-driver', '/orders/:id/assign-driver'], handleAssignDeliveryPerson);
  app.post(['/api/orders/:id/assign-driver', '/orders/:id/assign-driver'], handleAssignDeliveryPerson);

  // Secure Shared Tombstones Sync (Staff read / Gerente or Admin write)
  app.get(['/api/orders/tombstones', '/orders/tombstones'], async (req: Request, res: Response) => {
    try {
      const auth = await verifyStaffAuth(req);
      if (!auth.isStaff) {
        res.status(403).json({ success: false, message: 'Acesso restrito a colaboradores autorizados.' });
        return;
      }
      const deletedOrderIds = await getOrderTombstonesServer(auth.token);
      res.json({ success: true, deletedOrderIds });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, message: `Erro ao consultar exclusões: ${msg}` });
    }
  });

  app.post(['/api/orders/tombstones', '/orders/tombstones'], async (req: Request, res: Response) => {
    try {
      const auth = await verifyStaffAuth(req);
      if (!auth.isStaff || !['ADMINISTRADOR', 'GERENTE'].includes(auth.role.toUpperCase())) {
        res.status(403).json({ success: false, message: 'Permissão insuficiente: apenas Administrador ou Gerente podem registrar exclusões.' });
        return;
      }
      const orderId = req.body?.orderId;
      if (!orderId || typeof orderId !== 'string' || !/^[a-zA-Z0-9_\-]+$/.test(orderId) || orderId.length > 128) {
        res.status(400).json({ success: false, message: 'Identificador de pedido inválido.' });
        return;
      }
      await recordOrderTombstoneServer(orderId, auth.token);
      res.json({ success: true, orderId });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, message: `Erro ao registrar exclusão: ${msg}` });
    }
  });

  // Secure Order Deletion (Strictly ADMINISTRADOR or GERENTE)
  // Ensures reliable removal from Cloud Firestore with Admin SDK or Firestore REST API
  const handleOrderDeletion = async (req: Request, res: Response) => {
    try {
      const auth = await verifyStaffAuth(req);
      if (!auth.isStaff) {
        res.status(403).json({ success: false, message: 'Acesso restrito a colaboradores autorizados e ativos.' });
        return;
      }

      const normalizedRole = auth.role.toUpperCase();
      if (!['ADMINISTRADOR', 'GERENTE'].includes(normalizedRole)) {
        res.status(403).json({
          success: false,
          message: `Permissão insuficiente: perfil ${normalizedRole} não tem autorização para excluir pedidos (apenas Administrador ou Gerente).`,
        });
        return;
      }

      const orderId = req.params.id || req.body?.orderId || req.body?.id;
      const trackingCode = (typeof req.query?.trackingCode === 'string' ? req.query.trackingCode : req.body?.trackingCode) || '';
      if (!orderId || typeof orderId !== 'string' || !/^[a-zA-Z0-9_\-]+$/.test(orderId) || orderId.length > 128) {
        res.status(400).json({ success: false, message: 'Identificador de pedido inválido.' });
        return;
      }

      let deletedFromFirestore = false;
      let deleteErrorDetails = '';
      let deleteStatus = 500;

      // 1. Delete using Firebase Admin SDK if available
      if (adminDb) {
        try {
          await adminDb.collection('orders').doc(orderId).delete();
          deletedFromFirestore = true;

          // Also clean up any associated public tracking document (PublicOrderTracking uses field 'id')
          try {
            const trackingQuery = await adminDb.collection('public_tracking').where('id', '==', orderId).limit(5).get();
            if (!trackingQuery.empty) {
              const batch = adminDb.batch();
              trackingQuery.docs.forEach((d) => batch.delete(d.ref));
              await batch.commit();
            }
            if (trackingCode && /^[a-zA-Z0-9_\-]+$/.test(trackingCode)) {
              await adminDb.collection('public_tracking').doc(trackingCode).delete().catch(() => {});
            }
          } catch {}
        } catch (adminErr) {
          deleteErrorDetails = adminErr instanceof Error ? adminErr.message : String(adminErr);
          console.warn('[Admin SDK Delete Order Error]:', adminErr);
        }
      }

      let resolvedTrackingCode = String(trackingCode || '').trim();

      // 2. Fallback via Firestore REST API with Staff Auth Token
      if (!deletedFromFirestore && auth.token && PROJECT_ID) {
        try {
          if (!resolvedTrackingCode) {
            const existingOrder = await fetchOrderFromFirestoreServer(orderId, auth.token).catch(() => null);
            if (existingOrder?.exists && typeof existingOrder.data?.trackingCode === 'string') {
              resolvedTrackingCode = existingOrder.data.trackingCode.trim();
            }
          }
          const baseUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
          const restRes = await fetch(`${baseUrl}/orders/${orderId}`, {
            method: 'DELETE',
            headers: {
              Authorization: `Bearer ${auth.token}`,
            },
          });
          if (restRes.ok || restRes.status === 404) {
            deletedFromFirestore = true;
            if (resolvedTrackingCode && /^[a-zA-Z0-9_\-]+$/.test(resolvedTrackingCode)) {
              await fetch(`${baseUrl}/public_tracking/${resolvedTrackingCode}`, {
                method: 'DELETE',
                headers: {
                  Authorization: `Bearer ${auth.token}`,
                },
              }).catch(() => {});
            }
          } else {
            deleteStatus = restRes.status === 403 ? 403 : 500;
            const errTxt = await restRes.text().catch(() => '');
            deleteErrorDetails = `Firestore REST (${restRes.status}): ${errTxt.slice(0, 180)}`;
          }
        } catch (restErr) {
          deleteErrorDetails = restErr instanceof Error ? restErr.message : String(restErr);
          console.warn('[REST Delete Order Error]:', restErr);
        }
      }

      if (deletedFromFirestore) {
        await recordOrderTombstoneServer(orderId, auth.token);
        res.json({ success: true, message: 'Pedido excluído com sucesso do Cloud Firestore.', orderId });
      } else {
        res.status(deleteStatus).json({
          success: false,
          message:
            deleteErrorDetails ||
            'Não foi possível confirmar a exclusão do pedido no Cloud Firestore (Admin SDK não configurado e token REST ausente).',
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, message: `Erro ao excluir pedido: ${msg}` });
    }
  };

  app.delete(['/api/orders/:id', '/orders/:id'], handleOrderDeletion);
  app.post(['/api/orders/delete', '/orders/delete'], handleOrderDeletion);

  // Delivery Shifts Persistence (Admin / Supervisor / Delivery Staff)
  app.post(['/api/delivery-shifts', '/delivery-shifts'], async (req: Request, res: Response) => {
    try {
      const auth = await verifyStaffAuth(req);
      if (!auth.isStaff) {
        res.status(403).json({ success: false, message: 'Acesso restrito a colaboradores autorizados.' });
        return;
      }

      const { shift } = req.body;
      if (!shift || typeof shift !== 'object' || !shift.id || typeof shift.id !== 'string') {
        res.status(400).json({ success: false, message: 'Dados do turno de entrega inválidos.' });
        return;
      }

      if (!/^[a-zA-Z0-9_\-]+$/.test(shift.id) || shift.id.length > 128) {
        res.status(400).json({ success: false, message: 'Identificador do turno de entrega inválido.' });
        return;
      }

      if (shift.status !== 'ABERTO' && shift.status !== 'FECHADO') {
        res.status(400).json({ success: false, message: 'Status do turno de entrega deve ser ABERTO ou FECHADO.' });
        return;
      }

      if (!shift.date || typeof shift.date !== 'string' || !shift.openedAt || !shift.openedBy || typeof shift.openedBy !== 'object') {
        res.status(400).json({ success: false, message: 'Estrutura básica do turno de entrega incompleta.' });
        return;
      }

      // Persist via adminDb if available
      if (adminDb) {
        try {
          await adminDb.collection('delivery_shifts').doc(shift.id).set(shift);
          res.json({ success: true, message: 'Turno de entrega gravado com sucesso no Cloud Firestore via Admin SDK.' });
          return;
        } catch (adminErr) {
          console.warn('[Admin SDK Delivery Shift Error]:', adminErr);
        }
      }

      // Fallback: Firestore REST API with Staff Token
      if (auth.token) {
        try {
          const baseUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
          const payload = jsonToFirestoreDocument(shift);
          const restRes = await fetch(`${baseUrl}/delivery_shifts/${shift.id}`, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${auth.token}`,
            },
            body: JSON.stringify(payload),
          });
          if (restRes.ok) {
            res.json({ success: true, message: 'Turno de entrega gravado via REST API.' });
            return;
          }
        } catch (restErr) {
          console.warn('[REST Delivery Shift Error]:', restErr);
        }
      }

      res.json({ success: true, message: 'Turno de entrega aceito pelo servidor.' });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, message: `Erro ao processar turno de entrega: ${msg}` });
    }
  });

  // Helper: Server-side expected physical cash drawer balance computation
  function computeExpectedCashInDrawerServer(shiftData: Record<string, any>): number {
    let expected = roundCurrencyServer(Number(shiftData.initialBalance) || 0);
    const movements = Array.isArray(shiftData.movements) ? shiftData.movements : [];
    for (const m of movements) {
      if (!m || typeof m !== 'object') continue;
      const amt = roundCurrencyServer(Number(m.amount) || 0);
      if (m.type === 'SUPRIMENTO') {
        expected = roundCurrencyServer(expected + amt);
      } else if (m.type === 'SANGRIA' || m.type === 'VALE') {
        expected = roundCurrencyServer(expected - amt);
      } else if (m.type === 'VENDA' && m.paymentMethod === 'DINHEIRO') {
        expected = roundCurrencyServer(expected + amt);
      } else if (m.type === 'ESTORNO' && m.paymentMethod === 'DINHEIRO') {
        expected = roundCurrencyServer(expected - amt);
      } else if (m.type === 'AJUSTE') {
        expected = roundCurrencyServer(expected + (Number(m.amount) || 0));
      }
    }
    return expected;
  }

  // Cash Shifts Persistence (Strictly Admin / Gerente / Caixa + Atomic Admin SDK Transaction)
  app.post(['/api/cash-shifts', '/cash-shifts'], async (req: Request, res: Response) => {
    try {
      const auth = await verifyStaffAuth(req);
      if (!auth.isStaff || !['ADMINISTRADOR', 'GERENTE', 'CAIXA'].includes(auth.role.toUpperCase())) {
        res.status(403).json({
          success: false,
          message: 'Permissão insuficiente: apenas Caixa, Gerente ou Administrador podem administrar turnos e movimentações gerais do caixa.',
        });
        return;
      }

      if (!adminDb) {
        res.status(503).json({
          success: false,
          code: 'ADMIN_SDK_UNAVAILABLE',
          message:
            'Operação de caixa bloqueada: Firebase Admin SDK não está configurado no servidor para garantir transação atômica.',
        });
        return;
      }

      const { shift } = req.body;
      if (!shift || typeof shift !== 'object' || !shift.id || typeof shift.id !== 'string') {
        res.status(400).json({ success: false, message: 'Dados do turno de caixa inválidos.' });
        return;
      }

      if (!/^[a-zA-Z0-9_\-]+$/.test(shift.id) || shift.id.length > 128) {
        res.status(400).json({ success: false, message: 'Identificador do turno de caixa inválido.' });
        return;
      }

      if (shift.status !== 'ABERTO' && shift.status !== 'FECHADO') {
        res.status(400).json({ success: false, message: 'Status do turno de caixa deve ser ABERTO ou FECHADO.' });
        return;
      }

      if (!shift.openedAt || typeof shift.openedAt !== 'string' || !shift.openedBy || typeof shift.openedBy !== 'string') {
        res.status(400).json({ success: false, message: 'Estrutura básica do turno de caixa incompleta.' });
        return;
      }

      const db = adminDb;
      const shiftRef = db.collection('cash_shifts').doc(shift.id);
      let conflictCode: string | null = null;
      let conflictMsg = '';

      await db.runTransaction(async (transaction: FirebaseFirestore.Transaction) => {
        const docSnap = await transaction.get(shiftRef);
        if (docSnap.exists) {
          const currentData = docSnap.data();
          if (currentData && currentData.status === 'FECHADO') {
            conflictCode = 'SHIFT_ALREADY_CLOSED';
            conflictMsg = `Operação recusada: O turno de caixa '${shift.id}' já está FECHADO e não pode ser modificado ou sobrescrito.`;
            return;
          }
        } else if (shift.status === 'ABERTO') {
          const openQuery = await transaction.get(db.collection('cash_shifts').where('status', '==', 'ABERTO'));
          const otherOpen = openQuery.docs.filter((d) => d.id !== shift.id);
          if (otherOpen.length > 0) {
            conflictCode = 'OPEN_SHIFT_ALREADY_EXISTS';
            conflictMsg = `Operação recusada: Já existe um turno de caixa ABERTO ('${otherOpen[0].id}'). Feche o turno atual antes de abrir outro.`;
            return;
          }
        }
        transaction.set(shiftRef, shift);
      });

      if (conflictCode) {
        res.status(409).json({
          success: false,
          code: conflictCode,
          message: conflictMsg,
        });
        return;
      }

      await syncRestaurantOpenStatusDoc(db, shift.status === 'ABERTO');
      res.json({ success: true, shift, message: 'Turno de caixa gravado com sucesso no Cloud Firestore via Admin SDK.' });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, message: `Erro ao processar turno de caixa: ${msg}` });
    }
  });

  // Atomic Open Cash Shift (prevents concurrent double-open & preserves idempotent retry)
  app.post(['/api/cash-shifts/open', '/cash-shifts/open'], async (req: Request, res: Response) => {
    try {
      const auth = await verifyStaffAuth(req);
      if (!auth.isStaff || !['ADMINISTRADOR', 'GERENTE', 'CAIXA'].includes(auth.role.toUpperCase())) {
        res.status(403).json({
          success: false,
          message: 'Permissão insuficiente: apenas Caixa, Gerente ou Administrador podem abrir o caixa.',
        });
        return;
      }

      if (!adminDb) {
        res.status(503).json({
          success: false,
          code: 'ADMIN_SDK_UNAVAILABLE',
          message: 'Abertura de caixa bloqueada: Firebase Admin SDK não configurado no servidor.',
        });
        return;
      }

      const rawShiftId = typeof req.body?.shiftId === 'string' && req.body.shiftId.trim()
        ? req.body.shiftId.trim()
        : `shift-${Date.now()}`;
      if (!/^[a-zA-Z0-9_\-]+$/.test(rawShiftId) || rawShiftId.length > 128) {
        res.status(400).json({ success: false, message: 'Identificador do turno de caixa inválido.' });
        return;
      }

      const parsedBalance = Number(req.body?.initialBalance);
      if (!Number.isFinite(parsedBalance) || parsedBalance < 0) {
        res.status(400).json({ success: false, message: 'Saldo inicial inválido (deve ser maior ou igual a zero).' });
        return;
      }
      const initialBalance = roundCurrencyServer(parsedBalance);
      const openedBy = String(req.body?.openedBy || auth.email || auth.role).trim().slice(0, 128);
      if (!openedBy) {
        res.status(400).json({ success: false, message: 'Informe o operador responsável pela abertura do caixa.' });
        return;
      }

      const db = adminDb;
      const shiftRef = db.collection('cash_shifts').doc(rawShiftId);
      const now = new Date().toISOString();

      let outcome: { status: number; body: Record<string, any> } = {
        status: 500,
        body: { success: false, message: 'Erro interno na abertura atômica de caixa.' },
      };

      await db.runTransaction(async (tx: FirebaseFirestore.Transaction) => {
        const docSnap = await tx.get(shiftRef);
        const openQuery = await tx.get(db.collection('cash_shifts').where('status', '==', 'ABERTO'));

        if (docSnap.exists) {
          const existing = (docSnap.data() || {}) as Record<string, any>;
          if (existing.status === 'FECHADO') {
            outcome = {
              status: 409,
              body: {
                success: false,
                code: 'SHIFT_ALREADY_CLOSED',
                message: `Operação recusada: O turno '${rawShiftId}' já está FECHADO.`,
              },
            };
            return;
          }
          outcome = {
            status: 200,
            body: {
              success: true,
              alreadyExists: true,
              shift: { ...existing, id: rawShiftId },
              message: 'Turno de caixa já aberto no servidor.',
            },
          };
          return;
        }

        const otherOpen = openQuery.docs.filter((d) => d.id !== rawShiftId);
        if (otherOpen.length > 0) {
          outcome = {
            status: 409,
            body: {
              success: false,
              code: 'OPEN_SHIFT_ALREADY_EXISTS',
              message: `Operação recusada: Já existe um turno de caixa ABERTO ('${otherOpen[0].id}'). Feche o turno atual antes de abrir outro.`,
            },
          };
          return;
        }

        const newShift: Record<string, any> = {
          id: rawShiftId,
          openedAt: now,
          status: 'ABERTO',
          openedBy,
          initialBalance,
          movements: [],
        };

        tx.set(shiftRef, newShift);
        outcome = {
          status: 200,
          body: {
            success: true,
            alreadyExists: false,
            shift: newShift,
            message: 'Turno de caixa aberto com confirmação real no servidor.',
          },
        };
      });

      if (outcome.status === 200) {
        await syncRestaurantOpenStatusDoc(db, true);
      }

      res.status(outcome.status).json(outcome.body);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, message: `Erro ao abrir caixa atomicamente: ${msg}` });
    }
  });

  // Atomic Close Cash Shift (preserves all movements, forbids closing already FECHADO shift, computes totals server-side)
  app.post(['/api/cash-shifts/:id/close', '/cash-shifts/:id/close'], async (req: Request, res: Response) => {
    try {
      const auth = await verifyStaffAuth(req);
      if (!auth.isStaff || !['ADMINISTRADOR', 'GERENTE', 'CAIXA'].includes(auth.role.toUpperCase())) {
        res.status(403).json({
          success: false,
          message: 'Permissão insuficiente: apenas Caixa, Gerente ou Administrador podem fechar o caixa.',
        });
        return;
      }

      if (!adminDb) {
        res.status(503).json({
          success: false,
          code: 'ADMIN_SDK_UNAVAILABLE',
          message: 'Fechamento de caixa bloqueado: Firebase Admin SDK não configurado no servidor.',
        });
        return;
      }

      const shiftId = String(req.params.id || '').trim();
      if (!shiftId || !/^[a-zA-Z0-9_\-]+$/.test(shiftId) || shiftId.length > 128) {
        res.status(400).json({ success: false, message: 'Identificador do turno de caixa inválido.' });
        return;
      }

      const parsedCounted = Number(req.body?.countedCash);
      if (!Number.isFinite(parsedCounted) || parsedCounted < 0) {
        res.status(400).json({ success: false, message: 'Valor contado na gaveta inválido.' });
        return;
      }
      const countedCash = roundCurrencyServer(parsedCounted);
      const closedBy = String(req.body?.closedBy || auth.email || auth.role).trim().slice(0, 128) || 'Operador';
      const notes = typeof req.body?.notes === 'string' && req.body.notes.trim() ? req.body.notes.trim().slice(0, 500) : undefined;

      const db = adminDb;
      const shiftRef = db.collection('cash_shifts').doc(shiftId);
      const now = new Date().toISOString();

      let outcome: { status: number; body: Record<string, any> } = {
        status: 500,
        body: { success: false, message: 'Erro interno ao fechar caixa.' },
      };

      await db.runTransaction(async (tx: FirebaseFirestore.Transaction) => {
        const snap = await tx.get(shiftRef);
        if (!snap.exists) {
          outcome = {
            status: 404,
            body: {
              success: false,
              code: 'SHIFT_NOT_FOUND',
              message: `Turno de caixa '${shiftId}' não encontrado no servidor.`,
            },
          };
          return;
        }

        const shiftData = (snap.data() || {}) as Record<string, any>;
        if (shiftData.status === 'FECHADO') {
          outcome = {
            status: 409,
            body: {
              success: false,
              code: 'SHIFT_ALREADY_CLOSED',
              message: `Operação recusada: O turno de caixa '${shiftId}' já se encontra FECHADO e é imutável.`,
            },
          };
          return;
        }

        const expectedCash = computeExpectedCashInDrawerServer(shiftData);
        const difference = roundCurrencyServer(countedCash - expectedCash);

        const closedShift: Record<string, any> = {
          ...shiftData,
          id: shiftId,
          status: 'FECHADO',
          closedAt: now,
          closedBy,
          finalCalculatedBalance: expectedCash,
          finalCountedCash: countedCash,
          difference,
          ...(notes ? { notes } : {}),
        };

        tx.set(shiftRef, closedShift);
        outcome = {
          status: 200,
          body: {
            success: true,
            shift: closedShift,
            message: 'Turno de caixa fechado e conferido atomicamente no servidor.',
          },
        };
      });

      if (outcome.status === 200) {
        await syncRestaurantOpenStatusDoc(db, false);
      }

      res.status(outcome.status).json(outcome.body);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, message: `Erro ao fechar caixa atomicamente: ${msg}` });
    }
  });

  // Atomic Cash Movement Append (SANGRIA / SUPRIMENTO / VALE — idempotent by movementId, rejects FECHADO)
  app.post(['/api/cash-shifts/:id/movements', '/cash-shifts/:id/movements'], async (req: Request, res: Response) => {
    try {
      const auth = await verifyStaffAuth(req);
      if (!auth.isStaff || !['ADMINISTRADOR', 'GERENTE', 'CAIXA'].includes(auth.role.toUpperCase())) {
        res.status(403).json({
          success: false,
          message: 'Permissão insuficiente: apenas Caixa, Gerente ou Administrador podem registrar movimentações de caixa.',
        });
        return;
      }

      if (!adminDb) {
        res.status(503).json({
          success: false,
          code: 'ADMIN_SDK_UNAVAILABLE',
          message: 'Registro de movimentação bloqueado: Firebase Admin SDK não configurado no servidor.',
        });
        return;
      }

      const shiftId = String(req.params.id || '').trim();
      if (!shiftId || !/^[a-zA-Z0-9_\-]+$/.test(shiftId) || shiftId.length > 128) {
        res.status(400).json({ success: false, message: 'Identificador do turno de caixa inválido.' });
        return;
      }

      const movInput = req.body?.movement;
      if (!movInput || typeof movInput !== 'object') {
        res.status(400).json({ success: false, message: 'Dados da movimentação ausentes.' });
        return;
      }

      const movType = String(movInput.type || '').trim().toUpperCase();
      if (!['SANGRIA', 'SUPRIMENTO', 'VALE'].includes(movType)) {
        res.status(400).json({
          success: false,
          message: 'Tipo de movimentação inválido para este canal. Use SANGRIA, SUPRIMENTO ou VALE.',
        });
        return;
      }

      const movId = typeof movInput.id === 'string' && movInput.id.trim()
        ? movInput.id.trim()
        : `cash-mov-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      if (!/^[a-zA-Z0-9_\-]+$/.test(movId) || movId.length > 128) {
        res.status(400).json({ success: false, message: 'Identificador da movimentação inválido.' });
        return;
      }

      const parsedAmount = Number(movInput.amount);
      if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
        res.status(400).json({ success: false, message: 'Valor da movimentação deve ser maior que zero.' });
        return;
      }
      const amount = roundCurrencyServer(Math.abs(parsedAmount));

      const description = String(movInput.description || '').trim().slice(0, 300);
      if (!description) {
        res.status(400).json({ success: false, message: 'Motivo/descrição da movimentação é obrigatório.' });
        return;
      }

      const author = String(movInput.author || auth.email || auth.role).trim().slice(0, 128) || 'Operador';
      const allowedMethods = ['PIX', 'CARTAO_CREDITO', 'CARTAO_DEBITO', 'DINHEIRO', 'MISTO'];
      const paymentMethod = allowedMethods.includes(String(movInput.paymentMethod)) ? String(movInput.paymentMethod) : 'DINHEIRO';
      const employeeName = typeof movInput.employeeName === 'string' && movInput.employeeName.trim()
        ? movInput.employeeName.trim().slice(0, 128)
        : undefined;

      const db = adminDb;
      const shiftRef = db.collection('cash_shifts').doc(shiftId);
      const now = new Date().toISOString();

      let outcome: { status: number; body: Record<string, any> } = {
        status: 500,
        body: { success: false, message: 'Erro interno ao registrar movimentação.' },
      };

      await db.runTransaction(async (tx: FirebaseFirestore.Transaction) => {
        const snap = await tx.get(shiftRef);
        if (!snap.exists) {
          outcome = {
            status: 404,
            body: { success: false, code: 'SHIFT_NOT_FOUND', message: `Turno '${shiftId}' não encontrado.` },
          };
          return;
        }

        const shiftData = (snap.data() || {}) as Record<string, any>;
        if (shiftData.status === 'FECHADO') {
          outcome = {
            status: 409,
            body: {
              success: false,
              code: 'SHIFT_ALREADY_CLOSED',
              message: `Operação recusada: O turno '${shiftId}' já está FECHADO e não aceita novas movimentações.`,
            },
          };
          return;
        }

        const existingMovs = Array.isArray(shiftData.movements) ? [...shiftData.movements] : [];
        const dup = existingMovs.find((m: any) => m && m.id === movId);
        if (dup) {
          outcome = {
            status: 200,
            body: {
              success: true,
              alreadyExists: true,
              movement: dup,
              shift: { ...shiftData, id: shiftId },
              message: 'Movimentação já registrada anteriormente (idempotência confirmada).',
            },
          };
          return;
        }

        const newMovement: Record<string, any> = {
          id: movId,
          timestamp: now,
          type: movType,
          amount,
          paymentMethod,
          description,
          author,
          ...(employeeName ? { employeeName } : {}),
        };

        const nextMovements = [...existingMovs, newMovement];
        tx.update(shiftRef, { movements: nextMovements });
        outcome = {
          status: 200,
          body: {
            success: true,
            alreadyExists: false,
            movement: newMovement,
            shift: { ...shiftData, id: shiftId, movements: nextMovements },
            message: `${movType} registrada com sucesso no servidor.`,
          },
        };
      });

      res.status(outcome.status).json(outcome.body);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, message: `Erro ao registrar movimentação de caixa: ${msg}` });
    }
  });

  // Atomic Drawer Balance Adjustment (computes delta server-side inside transaction, idempotent by movementId, rejects FECHADO)
  app.post(['/api/cash-shifts/:id/adjust', '/cash-shifts/:id/adjust'], async (req: Request, res: Response) => {
    try {
      const auth = await verifyStaffAuth(req);
      if (!auth.isStaff || !['ADMINISTRADOR', 'GERENTE', 'CAIXA'].includes(auth.role.toUpperCase())) {
        res.status(403).json({
          success: false,
          message: 'Permissão insuficiente: apenas Caixa, Gerente ou Administrador podem ajustar o saldo da gaveta.',
        });
        return;
      }

      if (!adminDb) {
        res.status(503).json({
          success: false,
          code: 'ADMIN_SDK_UNAVAILABLE',
          message: 'Ajuste de gaveta bloqueado: Firebase Admin SDK não configurado no servidor.',
        });
        return;
      }

      const shiftId = String(req.params.id || '').trim();
      if (!shiftId || !/^[a-zA-Z0-9_\-]+$/.test(shiftId) || shiftId.length > 128) {
        res.status(400).json({ success: false, message: 'Identificador do turno de caixa inválido.' });
        return;
      }

      const parsedNewBalance = Number(req.body?.newBalance);
      if (!Number.isFinite(parsedNewBalance) || parsedNewBalance < 0) {
        res.status(400).json({ success: false, message: 'Novo saldo da gaveta inválido.' });
        return;
      }
      const targetBalance = roundCurrencyServer(parsedNewBalance);
      const movId = typeof req.body?.movementId === 'string' && req.body.movementId.trim()
        ? req.body.movementId.trim()
        : `cash-adj-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      if (!/^[a-zA-Z0-9_\-]+$/.test(movId) || movId.length > 128) {
        res.status(400).json({ success: false, message: 'Identificador do ajuste inválido.' });
        return;
      }
      const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 240) : '';
      const author = String(req.body?.author || auth.email || auth.role).trim().slice(0, 128) || 'admin';

      const db = adminDb;
      const shiftRef = db.collection('cash_shifts').doc(shiftId);
      const now = new Date().toISOString();

      let outcome: { status: number; body: Record<string, any> } = {
        status: 500,
        body: { success: false, message: 'Erro interno no ajuste de saldo.' },
      };

      await db.runTransaction(async (tx: FirebaseFirestore.Transaction) => {
        const snap = await tx.get(shiftRef);
        if (!snap.exists) {
          outcome = {
            status: 404,
            body: { success: false, code: 'SHIFT_NOT_FOUND', message: `Turno '${shiftId}' não encontrado.` },
          };
          return;
        }

        const shiftData = (snap.data() || {}) as Record<string, any>;
        if (shiftData.status === 'FECHADO') {
          outcome = {
            status: 409,
            body: {
              success: false,
              code: 'SHIFT_ALREADY_CLOSED',
              message: `Operação recusada: O turno '${shiftId}' já está FECHADO e não pode ser ajustado.`,
            },
          };
          return;
        }

        const existingMovs = Array.isArray(shiftData.movements) ? [...shiftData.movements] : [];
        const dup = existingMovs.find((m: any) => m && m.id === movId);
        if (dup) {
          outcome = {
            status: 200,
            body: {
              success: true,
              alreadyExists: true,
              movement: dup,
              shift: { ...shiftData, id: shiftId },
              message: 'Ajuste já registrado anteriormente.',
            },
          };
          return;
        }

        const currentDrawer = computeExpectedCashInDrawerServer(shiftData);
        const diff = roundCurrencyServer(targetBalance - currentDrawer);
        if (diff === 0) {
          outcome = {
            status: 400,
            body: {
              success: false,
              code: 'NO_BALANCE_CHANGE',
              message: 'O saldo informado já coincide com o saldo calculado atual da gaveta.',
            },
          };
          return;
        }

        const diffFormatted = diff > 0 ? `+R$ ${diff.toFixed(2)}` : `-R$ ${Math.abs(diff).toFixed(2)}`;
        const adjMovement: Record<string, any> = {
          id: movId,
          timestamp: now,
          type: 'AJUSTE',
          amount: diff,
          paymentMethod: 'DINHEIRO',
          description: reason
            ? `Ajuste manual de saldo da gaveta (${diffFormatted}): ${reason}`
            : `Ajuste manual de saldo da gaveta (${diffFormatted})`,
          author,
        };

        const nextMovements = [...existingMovs, adjMovement];
        tx.update(shiftRef, { movements: nextMovements });
        outcome = {
          status: 200,
          body: {
            success: true,
            alreadyExists: false,
            movement: adjMovement,
            shift: { ...shiftData, id: shiftId, movements: nextMovements },
            message: 'Ajuste de gaveta confirmado no servidor.',
          },
        };
      });

      res.status(outcome.status).json(outcome.body);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, message: `Erro ao ajustar saldo da gaveta: ${msg}` });
    }
  });

  // Atomic Delete Movement (rejects FECHADO, preserves VENDA/ESTORNO audit safety if requested)
  app.delete(['/api/cash-shifts/:id/movements/:movementId', '/cash-shifts/:id/movements/:movementId'], async (req: Request, res: Response) => {
    try {
      const auth = await verifyStaffAuth(req);
      if (!auth.isStaff || !['ADMINISTRADOR', 'GERENTE', 'CAIXA'].includes(auth.role.toUpperCase())) {
        res.status(403).json({
          success: false,
          message: 'Permissão insuficiente: apenas Caixa, Gerente ou Administrador podem excluir lançamentos do caixa.',
        });
        return;
      }

      if (!adminDb) {
        res.status(503).json({
          success: false,
          code: 'ADMIN_SDK_UNAVAILABLE',
          message: 'Exclusão de movimentação bloqueada: Firebase Admin SDK não configurado no servidor.',
        });
        return;
      }

      const shiftId = String(req.params.id || '').trim();
      const movementId = String(req.params.movementId || '').trim();
      if (!shiftId || !/^[a-zA-Z0-9_\-]+$/.test(shiftId) || !movementId) {
        res.status(400).json({ success: false, message: 'Identificador inválido.' });
        return;
      }

      const db = adminDb;
      const shiftRef = db.collection('cash_shifts').doc(shiftId);
      let outcome: { status: number; body: Record<string, any> } = {
        status: 500,
        body: { success: false, message: 'Erro interno ao excluir lançamento.' },
      };

      await db.runTransaction(async (tx: FirebaseFirestore.Transaction) => {
        const snap = await tx.get(shiftRef);
        if (!snap.exists) {
          outcome = {
            status: 404,
            body: { success: false, code: 'SHIFT_NOT_FOUND', message: `Turno '${shiftId}' não encontrado.` },
          };
          return;
        }

        const shiftData = (snap.data() || {}) as Record<string, any>;
        if (shiftData.status === 'FECHADO') {
          outcome = {
            status: 409,
            body: {
              success: false,
              code: 'SHIFT_ALREADY_CLOSED',
              message: `Operação recusada: O turno '${shiftId}' já está FECHADO e seu histórico é imutável.`,
            },
          };
          return;
        }

        const existingMovs = Array.isArray(shiftData.movements) ? [...shiftData.movements] : [];
        const target = existingMovs.find((m: any) => m && m.id === movementId);
        if (!target) {
          outcome = {
            status: 404,
            body: {
              success: false,
              code: 'MOVEMENT_NOT_FOUND',
              message: 'Lançamento não encontrado neste turno de caixa.',
            },
          };
          return;
        }

        if (target.type === 'VENDA' || target.type === 'ESTORNO') {
          outcome = {
            status: 409,
            body: {
              success: false,
              code: 'IMMUTABLE_AUDIT_MOVEMENT',
              message: `Lançamentos de ${target.type} vinculados a pedidos são auditáveis e não podem ser removidos diretamente.`,
            },
          };
          return;
        }

        const nextMovements = existingMovs.filter((m: any) => !m || m.id !== movementId);
        tx.update(shiftRef, { movements: nextMovements });
        outcome = {
          status: 200,
          body: {
            success: true,
            shift: { ...shiftData, id: shiftId, movements: nextMovements },
            message: 'Lançamento excluído com sucesso no servidor.',
          },
        };
      });

      res.status(outcome.status).json(outcome.body);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, message: `Erro ao excluir lançamento de caixa: ${msg}` });
    }
  });

  // Read authoritative shift state (used for timeout reconciliation in cash operations)
  app.get(['/api/cash-shifts/:id/state', '/cash-shifts/:id/state'], async (req: Request, res: Response) => {
    try {
      const auth = await verifyStaffAuth(req);
      if (!auth.isStaff || !['ADMINISTRADOR', 'GERENTE', 'CAIXA'].includes(auth.role.toUpperCase())) {
        res.status(403).json({ success: false, message: 'Permissão insuficiente para consultar estado do caixa.' });
        return;
      }

      if (!adminDb) {
        res.status(503).json({
          success: false,
          code: 'ADMIN_SDK_UNAVAILABLE',
          message: 'Consulta de estado de caixa indisponível: Firebase Admin SDK não configurado.',
        });
        return;
      }

      const shiftId = String(req.params.id || '').trim();
      if (!shiftId || !/^[a-zA-Z0-9_\-]+$/.test(shiftId)) {
        res.status(400).json({ success: false, message: 'Identificador de turno inválido.' });
        return;
      }

      const snap = await adminDb.collection('cash_shifts').doc(shiftId).get();
      if (!snap.exists) {
        res.json({ success: true, exists: false, shift: null });
        return;
      }
      const data = { ...(snap.data() || {}), id: snap.id };
      res.json({ success: true, exists: true, shift: data });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, message: `Erro ao consultar turno de caixa: ${msg}` });
    }
  });

  // ---------------------------------------------------------------------------
  // Atomic Payment Confirmation (Firebase Admin SDK Real Firestore Transaction)
  // Atomically:
  //   1. Verifies staff auth & role (ADMINISTRADOR, GERENTE, CAIXA, ATENDENTE)
  //   2. Reads order in Firestore (or validates & creates newOrder for PDV paid sale)
  //   3. Reads active cash_shifts (rejects 0 open shifts, FECHADO shift, or >1 open shifts)
  //   4. Validates order != CANCELADO and positive amount
  //   5. Marks order paymentStatus = 'PAGO' (+ public_tracking) AND appends exact 1 VENDA movement
  //   6. Idempotent on orderId (safe retry after network timeout)
  //   7. Fails safely (503 ADMIN_SDK_UNAVAILABLE) if Admin SDK is unavailable — ZERO REST fallback
  // ---------------------------------------------------------------------------
  async function executeAtomicPaymentConfirmationServer(params: {
    db: FirebaseFirestore.Firestore;
    orderId: string;
    author: string;
    notes?: string;
    requestedShiftId?: string;
    validatedNewOrder?: { cleanOrder: Record<string, any>; publicTrackingDoc: Record<string, any> } | null;
  }): Promise<{ status: number; body: Record<string, any>; createdNewOrder?: Record<string, any> }> {
    const { db, orderId, author, notes, requestedShiftId, validatedNewOrder } = params;
    const allowedMethods = ['PIX', 'CARTAO_CREDITO', 'CARTAO_DEBITO', 'DINHEIRO', 'MISTO'];
    const now = new Date().toISOString();
    const deterministicSaleMovementId = `cash-sale-${orderId}`;

    let result: { status: number; body: Record<string, any>; createdNewOrder?: Record<string, any> } = {
      status: 500,
      body: { success: false, message: 'Erro interno na transação atômica.' },
    };

    await db.runTransaction(async (tx: FirebaseFirestore.Transaction) => {
      const orderRef = db.collection('orders').doc(orderId);
      const orderSnap = await tx.get(orderRef);

      const openShiftsQuery = db.collection('cash_shifts').where('status', '==', 'ABERTO');
      const openShiftsSnap = await tx.get(openShiftsQuery);

      const reqShiftRef = requestedShiftId ? db.collection('cash_shifts').doc(requestedShiftId) : null;
      const reqShiftSnap = reqShiftRef ? await tx.get(reqShiftRef) : null;

      // Helper to resolve single valid open shift
      const resolveOpenShiftDoc = ():
        | { ok: true; docSnap: FirebaseFirestore.DocumentSnapshot }
        | { ok: false; status: number; code: string; message: string } => {
        if (reqShiftSnap) {
          if (!reqShiftSnap.exists) {
            return {
              ok: false,
              status: 404,
              code: 'NO_OPEN_SHIFT',
              message: `Turno de caixa '${requestedShiftId}' não encontrado no servidor.`,
            };
          }
          const reqData = reqShiftSnap.data() as Record<string, any> | undefined;
          if (!reqData || reqData.status !== 'ABERTO') {
            return {
              ok: false,
              status: 409,
              code: 'SHIFT_ALREADY_CLOSED',
              message: `Operação recusada: O turno de caixa '${requestedShiftId}' está ${reqData?.status || 'FECHADO'} e não pode receber vendas.`,
            };
          }
        }

        if (openShiftsSnap.empty) {
          return {
            ok: false,
            status: 404,
            code: 'NO_OPEN_SHIFT',
            message: 'Nenhum turno de caixa aberto encontrado no servidor. Abra o caixa antes de confirmar o pagamento.',
          };
        }

        if (openShiftsSnap.docs.length > 1) {
          return {
            ok: false,
            status: 409,
            code: 'MULTIPLE_OPEN_SHIFTS',
            message: `Inconsistência operacional: existem ${openShiftsSnap.docs.length} turnos de caixa ABERTO simultaneamente no servidor. Feche o turno excedente antes de confirmar vendas.`,
          };
        }

        const onlyOpenDoc = openShiftsSnap.docs[0];
        if (requestedShiftId && onlyOpenDoc.id !== requestedShiftId) {
          return {
            ok: false,
            status: 409,
            code: 'SHIFT_MISMATCH',
            message: `O turno informado ('${requestedShiftId}') não corresponde ao único turno ABERTO ('${onlyOpenDoc.id}').`,
          };
        }

        return { ok: true, docSnap: onlyOpenDoc };
      };

      if (orderSnap.exists) {
        const orderData = (orderSnap.data() || {}) as Record<string, any>;
        if (orderData.status === 'CANCELADO') {
          result = {
            status: 409,
            body: {
              success: false,
              code: 'ORDER_CANCELLED',
              message: 'Não é possível confirmar pagamento de um pedido cancelado.',
            },
          };
          return;
        }

        const roundedAmount = roundCurrencyServer(Number(orderData.totalAmount) || 0);
        if (roundedAmount <= 0) {
          result = {
            status: 400,
            body: {
              success: false,
              code: 'INVALID_ORDER_AMOUNT',
              message: 'Valor total do pedido inválido para confirmação financeira.',
            },
          };
          return;
        }

        // Check if already confirmed (Idempotency across open shifts and linked shift)
        let linkedShiftData: Record<string, any> | null = null;
        let linkedMovement: Record<string, any> | null = null;

        for (const sDoc of openShiftsSnap.docs) {
          const sData = sDoc.data() as Record<string, any>;
          const movs = Array.isArray(sData?.movements) ? sData.movements : [];
          const found = movs.find(
            (m: any) => m && m.type === 'VENDA' && (m.orderId === orderId || m.id === deterministicSaleMovementId)
          );
          if (found) {
            linkedShiftData = { ...sData, id: sDoc.id };
            linkedMovement = found;
            break;
          }
        }

        if (!linkedMovement && typeof orderData.saleCashShiftId === 'string' && orderData.saleCashShiftId) {
          const linkedShiftRef = db.collection('cash_shifts').doc(orderData.saleCashShiftId);
          const linkedSnap = await tx.get(linkedShiftRef);
          if (linkedSnap.exists) {
            const sData = linkedSnap.data() as Record<string, any>;
            const movs = Array.isArray(sData?.movements) ? sData.movements : [];
            const found = movs.find(
              (m: any) => m && m.type === 'VENDA' && (m.orderId === orderId || m.id === deterministicSaleMovementId)
            );
            if (found) {
              linkedShiftData = { ...sData, id: linkedSnap.id };
              linkedMovement = found;
            }
          }
        }

        if (orderData.paymentStatus === 'PAGO' && linkedMovement) {
          result = {
            status: 200,
            body: {
              success: true,
              alreadyConfirmed: true,
              order: orderData,
              shift: linkedShiftData,
              movement: linkedMovement,
              message: `Pagamento do pedido ${orderData.orderNumber || orderId} já confirmado anteriormente.`,
            },
          };
          return;
        }

        // Resolve single open shift for recording VENDA
        const shiftResolution = resolveOpenShiftDoc();
        if (shiftResolution.ok === false) {
          result = {
            status: shiftResolution.status,
            body: {
              success: false,
              code: shiftResolution.code,
              message: shiftResolution.message,
            },
          };
          return;
        }

        const shiftDocSnap = shiftResolution.docSnap;
        const shiftData = (shiftDocSnap.data() || {}) as Record<string, any>;
        const existingMovements = Array.isArray(shiftData.movements) ? [...shiftData.movements] : [];
        const existingSale = existingMovements.find(
          (m: any) => m && m.type === 'VENDA' && (m.orderId === orderId || m.id === deterministicSaleMovementId)
        );

        const paymentMethod = allowedMethods.includes(String(orderData.paymentMethod))
          ? String(orderData.paymentMethod)
          : 'PIX';

        const saleMovement =
          existingSale || {
            id: deterministicSaleMovementId,
            timestamp: now,
            type: 'VENDA',
            amount: roundedAmount,
            paymentMethod,
            description: `Recebimento Pedido ${String(orderData.orderNumber || '')} - ${String(orderData.customer?.name || 'Cliente')}`
              .trim()
              .slice(0, 300),
            orderId,
            orderNumber: String(orderData.orderNumber || '#0000').slice(0, 32),
            author: author.slice(0, 128),
          };

        const nextMovements = existingSale ? existingMovements : [...existingMovements, saleMovement];
        const prevOrderMovements = Array.isArray(orderData.movements) ? [...orderData.movements] : [];
        const nextOrderMovements =
          orderData.paymentStatus === 'PAGO'
            ? prevOrderMovements
            : [
                ...prevOrderMovements,
                {
                  id: `mov-pay-${orderId}`,
                  timestamp: now,
                  toStatus: orderData.status,
                  author: author.slice(0, 128),
                  notes: notes || `Pagamento ${paymentMethod} confirmado atomicamente no servidor`,
                },
              ];

        const updatedOrder: Record<string, any> = {
          ...orderData,
          paymentStatus: 'PAGO',
          updatedAt: now,
          saleCashShiftId: shiftDocSnap.id,
          saleMovementId: saleMovement.id,
          movements: nextOrderMovements,
        };

        tx.set(orderRef, updatedOrder);
        if (updatedOrder.trackingCode) {
          tx.set(
            db.collection('public_tracking').doc(updatedOrder.trackingCode),
            buildPublicTrackingDocServer(updatedOrder)
          );
        }
        if (!existingSale) {
          tx.update(shiftDocSnap.ref, { movements: nextMovements });
        }

        const updatedShift = { ...shiftData, id: shiftDocSnap.id, movements: nextMovements };
        result = {
          status: 200,
          body: {
            success: true,
            alreadyConfirmed: false,
            order: updatedOrder,
            shift: updatedShift,
            movement: saleMovement,
            message: `Pagamento do pedido ${updatedOrder.orderNumber || orderId} confirmado e venda lançada no caixa atomicamente.`,
          },
        };
        return;
      }

      // Order does not exist yet: only permitted when PDV supplies validatedNewOrder
      if (!validatedNewOrder) {
        result = {
          status: 404,
          body: {
            success: false,
            code: 'ORDER_NOT_FOUND',
            message: 'Pedido não encontrado no Cloud Firestore.',
          },
        };
        return;
      }

      const newOrderData = validatedNewOrder.cleanOrder;
      const roundedAmount = roundCurrencyServer(Number(newOrderData.totalAmount) || 0);
      if (roundedAmount <= 0) {
        result = {
          status: 400,
          body: {
            success: false,
            code: 'INVALID_ORDER_AMOUNT',
            message: 'Valor total da venda deve ser maior que zero para confirmação financeira.',
          },
        };
        return;
      }

      const shiftResolution = resolveOpenShiftDoc();
      if (shiftResolution.ok === false) {
        result = {
          status: shiftResolution.status,
          body: {
            success: false,
            code: shiftResolution.code,
            message: shiftResolution.message,
          },
        };
        return;
      }

      const shiftDocSnap = shiftResolution.docSnap;
      const shiftData = (shiftDocSnap.data() || {}) as Record<string, any>;
      const existingMovements = Array.isArray(shiftData.movements) ? [...shiftData.movements] : [];
      const existingSale = existingMovements.find(
        (m: any) => m && m.type === 'VENDA' && (m.orderId === orderId || m.id === deterministicSaleMovementId)
      );

      const paymentMethod = allowedMethods.includes(String(newOrderData.paymentMethod))
        ? String(newOrderData.paymentMethod)
        : 'PIX';

      const saleMovement =
        existingSale || {
          id: deterministicSaleMovementId,
          timestamp: now,
          type: 'VENDA',
          amount: roundedAmount,
          paymentMethod,
          description: `Recebimento Pedido ${String(newOrderData.orderNumber || '')} - ${String(newOrderData.customer?.name || 'Cliente')}`
            .trim()
            .slice(0, 300),
          orderId,
          orderNumber: String(newOrderData.orderNumber || '#0000').slice(0, 32),
          author: author.slice(0, 128),
        };

      const nextMovements = existingSale ? existingMovements : [...existingMovements, saleMovement];
      const committedOrder: Record<string, any> = {
        ...newOrderData,
        paymentStatus: 'PAGO',
        updatedAt: now,
        saleCashShiftId: shiftDocSnap.id,
        saleMovementId: saleMovement.id,
      };
      const trackingDoc = buildPublicTrackingDocServer(committedOrder);

      tx.set(orderRef, committedOrder);
      if (committedOrder.trackingCode) {
        tx.set(db.collection('public_tracking').doc(committedOrder.trackingCode), trackingDoc);
      }
      if (!existingSale) {
        tx.update(shiftDocSnap.ref, { movements: nextMovements });
      }

      const updatedShift = { ...shiftData, id: shiftDocSnap.id, movements: nextMovements };
      result = {
        status: 200,
        createdNewOrder: committedOrder,
        body: {
          success: true,
          alreadyConfirmed: false,
          order: committedOrder,
          shift: updatedShift,
          movement: saleMovement,
          message: `Venda ${committedOrder.orderNumber} criada, paga e lançada no caixa atomicamente.`,
        },
      };
    });

    return result;
  }

  app.post(['/api/orders/:id/confirm-payment', '/orders/:id/confirm-payment'], async (req: Request, res: Response) => {
    try {
      if (!adminDb) {
        res.status(503).json({
          success: false,
          code: 'ADMIN_SDK_UNAVAILABLE',
          message:
            'Confirmação de pagamento bloqueada: Firebase Admin SDK não está configurado no servidor para garantir transação atômica entre pedido e caixa.',
        });
        return;
      }

      const auth = await verifyStaffAuth(req);
      if (!auth.isStaff || !['ADMINISTRADOR', 'GERENTE', 'CAIXA', 'ATENDENTE'].includes(auth.role.toUpperCase())) {
        res.status(403).json({
          success: false,
          message: 'Permissão insuficiente: apenas Administrador, Gerente, Caixa ou Atendente podem confirmar pagamentos.',
        });
        return;
      }

      const orderId = String(req.params.id || req.body?.orderId || '').trim();
      if (!orderId || !/^[a-zA-Z0-9_\-]+$/.test(orderId) || orderId.length > 128) {
        res.status(400).json({ success: false, message: 'Identificador de pedido inválido.' });
        return;
      }

      const requestedShiftId = typeof req.body?.shiftId === 'string' ? req.body.shiftId.trim() : '';
      if (requestedShiftId && (!/^[a-zA-Z0-9_\-]+$/.test(requestedShiftId) || requestedShiftId.length > 128)) {
        res.status(400).json({ success: false, message: 'Identificador do turno de caixa inválido.' });
        return;
      }

      const tombstones = await getOrderTombstonesServer(auth.token);
      if (serverDeletedOrderIds.has(orderId) || tombstones.includes(orderId)) {
        res.status(410).json({
          success: false,
          deleted: true,
          message: 'Este pedido foi excluído definitivamente em outro dispositivo.',
        });
        return;
      }

      let validatedNewOrder: { cleanOrder: Record<string, any>; publicTrackingDoc: Record<string, any> } | null = null;
      if (req.body?.newOrder && typeof req.body.newOrder === 'object') {
        if (req.body.newOrder.id !== orderId) {
          res.status(400).json({ success: false, message: 'Identificador do novo pedido diverge da rota.' });
          return;
        }
        const validation = await validateAndBuildOrderServer(req.body.newOrder, true);
        if (validation.ok === false) {
          res.status(validation.status).json({ success: false, message: validation.message });
          return;
        }
        validatedNewOrder = {
          cleanOrder: validation.cleanOrder,
          publicTrackingDoc: validation.publicTrackingDoc,
        };
      }

      const authorStr = String(req.body?.author || auth.email || auth.role).trim() || auth.role;
      const notesStr = typeof req.body?.notes === 'string' ? req.body.notes.trim() : undefined;

      const txOutcome = await executeAtomicPaymentConfirmationServer({
        db: adminDb,
        orderId,
        author: authorStr,
        notes: notesStr,
        requestedShiftId: requestedShiftId || undefined,
        validatedNewOrder,
      });

      if (txOutcome.createdNewOrder) {
        sendOrderPushNotification(txOutcome.createdNewOrder, 'NEW_ORDER', auth.token || undefined).catch(() => {});
      }

      res.status(txOutcome.status).json(txOutcome.body);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, message: `Erro na confirmação atômica de pagamento: ${msg}` });
    }
  });

  app.get(['/api/orders/:id/payment-state', '/orders/:id/payment-state'], async (req: Request, res: Response) => {
    try {
      if (!adminDb) {
        res.status(503).json({
          success: false,
          code: 'ADMIN_SDK_UNAVAILABLE',
          message: 'Consulta atômica indisponível: Firebase Admin SDK não configurado no servidor.',
        });
        return;
      }

      const auth = await verifyStaffAuth(req);
      if (!auth.isStaff || !['ADMINISTRADOR', 'GERENTE', 'CAIXA', 'ATENDENTE'].includes(auth.role.toUpperCase())) {
        res.status(403).json({ success: false, message: 'Permissão insuficiente para consultar estado financeiro.' });
        return;
      }

      const orderId = String(req.params.id || '').trim();
      if (!orderId || !/^[a-zA-Z0-9_\-]+$/.test(orderId) || orderId.length > 128) {
        res.status(400).json({ success: false, message: 'Identificador de pedido inválido.' });
        return;
      }

      const orderSnap = await adminDb.collection('orders').doc(orderId).get();
      if (!orderSnap.exists) {
        res.json({ success: true, exists: false, paymentStatus: null, cashRecorded: false });
        return;
      }

      const orderData = (orderSnap.data() || {}) as Record<string, any>;
      const openShiftsSnap = await adminDb.collection('cash_shifts').where('status', '==', 'ABERTO').get();
      const deterministicId = `cash-sale-${orderId}`;
      let matchedShift: Record<string, any> | null = null;
      let matchedMovement: Record<string, any> | null = null;

      for (const sDoc of openShiftsSnap.docs) {
        const sData = sDoc.data() as Record<string, any>;
        const movs = Array.isArray(sData?.movements) ? sData.movements : [];
        const found = movs.find(
          (m: any) => m && m.type === 'VENDA' && (m.orderId === orderId || m.id === deterministicId)
        );
        if (found) {
          matchedShift = { ...sData, id: sDoc.id };
          matchedMovement = found;
          break;
        }
      }

      if (!matchedMovement && typeof orderData.saleCashShiftId === 'string' && orderData.saleCashShiftId) {
        const linkedSnap = await adminDb.collection('cash_shifts').doc(orderData.saleCashShiftId).get();
        if (linkedSnap.exists) {
          const sData = linkedSnap.data() as Record<string, any>;
          const movs = Array.isArray(sData?.movements) ? sData.movements : [];
          const found = movs.find(
            (m: any) => m && m.type === 'VENDA' && (m.orderId === orderId || m.id === deterministicId)
          );
          if (found) {
            matchedShift = { ...sData, id: linkedSnap.id };
            matchedMovement = found;
          }
        }
      }

      res.json({
        success: true,
        exists: true,
        paymentStatus: orderData.paymentStatus || null,
        cashRecorded: Boolean(matchedMovement),
        order: orderData,
        shift: matchedShift,
        movement: matchedMovement,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, message: `Erro ao consultar estado financeiro: ${msg}` });
    }
  });

  // Scoped Sale Movement Append (Atomic Admin SDK Transaction ONLY - NO non-atomic REST fallback)
  app.post(['/api/cash-shifts/record-sale', '/cash-shifts/record-sale'], async (req: Request, res: Response) => {
    try {
      if (!adminDb) {
        res.status(503).json({
          success: false,
          code: 'ADMIN_SDK_UNAVAILABLE',
          message:
            'Registro de venda bloqueado: Firebase Admin SDK não está configurado no servidor para garantir operação atômica.',
        });
        return;
      }

      const auth = await verifyStaffAuth(req);
      if (!auth.isStaff || !['ADMINISTRADOR', 'GERENTE', 'CAIXA', 'ATENDENTE'].includes(auth.role.toUpperCase())) {
        res.status(403).json({
          success: false,
          message: 'Permissão insuficiente: perfil não autorizado a registrar recebimento de pedido no caixa.',
        });
        return;
      }

      const orderId = typeof req.body?.orderId === 'string' ? req.body.orderId.trim() : '';
      if (!orderId || !/^[a-zA-Z0-9_\-]+$/.test(orderId) || orderId.length > 128) {
        res.status(400).json({ success: false, message: 'Identificador de pedido inválido.' });
        return;
      }

      const requestedShiftId = typeof req.body?.shiftId === 'string' ? req.body.shiftId.trim() : '';
      if (requestedShiftId && (!/^[a-zA-Z0-9_\-]+$/.test(requestedShiftId) || requestedShiftId.length > 128)) {
        res.status(400).json({ success: false, message: 'Identificador do turno de caixa inválido.' });
        return;
      }

      const authorStr = String(req.body?.author || auth.email || auth.role).trim().slice(0, 128) || 'Atendente';
      const notesStr = typeof req.body?.notes === 'string' ? req.body.notes.trim() : undefined;

      // Delegate to the same atomic transaction (validates user, order != CANCELADO, single open shift, updates order + shift atomically)
      const outcome = await executeAtomicPaymentConfirmationServer({
        db: adminDb,
        orderId,
        author: authorStr,
        notes: notesStr,
        requestedShiftId: requestedShiftId || undefined,
      });

      res.status(outcome.status).json(outcome.body);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, message: `Erro ao registrar venda no caixa: ${msg}` });
    }
  });

  // ---------------------------------------------------------------------------
  // Atomic Paid Order Cancellation & Refund (Firebase Admin SDK Transaction)
  // Atomically:
  //   1. Validates user & role (ADMINISTRADOR | GERENTE)
  //   2. Reads order in Firestore, confirms existence & not already CANCELADO
  //   3. For PENDENTE orders: updates order + public_tracking to CANCELADO (0 cash movements)
  //   4. For PAGO orders:
  //      - Identifies original VENDA movement (if present) and verifies NO existing ESTORNO (idempotency)
  //      - Requires valid single open shift (NEVER alters FECHADO shifts; fails explicitly without partial cancel if none/closed/multiple)
  //      - Updates order (CANCELADO + refundInfo), public_tracking, and appends exact 1 ESTORNO movement in same transaction
  //   5. Fails safely (503 ADMIN_SDK_UNAVAILABLE) if Admin SDK is unavailable — ZERO non-atomic fallback
  // ---------------------------------------------------------------------------
  async function executeAtomicOrderCancellationServer(params: {
    db: FirebaseFirestore.Firestore;
    orderId: string;
    reason: string;
    cancelledBy: string;
    refundPaymentMethodOverride?: string;
    requestedShiftId?: string;
  }): Promise<{ status: number; body: Record<string, any> }> {
    const { db, orderId, reason, cancelledBy, refundPaymentMethodOverride, requestedShiftId } = params;
    const allowedMethods = ['PIX', 'CARTAO_CREDITO', 'CARTAO_DEBITO', 'DINHEIRO', 'MISTO'];
    const cleanReason = reason.trim();
    const cleanAuthor = cancelledBy.trim().slice(0, 128) || 'Gerente';
    const deterministicRefundMovementId = `cash-estorno-${orderId}`;
    const deterministicSaleMovementId = `cash-sale-${orderId}`;
    const now = new Date().toISOString();

    let result: { status: number; body: Record<string, any> } = {
      status: 500,
      body: { success: false, message: 'Erro interno na transação atômica de cancelamento.' },
    };

    await db.runTransaction(async (tx: FirebaseFirestore.Transaction) => {
      const orderRef = db.collection('orders').doc(orderId);
      const orderSnap = await tx.get(orderRef);

      if (!orderSnap.exists) {
        result = {
          status: 404,
          body: {
            success: false,
            code: 'ORDER_NOT_FOUND',
            message: 'Pedido não encontrado no Cloud Firestore.',
          },
        };
        return;
      }

      const orderData = (orderSnap.data() || {}) as Record<string, any>;
      if (orderData.status === 'CANCELADO') {
        result = {
          status: 409,
          body: {
            success: false,
            code: 'ORDER_ALREADY_CANCELLED',
            alreadyCancelled: true,
            order: orderData,
            refundInfo: orderData.refundInfo || null,
            message: `O pedido ${orderData.orderNumber || orderId} já se encontra cancelado.`,
          },
        };
        return;
      }

      const prevOrderMovements = Array.isArray(orderData.movements) ? [...orderData.movements] : [];

      // Unpaid order (PENDENTE): cancel order & public_tracking atomically WITHOUT cash movement
      if (orderData.paymentStatus !== 'PAGO') {
        const updatedOrder: Record<string, any> = {
          ...orderData,
          status: 'CANCELADO',
          cancellationReason: cleanReason,
          cancelledBy: cleanAuthor,
          cancelledAt: now,
          updatedAt: now,
          movements: [
            ...prevOrderMovements,
            {
              id: `mov-cancel-${orderId}`,
              timestamp: now,
              fromStatus: orderData.status,
              toStatus: 'CANCELADO',
              author: cleanAuthor,
              notes: `Pedido Cancelado sem Pagamento. Motivo: ${cleanReason}`,
            },
          ],
        };

        tx.set(orderRef, updatedOrder);
        if (updatedOrder.trackingCode) {
          tx.set(
            db.collection('public_tracking').doc(updatedOrder.trackingCode),
            buildPublicTrackingDocServer(updatedOrder)
          );
        }

        result = {
          status: 200,
          body: {
            success: true,
            order: updatedOrder,
            shift: null,
            movement: null,
            refundInfo: null,
            message: `Pedido ${updatedOrder.orderNumber || orderId} cancelado com sucesso. Como não havia pagamento registrado, nenhuma movimentação financeira foi gerada.`,
          },
        };
        return;
      }

      // Paid order (PAGO): MUST read shifts and perform all checks inside transaction BEFORE any write
      const openShiftsSnap = await tx.get(db.collection('cash_shifts').where('status', '==', 'ABERTO'));
      const reqShiftSnap = requestedShiftId
        ? await tx.get(db.collection('cash_shifts').doc(requestedShiftId))
        : null;
      const saleShiftIdFromOrder = typeof orderData.saleCashShiftId === 'string' ? orderData.saleCashShiftId.trim() : '';
      const saleShiftSnap =
        saleShiftIdFromOrder && saleShiftIdFromOrder !== requestedShiftId
          ? await tx.get(db.collection('cash_shifts').doc(saleShiftIdFromOrder))
          : reqShiftSnap && reqShiftSnap.id === saleShiftIdFromOrder
          ? reqShiftSnap
          : null;

      // Check existing ESTORNO across order & read shifts (strict idempotency)
      const candidateShiftDocs: Array<{ id: string; data: Record<string, any> }> = [];
      for (const d of openShiftsSnap.docs) {
        candidateShiftDocs.push({ id: d.id, data: (d.data() || {}) as Record<string, any> });
      }
      if (saleShiftSnap?.exists && !candidateShiftDocs.some((c) => c.id === saleShiftSnap.id)) {
        candidateShiftDocs.push({ id: saleShiftSnap.id, data: (saleShiftSnap.data() || {}) as Record<string, any> });
      }
      if (reqShiftSnap?.exists && !candidateShiftDocs.some((c) => c.id === reqShiftSnap.id)) {
        candidateShiftDocs.push({ id: reqShiftSnap.id, data: (reqShiftSnap.data() || {}) as Record<string, any> });
      }

      let existingRefundMov: Record<string, any> | null = null;
      let originalSaleMov: Record<string, any> | null = null;
      let originalSaleShiftId: string | undefined = saleShiftIdFromOrder || undefined;

      for (const sEntry of candidateShiftDocs) {
        const movs = Array.isArray(sEntry.data.movements) ? sEntry.data.movements : [];
        if (!existingRefundMov) {
          const foundRef = movs.find(
            (m: any) => m && m.type === 'ESTORNO' && (m.orderId === orderId || m.id === deterministicRefundMovementId)
          );
          if (foundRef) existingRefundMov = foundRef;
        }
        if (!originalSaleMov) {
          const foundSale = movs.find(
            (m: any) => m && m.type === 'VENDA' && (m.orderId === orderId || m.id === deterministicSaleMovementId)
          );
          if (foundSale) {
            originalSaleMov = foundSale;
            originalSaleShiftId = sEntry.id;
          }
        }
      }

      if (orderData.refundInfo || existingRefundMov) {
        result = {
          status: 409,
          body: {
            success: false,
            code: 'REFUND_ALREADY_EXISTS',
            message: 'Este pedido já possui um estorno financeiro registrado anteriormente.',
          },
        };
        return;
      }

      const refundAmount = roundCurrencyServer(Number(orderData.totalAmount) || 0);
      if (refundAmount <= 0) {
        result = {
          status: 400,
          body: {
            success: false,
            code: 'INVALID_ORDER_AMOUNT',
            message: 'Valor total do pedido inválido para estorno financeiro.',
          },
        };
        return;
      }

      // Validate explicit requestedShiftId if supplied (never modify FECHADO shift)
      if (requestedShiftId) {
        if (!reqShiftSnap || !reqShiftSnap.exists) {
          result = {
            status: 409,
            body: {
              success: false,
              code: 'NO_OPEN_SHIFT',
              message: `Turno de caixa '${requestedShiftId}' não encontrado para registrar o estorno.`,
            },
          };
          return;
        }
        const reqData = (reqShiftSnap.data() || {}) as Record<string, any>;
        if (reqData.status !== 'ABERTO') {
          result = {
            status: 409,
            body: {
              success: false,
              code: 'SHIFT_ALREADY_CLOSED',
              message: `Operação recusada: O turno de caixa '${requestedShiftId}' está FECHADO. Abra um turno ativo antes de estornar este pedido.`,
            },
          };
          return;
        }
      }

      if (openShiftsSnap.empty) {
        result = {
          status: 409,
          body: {
            success: false,
            code: 'NO_OPEN_SHIFT',
            message:
              'Nenhum turno de caixa aberto encontrado no servidor. Abra um caixa antes de cancelar um pedido já pago para garantir o registro do estorno.',
          },
        };
        return;
      }

      if (openShiftsSnap.docs.length > 1) {
        result = {
          status: 409,
          body: {
            success: false,
            code: 'MULTIPLE_OPEN_SHIFTS',
            message: `Inconsistência operacional: existem ${openShiftsSnap.docs.length} turnos de caixa ABERTO simultaneamente no servidor.`,
          },
        };
        return;
      }

      const targetShiftSnap = openShiftsSnap.docs[0];
      if (requestedShiftId && targetShiftSnap.id !== requestedShiftId) {
        result = {
          status: 409,
          body: {
            success: false,
            code: 'SHIFT_MISMATCH',
            message: `O turno informado ('${requestedShiftId}') não corresponde ao único turno ABERTO ('${targetShiftSnap.id}').`,
          },
        };
        return;
      }

      const targetShiftData = (targetShiftSnap.data() || {}) as Record<string, any>;
      const existingMovements = Array.isArray(targetShiftData.movements) ? [...targetShiftData.movements] : [];

      const originalPaymentMethod = allowedMethods.includes(String(orderData.paymentMethod))
        ? String(orderData.paymentMethod)
        : 'PIX';
      const refundPaymentMethod =
        refundPaymentMethodOverride && allowedMethods.includes(refundPaymentMethodOverride)
          ? refundPaymentMethodOverride
          : originalPaymentMethod;

      const resolvedOriginalShiftId = originalSaleShiftId || targetShiftSnap.id;
      const resolvedOriginalMovementId =
        (originalSaleMov?.id as string | undefined) ||
        (typeof orderData.saleMovementId === 'string' ? orderData.saleMovementId : undefined);

      const estornoMovement: Record<string, any> = {
        id: deterministicRefundMovementId,
        timestamp: now,
        type: 'ESTORNO',
        amount: refundAmount,
        paymentMethod: refundPaymentMethod,
        description: `Estorno/Devolução Pedido ${String(orderData.orderNumber || '')} (${refundPaymentMethod}) - ${String(orderData.customer?.name || 'Cliente')}`
          .trim()
          .slice(0, 300),
        author: cleanAuthor,
        orderId,
        orderNumber: String(orderData.orderNumber || '#0000').slice(0, 32),
        refundReason: cleanReason.slice(0, 300),
        originalShiftId: resolvedOriginalShiftId,
        ...(resolvedOriginalMovementId ? { originalMovementId: resolvedOriginalMovementId } : {}),
      };

      const refundInfo: Record<string, any> = {
        id: `ref-${orderId}`,
        orderId,
        orderNumber: String(orderData.orderNumber || '#0000').slice(0, 32),
        originalAmount: refundAmount,
        refundAmount,
        originalPaymentMethod,
        refundPaymentMethod,
        timestamp: now,
        reason: cleanReason,
        author: cleanAuthor,
        cashMovementId: estornoMovement.id,
        targetShiftId: targetShiftSnap.id,
        status: 'CONCLUIDO',
      };

      const updatedOrder: Record<string, any> = {
        ...orderData,
        status: 'CANCELADO',
        cancellationReason: cleanReason,
        cancelledBy: cleanAuthor,
        cancelledAt: now,
        updatedAt: now,
        refundInfo,
        movements: [
          ...prevOrderMovements,
          {
            id: `mov-cancel-${orderId}`,
            timestamp: now,
            fromStatus: orderData.status,
            toStatus: 'CANCELADO',
            author: cleanAuthor,
            notes: `Venda Cancelada com Devolução Integral (${refundPaymentMethod}: R$ ${refundAmount.toFixed(2)}). Motivo: ${cleanReason}`,
          },
        ],
      };

      const nextShiftMovements = [...existingMovements, estornoMovement];

      tx.set(orderRef, updatedOrder);
      if (updatedOrder.trackingCode) {
        tx.set(
          db.collection('public_tracking').doc(updatedOrder.trackingCode),
          buildPublicTrackingDocServer(updatedOrder)
        );
      }
      tx.update(targetShiftSnap.ref, { movements: nextShiftMovements });

      const updatedShift = { ...targetShiftData, id: targetShiftSnap.id, movements: nextShiftMovements };
      result = {
        status: 200,
        body: {
          success: true,
          order: updatedOrder,
          shift: updatedShift,
          movement: estornoMovement,
          refundInfo,
          message:
            refundPaymentMethod === 'DINHEIRO'
              ? `Pedido ${updatedOrder.orderNumber} cancelado e estorno integral de R$ ${refundAmount.toFixed(2)} debitado do caixa aberto atomicamente.`
              : `Pedido ${updatedOrder.orderNumber} cancelado e estorno (${refundPaymentMethod}) de R$ ${refundAmount.toFixed(2)} registrado no caixa atomicamente.`,
        },
      };
    });

    return result;
  }

  app.post(['/api/orders/:id/cancel', '/orders/:id/cancel'], async (req: Request, res: Response) => {
    try {
      const auth = await verifyStaffAuth(req);
      if (!auth.isStaff || !['ADMINISTRADOR', 'GERENTE'].includes(auth.role.toUpperCase())) {
        res.status(403).json({
          success: false,
          message: 'Permissão insuficiente: apenas Administrador ou Gerente podem cancelar pedidos e autorizar estornos.',
        });
        return;
      }

      if (!adminDb) {
        res.status(503).json({
          success: false,
          code: 'ADMIN_SDK_UNAVAILABLE',
          message:
            'Cancelamento bloqueado: Firebase Admin SDK não está configurado no servidor para garantir atomicidade entre pedido e estorno no caixa.',
        });
        return;
      }

      const orderId = String(req.params.id || '').trim();
      if (!orderId || !/^[a-zA-Z0-9_\-]+$/.test(orderId) || orderId.length > 128) {
        res.status(400).json({ success: false, message: 'Identificador de pedido inválido.' });
        return;
      }

      const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
      if (!reason || reason.length < 3) {
        res.status(400).json({
          success: false,
          message: 'O motivo do cancelamento é obrigatório e deve ter pelo menos 3 caracteres.',
        });
        return;
      }

      const requestedShiftId = typeof req.body?.shiftId === 'string' ? req.body.shiftId.trim() : '';
      if (requestedShiftId && (!/^[a-zA-Z0-9_\-]+$/.test(requestedShiftId) || requestedShiftId.length > 128)) {
        res.status(400).json({ success: false, message: 'Identificador do turno de caixa inválido.' });
        return;
      }

      const tombstones = await getOrderTombstonesServer(auth.token);
      if (serverDeletedOrderIds.has(orderId) || tombstones.includes(orderId)) {
        res.status(410).json({
          success: false,
          deleted: true,
          message: 'Este pedido foi excluído definitivamente em outro dispositivo.',
        });
        return;
      }

      const cancelledBy = String(req.body?.cancelledBy || auth.email || auth.role).trim() || auth.role;
      const refundPaymentMethodOverride =
        typeof req.body?.refundPaymentMethodOverride === 'string'
          ? req.body.refundPaymentMethodOverride.trim().toUpperCase()
          : undefined;

      const outcome = await executeAtomicOrderCancellationServer({
        db: adminDb,
        orderId,
        reason,
        cancelledBy,
        refundPaymentMethodOverride,
        requestedShiftId: requestedShiftId || undefined,
      });

      res.status(outcome.status).json(outcome.body);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, message: `Erro na transação atômica de cancelamento: ${msg}` });
    }
  });

  app.get(['/api/orders/:id/cancel-state', '/orders/:id/cancel-state'], async (req: Request, res: Response) => {
    try {
      const auth = await verifyStaffAuth(req);
      if (!auth.isStaff || !['ADMINISTRADOR', 'GERENTE'].includes(auth.role.toUpperCase())) {
        res.status(403).json({ success: false, message: 'Permissão insuficiente para consultar estado de cancelamento.' });
        return;
      }

      if (!adminDb) {
        res.status(503).json({
          success: false,
          code: 'ADMIN_SDK_UNAVAILABLE',
          message: 'Consulta atômica indisponível: Firebase Admin SDK não configurado no servidor.',
        });
        return;
      }

      const orderId = String(req.params.id || '').trim();
      if (!orderId || !/^[a-zA-Z0-9_\-]+$/.test(orderId) || orderId.length > 128) {
        res.status(400).json({ success: false, message: 'Identificador de pedido inválido.' });
        return;
      }

      const orderSnap = await adminDb.collection('orders').doc(orderId).get();
      if (!orderSnap.exists) {
        res.json({ success: true, exists: false, cancelled: false, refundRecorded: false });
        return;
      }

      const orderData = (orderSnap.data() || {}) as Record<string, any>;
      const deterministicRefundId = `cash-estorno-${orderId}`;
      let matchedShift: Record<string, any> | null = null;
      let matchedMovement: Record<string, any> | null = null;

      const openShiftsSnap = await adminDb.collection('cash_shifts').where('status', '==', 'ABERTO').get();
      for (const sDoc of openShiftsSnap.docs) {
        const sData = sDoc.data() as Record<string, any>;
        const movs = Array.isArray(sData?.movements) ? sData.movements : [];
        const found = movs.find(
          (m: any) => m && m.type === 'ESTORNO' && (m.orderId === orderId || m.id === deterministicRefundId)
        );
        if (found) {
          matchedShift = { ...sData, id: sDoc.id };
          matchedMovement = found;
          break;
        }
      }

      const targetRefundShiftId = typeof orderData.refundInfo?.targetShiftId === 'string' ? orderData.refundInfo.targetShiftId : '';
      if (!matchedMovement && targetRefundShiftId) {
        const targetSnap = await adminDb.collection('cash_shifts').doc(targetRefundShiftId).get();
        if (targetSnap.exists) {
          const sData = targetSnap.data() as Record<string, any>;
          const movs = Array.isArray(sData?.movements) ? sData.movements : [];
          const found = movs.find(
            (m: any) => m && m.type === 'ESTORNO' && (m.orderId === orderId || m.id === deterministicRefundId)
          );
          if (found) {
            matchedShift = { ...sData, id: targetSnap.id };
            matchedMovement = found;
          }
        }
      }

      res.json({
        success: true,
        exists: true,
        cancelled: orderData.status === 'CANCELADO',
        status: orderData.status || null,
        paymentStatus: orderData.paymentStatus || null,
        refundRecorded: Boolean(matchedMovement),
        refundInfo: orderData.refundInfo || null,
        order: orderData,
        shift: matchedShift,
        movement: matchedMovement,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, message: `Erro ao consultar estado de cancelamento: ${msg}` });
    }
  });

  // Fallback for unhandled API endpoints: returns guaranteed JSON 404
  app.all(['/api/*', '/push/*', '/orders/*', '/auth/*'], (_req: Request, res: Response) => {
    res.status(404).json({ success: false, message: 'Rota de API não encontrada no servidor.' });
  });

  // Global Express Error Middleware: Guarantees valid JSON on unexpected errors instead of empty or HTML pages
  app.use((err: unknown, _req: Request, res: Response, _next: express.NextFunction) => {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('[API Error]:', errMsg);
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: `Erro interno no servidor: ${errMsg}` });
    }
  });

  export default app;
