import type { IncomingMessage, ServerResponse } from 'http';
import { getFirebaseServerInstances } from '../src/server/firebaseAdmin.ts';

// Vercel Serverless Function entry point for /api/health
// Uses the lightweight shared Firebase module (independent of the full Express bundle)
// to report real Admin/Client SDK initialization status without exposing credentials.
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
    const firebase = getFirebaseServerInstances();
    res.statusCode = 200;
    res.end(
      JSON.stringify({
        status: 'online',
        system: 'Amandita Sabores - Diagnóstico Serverless e Persistência Firestore',
        projectId: firebase.projectId,
        hasAdminSdk: firebase.hasAdminSdk,
        hasClientSdk: firebase.hasClientSdk,
        timestamp: new Date().toISOString(),
      })
    );
  } catch (err: unknown) {
    const safeMsg = err instanceof Error ? err.name : 'HealthCheckError';
    res.statusCode = 500;
    res.end(
      JSON.stringify({
        status: 'error',
        hasAdminSdk: false,
        hasClientSdk: false,
        error: safeMsg,
        timestamp: new Date().toISOString(),
      })
    );
  }
}
