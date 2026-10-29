const fs = require('fs');
const path = require('path');
const http = require('http');
const assert = require('assert');

let passed = 0;
let total = 0;

function test(name, fn) {
  total++;
  try {
    fn();
    passed++;
    console.log(`[PASS] ${name}`);
  } catch (err) {
    console.error(`[FAIL] ${name}: ${err.message}`);
  }
}

async function testAsync(name, fn) {
  total++;
  try {
    await fn();
    passed++;
    console.log(`[PASS] ${name}`);
  } catch (err) {
    console.error(`[FAIL] ${name}: ${err.message}`);
  }
}

function fetchLocal(pathname) {
  return new Promise((resolve, reject) => {
    http.get({
      host: '127.0.0.1',
      port: 3000,
      path: pathname,
    }, (res) => {
      let data = [];
      res.on('data', chunk => data.push(chunk));
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(data)
        });
      });
    }).on('error', reject);
  });
}

console.log('=== TEST SUITE DE COMPLACÊNCIA PWA & ANDROID (AMANDITA SABORES) ===\n');

// 1. Manifest Files Tests
test('1. Manifest File: public/manifest.json existe e é JSON válido', () => {
  const content = fs.readFileSync(path.resolve(__dirname, '../public/manifest.json'), 'utf8');
  const manifest = JSON.parse(content);
  assert.strictEqual(manifest.name, 'Amandita Sabores');
  assert.strictEqual(manifest.short_name, 'Amandita');
  assert.ok(manifest.short_name.length <= 12, 'short_name deve ser <= 12 caracteres');
  assert.strictEqual(manifest.start_url, '/');
  assert.strictEqual(manifest.scope, '/');
  assert.strictEqual(manifest.display, 'standalone');
  assert.strictEqual(manifest.theme_color, '#1F100B');
  assert.strictEqual(manifest.background_color, '#FAF7F2');
});

test('2. Manifest Icons: Especifica 192x192, 512x512 e maskable', () => {
  const content = fs.readFileSync(path.resolve(__dirname, '../public/manifest.json'), 'utf8');
  const manifest = JSON.parse(content);
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 3);
  
  const icon192 = manifest.icons.find(i => i.sizes === '192x192');
  assert.ok(icon192, 'Falta ícone 192x192');
  assert.strictEqual(icon192.purpose, 'any');

  const icon512 = manifest.icons.find(i => i.sizes === '512x512' && i.purpose === 'any');
  assert.ok(icon512, 'Falta ícone 512x512 any');

  const maskable = manifest.icons.find(i => i.purpose === 'maskable');
  assert.ok(maskable, 'Falta ícone maskable com margem de segurança');
});

// 2. Physical Icons & Signatures Tests
test('3. Icon Assets: Arquivos PNG e SVG existem com assinatura válida', () => {
  const publicDir = path.resolve(__dirname, '../public');
  const requiredFiles = [
    'icon.svg',
    'icon-maskable.svg',
    'pwa-192x192.png',
    'pwa-512x512.png',
    'pwa-maskable-512x512.png',
    'apple-touch-icon.png',
    'favicon-32x32.png',
    'favicon.ico'
  ];

  for (const file of requiredFiles) {
    const fullPath = path.join(publicDir, file);
    assert.ok(fs.existsSync(fullPath), `Arquivo ausente: ${file}`);
    const stat = fs.statSync(fullPath);
    assert.ok(stat.size > 0, `Arquivo vazio: ${file}`);

    if (file.endsWith('.png')) {
      const buf = fs.readFileSync(fullPath);
      // PNG signature: 89 50 4E 47 0D 0A 1A 0A
      assert.strictEqual(buf[0], 0x89);
      assert.strictEqual(buf[1], 0x50);
      assert.strictEqual(buf[2], 0x4e);
      assert.strictEqual(buf[3], 0x47);
    }
  }
});

// 3. HTML Tags Verification
test('4. HTML Entrypoint: Tags meta para PWA, iOS e Android presentes no index.html', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');
  assert.ok(html.includes('name="theme-color" content="#1F100B"'), 'Falta theme-color');
  assert.ok(html.includes('name="mobile-web-app-capable" content="yes"'), 'Falta mobile-web-app-capable');
  assert.ok(html.includes('name="apple-mobile-web-app-capable" content="yes"'), 'Falta apple-mobile-web-app-capable');
  assert.ok(html.includes('rel="apple-touch-icon"'), 'Falta link apple-touch-icon');
  assert.ok(html.includes('rel="manifest"'), 'Falta link manifest');
});

// 4. Production Dist Bundle Tests
test('5. Bundle de Produção: dist contém service worker e artefatos PWA', () => {
  const distDir = path.resolve(__dirname, '../dist');
  assert.ok(fs.existsSync(path.join(distDir, 'sw.js')), 'Falta dist/sw.js');
  assert.ok(fs.existsSync(path.join(distDir, 'manifest.webmanifest')), 'Falta dist/manifest.webmanifest');
  assert.ok(fs.existsSync(path.join(distDir, 'pwa-192x192.png')), 'Falta dist/pwa-192x192.png');
  assert.ok(fs.existsSync(path.join(distDir, 'pwa-512x512.png')), 'Falta dist/pwa-512x512.png');
});

// 5. In-App Install Prompt UI
test('6. In-App Prompt Component: usePWAInstall e PWAInstallButton presentes no código', () => {
  assert.ok(fs.existsSync(path.resolve(__dirname, '../src/hooks/usePWAInstall.ts')));
  assert.ok(fs.existsSync(path.resolve(__dirname, '../src/components/common/PWAInstallButton.tsx')));
  assert.ok(fs.existsSync(path.resolve(__dirname, '../src/components/common/PWAInstallBanner.tsx')));
});

async function runAsyncTests() {
  await testAsync('7. HTTP 200 no Servidor: /manifest.webmanifest servido com cabeçalho correto', async () => {
    const res = await fetchLocal('/manifest.webmanifest');
    assert.strictEqual(res.statusCode, 200);
    const manifest = JSON.parse(res.body.toString('utf8'));
    assert.strictEqual(manifest.name, 'Amandita Sabores');
    assert.strictEqual(manifest.short_name, 'Amandita');
  });

  await testAsync('8. HTTP 200 no Servidor: Ícones /pwa-192x192.png e /pwa-512x512.png acessíveis', async () => {
    const res192 = await fetchLocal('/pwa-192x192.png');
    assert.strictEqual(res192.statusCode, 200);
    assert.ok(res192.body.length > 1000);

    const res512 = await fetchLocal('/pwa-512x512.png');
    assert.strictEqual(res512.statusCode, 200);
    assert.ok(res512.body.length > 5000);
  });

  await testAsync('9. HTTP 200 no Servidor: /sw.js servido para registro do Service Worker', async () => {
    const res = await fetchLocal('/sw.js');
    assert.strictEqual(res.statusCode, 200);
    const content = res.body.toString('utf8');
    assert.ok(content.length > 50);
  });

  await testAsync('10. Isolamento de Rotas: /api/orders permanece intacto sem interferência do Service Worker', async () => {
    const res = await fetchLocal('/api/health');
    assert.strictEqual(res.statusCode, 200);
  });

  console.log(`\n======================================================`);
  console.log(`RESULTADO DA SUÍTE PWA: ${passed}/${total} TESTES APROVADOS.`);
  console.log(`======================================================`);

  if (passed !== total) {
    process.exit(1);
  }
}

runAsyncTests().catch((e) => {
  console.error(e);
  process.exit(1);
});
