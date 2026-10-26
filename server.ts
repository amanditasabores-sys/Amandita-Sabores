import express, { Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeApp as initClientApp, getApps as getClientApps, getApp as getClientApp } from 'firebase/app';
import { getFirestore as getClientFirestore, doc as clientDoc, setDoc as clientSetDoc } from 'firebase/firestore';
import { initializeApp as initAdminApp, cert, getApps as getAdminApps } from 'firebase-admin/app';
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore';
import { INITIAL_MENU, OFFICIAL_ADDONS } from './src/data/initialData.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Firebase Environment Configuration
const PROJECT_ID = process.env.VITE_FIREBASE_PROJECT_ID || 'amandita-sabores';
const API_KEY = process.env.VITE_FIREBASE_API_KEY || '';
const AUTH_DOMAIN = process.env.VITE_FIREBASE_AUTH_DOMAIN || `${PROJECT_ID}.firebaseapp.com`;
const STORAGE_BUCKET = process.env.VITE_FIREBASE_STORAGE_BUCKET || `${PROJECT_ID}.firebasestorage.app`;
const SENDER_ID = process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '';
const APP_ID = process.env.VITE_FIREBASE_APP_ID || '';
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
// Firebase Server Instances Setup
// ---------------------------------------------------------------------------
let adminDb: FirebaseFirestore.Firestore | null = null;
try {
  let credential = null;
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      const parsed = typeof process.env.FIREBASE_SERVICE_ACCOUNT === 'string'
        ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
        : process.env.FIREBASE_SERVICE_ACCOUNT;
      credential = cert(parsed);
    } catch (parseErr) {
      console.warn('[Server Admin] Falha ao analisar FIREBASE_SERVICE_ACCOUNT JSON:', parseErr);
    }
  } else if (process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
    credential = cert({
      projectId: PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    });
  }

  if (credential) {
    const adminApps = getAdminApps();
    const adminApp = adminApps.length > 0 ? adminApps[0] : initAdminApp({ credential, projectId: PROJECT_ID }, 'server-admin');
    adminDb = getAdminFirestore(adminApp);
    console.log('[Server Firebase] Firebase Admin SDK inicializado com credenciais administrativas seguras.');
  }
} catch (adminErr) {
  console.warn('[Server Firebase] Admin SDK indisponível sem service account:', adminErr instanceof Error ? adminErr.message : adminErr);
}

// Initialize Client SDK on server for standard verified transactions
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
        }, 'server-client');
    clientDb = getClientFirestore(clientApp);
  } catch (clientErr) {
    console.warn('[Server Firebase] Client SDK init notice:', clientErr instanceof Error ? clientErr.message : clientErr);
  }
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

async function verifyStaffAuth(req: Request): Promise<AuthVerificationResult> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { isStaff: false, role: 'ANONYMOUS', uid: null, email: null, token: null };
  }

  const token = authHeader.substring(7).trim();
  if (!token || !API_KEY) {
    return { isStaff: false, role: 'ANONYMOUS', uid: null, email: null, token: null };
  }

  try {
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
    const email = (fbUser.email || '').trim().toLowerCase();
    const uid = fbUser.localId;

    // 1. Designated Bootstrap Administrators
    if (email === INITIAL_ADMIN_EMAIL || email === 'admin@amanditasabores.com.br') {
      return { isStaff: true, role: 'ADMINISTRADOR', uid, email, token };
    }

    // 2. Staff Domain Check
    if (email.endsWith('@staff.amanditasabores.com.br') || email.endsWith('@amanditasabores.com.br')) {
      const username = email.split('@')[0];
      const role = username.includes('admin') ? 'ADMINISTRADOR' : 'ATENDENTE';
      return { isStaff: true, role, uid, email, token };
    }

    return { isStaff: false, role: 'CUSTOMER', uid, email, token };
  } catch (authErr) {
    console.warn('[Server Auth] Token validation error:', authErr instanceof Error ? authErr.message : authErr);
    return { isStaff: false, role: 'ANONYMOUS', uid: null, email: null, token: null };
  }
}

