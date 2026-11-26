/**
 * Suite Etapa 1 — Proteção do Caixa e Controle de Pendências Financeiras
 * (Amandita Sabores)
 *
 * Executa os 10 cenários obrigatórios contra as rotas reais do servidor Express,
 * o cliente `store.ts` e os geradores de relatório de fechamento, utilizando
 * Firestore transacional em memória (ZERO escrita no Firestore real de produção).
 */

import assert from 'node:assert';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

process.env.DISABLE_AUTO_LISTEN = '1';
process.env.ALLOW_TEST_FIREBASE_OVERRIDES = '1';
delete process.env.VITE_FIREBASE_API_KEY;
process.env.FIREBASE_PROJECT_ID = 'amandita-sabores';

const storageMap = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (storageMap.has(k) ? storageMap.get(k)! : null),
  setItem: (k: string, v: string) => storageMap.set(k, String(v)),
  removeItem: (k: string) => storageMap.delete(k),
  clear: () => storageMap.clear(),
};
(globalThis as any).CustomEvent = class MockCustomEvent {
  type: string;
  detail: unknown;
  constructor(type: string, init?: { detail?: unknown }) {
    this.type = type;
    this.detail = init?.detail;
  }
};
(globalThis as any).window = {
  location: { origin: 'http://127.0.0.1', search: '', hash: '', pathname: '/' },
  dispatchEvent: () => true,
  addEventListener: () => {},
  removeEventListener: () => {},
};
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { onLine: true, userAgent: 'AmanditaPendingReconciliationTest/1.0' },
});

const tmpTombstonePath = path.join(process.cwd(), '.deleted_orders_cache.json');
const hadExistingTombstoneFile = fs.existsSync(tmpTombstonePath);
const existingTombstoneBackup = hadExistingTombstoneFile ? fs.readFileSync(tmpTombstonePath, 'utf8') : null;

const tmpPushCachePath = path.join(process.cwd(), '.push_dispatches_cache.json');
const hadExistingPushCacheFile = fs.existsSync(tmpPushCachePath);
const existingPushCacheBackup = hadExistingPushCacheFile ? fs.readFileSync(tmpPushCachePath, 'utf8') : null;

interface StoredDoc {
  data: Record<string, any>;
  version: number;
}

function deepClone<T>(val: T): T {
  return val === undefined ? (undefined as any) : JSON.parse(JSON.stringify(val));
}

class TransactionalFirestoreSimulator {
  private cols = new Map<string, Map<string, StoredDoc>>();
  private colVersions = new Map<string, number>();

  private ensureCol(name: string): Map<string, StoredDoc> {
    let m = this.cols.get(name);
    if (!m) {
      m = new Map();
      this.cols.set(name, m);
      this.colVersions.set(name, 1);
    }
    return m;
  }

  public seedDoc(colName: string, docId: string, data: Record<string, any>): void {
    const col = this.ensureCol(colName);
    const prev = col.get(docId);
    col.set(docId, { data: deepClone(data), version: (prev?.version || 0) + 1 });
    this.colVersions.set(colName, (this.colVersions.get(colName) || 1) + 1);
  }

  public clearAll(): void {
    this.cols.clear();
    this.colVersions.clear();
  }

  public getRawDoc(colName: string, docId: string): Record<string, any> | undefined {
    const entry = this.cols.get(colName)?.get(docId);
    return entry ? deepClone(entry.data) : undefined;
  }

  private makeDocSnapshot(colName: string, docId: string, ref: any) {
    const entry = this.cols.get(colName)?.get(docId);
    return {
      exists: Boolean(entry),
      id: docId,
      ref,
      data: () => (entry ? deepClone(entry.data) : undefined),
    };
  }

  private runQuerySync(colName: string, filters: Array<{ field: string; op: string; value: any }>, limitNum?: number) {
    const col = this.ensureCol(colName);
    let entries = Array.from(col.entries()).filter(([, entry]) => {
      for (const f of filters) {
        if (f.op === '==' && entry.data[f.field] !== f.value) return false;
      }
      return true;
    });
    if (typeof limitNum === 'number' && limitNum >= 0) {
      entries = entries.slice(0, limitNum);
    }
    const docs = entries.map(([id, entry]) => ({
      exists: true,
      id,
      ref: this.docRef(colName, id),
      data: () => deepClone(entry.data),
    }));
    return {
      empty: docs.length === 0,
      size: docs.length,
      docs,
      forEach: (cb: (d: any) => void) => docs.forEach(cb),
    };
  }

