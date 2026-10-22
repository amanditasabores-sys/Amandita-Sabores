# Plano de Implementação — Sincronização em Tempo Real entre Celular e Computador (Amandita Sabores)

Garantir a persistência bidirecional e sincronização em tempo real de pedidos, cardápio, status de produção e configurações entre celular e computador através do Cloud Firestore (`amandita-sabores`), eliminando operações silenciosas em cache local e tratando rigorosamente regras de segurança e conectividade.

---

### Decisões Críticas e Diagnóstico Inicial

> [!IMPORTANT]
> **Causa Raiz Identificada no Firestore Remoto**:
> Nossos testes de sondagem direta com o SDK confirmaram que o projeto `amandita-sabores` e o banco `(default)` na região `southamerica-east1` estão ativos, mas as operações de leitura e gravação no servidor do Google retornam `permission-denied` (Code 7: PERMISSION_DENIED).
> Isso ocorre porque as regras ativas no console do Firebase estão bloqueando as requisições públicas de leitura do cardápio e criação de pedidos, ou porque o arquivo `firestore.rules` preparado localmente ainda não está ativo no console do Firebase do projeto.
>
> **Diretrizes adotadas neste plano**:
> 1. **Não enfraquecer regras**: manter regras estritas que permitam a clientes ler o cardápio e criar pedidos, enquanto restringem a listagem interna e alterações de status aos operadores/administrador.
> 2. **Fila de Sincronização Resiliente (Pending Sync Queue)**: gravações não podem apenas gerar um log no console quando falharem; devem permanecer na fila com status `SINCRONIZANDO` / `PENDENTE` até que a nuvem confirme.
> 3. **Preservação Visual e Funcional**: nenhuma tela, layout, permissão ou dado local existente será apagado ou desconfigurado.

---

### 1. Visão Geral e Conceito do Fluxo de Dados

- **O que a solução faz**: Permite que pedidos criados no celular (via cardápio público ou app) apareçam instantaneamente no computador (KDS cozinha, PDV e Kanban administrativo) e vice-versa, com atualização de status em tempo real (ex.: "EM_PREPARO" → "PRONTO" → "EM_ROTA" → "ENTREGUE").
- **Público-alvo**: Clientes no celular (cardápio e rastreamento), Atendentes/Caixas no balcão, Cozinha (KDS) e Administrador no computador.
- **Valor Principal**: Eliminação de discrepâncias entre dispositivos e garantia de que nenhum pedido seja perdido por falha de conectividade ou encerramento da aba.

---

### 2. Experiência do Usuário e Manutenção Visual

- **Preservação Total**: Mantém a paleta de cores original Amandita Sabores (`#2C1810`, `#C86D3B`, `#FAF7F2`, `#FFFDF9`), tipografia (*Plus Jakarta Sans* e *JetBrains Mono*) e layouts das telas individuais de cada perfil.
- **Indicador de Sincronização em Tempo Real**:
  - Quando um pedido estiver sendo gravado no Cloud Firestore, o botão e o card do pedido mostram feedback visual sutil ("Sincronizando com a Nuvem..." / "Confirmado na Nuvem").
  - Caso haja perda momentânea de conexão ou restrição de regras, o sistema exibe aviso discreto e mantém a operação salva localmente para envio automático imediato assim que a conexão/permissão for restabelecida.

---

### 3. Decisões de Produto e Arquitetura de Dados

- **Decisão 1: Gravação Assíncrona Confirmada (Awaited Writes)**:
  - *Abordagem*: As funções `createOrder`, `updateOrderStatus`, `saveMenuItem` e `saveCashShift` passam a aguardar a confirmação do Firestore (ou registrar formalmente o estado na fila pendente), em vez de executar `setDoc` em segundo plano sem controle.
  - *Benefício*: Evita que o operador no computador ou o cliente no celular acreditem que uma operação foi transmitida à nuvem quando na verdade foi rejeitada por falta de permissão ou rede.
- **Decisão 2: Listeners com Recuperação Automática e Prevenção de Loops**:
  - *Abordagem*: Listeners `onSnapshot` com deduplicação por carimbo de data/hora (`updatedAt`) e identificadores únicos (`id`), evitando repetições infinitas ou duplicação de pedidos ao mesclar dados locais e remotos.
- **Decisão 3: Relatório Detalhado de Regras de Segurança**:
  - *Abordagem*: Mapear exatamente quais regras de segurança no arquivo `firestore.rules` precisam ser ativadas no Console do Firebase para viabilizar o fluxo cliente-atendente-cozinha.

---

### 4. Arquitetura Técnica e Diagrama do Sistema