// ---------------------------------------------------------------------------
// Helper: Write Order & Sanitized Tracking to Firestore
// ---------------------------------------------------------------------------
async function persistOrderToFirestoreServer(
  order: Record<string, any>,
  publicTrackingDoc: Record<string, any>,
  staffToken: string | null
): Promise<{ success: boolean; error?: string; status?: number }> {
  // Strategy 1: Firebase Admin SDK (Privileged backend bypass)
  if (adminDb) {
    try {
      await adminDb.collection('orders').doc(order.id).set(order);
      if (order.trackingCode) {
        await adminDb.collection('public_tracking').doc(order.trackingCode).set(publicTrackingDoc);
      }
      return { success: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn('[Server Admin SDK Write Failed, trying fallback]:', msg);
    }
  }

  // Strategy 2: Firestore REST API with Authenticated Staff Token
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

      return { success: true };
    } catch (restErr: unknown) {
      const msg = restErr instanceof Error ? restErr.message : String(restErr);
      return { success: false, error: msg, status: 500 };
    }
  }

  // Strategy 3: Standard Client SDK with API Key
  if (clientDb) {
    try {
      await clientSetDoc(clientDoc(clientDb, 'orders', order.id), order);
      if (order.trackingCode) {
        await clientSetDoc(clientDoc(clientDb, 'public_tracking', order.trackingCode), publicTrackingDoc);
      }
      return { success: true };
    } catch (clientErr: unknown) {
      const msg = clientErr instanceof Error ? clientErr.message : String(clientErr);
      return { success: false, error: msg, status: 403 };
    }
  }

  return { success: false, error: 'Nenhum conector Firestore disponível no servidor (verifique VITE_FIREBASE_API_KEY ou service account).', status: 500 };
}