  private docRef(colName: string, docId: string): any {
    const self = this;
    return {
      __kind: 'docRef',
      colName,
      id: docId,
      path: `${colName}/${docId}`,
      async get() {
        return self.makeDocSnapshot(colName, docId, this);
      },
      async set(data: Record<string, any>, opts?: { merge?: boolean }) {
        const col = self.ensureCol(colName);
        const existing = col.get(docId);
        const nextData = opts?.merge && existing ? { ...deepClone(existing.data), ...deepClone(data) } : deepClone(data);
        col.set(docId, { data: nextData, version: (existing?.version || 0) + 1 });
        self.colVersions.set(colName, (self.colVersions.get(colName) || 1) + 1);
      },
      async update(partial: Record<string, any>) {
        const col = self.ensureCol(colName);
        const existing = col.get(docId);
        if (!existing) throw new Error(`NOT_FOUND: ${colName}/${docId}`);
        col.set(docId, { data: { ...deepClone(existing.data), ...deepClone(partial) }, version: existing.version + 1 });
        self.colVersions.set(colName, (self.colVersions.get(colName) || 1) + 1);
      },
      async delete() {
        const col = self.ensureCol(colName);
        col.delete(docId);
        self.colVersions.set(colName, (self.colVersions.get(colName) || 1) + 1);
      },
    };
  }

  private queryRef(colName: string, filters: Array<{ field: string; op: string; value: any }> = [], limitNum?: number): any {
    const self = this;
    return {
      __kind: 'queryRef',
      colName,
      filters,
      limitNum,
      where(field: string, op: string, value: any) {
        return self.queryRef(colName, [...filters, { field, op, value }], limitNum);
      },
      limit(n: number) {
        return self.queryRef(colName, filters, n);
      },
      async get() {
        return self.runQuerySync(colName, filters, limitNum);
      },
    };
  }

  public collection(colName: string): any {
    const self = this;
    const baseQuery = this.queryRef(colName);
    return {
      ...baseQuery,
      doc: (docId: string) => self.docRef(colName, docId),
    };
  }

  public async runTransaction<T>(updateFn: (tx: any) => Promise<T>): Promise<T> {
    const pendingOps: Array<{ type: 'set' | 'update' | 'delete'; ref: any; data?: any; merge?: boolean }> = [];
    const tx = {
      get: async (target: any) => {
        if (target?.__kind === 'queryRef') {
          this.ensureCol(target.colName);
          return this.runQuerySync(target.colName, target.filters, target.limitNum);
        }
        return this.makeDocSnapshot(target.colName, target.id, target);
      },
      set: (ref: any, data: Record<string, any>, opts?: { merge?: boolean }) => {
        pendingOps.push({ type: 'set', ref, data: deepClone(data), merge: opts?.merge });
        return tx;
      },
      update: (ref: any, partial: Record<string, any>) => {
        pendingOps.push({ type: 'update', ref, data: deepClone(partial) });
        return tx;
      },
      delete: (ref: any) => {
        pendingOps.push({ type: 'delete', ref });
        return tx;
      },
    };
    const result = await updateFn(tx);
    for (const op of pendingOps) {
      if (op.type === 'set') await op.ref.set(op.data, { merge: op.merge });
      else if (op.type === 'update') await op.ref.update(op.data);
      else if (op.type === 'delete') await op.ref.delete();
    }
    return result;
  }
}

