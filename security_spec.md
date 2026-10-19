# Amandita Sabores - Security Specification & Test Matrix

## 1. Data Invariants

1. **Order Integrity**: An order cannot be created with negative or empty `totalAmount`, missing `fulfillmentType`, or an invalid initial state (only 'NOVO' or 'EM_PREPARO' permitted on creation).
2. **Role Elevation Guard**: No user can set their own role or promote themselves to `ADMINISTRADOR`. Only administrators can create or modify `users` collection documents.
3. **Audit Immutability**: `access_logs` records are append-only. Once created, no user (not even an administrator) can modify or delete existing access records.
4. **Financial Containment**: Cash shift movements and register records (`cash_shifts`) are inaccessible to unauthenticated external public users.
5. **Public Safety**: Public clients can view `menu_items` and `configs`, track specific orders by ID, and submit valid new orders, but cannot list entire order queues or view staff profiles.

---

## 2. The Dirty Dozen Security Payloads

| # | Vector | Target Path | Payload Intent | Expected Outcome |
|---|---|---|---|---|
| 1 | Public menu overwrite | `/menu_items/item-1` | Unauthenticated client attempts to change burger price to R$ 0.01 | **PERMISSION_DENIED** |
| 2 | Self-promotion | `/users/hacker-uid` | Non-admin user attempts to create user doc with role `ADMINISTRADOR` | **PERMISSION_DENIED** |
| 3 | Log tampering | `/access_logs/log-1` | Any user attempts to delete or update an existing login audit record | **PERMISSION_DENIED** |
| 4 | Cash shift siphon | `/cash_shifts/shift-today` | Unauthenticated user attempts to read cash register balance | **PERMISSION_DENIED** |
| 5 | Order list snooping | `/orders` (list) | Unauthenticated user attempts `collection(db, 'orders')` query | **PERMISSION_DENIED** |
| 6 | Ghost field injection | `/orders/ord-999` | Client injects unauthorized root property `isAdminApproved: true` | **PERMISSION_DENIED** |
| 7 | Negative total order | `/orders/ord-998` | Client submits order with `totalAmount: -50.00` | **PERMISSION_DENIED** |
| 8 | Illegal initial state | `/orders/ord-997` | Client submits order with `status: 'ENTREGUE'` | **PERMISSION_DENIED** |
| 9 | Path variable poisoning | `/orders/%2e%2e%2f` | Attacker injects traversal or non-regex ID string | **PERMISSION_DENIED** |
| 10 | Direct config hijack | `/configs/restaurant` | Unauthenticated client attempts to rewrite `pixKey` to personal account | **PERMISSION_DENIED** |
| 11 | Staff role overwrite | `/users/user-caixa` | Cashier attempts to update their own document to `allowedModules: ['*']` | **PERMISSION_DENIED** |
| 12 | Customer spoofing | `/orders/ord-1002` | Unauthenticated client attempts to delete existing order | **PERMISSION_DENIED** |

---

## 3. Test Verification Plan

All paths and invariants have been modeled into `firestore.rules`.
When deployed to Firebase project `amandita-sabores`, these rules guarantee zero-trust protection while preserving full functionality for the mobile cardápio, kitchen KDS, POS register, and delivery portal.
