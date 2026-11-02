import { sendTestPushNotification } from '../../src/server/pushBackendService.ts';
import { sendJson } from '../../src/server/pushConfig.ts';

export default async function handler(req: any, res: any) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 200;
    res.end();
    return;
  }

  try {
    const result = await sendTestPushNotification();
    return sendJson(res, 200, {
      success: true,
      message: result.sent > 0
        ? `Notificação de teste enviada com sucesso para ${result.sent} dispositivo(s)!`
        : 'Nenhum dispositivo com notificação push registrado no momento.',
      sent: result.sent,
      failed: result.failed,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return sendJson(res, 500, {
      success: false,
      message: `Erro interno ao enviar notificação de teste: ${msg}`,
    });
  }
}
