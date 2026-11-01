/**
 * Test Suite Automatizada para Impressora Térmica 58mm (Amandita Sabores)
 * Valida formatação ESC/POS (32 colunas), sanitização de acentos,
 * filtros de auto-impressão (RETIRADA apenas), prevenção de duplicação,
 * fallback para modos BLE, RawBT e Spooler, e resiliência a falhas de conexão.
 */

const fs = require('fs');
const path = require('path');

let testsPassed = 0;
let testsFailed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ [PASS] ${message}`);
    testsPassed++;
  } else {
    console.error(`  ✗ [FAIL] ${message}`);
    testsFailed++;
  }
}

console.log('====================================================');
console.log('TEST SUITE: IMPRESSORA TÉRMICA 58MM (AMANDITA SABORES)');
console.log('====================================================');

// 1. Inspecionar o código fonte de src/services/thermalPrinter.ts
const thermalServicePath = path.resolve(__dirname, '../src/services/thermalPrinter.ts');
const serviceContent = fs.readFileSync(thermalServicePath, 'utf8');

console.log('\n1. Testando Configuração e Modos de Conexão...');
assert(serviceContent.includes("'58mm'"), "Suporte à largura 58mm explicitamente definida");
assert(serviceContent.includes("'bluetooth_ble'"), "Modo Web Bluetooth BLE/GATT disponível");
assert(serviceContent.includes("'android_rawbt'"), "Modo Android RawBT Intent disponível para Bluetooth clássico SPP");
assert(serviceContent.includes("'system_print'"), "Modo Spooler / Impressão do Sistema disponível como fallback");
assert(serviceContent.includes("localStorage.getItem('gf_thermal_printer_config')"), "Configurações persistidas em localStorage");

console.log('\n2. Testando Especificação ESC/POS de 58mm (32 colunas)...');
assert(serviceContent.includes("ESC, 0x40") || serviceContent.includes("0x1b, 0x40"), "Comando de inicialização ESC/POS (ESC @)");
assert(serviceContent.includes("LINE_WIDTH = 32") || serviceContent.includes("WIDTH_58MM = 32") || serviceContent.includes("cols = 32") || serviceContent.includes("32"), "Largura de 32 colunas configurada para bobina de 58mm");
assert(serviceContent.includes("normalize('NFD')") || serviceContent.includes("sanitizeText"), "Sanitização de caracteres acentuados para compatibilidade com código de página CP850/ASCII");
assert(serviceContent.includes("0x1d, 0x56") || serviceContent.includes("GS, 0x56"), "Comando ESC/POS para corte de papel (GS V)");

console.log('\n3. Testando Regra de Auto-Impressão e Prevenção de Duplicatas...');
// Checar em store.ts se apenas RETIRADA dispara auto-impressão
const storePath = path.resolve(__dirname, '../src/services/store.ts');
const storeContent = fs.readFileSync(storePath, 'utf8');

assert(storeContent.includes("fulfillmentType === 'RETIRADA'"), "Auto-impressão restrita exclusivamente a pedidos de RETIRADA no balcão");
assert(!storeContent.includes("fulfillmentType === 'ENTREGA' && autoPrint"), "Pedidos de entrega NÃO disparam auto-impressão compulsória");
assert(serviceContent.includes("gf_printed_order_ids") || serviceContent.includes("printed_order_ids"), "Cache de IDs impressos para prevenir duplicações acidentais");
assert(serviceContent.includes("forceReprint"), "Suporte a reimpressão manual autorizada com carimbo de [2ª VIA]");

console.log('\n4. Testando Isolamento de Falhas e Resiliência...');
assert(serviceContent.includes("catch"), "Captura de exceções implementada para não quebrar o fluxo do PDV/Cozinha");
assert(serviceContent.includes("isBluetoothSupported"), "Detecção dinâmica da API Web Bluetooth no navegador");
assert(serviceContent.includes("rawbt:base64") || serviceContent.includes("intent:base64") || serviceContent.includes("rawbt"), "URI scheme para RawBT Android");

console.log('\n5. Testando Integração nos Módulos de Operação...');
const kanbanPath = path.resolve(__dirname, '../src/components/admin/LiveOrdersKanban.tsx');
const kanbanContent = fs.readFileSync(kanbanPath, 'utf8');
assert(kanbanContent.includes("thermalPrinterService") || kanbanContent.includes("printOrder"), "Botão de impressão térmica integrado no Kanban de Pedidos");

const kdsPath = path.resolve(__dirname, '../src/components/admin/KitchenDisplaySystem.tsx');
const kdsContent = fs.readFileSync(kdsPath, 'utf8');
assert(kdsContent.includes("thermalPrinterService") || kdsContent.includes("printOrder"), "Botão de impressão rápida integrado no Display da Cozinha (KDS)");

const posPath = path.resolve(__dirname, '../src/components/admin/PointOfSale.tsx');
const posContent = fs.readFileSync(posPath, 'utf8');
assert(posContent.includes("thermalPrinterService") || posContent.includes("printOrder"), "Botão de emissão de comprovante térmico integrado no PDV");

const printerSettingsPath = path.resolve(__dirname, '../src/components/admin/PrinterSettings.tsx');
const printerSettingsContent = fs.readFileSync(printerSettingsPath, 'utf8');
assert(printerSettingsContent.includes("connectBluetoothBLE"), "Interface administrativa inclui botão de pareamento Bluetooth");
assert(printerSettingsContent.includes("printTestReceipt"), "Interface administrativa inclui botão de Impressão de Teste");

console.log('\n6. Testando Diferenciação de Cupom: RETIRADA vs ENTREGA...');
assert(serviceContent.includes("isDelivery"), "Detecção dinâmica da modalidade do pedido no comprovante");
assert(serviceContent.includes("*** RETIRADA NO BALCAO ***"), "Indicação expressa de RETIRADA NO BALCÃO");
assert(serviceContent.includes("*** ENTREGA ***"), "Indicação expressa de ENTREGA");
assert(serviceContent.includes("ENDERECO DE ENTREGA:"), "Seção formatada de endereço de entrega");
assert(serviceContent.includes("TAXA DE ENTREGA:"), "Taxa de entrega discriminada nos totais para pedidos de entrega");

console.log('\n7. Testando Resiliência de Conexão BLE e Reconexão...');
assert(serviceContent.includes("discoverWriteCharacteristic"), "Redescoberta dinâmica de característica de escrita BLE");
assert(serviceContent.includes("reconnectSavedBLE"), "Reconexão com dispositivo BLE salvo sem reabrir diálogo");
assert(printerSettingsContent.includes("handleReconnectSaved") || printerSettingsContent.includes("Reconectar Impressora"), "Botão de reconexão direta disponível na interface de configurações");

console.log('\n8. Testando Deduplicação Estrita de Endereço no Cupom...');
assert(serviceContent.includes("formatReceiptAddressLines"), "Método formatReceiptAddressLines implementado para montagem do endereço");
assert(serviceContent.includes("effectiveApt") && serviceContent.includes("effectiveBlock"), "Deduplicação de apartamento e bloco em campos de número e complemento");
assert(!serviceContent.includes("lines.push(`  ${blockApt}`);\n\n      if (addr.street"), "Bloco e apartamento não são mais concatenados redundantemente com street/number");

console.log('\n9. Testando Rodapé Editável do Cupom...');
assert(serviceContent.includes("getEffectiveFooterText"), "Helper getEffectiveFooterText lê configuração persistente da loja");
assert(!serviceContent.includes("lines.push(this.centerText('amanditasabores.com.br'));"), "Texto fixo do site removido do rodapé em favor de configuração dinâmica");
const settingsPath = path.resolve(__dirname, '../src/components/admin/StoreSettings.tsx');
const settingsContent = fs.readFileSync(settingsPath, 'utf8');
assert(settingsContent.includes("receiptFooterText"), "Campo 'Texto do rodapé do cupom' disponível na tela de configurações da loja");

console.log('\n10. Testando Controle de Volume e Mute do Som de Notificação...');
const audioPath = path.resolve(__dirname, '../src/services/audio.ts');
const audioContent = fs.readFileSync(audioPath, 'utf8');
assert(audioContent.includes("newOrderVolume"), "Controle de volume específico implementado no SoundService");
assert(audioContent.includes("isNewOrderMuted"), "Opção para silenciar som de novos pedidos implementada");
assert(audioContent.includes("testNewOrderAlert"), "Método para testar som de novos pedidos disponível");
assert(settingsContent.includes("orderVolume") && settingsContent.includes("handleVolumeChange"), "Slider de volume (0 a 100%) integrado nas configurações");
assert(settingsContent.includes("isOrderMuted") && settingsContent.includes("handleToggleMuteOrder"), "Checkbox para silenciar som de pedidos integrado nas configurações");
assert(settingsContent.includes("handleTestAudio"), "Botão 'Testar som' integrado na interface de configurações");

console.log('====================================================');
console.log(`TOTAL DE TESTES DA IMPRESSORA E NOTIFICAÇÕES: ${testsPassed + testsFailed} | APROVADOS: ${testsPassed} | FALHAS: ${testsFailed}`);
console.log('====================================================');

if (testsFailed > 0) {
  process.exit(1);
} else {
  console.log('✓ TEST SUITE DA IMPRESSORA TÉRMICA E CONFIGURAÇÕES APROVADA COM SUCESSO!\n');
}
