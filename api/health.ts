import type { IncomingMessage, ServerResponse } from 'http';

export default function handler(_req: IncomingMessage, res: ServerResponse) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.statusCode = 200;
  res.end(JSON.stringify({
    status: 'online',
    system: 'Amandita Sabores - Serverless Gateway',
    timestamp: new Date().toISOString(),
  }));
}
