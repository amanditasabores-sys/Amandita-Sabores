import { sendOrderPushNotification } from '../../src/server/pushBackendService.ts';
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
    const data = await readJsonBody(req);
    const { order, event = 'NEW_ORDER' } = data;

    if (!order || !order.id) {
      return sendJson(res, 400, { success: false, message: 'Pedido ausente ou sem identificador.' });
    }

    const eventType = event === 'DELIVERY_CONFIRMED' ? 'DELIVERY_CONFIRMED' : 'NEW_ORDER';

    // CRITICAL for Vercel Serverless: Await push dispatch before sending HTTP response
    // Otherwise Vercel terminates the Lambda container immediately, killing pending HTTP push requests.
    const result = await sendOrderPushNotification(order, eventType);

    const eventLabel = eventType === 'DELIVERY_CONFIRMED' ? 'entrega concluída' : 'novo pedido';
    return sendJson(res, 200, {
      success: true,
      message: `Notificação push de ${eventLabel} processada com sucesso. Entregas confirmadas: ${result.sent}/${result.total}.`,
      stats: result,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return sendJson(res, 500, { success: false, message: msg });
  }
}
