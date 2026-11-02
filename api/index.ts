import type { Request, Response } from 'express';
import app from '../server.ts';

// Vercel Serverless Function entry point
// Bridges Vercel edge/serverless requests to the Express application
export default function handler(req: Request, res: Response) {
  // Normalize request path if rewritten by Vercel
  const matchedPath = 
    (req.headers['x-matched-path'] as string) || 
    (req.headers['x-vercel-matched-path'] as string) || 
    (req.headers['x-forwarded-uri'] as string) || 
    (req.headers['x-original-url'] as string);

  if (matchedPath && matchedPath.startsWith('/api') && req.url !== matchedPath) {
    req.url = matchedPath;
  }

  return app(req, res);
}