async function run() {
  const realFetch = globalThis.fetch.bind(globalThis);
  const simDb = new TransactionalFirestoreSimulator();

  const staffTokens: Record<string, { uid: string; role: string; status: string; email: string }> = {
    'tok-admin': { uid: 'uid-admin-1', role: 'ADMINISTRADOR', status: 'ATIVO', email: 'admin@amandita.local' },
    'tok-gerente': { uid: 'uid-gerente-1', role: 'GERENTE', status: 'ATIVO', email: 'gerente@amandita.local' },
    'tok-caixa': { uid: 'uid-caixa-1', role: 'CAIXA', status: 'ATIVO', email: 'caixa@amandita.local' },
    'tok-atendente': { uid: 'uid-atendente-1', role: 'ATENDENTE', status: 'ATIVO', email: 'atendente@amandita.local' },
    'tok-entregador': { uid: 'uid-entregador-1', role: 'ENTREGADOR', status: 'ATIVO', email: 'entregador@amandita.local' },
    'tok-cozinha': { uid: 'uid-cozinha-1', role: 'COZINHA', status: 'ATIVO', email: 'cozinha@amandita.local' },
  };

  const mockAdminAuth = {
    async verifyIdToken(token: string) {
      const hit = staffTokens[token];
      if (!hit) throw new Error('INVALID_TOKEN');
      return { uid: hit.uid, role: hit.role, status: hit.status, email: hit.email };
    },
  };

  const { default: app, __setTestFirebaseAdminServices } = await import('../server');
  __setTestFirebaseAdminServices({
    adminDb: simDb as any,
    adminAuth: mockAdminAuth as any,
  });

  const { buildClosedShiftClosingReport, buildOpenShiftClosingReport } = await import('../src/utils/cashClosingReport');
  const { generateCashClosingPdfBytes } = await import('../src/utils/cashClosingPdf');
  const { thermalPrinterService } = await import('../src/services/thermalPrinter');
  const { store } = await import('../src/services/store');

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as any;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const seedUsers = () => {
    for (const u of Object.values(staffTokens)) {
      simDb.seedDoc('users', u.uid, {
        uid: u.uid,
        role: u.role,
        status: u.status,
        email: u.email,
        provisioningState: 'ACTIVE',
      });
    }
  };

  const apiCall = async (
    method: string,
    urlPath: string,
    token?: string,
    body?: Record<string, any>
  ) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await realFetch(`${baseUrl}${urlPath}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const json = await res.json();
    return { status: res.status, data: json };
  };

  let passed = 0;
  const runCase = async (label: string, fn: () => Promise<void>) => {
    simDb.clearAll();
    seedUsers();
    await fn();
    passed += 1;
    console.log(`✅ [PASS] ${label}`);
  };

  try {
    // CENÁRIO 1: Turno sem pedidos pendentes: fechamento normal funciona.
    await runCase('1. Turno sem pedidos pendentes — fechamento normal funciona', async () => {
      simDb.seedDoc('cash_shifts', 'shift-c1', {
        id: 'shift-c1',
        status: 'ABERTO',
        openedAt: '2026-11-26T08:00:00.000Z',
        openedBy: 'Caixa 1',
        initialBalance: 100,
        movements: [
          {
            id: 'cash-sale-ord-paid-1',
            timestamp: '2026-11-26T09:00:00.000Z',
            type: 'VENDA',
            amount: 25,
            paymentMethod: 'DINHEIRO',
            description: 'Recebimento Pedido #1001 - Ana',
            orderId: 'ord-paid-1',
            orderNumber: '#1001',
            author: 'Caixa 1',
          },
        ],
      });
      simDb.seedDoc('orders', 'ord-paid-1', {
        id: 'ord-paid-1',
        orderNumber: '#1001',
        status: 'ENTREGUE',
        paymentStatus: 'PAGO',
        paymentMethod: 'DINHEIRO',
        totalAmount: 25,
        createdAt: '2026-11-26T08:50:00.000Z',
        customer: { name: 'Ana' },
        movements: [],
      });

      const pendingRes = await apiCall('GET', '/api/cash-shifts/shift-c1/pending-orders', 'tok-caixa');
      assert.strictEqual(pendingRes.status, 200);
      assert.strictEqual(pendingRes.data.currentShiftPendingCount, 0);
      assert.strictEqual(pendingRes.data.currentShiftPendingTotal, 0);

      const closeRes = await apiCall('POST', '/api/cash-shifts/shift-c1/close', 'tok-caixa', {
        countedCash: 125,
        closedBy: 'Maria Caixa',
        notes: 'Fechamento normal',
      });
      assert.strictEqual(closeRes.status, 200);
      assert.strictEqual(closeRes.data.success, true);
      assert.strictEqual(closeRes.data.shift.status, 'FECHADO');
      assert.strictEqual(closeRes.data.shift.finalCalculatedBalance, 125);
      assert.strictEqual(closeRes.data.shift.finalCountedCash, 125);
      assert.strictEqual(closeRes.data.shift.difference, 0);
      assert.strictEqual(closeRes.data.shift.closedWithPendingOrders, undefined);
    });

    // CENÁRIO 2: Turno com pedido ENTREGUE e PENDENTE: alerta e bloqueio do fechamento silencioso.
    await runCase('2. Turno com pedido ENTREGUE + PENDENTE — bloqueia fechamento silencioso no servidor', async () => {
      simDb.seedDoc('cash_shifts', 'shift-c2', {
        id: 'shift-c2',
        status: 'ABERTO',
        openedAt: '2026-11-26T08:00:00.000Z',
        openedBy: 'Caixa 1',
        initialBalance: 100,
        movements: [],
      });
      simDb.seedDoc('orders', 'ord-pend-1', {
        id: 'ord-pend-1',
        orderNumber: '#2001',
        status: 'ENTREGUE',
        paymentStatus: 'PENDENTE',
        paymentMethod: 'PIX',
        totalAmount: 36.5,
        createdAt: '2026-11-26T09:15:00.000Z',
        customer: { name: 'Carlos' },
        origin: 'CARDAPIO_PUBLICO',
        deliveryPersonName: 'João Motoboy',
        movements: [],
      });

      const pendingRes = await apiCall('GET', '/api/cash-shifts/shift-c2/pending-orders', 'tok-caixa');
      assert.strictEqual(pendingRes.status, 200);
      assert.strictEqual(pendingRes.data.currentShiftPendingCount, 1);
      assert.strictEqual(pendingRes.data.currentShiftPendingTotal, 36.5);
      assert.strictEqual(pendingRes.data.currentShiftPending[0].orderId, 'ord-pend-1');
      assert.strictEqual(pendingRes.data.currentShiftPending[0].originLabel, 'Cardápio Público');
      assert.strictEqual(pendingRes.data.currentShiftPending[0].deliveryPersonName, 'João Motoboy');

      const closeRes = await apiCall('POST', '/api/cash-shifts/shift-c2/close', 'tok-caixa', {
        countedCash: 100,
        closedBy: 'Maria Caixa',
      });
      assert.strictEqual(closeRes.status, 409);
      assert.strictEqual(closeRes.data.code, 'PENDING_DELIVERED_ORDERS_EXIST');
      assert.strictEqual(closeRes.data.pendingCount, 1);
      assert.strictEqual(closeRes.data.pendingTotalAmount, 36.5);

      const storedShift = simDb.getRawDoc('cash_shifts', 'shift-c2');
      assert.strictEqual(storedShift?.status, 'ABERTO', 'Turno deve permanecer ABERTO após bloqueio');
    });

    // CENÁRIO 3: Pedido confirmado corretamente: desaparece da fila de pendências.
    await runCase('3. Pedido confirmado via endpoint atômico — desaparece da fila e libera fechamento', async () => {
      simDb.seedDoc('cash_shifts', 'shift-c3', {
        id: 'shift-c3',
        status: 'ABERTO',
        openedAt: '2026-11-26T08:00:00.000Z',
        openedBy: 'Caixa 1',
        initialBalance: 100,
        movements: [],
      });
      simDb.seedDoc('orders', 'ord-pend-3', {
        id: 'ord-pend-3',
        orderNumber: '#3001',
        status: 'ENTREGUE',
        paymentStatus: 'PENDENTE',
        paymentMethod: 'PIX',
        totalAmount: 42,
        createdAt: '2026-11-26T10:00:00.000Z',
        customer: { name: 'Beatriz' },
        movements: [],
      });

      const confirmRes = await apiCall('POST', '/api/orders/ord-pend-3/confirm-payment', 'tok-caixa', {
        author: 'Maria Caixa',
        shiftId: 'shift-c3',
        requireOrderInShiftPeriod: true,
      });
      assert.strictEqual(confirmRes.status, 200);
      assert.strictEqual(confirmRes.data.order.paymentStatus, 'PAGO');
      assert.strictEqual(confirmRes.data.shift.movements.length, 1);
      assert.strictEqual(confirmRes.data.shift.movements[0].id, 'cash-sale-ord-pend-3');

      const pendingAfter = await apiCall('GET', '/api/cash-shifts/shift-c3/pending-orders', 'tok-caixa');
      assert.strictEqual(pendingAfter.status, 200);
      assert.strictEqual(pendingAfter.data.currentShiftPendingCount, 0);

      const closeRes = await apiCall('POST', '/api/cash-shifts/shift-c3/close', 'tok-caixa', {
        countedCash: 100,
        closedBy: 'Maria Caixa',
      });
      assert.strictEqual(closeRes.status, 200);
      assert.strictEqual(closeRes.data.shift.status, 'FECHADO');
    });

    // CENÁRIO 4: Pedido com pagamento não confirmado: permanece pendente (inclusive erro de caixa fechado/inexistente).
    await runCase('4. Pedido não confirmado ou com caixa fechado — permanece PENDENTE sem VENDA', async () => {
      simDb.seedDoc('cash_shifts', 'shift-c4', {
        id: 'shift-c4',
        status: 'FECHADO',
        openedAt: '2026-11-26T08:00:00.000Z',
        closedAt: '2026-11-26T12:00:00.000Z',
        openedBy: 'Caixa 1',
        initialBalance: 100,
        movements: [],
      });
      simDb.seedDoc('orders', 'ord-pend-4', {
        id: 'ord-pend-4',
        orderNumber: '#4001',
        status: 'ENTREGUE',
        paymentStatus: 'PENDENTE',
        paymentMethod: 'DINHEIRO',
        totalAmount: 19,
        createdAt: '2026-11-26T09:30:00.000Z',
        customer: { name: 'Lucas' },
        movements: [],
      });

      const confirmRes = await apiCall('POST', '/api/orders/ord-pend-4/confirm-payment', 'tok-caixa', {
        author: 'Maria Caixa',
        shiftId: 'shift-c4',
        requireOrderInShiftPeriod: true,
      });
      assert.strictEqual(confirmRes.status, 409);
      assert.strictEqual(confirmRes.data.code, 'SHIFT_ALREADY_CLOSED');

      const orderDoc = simDb.getRawDoc('orders', 'ord-pend-4');
      assert.strictEqual(orderDoc?.paymentStatus, 'PENDENTE');
      const shiftDoc = simDb.getRawDoc('cash_shifts', 'shift-c4');
      assert.strictEqual(shiftDoc?.movements.length, 0);
    });

    // CENÁRIO 5 & 6: Fechamento excepcional com justificativa registra trilha completa e NÃO marca PAGO nem cria VENDA nem altera saldo/diferença.
    await runCase('5 & 6. Fechamento excepcional — valida justificativa, registra auditoria e preserva saldos e pedido PENDENTE', async () => {
      simDb.seedDoc('cash_shifts', 'shift-c5', {
        id: 'shift-c5',
        status: 'ABERTO',
        openedAt: '2026-11-26T08:00:00.000Z',
        openedBy: 'Caixa 1',
        initialBalance: 100,
        movements: [
          {
            id: 'cash-sale-ord-ok-5',
            timestamp: '2026-11-26T09:00:00.000Z',
            type: 'VENDA',
            amount: 50,
            paymentMethod: 'DINHEIRO',
            description: 'Recebimento Pedido #5000 - Pedro',
            orderId: 'ord-ok-5',
            orderNumber: '#5000',
            author: 'Caixa 1',
          },
        ],
      });
      simDb.seedDoc('orders', 'ord-pend-5a', {
        id: 'ord-pend-5a',
        orderNumber: '#5001',
        status: 'ENTREGUE',
        paymentStatus: 'PENDENTE',
        paymentMethod: 'PIX',
        totalAmount: 28,
        createdAt: '2026-11-26T09:30:00.000Z',
        customer: { name: 'Fernanda' },
        movements: [],
      });
      simDb.seedDoc('orders', 'ord-pend-5b', {
        id: 'ord-pend-5b',
        orderNumber: '#5002',
        status: 'ENTREGUE',
        paymentStatus: 'PENDENTE',
        paymentMethod: 'DINHEIRO',
        totalAmount: 32,
        createdAt: '2026-11-26T10:15:00.000Z',
        customer: { name: 'Rafael' },
        movements: [],
      });

      // 5a: Rejeita "Outra situação" sem descrição obrigatória
      const badDetailRes = await apiCall('POST', '/api/cash-shifts/shift-c5/close', 'tok-gerente', {
        countedCash: 148,
        closedBy: 'Joana Gerente',
        exceptionalJustifications: [
          { orderId: 'ord-pend-5a', reasonCode: 'PIX_AGUARDANDO_EXTRATO' },
          { orderId: 'ord-pend-5b', reasonCode: 'OUTRA_SITUACAO', reasonDetail: 'abc' },
        ],
      });
      assert.strictEqual(badDetailRes.status, 400);
      assert.strictEqual(badDetailRes.data.code, 'INVALID_EXCEPTIONAL_JUSTIFICATIONS');

      // 5b: Rejeita cobertura parcial (faltando 1 pedido)
      const partialRes = await apiCall('POST', '/api/cash-shifts/shift-c5/close', 'tok-gerente', {
        countedCash: 148,
        closedBy: 'Joana Gerente',
        exceptionalJustifications: [{ orderId: 'ord-pend-5a', reasonCode: 'PIX_AGUARDANDO_EXTRATO' }],
      });
      assert.strictEqual(partialRes.status, 400);
      assert.strictEqual(partialRes.data.code, 'INVALID_EXCEPTIONAL_JUSTIFICATIONS');

      // 5c: Aceita justificativas completas
      const okRes = await apiCall('POST', '/api/cash-shifts/shift-c5/close', 'tok-gerente', {
        countedCash: 148,
        closedBy: 'Joana Gerente',
        notes: 'Fechado com pendências justificadas',
        exceptionalJustifications: [
          { orderId: 'ord-pend-5a', reasonCode: 'PIX_AGUARDANDO_EXTRATO', reasonDetail: 'Banco instável' },
          { orderId: 'ord-pend-5b', reasonCode: 'OUTRA_SITUACAO', reasonDetail: 'Cliente pagará no próximo turno conforme combinado' },
        ],
      });
      assert.strictEqual(okRes.status, 200);
      const closedShift = okRes.data.shift;
      assert.strictEqual(closedShift.status, 'FECHADO');
      assert.strictEqual(closedShift.closedWithPendingOrders, true);
      assert.strictEqual(closedShift.pendingDeliveredAtCloseCount, 2);
      assert.strictEqual(closedShift.pendingDeliveredAtCloseTotal, 60);
      assert.strictEqual(closedShift.exceptionalPendingJustifications.length, 2);

      // Verifica metadados de auditoria derivados no servidor
      const recA = closedShift.exceptionalPendingJustifications.find((r: any) => r.orderId === 'ord-pend-5a');
      assert.strictEqual(recA.responsibleUid, 'uid-gerente-1');
      assert.strictEqual(recA.responsibleName, 'Joana Gerente');
      assert.strictEqual(recA.responsibleRole, 'GERENTE');
      assert.strictEqual(recA.shiftId, 'shift-c5');
      assert.ok(recA.recordedAt);
      assert.strictEqual(recA.reasonLabel, 'PIX aguardando conferência no extrato');

      // CENÁRIO 6: Invariantes financeiros rigorosos
      // - Nenhuma nova movimentação VENDA criada (continua 1)
      assert.strictEqual(closedShift.movements.length, 1);
      // - Saldos e diferença NÃO incluem os R$ 60,00 pendentes (100 inicial + 50 dinheiro = 150 esperado; 148 contado -> -2 diferença)
      assert.strictEqual(closedShift.initialBalance, 100);
      assert.strictEqual(closedShift.finalCalculatedBalance, 150);
      assert.strictEqual(closedShift.finalCountedCash, 148);
      assert.strictEqual(closedShift.difference, -2);
      // - Pedidos continuam rigorosamente PENDENTE no Firestore
      assert.strictEqual(simDb.getRawDoc('orders', 'ord-pend-5a')?.paymentStatus, 'PENDENTE');
      assert.strictEqual(simDb.getRawDoc('orders', 'ord-pend-5b')?.paymentStatus, 'PENDENTE');

      // Verifica que relatórios (fechamento, PDF e térmico) separam vendas confirmadas de pendências excepcionais
      const closedReport = buildClosedShiftClosingReport(closedShift);
      assert.strictEqual(closedReport.totalNetRevenue, 50);
      assert.strictEqual(closedReport.expectedCashInDrawer, 150);
      assert.strictEqual(closedReport.exceptionalPendingJustifications?.length, 2);
      const pdfBytes = generateCashClosingPdfBytes(closedReport);
      assert.ok(pdfBytes.byteLength > 500);
      const thermalText = thermalPrinterService.generateCashClosingPlainText(closedReport);
      assert.ok(thermalText.includes('FECH. EXCEPCIONAL - PENDENCIAS'));
      assert.ok(thermalText.includes('#5001'));

      const openReport = buildOpenShiftClosingReport(
        { ...closedShift, status: 'ABERTO' },
        {
          countedCash: 148,
          closingNotes: '',
          pendingDeliveredOrders: [
            {
              orderId: 'ord-pend-5a',
              orderNumber: '#5001',
              createdAt: '2026-11-26T09:30:00.000Z',
              totalAmount: 28,
              paymentMethod: 'PIX',
              customerName: 'Fernanda',
              originLabel: 'Não informada',
            },
          ],
        }
      );
      assert.strictEqual(openReport.totalNetRevenue, 50);
      assert.strictEqual(openReport.pendingDeliveredSummary?.count, 1);
    });

    // CENÁRIO 7: Repetição da confirmação de pagamento é idempotente e não duplica movimentação.
    await runCase('7. Repetição da confirmação de pagamento — idempotente, sem duplicação de VENDA', async () => {
      simDb.seedDoc('cash_shifts', 'shift-c7', {
        id: 'shift-c7',
        status: 'ABERTO',
        openedAt: '2026-11-26T08:00:00.000Z',
        openedBy: 'Caixa 1',
        initialBalance: 100,
        movements: [],
      });
      simDb.seedDoc('orders', 'ord-idem-7', {
        id: 'ord-idem-7',
        orderNumber: '#7001',
        status: 'ENTREGUE',
        paymentStatus: 'PENDENTE',
        paymentMethod: 'CARTAO_DEBITO',
        totalAmount: 55,
        createdAt: '2026-11-26T09:00:00.000Z',
        customer: { name: 'Mariana' },
        movements: [],
      });

      const r1 = await apiCall('POST', '/api/orders/ord-idem-7/confirm-payment', 'tok-caixa', {
        author: 'Maria Caixa',
        shiftId: 'shift-c7',
        requireOrderInShiftPeriod: true,
      });
      assert.strictEqual(r1.status, 200);
      assert.strictEqual(r1.data.alreadyConfirmed, false);

      const r2 = await apiCall('POST', '/api/orders/ord-idem-7/confirm-payment', 'tok-caixa', {
        author: 'Maria Caixa',
        shiftId: 'shift-c7',
        requireOrderInShiftPeriod: true,
      });
      assert.strictEqual(r2.status, 200);
      assert.strictEqual(r2.data.alreadyConfirmed, true);

      const shiftDoc = simDb.getRawDoc('cash_shifts', 'shift-c7');
      const saleMovs = (shiftDoc?.movements || []).filter((m: any) => m.type === 'VENDA' && m.orderId === 'ord-idem-7');
      assert.strictEqual(saleMovs.length, 1, 'Deve existir exatamente 1 movimentação VENDA');
    });

    // CENÁRIO 8: Usuários sem permissão (anônimo, ENTREGADOR, ATENDENTE, COZINHA) recebem acesso negado no servidor.
    await runCase('8. Controle de acesso no servidor — bloqueia anônimo, ENTREGADOR, ATENDENTE e COZINHA', async () => {
      simDb.seedDoc('cash_shifts', 'shift-c8', {
        id: 'shift-c8',
        status: 'ABERTO',
        openedAt: '2026-11-26T08:00:00.000Z',
        openedBy: 'Caixa 1',
        initialBalance: 100,
        movements: [],
      });
      simDb.seedDoc('orders', 'ord-c8', {
        id: 'ord-c8',
        orderNumber: '#8001',
        status: 'ENTREGUE',
        paymentStatus: 'PENDENTE',
        paymentMethod: 'PIX',
        totalAmount: 20,
        createdAt: '2026-11-26T09:00:00.000Z',
        customer: { name: 'Cliente' },
        movements: [],
      });

      // Anônimo -> 401
      assert.strictEqual((await apiCall('GET', '/api/cash-shifts/shift-c8/pending-orders')).status, 401);
      assert.strictEqual((await apiCall('POST', '/api/cash-shifts/shift-c8/close', undefined, { countedCash: 100 })).status, 401);
      assert.strictEqual((await apiCall('POST', '/api/orders/ord-c8/confirm-payment', undefined, { shiftId: 'shift-c8' })).status, 401);

      // ENTREGADOR, COZINHA, ATENDENTE -> 403 em pending-orders e close
      for (const tok of ['tok-entregador', 'tok-cozinha', 'tok-atendente']) {
        assert.strictEqual((await apiCall('GET', '/api/cash-shifts/shift-c8/pending-orders', tok)).status, 403);
        assert.strictEqual((await apiCall('POST', '/api/cash-shifts/shift-c8/close', tok, { countedCash: 100 })).status, 403);
      }

      // ENTREGADOR e COZINHA -> 403 em confirm-payment; ATENDENTE -> 403 quando requireOrderInShiftPeriod: true (painel do caixa)
      assert.strictEqual((await apiCall('POST', '/api/orders/ord-c8/confirm-payment', 'tok-entregador', { shiftId: 'shift-c8' })).status, 403);
      assert.strictEqual((await apiCall('POST', '/api/orders/ord-c8/confirm-payment', 'tok-cozinha', { shiftId: 'shift-c8' })).status, 403);
      assert.strictEqual(
        (await apiCall('POST', '/api/orders/ord-c8/confirm-payment', 'tok-atendente', { shiftId: 'shift-c8', requireOrderInShiftPeriod: true })).status,
        403
      );
    });

    // CENÁRIO 9: Pendência de turno anterior não é misturada nem lançada no turno atual.
    await runCase('9. Pendência de turno anterior — isolada em seção separada e bloqueada para lançamento no turno atual', async () => {
      simDb.seedDoc('cash_shifts', 'shift-old', {
        id: 'shift-old',
        status: 'FECHADO',
        openedAt: '2026-11-25T08:00:00.000Z',
        closedAt: '2026-11-25T18:00:00.000Z',
        openedBy: 'Caixa Ontem',
        initialBalance: 100,
        movements: [],
      });
      simDb.seedDoc('cash_shifts', 'shift-today', {
        id: 'shift-today',
        status: 'ABERTO',
        openedAt: '2026-11-26T08:00:00.000Z',
        openedBy: 'Caixa Hoje',
        initialBalance: 150,
        movements: [],
      });
      simDb.seedDoc('orders', 'ord-old-pend', {
        id: 'ord-old-pend',
        orderNumber: '#9001',
        status: 'ENTREGUE',
        paymentStatus: 'PENDENTE',
        paymentMethod: 'PIX',
        totalAmount: 45,
        createdAt: '2026-11-25T12:30:00.000Z', // Turno anterior!
        customer: { name: 'Cliente Ontem' },
        movements: [],
      });

      const pendingRes = await apiCall('GET', '/api/cash-shifts/shift-today/pending-orders', 'tok-caixa');
      assert.strictEqual(pendingRes.status, 200);
      assert.strictEqual(pendingRes.data.currentShiftPendingCount, 0, 'Pendência antiga NÃO entra no turno atual');
      assert.strictEqual(pendingRes.data.previousShiftsPendingCount, 1, 'Pendência antiga permanece visível em seção separada');
      assert.strictEqual(pendingRes.data.previousShiftsPending[0].orderId, 'ord-old-pend');

      // Tentativa de lançar pedido antigo no turno atual pelo controle de caixa -> bloqueada no servidor!
      const blockConfirm = await apiCall('POST', '/api/orders/ord-old-pend/confirm-payment', 'tok-caixa', {
        author: 'Caixa Hoje',
        shiftId: 'shift-today',
        requireOrderInShiftPeriod: true,
      });
      assert.strictEqual(blockConfirm.status, 409);
      assert.strictEqual(blockConfirm.data.code, 'ORDER_FROM_PREVIOUS_SHIFT');
      assert.strictEqual(simDb.getRawDoc('orders', 'ord-old-pend')?.paymentStatus, 'PENDENTE');
      assert.strictEqual(simDb.getRawDoc('cash_shifts', 'shift-today')?.movements.length, 0);

      // Fechamento normal do turno atual NÃO é bloqueado pela pendência do turno anterior
      const closeToday = await apiCall('POST', '/api/cash-shifts/shift-today/close', 'tok-caixa', {
        countedCash: 150,
        closedBy: 'Caixa Hoje',
      });
      assert.strictEqual(closeToday.status, 200);
      assert.strictEqual(closeToday.data.shift.status, 'FECHADO');
      assert.strictEqual(closeToday.data.shift.closedWithPendingOrders, undefined);
    });

    // CENÁRIO 10: Falha de comunicação / retry no fechamento não produz fechamento parcial ou duplicado.
    await runCase('10. Falha de comunicação e retry — fechamento atômico sem duplicidade nem parcialidade', async () => {
      simDb.seedDoc('cash_shifts', 'shift-c10', {
        id: 'shift-c10',
        status: 'ABERTO',
        openedAt: '2026-11-26T08:00:00.000Z',
        openedBy: 'Caixa 1',
        initialBalance: 100,
        movements: [],
      });
      simDb.seedDoc('orders', 'ord-pend-10', {
        id: 'ord-pend-10',
        orderNumber: '#10001',
        status: 'ENTREGUE',
        paymentStatus: 'PENDENTE',
        paymentMethod: 'PIX',
        totalAmount: 18,
        createdAt: '2026-11-26T09:00:00.000Z',
        customer: { name: 'Retry Test' },
        movements: [],
      });

      // Primeiro fechamento excepcional conclui no servidor
      const first = await apiCall('POST', '/api/cash-shifts/shift-c10/close', 'tok-admin', {
        countedCash: 100,
        closedBy: 'Admin',
        exceptionalJustifications: [{ orderId: 'ord-pend-10', reasonCode: 'CLIENTE_NAO_PAGOU' }],
      });
      assert.strictEqual(first.status, 200);
      assert.strictEqual(first.data.shift.exceptionalPendingJustifications.length, 1);

      // Retry duplicado após suposto timeout de rede -> rejeitado atomicamente com SHIFT_ALREADY_CLOSED sem alterar nem duplicar justificativas
      const retry = await apiCall('POST', '/api/cash-shifts/shift-c10/close', 'tok-admin', {
        countedCash: 99,
        closedBy: 'Admin',
        exceptionalJustifications: [{ orderId: 'ord-pend-10', reasonCode: 'CLIENTE_NAO_PAGOU' }],
      });
      assert.strictEqual(retry.status, 409);
      assert.strictEqual(retry.data.code, 'SHIFT_ALREADY_CLOSED');

      const finalDoc = simDb.getRawDoc('cash_shifts', 'shift-c10');
      assert.strictEqual(finalDoc?.finalCountedCash, 100, 'Valor original imutável');
      assert.strictEqual(finalDoc?.exceptionalPendingJustifications.length, 1, 'Justificativa não duplicada');
      assert.strictEqual(simDb.getRawDoc('orders', 'ord-pend-10')?.paymentStatus, 'PENDENTE');
      void store;
    });

    console.log(`\n🎉 TODOS OS ${passed} BLOCOS DE CENÁRIOS (1 a 10) PASSARAM COM SUCESSO!`);
  } finally {
    server.closeAllConnections?.();
    server.close();
    if (hadExistingTombstoneFile && existingTombstoneBackup !== null) {
      fs.writeFileSync(tmpTombstonePath, existingTombstoneBackup, 'utf8');
    } else if (fs.existsSync(tmpTombstonePath)) {
      fs.unlinkSync(tmpTombstonePath);
    }
    if (hadExistingPushCacheFile && existingPushCacheBackup !== null) {
      fs.writeFileSync(tmpPushCachePath, existingPushCacheBackup, 'utf8');
    } else if (fs.existsSync(tmpPushCachePath)) {
      fs.unlinkSync(tmpPushCachePath);
    }
  }
  process.exit(0);
}

run().catch((err) => {
  console.error('❌ FALHA NA SUITE DE TESTES:', err);
  process.exit(1);
});
