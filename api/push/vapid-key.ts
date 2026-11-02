import { getVapidConfig, sendJson } from '../../src/server/pushConfig.ts';

export default function handler(req: any, res: any) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 200;
    res.end();
    return;
  }

  try {
    const config = getVapidConfig();
    return sendJson(res, 200, {
      publicKey: config.publicKey,
      isConfigured: config.isConfigured,
      isProductionActive: config.isProductionActive,
      statusMessage: config.statusMessage,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return sendJson(res, 500, {
      publicKey: '',
      isConfigured: false,
      isProductionActive: false,
      statusMessage: `Erro ao obter VAPID key: ${msg}`,
    });
  }
}