```
┌────────────────────────────────────────────────────────────────────────┐
│                        FLUXO DE DADOS MULTIDEVICE                      │
└────────────────────────────────────────────────────────────────────────┘

     CELULAR (Cliente / Cardápio)            COMPUTADOR (KDS / PDV / Admin)
   ┌──────────────────────────────┐        ┌──────────────────────────────┐
   │ • Cardápio Web               │        │ • KDS Cozinha                │
   │ • Criação de Pedido          │        │ • PDV Balcão / Caixa         │
   │ • Rastreamento               │        │ • Painel Administrativo      │
   └──────────────┬───────────────┘        └──────────────▲───────────────┘
                  │                                       │
                  │ 1. setDoc(orders, ord-id)             │ 3. onSnapshot(orders)
                  ▼                                       │    Recebe pedido novo
   ┌──────────────────────────────────────────────────────┴───────────────┐
   │               GOOGLE CLOUD FIRESTORE (amandita-sabores)              │
   │               Região: southamerica-east1 | DB: (default)             │
   │                                                                      │
   │  Coleções:                                                           │
   │  ├── menu_items/      (Leitura pública / Edição staff)               │
   │  ├── configs/         (Leitura pública / Edição admin)               │
   │  ├── orders/          (Criação cliente/staff, listagem staff)        │
   │  ├── public_tracking/ (Leitura pelo código único do pedido)          │
   │  ├── cash_shifts/     (Restrito ao Caixa / Gerente / Admin)          │
   │  └── users/           (Perfis e permissões dos funcionários)         │
   └──────────────────────────────────────────────────────────────────────┘
                  │                                       ▲
                  │ 4. onSnapshot(orders)                 │ 2. updateDoc(orders)
                  │    Atualização em tempo real          │    "EM_PREPARO"
                  ▼                                       │
   ┌──────────────────────────────┐        ┌──────────────┴───────────────┐
   │ • Rastreamento atualizado    │        │ • Cozinha avança status      │
   │   instantaneamente           │        │ • Sincronizado no Firestore  │
   └──────────────────────────────┘        └──────────────────────────────┘
```

#### Mapeamento de Coleções e Operações Afetadas:

| Coleção Firestore | Módulos que Utilizam | Operação | Requisito de Permissão no Firestore |
| :--- | :--- | :--- | :--- |
| `menu_items` | Cardápio, PDV, Cozinha, Admin | Leitura (Get/List) | **Pública** (qualquer cliente pode ver itens disponíveis) |
| `menu_items` | Gerenciamento de Cardápio | Criação, Atualização, Exclusão | **Restrita** ao Administrador / Gerente |
| `configs` | Cardápio (PIX, Horários), Admin | Leitura (Get) | **Pública** (chave PIX oficial e taxas) |
| `configs` | Configurações da Loja | Escrita (Write) | **Restrita** ao Administrador |
| `orders` | Cardápio, PDV | Criação (Create) | **Pública e Staff** (com validação estrita dos campos do pedido) |
| `orders` | KDS, Kanban, PDV, Entregas | Listagem (List) e Atualização (Update) | **Colaboradores autorizados** (Staff) |
| `public_tracking` | Rastreio de Pedidos | Leitura (Get) e Escrita (Create/Update) | **Pública por Código Seguro** (`trackingCode`) |
| `cash_shifts` | Caixa, Relatórios Financeiros | Leitura e Escrita | **Restrita** a Caixa, Gerente e Admin |
| `users` | Gestão de Equipe, Login | Leitura e Escrita | **Restrita** a Administrador / Gerente |

---

### 5. Plano de Execução em Etapas

1. **Revisão e Correção do `store.ts`**:
   - Atualizar `createOrder` e `updateOrderStatus` para gravação assíncrona com confirmação e registro de fila pendente (`pendingSyncQueue`).
   - Tornar o listener de pedidos resiliente, permitindo sincronização ativa tanto com sessão autenticada quanto por chave operacional de equipe.
   - Sincronização do cardápio (`menu_items`) e dados da loja (`configs`) com tratamento amigável de erro de permissão sem desconectar listeners.
2. **Componentes de Pedidos e Cardápio**:
   - Ajustar `CustomerMenu.tsx`, `PointOfSale.tsx`, `KitchenScreen.tsx`, `CashierScreen.tsx` e `AttendantScreen.tsx` para apresentar feedback visual real sobre o status da gravação na nuvem.
3. **Auditoria das Regras `firestore.rules`**:
   - Fornecer as regras exatas e documentadas prontas para publicação no Console do Firebase, corrigindo a barreira `permission-denied` que atualmente bloqueia a sincronização.
4. **Testes de Validação**:
   - Teste automatizado de criação, escuta e persistência de pedidos.
   - Verificação de não duplicidade de registros e integridade após recarregamento.
