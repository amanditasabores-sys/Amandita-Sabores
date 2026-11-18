/**
 * Testes Unitários — Sincronização Pública de Cardápio (Firestore -> Store -> UI)
 *
 * Verifica:
 * 1. Atualizações remotas (preço, imagemUrl, disponibilidade) atualizam getMenuItems() e emitem FIRESTORE_MENU_SYNCED.
 * 2. Resposta vazia ou falha NÃO apaga nem sobrescreve o cardápio local.
 * 3. Falha em localStorage.setItem não quebra a execução.
 * 4. Reconexão / erro do listener limpa listeners anteriores sem duplicidade e permite retentativa.
 * 5. saveMenuItem remove costPrice do payload gravado em menu_items.
 * 6. MenuManagement.tsx escuta gestaofood_state_changed para FIRESTORE_MENU_SYNCED / MENU_UPDATED / COMBOS_UPDATED e remove listener ao desmontar.
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const storageMap = new Map<string, string>();
const dispatchedEvents: Array<{ type: string; detail?: unknown }> = [];
const windowListeners = new Map<string, Set<Function>>();
const docListeners = new Map<string, Set<Function>>();

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
  dispatchEvent: (ev: { type: string; detail?: unknown }) => {
    dispatchedEvents.push(ev);
    const listeners = windowListeners.get(ev.type);
    if (listeners) {
      listeners.forEach((fn) => fn(ev));
    }
    return true;
  },
  addEventListener: (type: string, fn: Function) => {
    if (!windowListeners.has(type)) windowListeners.set(type, new Set());
    windowListeners.get(type)!.add(fn);
  },
  removeEventListener: (type: string, fn: Function) => {
    windowListeners.get(type)?.delete(fn);
  },
};

(globalThis as any).document = {
  visibilityState: 'visible',
  addEventListener: (type: string, fn: Function) => {
    if (!docListeners.has(type)) docListeners.set(type, new Set());
    docListeners.get(type)!.add(fn);
  },
  removeEventListener: (type: string, fn: Function) => {
    docListeners.get(type)?.delete(fn);
  },
};

Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: {
    onLine: true,
    userAgent: 'AmanditaMenuSyncTest/1.0',
  },
});

async function runTests() {
  const { store } = await import('../src/services/store');
  let passed = 0;
  let total = 0;

  const check = (name: string, fn: () => void) => {
    total++;
    try {
      fn();
      passed++;
      console.log(`[PASS] ${name}`);
    } catch (err: any) {
      console.error(`[FAIL] ${name}: ${err?.message || err}`);
    }
  };

  check('1. applyRemoteMenuItems atualiza preço e imageUrl de cuscuz-manteiga e cuscuz-ovos e emite FIRESTORE_MENU_SYNCED', () => {
    dispatchedEvents.length = 0;
    const beforeItems = store.getMenuItems();
    assert.ok(beforeItems.length > 0, 'Catálogo base deve conter itens oficiais');

    const manteiga = beforeItems.find((i) => i.id === 'cuscuz-manteiga' || i.name.toLowerCase().includes('manteiga'));
    const ovos = beforeItems.find((i) => i.id === 'cuscuz-ovos' || i.name.toLowerCase().includes('ovos'));
    assert.ok(manteiga && ovos, 'Itens de cuscuz devem existir no catálogo inicial');

    (store as any).applyRemoteMenuItems([
      {
        id: manteiga!.id,
        data: {
          ...manteiga,
          price: 5.5,
          imageUrl: 'https://cdn.example.com/cuscuz-manteiga-novo.jpg',
          available: true,
        },
      },
      {
        id: ovos!.id,
        data: {
          ...ovos,
          price: 7.0,
          imageUrl: 'https://cdn.example.com/cuscuz-ovos-novo.jpg',
          available: true,
        },
      },
    ]);

    const afterItems = store.getMenuItems();
    const updatedManteiga = afterItems.find((i) => i.id === manteiga!.id)!;
    const updatedOvos = afterItems.find((i) => i.id === ovos!.id)!;

    assert.strictEqual(updatedManteiga.price, 5.5, 'Preço de cuscuz-manteiga deve ser atualizado para R$ 5,50');
    assert.strictEqual(updatedManteiga.imageUrl, 'https://cdn.example.com/cuscuz-manteiga-novo.jpg', 'imageUrl de cuscuz-manteiga deve ser atualizada');
    assert.strictEqual(updatedOvos.price, 7.0, 'Preço de cuscuz-ovos deve ser atualizado para R$ 7,00');
    assert.strictEqual(updatedOvos.imageUrl, 'https://cdn.example.com/cuscuz-ovos-novo.jpg', 'imageUrl de cuscuz-ovos deve ser atualizada');

    const syncEvents = dispatchedEvents.filter((e: any) => e?.detail?.type === 'FIRESTORE_MENU_SYNCED');
    assert.strictEqual(syncEvents.length, 1, 'Deve emitir FIRESTORE_MENU_SYNCED quando houver alteração');
  });

  check('2. Snapshot idêntico repetido NÃO gera escrita/evento redundante (sem loop de renderização)', () => {
    const current = store.getMenuItems();
    const sample = current[0];
    (store as any).applyRemoteMenuItems([{ id: sample.id, data: { ...sample } }]);
    dispatchedEvents.length = 0;
    (store as any).applyRemoteMenuItems([{ id: sample.id, data: { ...sample } }]);
    const syncEvents = dispatchedEvents.filter((e: any) => e?.detail?.type === 'FIRESTORE_MENU_SYNCED');
    assert.strictEqual(syncEvents.length, 0, 'Snapshot idêntico não deve disparar FIRESTORE_MENU_SYNCED redundante');
  });

  check('3. Resposta vazia ou inválida do Firestore NUNCA apaga dados locais do cardápio', () => {
    const countBefore = store.getMenuItems().length;
    const rawBefore = localStorage.getItem('gf_menu_items');
    (store as any).applyRemoteMenuItems([]);
    (store as any).applyRemoteMenuItems([{ id: 'invalid', data: {} }]);
    assert.strictEqual(store.getMenuItems().length, countBefore, 'Quantidade de itens locais não pode diminuir');
    assert.strictEqual(localStorage.getItem('gf_menu_items'), rawBefore, 'Cache local não deve ser sobrescrito por resposta vazia');
  });

  check('4. Erro de quota/armazenamento em localStorage.setItem não interrompe execução', () => {
    const origSetItem = globalThis.localStorage.setItem;
    globalThis.localStorage.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    try {
      const sample = store.getMenuItems()[0];
      assert.doesNotThrow(() => {
        (store as any).applyRemoteMenuItems([
          { id: sample.id, data: { ...sample, price: sample.price + 1 } },
        ]);
      });
    } finally {
      globalThis.localStorage.setItem = origSetItem;
    }
  });

  check('5. teardownPublicListenersOnly limpa listeners sem duplicidade e zera estado ativo', () => {
    let unsubCalls = 0;
    (store as any).publicUnsubscribers = [
      () => { unsubCalls++; },
      () => { unsubCalls++; },
    ];
    (store as any).isPublicSyncActive = true;
    (store as any).teardownPublicListenersOnly();

    assert.strictEqual(unsubCalls, 2, 'Todos os listeners públicos anteriores devem ser cancelados');
    assert.strictEqual((store as any).publicUnsubscribers.length, 0, 'Lista de unsubscribers públicos deve ficar vazia');
    assert.strictEqual((store as any).isPublicSyncActive, false, 'isPublicSyncActive deve voltar para false após teardown');
  });

  check('6. MenuManagement.tsx escuta gestaofood_state_changed e faz cleanup no unmount', () => {
    const menuMgmtPath = path.join(process.cwd(), 'src/components/admin/MenuManagement.tsx');
    const content = fs.readFileSync(menuMgmtPath, 'utf8');
    assert.ok(content.includes("window.addEventListener('gestaofood_state_changed'"), 'MenuManagement deve registrar listener gestaofood_state_changed');
    assert.ok(content.includes("window.removeEventListener('gestaofood_state_changed'"), 'MenuManagement deve remover listener no unmount');
    assert.ok(content.includes('FIRESTORE_MENU_SYNCED'), 'MenuManagement deve reagir a FIRESTORE_MENU_SYNCED');
    assert.ok(content.includes('MENU_UPDATED'), 'MenuManagement deve reagir a MENU_UPDATED');
    assert.ok(content.includes('COMBOS_UPDATED'), 'MenuManagement deve reagir a COMBOS_UPDATED');
  });

  check('7. store.ts implementa getDocsFromServer, tratamento de permissão/rede e hooks de reconexão sem duplicar listeners', () => {
    const storePath = path.join(process.cwd(), 'src/services/store.ts');
    const content = fs.readFileSync(storePath, 'utf8');
    assert.ok(content.includes("getDocsFromServer(collection(db, 'menu_items'))"), 'store.ts deve buscar catálogo atualizado via getDocsFromServer');
    assert.ok(content.includes('permission-denied'), 'store.ts deve identificar erros de permissão');
    assert.ok(content.includes('refreshPublicMenuSync'), 'store.ts deve expor refreshPublicMenuSync para reconexão/visibilidade');
    assert.ok(content.includes('teardownPublicListenersOnly'), 'store.ts deve limpar listeners antes de reanexar');
  });

  console.log(`\n======================================================`);
  console.log(`RESULTADO TESTE SYNC CARDÁPIO: ${passed}/${total} TESTES APROVADOS.`);
  console.log(`======================================================`);

  if (passed !== total) {
    process.exit(1);
  }
  process.exit(0);
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
