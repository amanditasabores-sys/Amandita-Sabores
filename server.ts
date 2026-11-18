import express, { type Request, type Response } from 'express';
import path from 'path';
import { app, __setTestFirebaseAdminServices } from './src/server/app.js';

export { app, __setTestFirebaseAdminServices };

// Local development / standalone Node entrypoint.
// Vercel serverless functions import src/server/app directly and NEVER execute this file.
async function startServer() {
  const PORT = Number(process.env.PORT) || 3000;

  if (process.env.NODE_ENV === 'production') {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false, ws: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Amandita Sabores] Servidor full-stack rodando em http://0.0.0.0:${PORT}`);
  });
}

if (!process.env.VERCEL && !process.env.DISABLE_AUTO_LISTEN) {
  startServer().catch((err) => {
    console.error('[Amandita Sabores] Falha ao iniciar servidor:', err);
    process.exit(1);
  });
}

export default app;
