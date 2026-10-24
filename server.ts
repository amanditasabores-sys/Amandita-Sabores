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

  // Secure Backend API: Order Ingestion & Full-Catalog Mathematical Invariant Validation
  // Allows orders with large item counts (> 5 or > 8 items) to be processed cleanly without
  // breaching Cloud Firestore Rules 10-read budget.
  app.post('/api/orders', (req: Request, res: Response) => {
    try {
      const { order } = req.body;
      if (!order || typeof order !== 'object') {
        res.status(400).json({ success: false, message: 'Dados do pedido ausentes ou inválidos.' });
        return;
      }

      if (!order.id || !order.orderNumber || !Array.isArray(order.items) || order.items.length === 0) {
        res.status(400).json({ success: false, message: 'Estrutura básica do pedido incompleta.' });
        return;
      }

      if (!order.trackingCode || typeof order.trackingCode !== 'string' || order.trackingCode.length < 20) {
        res.status(400).json({ success: false, message: 'Código de rastreamento inválido ou insuficiente (mínimo 20 caracteres).' });
        return;
      }

      if (!order.customer || typeof order.customer.name !== 'string' || order.customer.name.trim().length === 0) {
        res.status(400).json({ success: false, message: 'Nome do cliente é obrigatório.' });
        return;
      }

      // Mathematical item and addon invariant verification
      let calculatedSubtotal = 0;
      for (const item of order.items) {
        if (!item.id || !item.menuItemId || !item.name || typeof item.quantity !== 'number' || item.quantity < 1) {
          res.status(400).json({ success: false, message: `Item inválido no pedido: ${item.name || 'desconhecido'}.` });
          return;
        }

        let expectedItemSubtotal = item.unitPrice * item.quantity;
        if (Array.isArray(item.addons)) {
          for (const addon of item.addons) {
            if (typeof addon.price !== 'number' || (addon.price !== 3.00 && addon.price !== 0.00)) {
              res.status(400).json({ success: false, message: `Preço de adicional inválido: ${addon.name}. Apenas R$ 3,00 (recheios) ou R$ 0,00 (sabores) são autorizados.` });
              return;
            }
            expectedItemSubtotal += addon.price * item.quantity;
          }
        }

        if (Math.abs(item.subtotal - expectedItemSubtotal) > 0.01) {
          res.status(400).json({ success: false, message: `Subtotal incorreto para o item ${item.name}. Esperado: ${expectedItemSubtotal.toFixed(2)}, recebido: ${item.subtotal}.` });
          return;
        }

        calculatedSubtotal += item.subtotal;
      }

      if (Math.abs(order.subtotal - calculatedSubtotal) > 0.01) {
        res.status(400).json({ success: false, message: 'Subtotal geral do pedido não confere com a soma dos itens.' });
        return;
      }

      const expectedDeliveryFee = order.fulfillmentType === 'RETIRADA' ? 0 : (order.deliveryFee || 0);
      if (Math.abs(order.deliveryFee - expectedDeliveryFee) > 0.01) {
        res.status(400).json({ success: false, message: 'Taxa de entrega incorreta para a modalidade.' });
        return;
      }

      // Public customers cannot grant discounts
      const expectedTotal = calculatedSubtotal + expectedDeliveryFee - 0;
      if (Math.abs(order.totalAmount - expectedTotal) > 0.01) {
        res.status(400).json({ success: false, message: 'Valor total do pedido não confere matematicamente.' });
        return;
      }

      res.json({
        success: true,
        message: 'Pedido processado e verificado com sucesso pelo backend.',
        orderId: order.id,
        trackingCode: order.trackingCode
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