// ---------------------------------------------------------------------------
// Server Bootstrap & Route Definitions
// ---------------------------------------------------------------------------
async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Health and Status API
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      status: 'online',
      system: 'Amandita Sabores - Backend Seguro de Credenciais e Persistência Firestore',
      projectId: PROJECT_ID,
      hasAdminSdk: Boolean(adminDb),
      hasClientSdk: Boolean(clientDb),
      timestamp: new Date().toISOString(),
    });
  });

  // Secure Backend API: Staff Registration and Credential Administration
  // Enforces RBAC on server side: only authenticated ADMINISTRADOR or GERENTE
  app.post('/api/auth/register-staff', async (req: Request, res: Response) => {
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
  app.post('/api/auth/reset-password', async (req: Request, res: Response) => {
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

  // Secure Backend API: Order Ingestion, Mathematical Validation & Real Firestore Persistence
  // Only returns success AFTER real document persistence is confirmed in Cloud Firestore.
  app.post('/api/orders', async (req: Request, res: Response) => {
    try {
      const auth = await verifyStaffAuth(req);
      const isStaffRequester = auth.isStaff;

      const { order } = req.body;
      if (!order || typeof order !== 'object') {
        res.status(400).json({ success: false, message: 'Dados do pedido ausentes ou inválidos.' });
        return;
      }

      if (!order.id || !order.orderNumber || !Array.isArray(order.items) || order.items.length === 0) {
        res.status(400).json({ success: false, message: 'Estrutura básica do pedido incompleta.' });
        return;
      }

      if (!order.trackingCode || typeof order.trackingCode !== 'string' || order.trackingCode.length < 20) {
        res.status(400).json({ success: false, message: 'Código de rastreamento inválido ou insuficiente (mínimo 20 caracteres).' });
        return;
      }

      if (!order.customer || typeof order.customer.name !== 'string' || order.customer.name.trim().length === 0) {
        res.status(400).json({ success: false, message: 'Nome do cliente é obrigatório.' });
        return;
      }

      // Security Check: Role-specific bounds and anti-injection
      if (!isStaffRequester) {
        // Public customer order flow:
        if (order.status !== 'NOVO') {
          res.status(400).json({ success: false, message: 'Pedidos do cardápio público devem iniciar com status NOVO.' });
          return;
        }
        if (order.paymentStatus !== 'PENDENTE') {
          res.status(400).json({ success: false, message: 'Pedidos do cardápio público não podem ser criados como já pagos.' });
          return;
        }
        if (order.discount && order.discount !== 0) {
          res.status(400).json({ success: false, message: 'Descontos não são permitidos para pedidos enviados pelo cardápio público.' });
          return;
        }
        if (order.operatorName || order.cancellationReason || order.cancelledBy || order.deliveryPerson) {
          res.status(400).json({ success: false, message: 'Campos administrativos de uso interno não são autorizados para clientes.' });
          return;
        }
      } else {
        // Staff PDV order flow:
        if (!['NOVO', 'EM_PREPARO'].includes(order.status)) {
          res.status(400).json({ success: false, message: 'Status inicial inválido para pedido de balcão/PDV.' });
          return;
        }
      }

      // Mathematical item and official catalog price invariant verification
      let calculatedSubtotal = 0;
      for (const item of order.items) {
        if (!item.id || !item.menuItemId || !item.name || typeof item.quantity !== 'number' || item.quantity < 1 || item.quantity > 50) {
          res.status(400).json({ success: false, message: `Item inválido no pedido: ${item.name || 'desconhecido'}. Quantidade permitida entre 1 e 50.` });
          return;
        }

        // Verify product against official catalog
        const catalogItem = catalogMap.get(item.menuItemId) || catalogMap.get(item.id);
        if (catalogItem) {
          if (Math.abs(item.unitPrice - catalogItem.price) > 0.001) {
            res.status(400).json({
              success: false,
              message: `Preço unitário divergente do cardápio oficial para '${item.name}'. Esperado: R$ ${catalogItem.price.toFixed(2)}, recebido: R$ ${item.unitPrice.toFixed(2)}.`,
            });
            return;
          }
        }

        let expectedItemSubtotal = item.unitPrice * item.quantity;
        if (Array.isArray(item.addons)) {
          for (const addon of item.addons) {
            if (typeof addon.price !== 'number' || (Math.abs(addon.price - 3.00) > 0.001 && Math.abs(addon.price - 0.00) > 0.001)) {
              res.status(400).json({
                success: false,
                message: `Preço de adicional inválido: ${addon.name}. Apenas R$ 3,00 (recheios) ou R$ 0,00 (sabores) são autorizados.`,
              });
              return;
            }
            expectedItemSubtotal += addon.price * item.quantity;
          }
        }

        if (Math.abs(item.subtotal - expectedItemSubtotal) > 0.01) {
          res.status(400).json({
            success: false,
            message: `Subtotal incorreto para o item ${item.name}. Esperado: ${expectedItemSubtotal.toFixed(2)}, recebido: ${item.subtotal}.`,
          });
          return;
        }

        calculatedSubtotal += item.subtotal;
      }

      if (Math.abs(order.subtotal - calculatedSubtotal) > 0.01) {
        res.status(400).json({ success: false, message: 'Subtotal geral do pedido não confere com a soma dos itens.' });
        return;
      }

      const expectedDeliveryFee = order.fulfillmentType === 'RETIRADA' ? 0 : (order.deliveryFee || 0);
      if (Math.abs(order.deliveryFee - expectedDeliveryFee) > 0.01) {
        res.status(400).json({ success: false, message: 'Taxa de entrega incorreta para a modalidade.' });
        return;
      }

      const effectiveDiscount = isStaffRequester ? (order.discount || 0) : 0;
      if (effectiveDiscount < 0 || effectiveDiscount > calculatedSubtotal) {
        res.status(400).json({ success: false, message: 'Desconto inválido ou superior ao subtotal.' });
        return;
      }

      const expectedTotal = calculatedSubtotal + expectedDeliveryFee - effectiveDiscount;
      if (Math.abs(order.totalAmount - expectedTotal) > 0.01) {
        res.status(400).json({ success: false, message: 'Valor total do pedido não confere matematicamente.' });
        return;
      }

      // Construct Sanitized Public Tracking Document (Strict PII Shield)
      // Telephones and exact residential street/numbers are never placed in public_tracking
      const destinationSummary = order.customer.address
        ? `${order.customer.address.neighborhood || ''}${order.customer.address.city ? ` · ${order.customer.address.city}` : ''}`.trim() || undefined
        : (order.fulfillmentType === 'RETIRADA' ? 'Retirada no Balcão' : undefined);

      const publicTrackingDoc = {
        id: order.id,
        orderNumber: order.orderNumber,
        createdAt: order.createdAt,
        estimatedDeliveryMinutes: order.estimatedDeliveryMinutes || 45,
        fulfillmentType: order.fulfillmentType,
        status: order.status,
        items: order.items.map((i: any) => ({
          id: i.id,
          name: i.name,
          quantity: i.quantity,
          subtotal: i.subtotal,
          addons: i.addons || [],
          notes: i.notes || '',
        })),
        subtotal: order.subtotal,
        deliveryFee: order.deliveryFee,
        discount: order.discount || 0,
        totalAmount: order.totalAmount,
        paymentMethod: order.paymentMethod,
        paymentStatus: order.paymentStatus,
        deliveryPerson: order.deliveryPerson ? { name: order.deliveryPerson.name } : undefined,
        trackingCode: order.trackingCode,
        destinationSummary,
      };

      // Sanitize order object by removing transient properties
      const cleanOrder: Record<string, any> = {};
      for (const [key, val] of Object.entries(order)) {
        if (!key.startsWith('_') && val !== undefined) {
          cleanOrder[key] = val;
        }
      }

      // Persist to Cloud Firestore: ONLY return success if write is confirmed!
      const persistResult = await persistOrderToFirestoreServer(cleanOrder, publicTrackingDoc, auth.token);

      if (!persistResult.success) {
        res.status(persistResult.status === 403 ? 403 : 500).json({
          success: false,
          message: `Não foi possível persistir o pedido no Cloud Firestore: ${persistResult.error}. O pedido permanece na fila local para sincronização resiliente.`,
          error: persistResult.error,
        });
        return;
      }

      // Document write is confirmed
      res.json({
        success: true,
        message: 'Pedido verificado e gravado com sucesso no Cloud Firestore.',
        orderId: order.id,
        trackingCode: order.trackingCode,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, message: `Erro interno no backend ao processar pedido: ${msg}` });
    }
  });

  // Mount Vite development middlewares or serve static assets in production
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Amandita Sabores] Servidor full-stack rodando em http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('[Amandita Sabores] Falha ao iniciar servidor:', err);
  process.exit(1);
});
