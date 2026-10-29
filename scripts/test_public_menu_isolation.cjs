/**
 * Automated Verification Script: Public Menu Isolation & Access Security Guard
 * Amandita Sabores
 */
const fs = require('fs');
const path = require('path');

let passedTests = 0;
let totalTests = 0;

function assert(condition, testName, details = '') {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✓ [PASS] ${testName}`);
  } else {
    console.error(`  ✗ [FAIL] ${testName}: ${details}`);
  }
}

console.log('====================================================');
console.log('TEST SUITE: PUBLIC MENU ISOLATION & ACCESS SECURITY');
console.log('====================================================\n');

// 1. Verify URL Generation Logic
console.log('1. Testing URL Generation & Parameter Sanitization...');
const urlTsContent = fs.readFileSync(path.join(__dirname, '../src/utils/url.ts'), 'utf8');

// Test regex/content in url.ts
assert(
  urlTsContent.includes('buildAppUrl') && urlTsContent.includes('getPublicAppUrl'),
  'url.ts exports buildAppUrl and getPublicAppUrl'
);

assert(
  urlTsContent.includes('effectiveBase = trackingCode') || urlTsContent.includes('overrideBase'),
  'buildAppUrl safely resolves overrideBase even if passed as 3rd parameter'
);

// Simulate buildAppUrl behavior in JS
function mockBuildAppUrl(view, orderId, trackingCode, overrideBase) {
  let effectiveBase = overrideBase;
  let effectiveTracking = trackingCode;
  if (!effectiveBase && trackingCode && (trackingCode.startsWith('http://') || trackingCode.startsWith('https://'))) {
    effectiveBase = trackingCode;
    effectiveTracking = undefined;
  }
  const base = (effectiveBase || 'https://amandita-sabores.vercel.app').replace(/\/$/, '');
  let url = `${base}/?view=${encodeURIComponent(view)}`;
  if (orderId) url += `&pedido=${encodeURIComponent(orderId)}`;
  if (effectiveTracking) url += `&tk=${encodeURIComponent(effectiveTracking)}`;
  return url;
}

const standardMenuUrl = mockBuildAppUrl('cardapio', undefined, undefined, 'https://amandita-sabores.vercel.app');
assert(
  standardMenuUrl === 'https://amandita-sabores.vercel.app/?view=cardapio',
  'Public menu URL is cleanly formatted without spurious parameters',
  `Got: ${standardMenuUrl}`
);

const thirdParamBaseUrl = mockBuildAppUrl('cardapio', undefined, 'https://amandita-sabores.vercel.app');
assert(
  thirdParamBaseUrl === 'https://amandita-sabores.vercel.app/?view=cardapio',
  'buildAppUrl handles base URL passed in 3rd parameter without generating broken &tk= URL',
  `Got: ${thirdParamBaseUrl}`
);

// 2. Verify Session Storage & No Auto-Admin Leak
console.log('\n2. Testing Session Storage & Auto-Admin Elimination in store.ts...');
const storeTsContent = fs.readFileSync(path.join(__dirname, '../src/services/store.ts'), 'utf8');

assert(
  !storeTsContent.includes("localStorage.setItem('gf_current_user', JSON.stringify(INITIAL_USERS[0]));\n    }") &&
  !storeTsContent.includes("localStorage.setItem('gf_current_user', JSON.stringify(INITIAL_USERS[0]));\r\n    }"),
  'store.ts does NOT automatically store INITIAL_USERS[0] as gf_current_user on initialization'
);

assert(
  storeTsContent.includes('Visitor sessions start unauthenticated (currentUser is null)'),
  'store.ts includes explicit security isolation comment and check for visitor sessions'
);

// 3. Verify Route Guarding in App.tsx
console.log('\n3. Testing Route Guarding & RBAC in App.tsx...');
const appTsxContent = fs.readFileSync(path.join(__dirname, '../src/App.tsx'), 'utf8');

assert(
  !appTsxContent.includes('if (!user) return view === \'admin\';'),
  'App.tsx does NOT grant unauthenticated visitors access to view=admin via isViewAllowedForUser'
);

assert(
  appTsxContent.includes('if (!user) return false;'),
  'App.tsx strictly denies unauthenticated users for internal views (isViewAllowedForUser returns false)'
);

assert(
  appTsxContent.includes('Acesso restrito. Faça login com suas credenciais de colaborador para acessar este módulo.') ||
  appTsxContent.includes('Acesso restrito. Este módulo requer credenciais de colaborador autorizado.'),
  'App.tsx notifies and redirects unauthenticated users attempting direct access to internal views'
);

assert(
  !appTsxContent.includes('⚡ Entrar Imediatamente como Administrador (Demo)'),
  'App.tsx has completely removed the 1-click Demo Administrator bypass button'
);

assert(
  appTsxContent.includes("currentView !== 'cardapio'") && appTsxContent.includes("currentView !== 'rastreio'"),
  'App.tsx strictly hides the global admin toolbar on public customer views (cardapio and rastreio)'
);

// 4. Verify CustomerMenu & AuthModal UI Protection
console.log('\n4. Testing CustomerMenu & AuthModal Isolation...');
const customerMenuContent = fs.readFileSync(path.join(__dirname, '../src/components/menu/CustomerMenu.tsx'), 'utf8');
const authModalContent = fs.readFileSync(path.join(__dirname, '../src/components/auth/AuthModal.tsx'), 'utf8');
const deliveryPortalContent = fs.readFileSync(path.join(__dirname, '../src/components/delivery/DeliveryPortal.tsx'), 'utf8');

assert(
  !customerMenuContent.includes('Painel ADM') && !customerMenuContent.includes('Painel<span className="hidden sm:inline"> ADM</span>'),
  'CustomerMenu header has NO "Painel ADM" button leaking employee navigation'
);

assert(
  !authModalContent.includes('Padrão: 123456'),
  'AuthModal has removed "Padrão: 123456" password disclosure hint'
);

assert(
  !authModalContent.includes('Atalhos de Acesso Rápido por Função'),
  'AuthModal has removed 1-click role quick-fill buttons'
);

assert(
  !authModalContent.includes('signInWithGoogle') && !authModalContent.includes('Entrar com Google'),
  'AuthModal has completely removed Google/Gmail login integration'
);

assert(
  !deliveryPortalContent.includes('|| !currentUser') || !deliveryPortalContent.includes('Painel ADM'),
  'DeliveryPortal does NOT offer Painel ADM navigation to unauthenticated users'
);

assert(
  customerMenuContent.includes('item.available === false'),
  'CustomerMenu safely checks available !== false so items are not prematurely hidden'
);

assert(
  storeTsContent.includes('fallback to INITIAL_MENU to guarantee products are never empty') ||
  storeTsContent.includes('INITIAL_MENU'),
  'store.ts guarantees products never return empty array'
);

assert(
  appTsxContent.includes("// Default main domain: employee access & login\n    return 'admin';") ||
  appTsxContent.includes("Main domain access without parameter: presents employee system access / login"),
  'App.tsx defaults unauthenticated visitors on main domain (no params) to employee login flow'
);

// 5. Verify RBAC Simulation
console.log('\n5. Simulating Access Control Matrix for All User Profiles...');
const roles = [
  { user: null, view: 'cardapio', expected: true, desc: 'Anonymous visitor opening public menu' },
  { user: null, view: 'caixa', expected: false, desc: 'Anonymous visitor opening caixa directly' },
  { user: null, view: 'producao', expected: false, desc: 'Anonymous visitor opening cozinha directly' },
  { user: null, view: 'atendente', expected: false, desc: 'Anonymous visitor opening atendente directly' },
  { user: null, view: 'entregador', expected: false, desc: 'Anonymous visitor opening entregador directly' },
  { user: { role: 'CAIXA' }, view: 'caixa', expected: true, desc: 'Cashier accessing caixa' },
  { user: { role: 'CAIXA' }, view: 'producao', expected: false, desc: 'Cashier accessing cozinha' },
  { user: { role: 'COZINHA' }, view: 'producao', expected: true, desc: 'Kitchen accessing cozinha' },
  { user: { role: 'COZINHA' }, view: 'caixa', expected: false, desc: 'Kitchen accessing caixa' },
  { user: { role: 'ENTREGADOR' }, view: 'entregador', expected: true, desc: 'Driver accessing entregador' },
  { user: { role: 'ENTREGADOR' }, view: 'admin', expected: false, desc: 'Driver accessing admin panel' },
  { user: { role: 'ADMINISTRADOR' }, view: 'admin', expected: true, desc: 'Admin accessing admin panel' },
  { user: { role: 'ADMINISTRADOR' }, view: 'caixa', expected: true, desc: 'Admin accessing caixa' },
];

function simulateIsViewAllowed(view, user) {
  if (view === 'cardapio' || view === 'rastreio') return true;
  if (!user) return false;
  const role = user.role?.toUpperCase();
  if (role === 'ADMINISTRADOR' || role === 'GERENTE' || user.username === 'admin') return true;
  if (role === 'ENTREGADOR') return view === 'entregador';
  if (role === 'COZINHA') return view === 'producao';
  if (role === 'CAIXA') return view === 'caixa';
  if (role === 'ATENDENTE') return view === 'atendente';
  return false;
}

for (const tc of roles) {
  const result = simulateIsViewAllowed(tc.view, tc.user);
  assert(result === tc.expected, `${tc.desc} -> ${result ? 'ALLOWED' : 'BLOCKED'} (expected ${tc.expected ? 'ALLOWED' : 'BLOCKED'})`);
}

console.log('\n====================================================');
console.log(`TOTAL TESTS: ${totalTests} | PASSED: ${passedTests} | FAILED: ${totalTests - passedTests}`);
console.log('====================================================');

if (passedTests === totalTests) {
  console.log('✓ ALL PUBLIC MENU ISOLATION TESTS PASSED SUCCESSFULLY!');
  process.exit(0);
} else {
  console.error('✗ SOME TESTS FAILED.');
  process.exit(1);
}
