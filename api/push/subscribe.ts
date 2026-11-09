import { savePushSubscription } from '../../src/server/pushBackendService.ts';
import { sendJson } from '../../src/server/pushConfig.ts';

function readJsonBody(req: any): Promise<any> {
  if (req.body && typeof req.body === 'object') {
    return Promise.resolve(req.body);
  }
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: any) => {
      body += chunk;
    });
    req.on('end', () => {
      if (!body.trim()) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

export default async function handler(req: any, res: any) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 200;
    res.end();
    return;
  }

  try {
    const authHeader = req.headers?.authorization || req.headers?.Authorization || '';
    const staffToken = authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : undefined;

    const data = await readJsonBody(req);
    const { subscription, role, userAgent } = data;

    if (!subscription || !subscription.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) {
      return sendJson(res, 400, { success: false, message: 'Assinatura Push incompleta ou inválida.' });
    }

    await savePushSubscription({
      subscription,
      role: role || 'staff',
      userAgent,
      subscribedAt: new Date().toISOString(),
    }, staffToken);

    return sendJson(res, 200, {
      success: true,
      message: 'Dispositivo registrado com sucesso no Firestore para notificações em segundo plano.',
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return sendJson(res, 500, { success: false, message: msg });
  }
}
