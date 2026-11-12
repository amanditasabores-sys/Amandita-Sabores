/**
 * Automated Verification: Cash Shifts Immutability & Atomic Concurrency Protection
 * AMANDITA SABORES - GESTÃO DE CAIXA E FLUXO FINANCEIRO
 */

const assert = require('assert');

console.log('======================================================================');
console.log('TEST SUITE: IMUTABILIDADE DOS TURNOS DE CAIXA FECHADOS');
console.log('AMANDITA SABORES');
console.log('======================================================================\n');

let passedTests = 0;
let totalTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`[PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`[FAIL] ${name}:`, err.message);
  }
}

async function runAsyncTest(name, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`[PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`[FAIL] ${name}:`, err.message);
  }
}

// 1. Simulação do mecanismo atômico de transação do backend
class MockFirestoreBackend {
  constructor() {
    this.storage = new Map();
    this.txQueue = Promise.resolve();
  }

  async runTransaction(updateFn) {
    // Acquire transaction lock to serialize atomic execution
    const prevQueue = this.txQueue;
    let release;
    this.txQueue = new Promise(resolve => { release = resolve; });

    await prevQueue;

    try {
      const tx = {
        get: async (id) => {
          const item = this.storage.get(id);
          return {
            exists: Boolean(item),
            data: () => item ? JSON.parse(JSON.stringify(item)) : null,
          };
        },
        set: (id, data) => {
          this.storage.set(id, JSON.parse(JSON.stringify(data)));
        }
      };

      return await updateFn(tx);
    } finally {
      release();
    }
  }

  async persistCashShift(shift) {
    if (!shift || !shift.id || (shift.status !== 'ABERTO' && shift.status !== 'FECHADO')) {
      return { status: 400, success: false, message: 'Dados inválidos.' };
    }

    let isBlocked = false;
    let conflictMsg = '';

    await this.runTransaction(async (tx) => {
      const existing = await tx.get(shift.id);
      if (existing.exists) {
        const currentData = existing.data();
        if (currentData && currentData.status === 'FECHADO') {
          isBlocked = true;
          conflictMsg = `Operação recusada: O turno de caixa '${shift.id}' já está FECHADO e não pode ser modificado ou sobrescrito.`;
          return;
        }
      }
      tx.set(shift.id, shift);
    });

    if (isBlocked) {
      return { status: 409, success: false, code: 'SHIFT_ALREADY_CLOSED', message: conflictMsg };
    }

    return { status: 200, success: true, message: 'Gravado com sucesso.' };
  }
}

// 2. Simulação da regra de validação do Firestore Rules
function evalFirestoreCashShiftUpdateRule(existing, incoming) {
  // Regra: allow update: if isValidId(shiftId) && (isAdmin() || (isStaff() && ...)) && resource.data.status != 'FECHADO';
  if (!existing) return true; // criação é tratada por 'allow create'
  return existing.status !== 'FECHADO';
}

function evalFirestoreCashShiftCreateRule(existing) {
  return true;
}

