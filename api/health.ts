import type { Request, Response } from 'express';
import app from '../server.ts';

// Vercel Serverless Function entry point for /api/health
// Delegates directly to the shared Express application so health checks reflect
// the exact same Firebase Admin/Client SDK initialization and validation state
// without creating duplicate or conflicting SDK instances.
export default function handler(req: Request, res: Response) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.statusCode = 200;
    res.end();
    return;
  }

  const rawUrl = req.url || '/api/health';
  const queryIndex = rawUrl.indexOf('?');
  const querySuffix = queryIndex >= 0 ? rawUrl.slice(queryIndex) : '';
  const pathname = queryIndex >= 0 ? rawUrl.slice(0, queryIndex) : rawUrl;

  if (pathname !== '/api/health' && pathname !== '/health') {
    req.url = `/api/health${querySuffix}`;
  }

  return app(req, res);
}

