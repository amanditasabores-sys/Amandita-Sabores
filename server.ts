import express, { Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Health and Status API
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      status: 'online',
      system: 'Amandita Sabores - Backend Seguro de Credenciais',
      timestamp: new Date().toISOString()
    });
  });

  // Secure Backend API: Staff Registration and Credential Administration
  // Ensures role boundaries without placing administrative master secrets in the browser
  app.post('/api/auth/register-staff', (req: Request, res: Response) => {
    try {
      const { username, name, role, allowedModules, requesterRole } = req.body;

      // 1. Validate requester authorization
      if (!requesterRole || !['ADMINISTRADOR', 'GERENTE'].includes(String(requesterRole).toUpperCase())) {
        res.status(403).json({
          success: false,
          message: 'Acesso negado: apenas Administrador ou Gerente possuem autorização para registrar funcionários.'
        });
        return;
      }

      // 2. Enforce RBAC: Gerente cannot create an Administrador
      if (String(requesterRole).toUpperCase() === 'GERENTE' && String(role).toUpperCase() === 'ADMINISTRADOR') {
        res.status(403).json({
          success: false,
          message: 'Permissão insuficiente: Gerente não possui autorização para criar contas de Administrador Geral.'
        });
        return;
      }

      if (!username || !role) {
        res.status(400).json({
          success: false,
          message: 'Dados incompletos: nome de usuário e cargo são obrigatórios.'
        });
        return;
      }

      const cleanUsername = String(username).trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '');
      const syntheticEmail = `${cleanUsername}@staff.amanditasabores.com.br`;

      res.json({
        success: true,
        message: 'Credencial de funcionário validada com sucesso pelo backend.',
        user: {
          username: cleanUsername,
          name: name ? String(name).trim() : cleanUsername,
          email: syntheticEmail,
          role,
          allowedModules: allowedModules || ['pdv'],
          status: 'ATIVO',
          createdAt: new Date().toISOString()
        }
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, message: `Erro interno no backend: ${msg}` });
    }
  });

  // Secure Backend API: Password Reset Authorization
  app.post('/api/auth/reset-password', (req: Request, res: Response) => {
    try {
      const { targetUserRole, newPassword, requesterRole } = req.body;

      if (!requesterRole || !['ADMINISTRADOR', 'GERENTE'].includes(String(requesterRole).toUpperCase())) {
        res.status(403).json({
          success: false,
          message: 'Acesso negado: apenas Administrador ou Gerente podem autorizar redefinições de senha.'
        });
        return;
      }

      if (String(requesterRole).toUpperCase() === 'GERENTE' && String(targetUserRole).toUpperCase() === 'ADMINISTRADOR') {
        res.status(403).json({
          success: false,
          message: 'Permissão insuficiente: Gerente não pode redefinir a senha do Administrador Geral.'
        });
        return;
      }

      if (!newPassword || String(newPassword).trim().length < 4) {
        res.status(400).json({
          success: false,
          message: 'A nova senha deve possuir no mínimo 4 caracteres.'
        });
        return;
      }

      res.json({
        success: true,
        message: 'Redefinição de senha autorizada com sucesso pelo backend seguro.'
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, message: `Erro interno no backend: ${msg}` });
    }
  });

  // Mount Vite development middlewares or serve static assets in production
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Amandita Sabores] Servidor full-stack rodando em http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('[Amandita Sabores] Falha ao iniciar servidor:', err);
  process.exit(1);
});
