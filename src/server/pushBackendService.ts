import webpush from 'web-push';
import crypto from 'crypto';
import { initializeApp as initClientApp, getApps as getClientApps, getApp as getClientApp } from 'firebase/app';
import { 
  getFirestore as getClientFirestore, 
  doc as clientDoc, 
  setDoc as clientSetDoc, 
  getDocs as clientGetDocs, 
  collection as clientCollection, 
  deleteDoc as clientDeleteDoc 
} from 'firebase/firestore';
import { initializeApp as initAdminApp, cert, getApps as getAdminApps } from 'firebase-admin/app';
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore';
import { getVapidConfig } from './pushConfig.ts';

const PROJECT_ID = process.env.VITE_FIREBASE_PROJECT_ID || 'amandita-sabores';
const API_KEY = process.env.VITE_FIREBASE_API_KEY || '';
const AUTH_DOMAIN = process.env.VITE_FIREBASE_AUTH_DOMAIN || `${PROJECT_ID}.firebaseapp.com`;
const STORAGE_BUCKET = process.env.VITE_FIREBASE_STORAGE_BUCKET || `${PROJECT_ID}.firebasestorage.app`;
const SENDER_ID = process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '';
const APP_ID = process.env.VITE_FIREBASE_APP_ID || '';

// Initialize Firebase Admin if credentials are present
let adminDb: FirebaseFirestore.Firestore | null = null;
try {
  let credential = null;
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      const parsed = typeof process.env.FIREBASE_SERVICE_ACCOUNT === 'string'
        ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
        : process.env.FIREBASE_SERVICE_ACCOUNT;
      credential = cert(parsed);
    } catch {}
  } else if (process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
    credential = cert({
      projectId: PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    });
  }

  if (credential) {
    const adminApps = getAdminApps();
    const adminApp = adminApps.length > 0 ? adminApps[0] : initAdminApp({ credential, projectId: PROJECT_ID }, 'server-push-admin');
    adminDb = getAdminFirestore(adminApp);
  }
} catch {}

// Initialize Firebase Client SDK
let clientDb: ReturnType<typeof getClientFirestore> | null = null;
if (API_KEY) {
  try {
    const existingApps = getClientApps();
    const clientApp = existingApps.length > 0
      ? getClientApp()
      : initClientApp({
          apiKey: API_KEY,
          authDomain: AUTH_DOMAIN,
          projectId: PROJECT_ID,
          storageBucket: STORAGE_BUCKET,
          messagingSenderId: SENDER_ID,
          appId: APP_ID,
        }, 'server-push-client');
    clientDb = getClientFirestore(clientApp);
  } catch {}
}

export interface PushSubscriptionData {
  subscription: webpush.PushSubscription;
  role?: string;
  userAgent?: string;
  subscribedAt: string;
}

const activePushSubscriptions: Map<string, PushSubscriptionData> = new Map();

function toFirestoreValue(val: unknown): Record<string, unknown> {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'string') return { stringValue: val };
  if (typeof val === 'boolean') return { booleanValue: val };
  if (typeof val === 'number') {
    if (Number.isInteger(val)) return { integerValue: String(val) };
    return { doubleValue: val };
  }
  if (Array.isArray(val)) {
    return { arrayValue: { values: val.map(toFirestoreValue) } };
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

// In-memory cache for idempotency deduplication across calls in the same container
const pushDispatchesCache = new Set<string>();

export async function isPushAlreadyDispatched(key: string): Promise<boolean> {
  if (pushDispatchesCache.has(key)) return true;

  if (adminDb) {
    try {
      const snap = await adminDb.collection('push_dispatches').doc(key).get();
      if (snap.exists) {
        pushDispatchesCache.add(key);
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
        return true;
      }
    } catch {}
  }

  return false;
}

export async function markPushDispatched(key: string, orderId: string, event: string): Promise<void> {
  pushDispatchesCache.add(key);

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

export async function savePushSubscription(subData: PushSubscriptionData, staffToken?: string): Promise<boolean> {
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

  activePushSubscriptions.set(endpoint, subData);

  // Strategy 1: Firebase Admin SDK (Privileged backend bypass)
  if (adminDb) {
    try {
      await adminDb.collection('push_subscriptions').doc(endpointHash).set(record);
      return true;
    } catch {}
  }

  // Strategy 2: Authenticated Staff Bearer Token via Firestore REST
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
    } catch {}
  }

  // Strategy 3: Client SDK
  if (clientDb) {
    try {
      await clientSetDoc(clientDoc(clientDb, 'push_subscriptions', endpointHash), record);
      return true;
    } catch {}
  }

  // Strategy 4: Firestore REST API with API Key
  if (API_KEY) {
    try {
      const baseUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
      const docPayload = jsonToFirestoreDocument(record);
      const res = await fetch(`${baseUrl}/push_subscriptions/${endpointHash}?key=${API_KEY}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(docPayload),
      });
      return res.ok;
    } catch {}
  }

  return true;
}

export async function getAllPushSubscriptions(): Promise<PushSubscriptionData[]> {
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
    } catch {}
  }

  // Strategy 2: Client SDK
  if (clientDb) {
    try {
      const snap = await clientGetDocs(clientCollection(clientDb, 'push_subscriptions'));
      snap.forEach((docSnap) => {
        const d = docSnap.data();
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
    } catch {}
  }

  // Strategy 3: Firestore REST API
  if (API_KEY) {
    try {
      const baseUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/push_subscriptions?key=${API_KEY}`;
      const res = await fetch(baseUrl);
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
      }
    } catch {}
  }

  // Strategy 4: Local memory cache
  for (const [endpoint, sub] of activePushSubscriptions.entries()) {
    if (!seenEndpoints.has(endpoint)) {
      results.push(sub);
    }
  }

  return results;
}

