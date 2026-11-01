import type { Request, Response } from 'express';
import app from '../server.ts';

// Vercel Serverless Function entry point
// Bridges Vercel edge/serverless requests to the Express application
export default function handler(req: Request, res: Response) {
  return app(req, res);
}