(async () => {
  const backend = new MockFirestoreBackend();

  // Teste 1: Criar novo turno
  await runAsyncTest('1. Criar novo turno: permitido', async () => {
    const shift1 = {
      id: 'shift-2026-11-11-01',
      openedAt: '2026-11-11T08:00:00Z',
      status: 'ABERTO',
      openedBy: 'admin',
      initialBalance: 150.00,
      movements: []
    };
    const res = await backend.persistCashShift(shift1);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.success, true);
    assert.strictEqual(backend.storage.get('shift-2026-11-11-01').status, 'ABERTO');
  });

  // Teste 2: Atualizar turno aberto
  await runAsyncTest('2. Atualizar turno aberto: permitido', async () => {
    const shift1Updated = {
      id: 'shift-2026-11-11-01',
      openedAt: '2026-11-11T08:00:00Z',
      status: 'ABERTO',
      openedBy: 'admin',
      initialBalance: 150.00,
      movements: [
        { id: 'mov-1', type: 'SUPRIMENTO', amount: 50.00, description: 'Troco', timestamp: '2026-11-11T09:00:00Z' }
      ]
    };
    const res = await backend.persistCashShift(shift1Updated);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(backend.storage.get('shift-2026-11-11-01').movements.length, 1);
  });

  // Teste 3: Fechar turno aberto
  await runAsyncTest('3. Fechar turno aberto: permitido', async () => {
    const shift1Closed = {
      id: 'shift-2026-11-11-01',
      openedAt: '2026-11-11T08:00:00Z',
      closedAt: '2026-11-11T18:00:00Z',
      status: 'FECHADO',
      openedBy: 'admin',
      closedBy: 'admin',
      initialBalance: 150.00,
      finalCalculatedBalance: 200.00,
      finalCountedCash: 200.00,
      difference: 0,
      movements: [
        { id: 'mov-1', type: 'SUPRIMENTO', amount: 50.00, description: 'Troco', timestamp: '2026-11-11T09:00:00Z' }
      ]
    };
    const res = await backend.persistCashShift(shift1Closed);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(backend.storage.get('shift-2026-11-11-01').status, 'FECHADO');
  });

  // Teste 4: Tentar alterar turno já fechado pelo endpoint: BLOQUEADO
  await runAsyncTest('4. Tentar alterar turno já fechado pelo endpoint: BLOQUEADO (HTTP 409)', async () => {
    const shiftTampered = {
      id: 'shift-2026-11-11-01',
      openedAt: '2026-11-11T08:00:00Z',
      closedAt: '2026-11-11T18:00:00Z',
      status: 'FECHADO',
      openedBy: 'admin',
      closedBy: 'admin',
      initialBalance: 9999.00, // Tentativa de adulterar saldo inicial
      finalCalculatedBalance: 9999.00,
      movements: [] // Tentativa de apagar movimentos
    };
    const res = await backend.persistCashShift(shiftTampered);
    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.code, 'SHIFT_ALREADY_CLOSED');
    assert.strictEqual(res.success, false);

    // Confirmar que o documento permaneceu inalterado no banco
    const currentInDb = backend.storage.get('shift-2026-11-11-01');
    assert.strictEqual(currentInDb.initialBalance, 150.00);
    assert.strictEqual(currentInDb.movements.length, 1);
  });

  // Teste 5: Tentar alterar turno já fechado diretamente pelo Firestore: BLOQUEADO
  runTest('5. Tentar alterar turno já fechado pelo Firestore: BLOQUEADO pelas regras', () => {
    const existingClosed = { id: 'shift-1', status: 'FECHADO' };
    const existingOpen = { id: 'shift-1', status: 'ABERTO' };

    // Regra no update: resource.data.status != 'FECHADO'
    assert.strictEqual(evalFirestoreCashShiftUpdateRule(existingOpen, { status: 'FECHADO' }), true);
    assert.strictEqual(evalFirestoreCashShiftUpdateRule(existingClosed, { status: 'ABERTO' }), false);
    assert.strictEqual(evalFirestoreCashShiftUpdateRule(existingClosed, { notes: 'Tentativa de alteração' }), false);
  });

  // Teste 6: Concorrência com duas atualizações simultâneas (uma fechando)
  await runAsyncTest('6. Concorrência: turno não termina sobrescrito após fechado', async () => {
    const shiftConcorrente = {
      id: 'shift-concurrent-01',
      openedAt: '2026-11-11T08:00:00Z',
      status: 'ABERTO',
      openedBy: 'admin',
      initialBalance: 100,
      movements: []
    };
    await backend.persistCashShift(shiftConcorrente);

    // Operação A fecha o turno
    const closingOp = backend.persistCashShift({
      ...shiftConcorrente,
      status: 'FECHADO',
      closedAt: '2026-11-11T12:00:00Z'
    });

    // Operação B tenta adicionar uma venda
    const lateSaleOp = backend.persistCashShift({
      ...shiftConcorrente,
      status: 'ABERTO',
      movements: [{ id: 'mov-tardia', type: 'VENDA', amount: 30 }]
    });

    const [resA, resB] = await Promise.all([closingOp, lateSaleOp]);

    // O turno deve terminar com status FECHADO e nunca ser regredido para ABERTO
    const finalDoc = backend.storage.get('shift-concurrent-01');
    assert.strictEqual(finalDoc.status, 'FECHADO');
  });

  // Teste 7: Tentar criar um turno novo com outro ID: permitido
  await runAsyncTest('7. Criar turno novo com outro ID: permitido', async () => {
    const shift2 = {
      id: 'shift-2026-11-12-02',
      openedAt: '2026-11-12T08:00:00Z',
      status: 'ABERTO',
      openedBy: 'caixa1',
      initialBalance: 200.00,
      movements: []
    };
    const res = await backend.persistCashShift(shift2);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.success, true);
    assert.strictEqual(backend.storage.get('shift-2026-11-12-02').status, 'ABERTO');
  });

  // Teste 8: Confirmar que movimentos e valores do turno fechado permanecem intactos
  runTest('8. Confirmar que movimentos e valores do turno fechado permanecem intactos', () => {
    const closedShift = backend.storage.get('shift-2026-11-11-01');
    assert.strictEqual(closedShift.status, 'FECHADO');
    assert.strictEqual(closedShift.initialBalance, 150.00);
    assert.strictEqual(closedShift.finalCalculatedBalance, 200.00);
    assert.strictEqual(closedShift.movements.length, 1);
    assert.strictEqual(closedShift.movements[0].amount, 50.00);
    assert.strictEqual(closedShift.movements[0].description, 'Troco');
  });

  console.log(`\n======================================================`);
  console.log(`RESULTADO DA SUÍTE DE TESTES: ${passedTests}/${totalTests} TESTES APROVADOS.`);
  console.log(`======================================================`);

  if (passedTests !== totalTests) {
    process.exit(1);
  }
})();