export async function deletePushSubscription(endpoint: string): Promise<void> {
  activePushSubscriptions.delete(endpoint);
  const endpointHash = crypto.createHash('sha256').update(endpoint).digest('hex');
  if (adminDb) {
    try {
      await adminDb.collection('push_subscriptions').doc(endpointHash).delete();
      return;
    } catch {}
  }
  if (clientDb) {
    try {
      await clientDeleteDoc(clientDoc(clientDb, 'push_subscriptions', endpointHash));
      return;
    } catch {}
  }
  if (API_KEY) {
    try {
      const baseUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/push_subscriptions/${endpointHash}?key=${API_KEY}`;
      await fetch(baseUrl, { method: 'DELETE' });
    } catch {}
  }
}

export async function sendTestPushNotification(): Promise<{ sent: number; failed: number }> {
  getVapidConfig(); // Ensure webpush is configured
  const subscriptions = await getAllPushSubscriptions();
  if (subscriptions.length === 0) {
    return { sent: 0, failed: 0 };
  }

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
  };

  let sent = 0;
  let failed = 0;
  const deadEndpoints: string[] = [];

  for (const subData of subscriptions) {
    try {
      await webpush.sendNotification(subData.subscription, payload, pushOptions);
      sent++;
    } catch (err: any) {
      failed++;
      if (err.statusCode === 404 || err.statusCode === 410) {
        deadEndpoints.push(subData.subscription.endpoint);
      }
    }
  }

  for (const endpoint of deadEndpoints) {
    await deletePushSubscription(endpoint);
  }

  return { sent, failed };
}

export async function sendOrderPushNotification(
  order: any,
  event: 'NEW_ORDER' | 'DELIVERY_CONFIRMED' = 'NEW_ORDER'
): Promise<{ sent: number; failed: number; total: number; skipped?: string }> {
  if (!order || !order.id) {
    return { sent: 0, failed: 0, total: 0, skipped: 'invalid_order' };
  }

  // 1. Strictly restrict notifications to ONLY the two authorized business events
  if (event !== 'NEW_ORDER' && event !== 'DELIVERY_CONFIRMED') {
    return { sent: 0, failed: 0, total: 0, skipped: 'unauthorized_event' };
  }

  // 2. Persistent Cross-Instance Idempotency Lock
  const idempotencyKey = `notif_${order.id}_${event}`;
  const alreadySent = await isPushAlreadyDispatched(idempotencyKey);
  if (alreadySent) {
    console.info(`[Web Push Idempotency] Notificação '${event}' para pedido #${order.orderNumber} já enviada. Ignorando duplicata.`);
    return { sent: 0, failed: 0, total: 0, skipped: 'already_sent' };
  }

  // Mark immediately as dispatched to avoid race conditions between parallel workers
  await markPushDispatched(idempotencyKey, order.id, event);

  // 3. Ensure VAPID configuration is initialized
  getVapidConfig();

  // 4. Retrieve subscriptions
  const allSubscriptions = await getAllPushSubscriptions();
  if (allSubscriptions.length === 0) {
    console.info(`[Web Push] Pedido #${order.orderNumber}: Nenhuma inscrição push registrada para alerta.`);
    return { sent: 0, failed: 0, total: 0, skipped: 'no_subscriptions' };
  }

  // STRICT PRIVACY SHIELD: Filter subscriptions exclusively to authorized staff roles
  // Anonymous customer devices that might have subscribed must NEVER receive internal order notifications
  const staffSubscriptions = allSubscriptions.filter((s) => {
    const r = (s.role || '').toUpperCase();
    return ['ADMINISTRADOR', 'GERENTE', 'CAIXA', 'COZINHA', 'ATENDENTE', 'ENTREGADOR', 'STAFF'].includes(r);
  });

  if (staffSubscriptions.length === 0) {
    console.info(`[Web Push] Pedido #${order.orderNumber}: Nenhuma inscrição de funcionário autorizada ativa.`);
    return { sent: 0, failed: 0, total: 0, skipped: 'no_staff_subscriptions' };
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
  let sent = 0;
  let failed = 0;

  // Await each push notification dispatch concurrently
  const sendPromises = staffSubscriptions.map(async (subData) => {
    try {
      await webpush.sendNotification(subData.subscription, payload, pushOptions);
      sent++;
    } catch (err: any) {
      failed++;
      console.warn(`[Web Push] Falha ao enviar para endpoint (${err?.statusCode || 'erro'}):`, err?.message);
      if (err?.statusCode === 404 || err?.statusCode === 410) {
        deadEndpoints.push(subData.subscription.endpoint);
      }
    }
  });

  await Promise.allSettled(sendPromises);

  // Clean up dead subscriptions
  for (const endpoint of deadEndpoints) {
    await deletePushSubscription(endpoint);
  }

  console.info(`[Web Push] Resumo de envio pedido #${order.orderNumber} (${event}): ${sent}/${staffSubscriptions.length} entregas confirmadas.`);

  return {
    sent,
    failed,
    total: staffSubscriptions.length,
  };
}
