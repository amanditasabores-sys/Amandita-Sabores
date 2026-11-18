import type { IncomingMessage, ServerResponse } from 'http';
import { getFirebaseAdminInstances, getFirebaseClientConfigStatus } from '../src/server/firebaseAdmin';

// Standalone Vercel Serverless Function for /api/health
// Strictly independent of server.ts, Express, Vite, and Firebase Client SDK.
export default function handler(req: IncomingMessage, res: ServerResponse) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.statusCode = 200;
    res.end();
    return;
  }

  try {
    const admin = getFirebaseAdminInstances();
    const clientConfig = getFirebaseClientConfigStatus(admin.projectId);

    // Report real configuration/initialization errors without leaking credentials or secrets
    if (admin.adminError) {
      res.statusCode = 500;
      res.end(
        JSON.stringify({
          status: 'error',
          system: 'Amandita Sabores - Diagnóstico Serverless',
          projectId: admin.projectId,
          hasAdminSdk: false,
          adminSdkInitialized: false,
          adminSdkConfigured: admin.adminConfigured,
          hasClientSdk: false,
          clientSdkInitialized: false,
          clientConfigured: clientConfig.configured,
          clientConfig: {
            configured: clientConfig.configured,
            hasApiKey: clientConfig.hasApiKey,
            hasAppId: clientConfig.hasAppId,
            hasAuthDomain: clientConfig.hasAuthDomain,
            hasStorageBucket: clientConfig.hasStorageBucket,
            hasMessagingSenderId: clientConfig.hasMessagingSenderId,
          },
          error: 'Falha ao inicializar Firebase Admin SDK.',
          details: admin.adminError,
          timestamp: new Date().toISOString(),
        })
      );
      return;
    }

    res.statusCode = 200;
    res.end(
      JSON.stringify({
        status: 'online',
        system: 'Amandita Sabores - Diagnóstico Serverless',
        projectId: admin.projectId,
        hasAdminSdk: admin.hasAdminSdk,
        adminSdkInitialized: admin.hasAdminSdk,
        adminSdkConfigured: admin.adminConfigured,
        hasClientSdk: false,
        clientSdkInitialized: false,
        clientConfigured: clientConfig.configured,
        clientConfig: {
          configured: clientConfig.configured,
          hasApiKey: clientConfig.hasApiKey,
          hasAppId: clientConfig.hasAppId,
          hasAuthDomain: clientConfig.hasAuthDomain,
          hasStorageBucket: clientConfig.hasStorageBucket,
          hasMessagingSenderId: clientConfig.hasMessagingSenderId,
        },
        timestamp: new Date().toISOString(),
      })
    );
  } catch (err: unknown) {
    const safeName = err instanceof Error ? err.name : 'HealthCheckError';
    const safeMsg = err instanceof Error ? err.message : 'Erro interno ao verificar saúde do servidor.';
    res.statusCode = 500;
    res.end(
      JSON.stringify({
        status: 'error',
        system: 'Amandita Sabores - Diagnóstico Serverless',
        hasAdminSdk: false,
        adminSdkInitialized: false,
        hasClientSdk: false,
        clientSdkInitialized: false,
        clientConfigured: false,
        error: safeName,
        details: safeMsg,
        timestamp: new Date().toISOString(),
      })
    );
  }
}
