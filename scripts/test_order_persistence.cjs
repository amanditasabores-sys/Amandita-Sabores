/**
 * Backend Ingestion, Persistence & Security Test Suite
 * Tests /api/orders, catalog price validation, staff authorization,
 * public client restrictions, and persistence error handling.
 */

const assert = require('assert');

// Start backend server or test endpoint logic
async function runTests() {
  console.log('=== INICIANDO TESTES DO BACKEND SEGURO (/api/orders & RBAC) ===\n');

  // Let's test endpoint against the running server on port 3000
  const BASE_URL = 'http://localhost:3000';

  // 1. Health check
  try {
    const healthRes = await fetch(`${BASE_URL}/api/health`);
    assert.strictEqual(healthRes.status, 200, 'Health endpoint deve responder 200');
    const healthData = await healthRes.json();
    console.log('[PASS] 1. Backend Health Check:', healthData.system);
  } catch (err) {
    console.error('[FAIL] Backend não está respondendo em http://localhost:3000:', err.message);
    process.exit(1);
  }

  // 2. Test staff registration without auth (Must be rejected with 403)
  {
    const res = await fetch(`${BASE_URL}/api/auth/register-staff`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'hacker',
        role: 'ADMINISTRADOR',
        requesterRole: 'ADMINISTRADOR' // spoofed in body
      })
    });
    assert.strictEqual(res.status, 403, 'Registro sem token válido deve ser rejeitado com 403');
    console.log('[PASS] 2. RBAC: Rejeitar tentativa de registrar funcionário sem token de autorização');
  }

  // 3. Test order with tampered unit price (Official is 5.00, client sends 0.01)
  {
    const orderTamperedPrice = {
      id: 'ord-tamper-1',
      orderNumber: '#9901',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      fulfillmentType: 'DELIVERY',
      status: 'NOVO',
      paymentStatus: 'PENDENTE',
      paymentMethod: 'PIX',
      customer: { name: 'Cliente Teste' },
      items: [
        {
          id: 'item-1',
          menuItemId: 'cuscuz-manteiga',
          name: 'Cuscuz com manteiga',
          quantity: 1,
          unitPrice: 0.01, // TAMPERED! (Official is 5.00)
          subtotal: 0.01
        }
      ],
      subtotal: 0.01,
      deliveryFee: 5.00,
      discount: 0,
      totalAmount: 5.01,
      trackingCode: 'tk_test_high_entropy_1234567890abcdef'
    };

    const res = await fetch(`${BASE_URL}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order: orderTamperedPrice })
    });
    assert.strictEqual(res.status, 400, 'Preço unitário adulterado deve ser rejeitado com 400');
    const data = await res.json();
    assert.ok(data.message.includes('Preço unitário divergente'), 'Mensagem deve indicar divergência de preço');
    console.log('[PASS] 3. Catálogo Oficial: Rejeitar adulteração de preço unitário (R$ 0,01 vs R$ 5,00)');
  }

  // 4. Test order with tampered addon price (R$ 0.01 vs R$ 3.00)
  {
    const orderTamperedAddon = {
      id: 'ord-tamper-addon-1',
      orderNumber: '#9902',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      fulfillmentType: 'RETIRADA',
      status: 'NOVO',
      paymentStatus: 'PENDENTE',
      paymentMethod: 'PIX',
      customer: { name: 'Cliente Teste' },
      items: [
        {
          id: 'item-1',
          menuItemId: 'cuscuz-manteiga',
          name: 'Cuscuz com manteiga',
          quantity: 1,
          unitPrice: 5.00,
          addons: [{ id: 'ad-queijo', name: 'Queijo', price: 0.01 }], // TAMPERED!
          subtotal: 5.01
        }
      ],
      subtotal: 5.01,
      deliveryFee: 0,
      discount: 0,
      totalAmount: 5.01,
      trackingCode: 'tk_test_high_entropy_1234567890abcdef'
    };

    const res = await fetch(`${BASE_URL}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order: orderTamperedAddon })
    });
    assert.strictEqual(res.status, 400, 'Adicional com preço adulterado deve ser rejeitado');
    console.log('[PASS] 4. Catálogo Oficial: Rejeitar adulteração de preço de adicionais');
  }

  // 5. Test anonymous customer trying to grant self-discount
  {
    const orderSelfDiscount = {
      id: 'ord-tamper-disc-1',
      orderNumber: '#9903',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      fulfillmentType: 'RETIRADA',
      status: 'NOVO',
      paymentStatus: 'PENDENTE',
      paymentMethod: 'PIX',
      customer: { name: 'Cliente Teste' },
      items: [
        {
          id: 'item-1',
          menuItemId: 'cuscuz-manteiga',
          name: 'Cuscuz com manteiga',
          quantity: 1,
          unitPrice: 5.00,
          subtotal: 5.00
        }
      ],
      subtotal: 5.00,
      deliveryFee: 0,
      discount: 4.00, // FORBIDDEN FOR PUBLIC CUSTOMERS
      totalAmount: 1.00,
      trackingCode: 'tk_test_high_entropy_1234567890abcdef'
    };

    const res = await fetch(`${BASE_URL}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order: orderSelfDiscount })
    });
    assert.strictEqual(res.status, 400, 'Desconto concedido por cliente público deve ser rejeitado');
    console.log('[PASS] 5. Fraude de Desconto: Rejeitar concessão de desconto por cliente público');
  }

  // 6. Test anonymous customer trying to create order as PAGO
  {
    const orderFakePaid = {
      id: 'ord-tamper-paid-1',
      orderNumber: '#9904',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      fulfillmentType: 'RETIRADA',
      status: 'NOVO',
      paymentStatus: 'PAGO', // FORBIDDEN FOR PUBLIC CUSTOMERS
      paymentMethod: 'PIX',
      customer: { name: 'Cliente Teste' },
      items: [
        {
          id: 'item-1',
          menuItemId: 'cuscuz-manteiga',
          name: 'Cuscuz com manteiga',
          quantity: 1,
          unitPrice: 5.00,
          subtotal: 5.00
        }
      ],
      subtotal: 5.00,
      deliveryFee: 0,
      discount: 0,
      totalAmount: 5.00,
      trackingCode: 'tk_test_high_entropy_1234567890abcdef'
    };

    const res = await fetch(`${BASE_URL}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order: orderFakePaid })
    });
    assert.strictEqual(res.status, 400, 'Cliente declarando pagamento PAGO deve ser rejeitado');
    console.log('[PASS] 6. Fraude de Pagamento: Rejeitar auto-declaração de pedido PAGO por cliente');
  }

  // 7. Test invalid delivery fee for RETIRADA (must be 0)
  {
    const orderInvalidDelivery = {
      id: 'ord-tamper-fee-1',
      orderNumber: '#9905',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      fulfillmentType: 'RETIRADA',
      status: 'NOVO',
      paymentStatus: 'PENDENTE',
      paymentMethod: 'DINHEIRO',
      customer: { name: 'Cliente Teste' },
      items: [
        {
          id: 'item-1',
          menuItemId: 'cuscuz-manteiga',
          name: 'Cuscuz com manteiga',
          quantity: 1,
          unitPrice: 5.00,
          subtotal: 5.00
        }
      ],
      subtotal: 5.00,
      deliveryFee: 10.00, // RETIRADA must have fee 0
      discount: 0,
      totalAmount: 15.00,
      trackingCode: 'tk_test_high_entropy_1234567890abcdef'
    };

    const res = await fetch(`${BASE_URL}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order: orderInvalidDelivery })
    });
    assert.strictEqual(res.status, 400, 'Taxa de entrega para RETIRADA deve ser 0');
    console.log('[PASS] 7. Taxa de Entrega: Validar que modalidade RETIRADA obriga taxa zero');
  }

  // 8. Test persistence confirmation check:
  // When Firestore write cannot be completed (e.g. cloud rules not published or missing service account credentials),
  // backend MUST return 500 / 403 and NEVER return success: true!
  {
    const validMathOrder = {
      id: 'ord-valid-probe-' + Date.now(),
      orderNumber: '#1050',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      fulfillmentType: 'RETIRADA',
      status: 'NOVO',
      paymentStatus: 'PENDENTE',
      paymentMethod: 'PIX',
      customer: { name: 'Maria Silva', address: { neighborhood: 'Mirante', city: 'Campina Grande' } },
      items: [
        {
          id: 'item-probe-1',
          menuItemId: 'cuscuz-manteiga',
          name: 'Cuscuz com manteiga',
          quantity: 2,
          unitPrice: 5.00,
          subtotal: 10.00
        }
      ],
      subtotal: 10.00,
      deliveryFee: 0,
      discount: 0,
      totalAmount: 10.00,
      trackingCode: 'tk_test_high_entropy_1234567890abcdef'
    };

    const res = await fetch(`${BASE_URL}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order: validMathOrder })
    });

    const data = await res.json();
    if (res.status === 200) {
      assert.strictEqual(data.success, true, 'Se responder 200, gravação foi confirmada');
      console.log('[PASS] 8. Persistência Real: Gravação confirmada diretamente no Firestore!');
    } else {
      // Must NOT return success: true if write was not confirmed!
      assert.strictEqual(data.success, false, 'Se gravação não confirmada no Firestore, success DEVE ser false');
      assert.ok(res.status === 403 || res.status === 500, 'Status deve ser 403 ou 500');
      console.log('[PASS] 8. Persistência Segura: Backend recusou sucesso falso e retornou status ' + res.status + ' (' + data.message.slice(0, 60) + '...)');
    }
  }

  console.log('\n======================================================');
  console.log('TODOS OS TESTES DO BACKEND SEGURO FORAM APROVADOS!');
  console.log('======================================================');
}

runTests().catch((e) => {
  console.error('Falha nos testes:', e);
  process.exit(1);
});
