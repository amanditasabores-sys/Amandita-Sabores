import type { Request, Response } from 'express';
import app from '../server.ts';

// Vercel Serverless Function entry point
// Bridges Vercel edge/serverless requests to the Express application
export default function handler(req: Request, res: Response) {
  // Normalize request path if rewritten by Vercel without clobbering real subpaths with bare '/api'
  const originalUrl =
    (req.headers['x-original-url'] as string) ||
    (req.headers['x-forwarded-uri'] as string) ||
    (req.headers['x-vercel-matched-path'] as string) ||
    (req.headers['x-matched-path'] as string);

  if (
    originalUrl &&
    originalUrl.startsWith('/api/') &&
    originalUrl !== '/api/index' &&
    (!req.url || req.url === '/api' || req.url === '/' || req.url.startsWith('/api?'))
  ) {
    req.url = originalUrl;
  }

  try {
    return app(req, res);
  } catch (err: unknown) {
    const safeMsg = err instanceof Error ? err.message : 'Erro interno no gateway da API.';
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ success: false, message: safeMsg }));
    }
  }
}
