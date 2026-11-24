import type {
  Combo,
  ComboAvailabilityStatus,
  ComboComponent,
  ComboComponentStatus,
  MenuItem,
} from '../types/index.js';

export const DEFAULT_COMBO_IMAGE_URL =
  'https://images.unsplash.com/photo-1541592106381-b31e9677c0e5?auto=format&fit=crop&w=700&q=80';

export function isComboMenuItem(item?: Partial<MenuItem> | null): boolean {
  if (!item || typeof item !== 'object') return false;
  return item.isCombo === true || item.category === 'Combos';
}

export function hasCompleteFirestoreComboMetadata(item?: Partial<MenuItem> | null): boolean {
  if (!item || typeof item !== 'object') return false;
  return item.isCombo === true && Array.isArray(item.comboItems) && item.comboItems.length > 0;
}

export function parseIsoTimestampMs(value?: string | null): number {
  if (!value || typeof value !== 'string') return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function normalizeComboComponents(raw: unknown): ComboComponent[] {
  if (!Array.isArray(raw)) return [];
  const normalized: ComboComponent[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const rec = entry as Record<string, unknown>;
    const menuItemId = typeof rec.menuItemId === 'string' ? rec.menuItemId.trim() : '';
    const name = typeof rec.name === 'string' ? rec.name.trim() : '';
    const quantityNum = Number(rec.quantity);
    const originalPriceNum = Number(rec.originalPrice);
    if (!menuItemId || !name) continue;
    normalized.push({
      menuItemId,
      name,
      quantity: Number.isFinite(quantityNum) && quantityNum > 0 ? Math.round(quantityNum) : 1,
      originalPrice: Number.isFinite(originalPriceNum) && originalPriceNum >= 0 ? originalPriceNum : 0,
    });
  }
  return normalized;
}

export interface EvaluatedComboResult {
  available: boolean;
  availabilityStatus: ComboAvailabilityStatus;
  originalPrice: number;
  missingComponents: ComboComponent[];
  pausedComponents: ComboComponent[];
  componentStatuses: ComboComponentStatus[];
}

/**
 * Avalia a disponibilidade real de um combo a partir dos produtos do catálogo.
 * - Ausência de campo de estoque ou `available === undefined` NÃO torna produto indisponível.
 * - Componente com `available === false` -> 'PAUSED' (bloqueia venda como item pausado).
 * - Componente ausente do catálogo -> 'MISSING' (bloqueia venda, mas distingue de estoque/pausa).
 * - Combo inativo (`active === false`) -> 'INACTIVE' (bloqueia venda).
 */
export function evaluateComboAvailability(
  combo: Pick<Combo, 'active' | 'items' | 'originalPrice'>,
  catalogMap: Map<string, Pick<MenuItem, 'id' | 'name' | 'price' | 'available'>>
): EvaluatedComboResult {
  const items = normalizeComboComponents(combo.items);
  const missingComponents: ComboComponent[] = [];
  const pausedComponents: ComboComponent[] = [];
  const componentStatuses: ComboComponentStatus[] = [];

  let calculatedSum = 0;

  for (const comp of items) {
    const found = catalogMap.get(comp.menuItemId);
    const unitPrice = found && typeof found.price === 'number' ? found.price : comp.originalPrice;
    calculatedSum += unitPrice * comp.quantity;

    if (!found) {
      missingComponents.push(comp);
      componentStatuses.push({ ...comp, status: 'MISSING' });
    } else if (found.available === false) {
      pausedComponents.push(comp);
      componentStatuses.push({ ...comp, status: 'PAUSED' });
    } else {
      componentStatuses.push({ ...comp, status: 'AVAILABLE' });
    }
  }

  let availabilityStatus: ComboAvailabilityStatus;
  if (combo.active === false) {
    availabilityStatus = 'INACTIVE';
  } else if (items.length === 0) {
    availabilityStatus = 'EMPTY_COMPOSITION';
  } else if (pausedComponents.length > 0) {
    availabilityStatus = 'COMPONENT_PAUSED';
  } else if (missingComponents.length > 0) {
    availabilityStatus = 'COMPONENT_MISSING';
  } else {
    availabilityStatus = 'AVAILABLE';
  }

  return {
    available: availabilityStatus === 'AVAILABLE',
    availabilityStatus,
    originalPrice: calculatedSum > 0 ? Math.round((calculatedSum + Number.EPSILON) * 100) / 100 : combo.originalPrice,
    missingComponents,
    pausedComponents,
    componentStatuses,
  };
}

export function getPublicComboUnavailableMessage(
  combo: Pick<Combo, 'active' | 'available' | 'availabilityStatus'>
): { badge: string; detail: string } {
  if (combo.active === false || combo.availabilityStatus === 'INACTIVE') {
    return {
      badge: 'Combo Indisponível',
      detail: 'Este combo está temporariamente desativado no cardápio.',
    };
  }
  if (combo.availabilityStatus === 'COMPONENT_PAUSED') {
    return {
      badge: 'Item Indisponível',
      detail: 'Um ou mais produtos deste combo estão temporariamente pausados no cardápio.',
    };
  }
  if (combo.availabilityStatus === 'COMPONENT_MISSING' || combo.availabilityStatus === 'EMPTY_COMPOSITION') {
    return {
      badge: 'Combo em Atualização',
      detail: 'A composição deste combo está sendo atualizada pela equipe e estará disponível em breve.',
    };
  }
  return {
    badge: 'Indisponível',
    detail: 'Este combo está temporariamente indisponível no momento.',
  };
}

export function menuItemDocumentToComboBase(item: MenuItem): Combo {
  const items = normalizeComboComponents(item.comboItems);
  const sum = items.reduce((acc, comp) => acc + comp.originalPrice * comp.quantity, 0);
  const originalPrice =
    typeof item.originalPrice === 'number' && Number.isFinite(item.originalPrice) && item.originalPrice > 0
      ? item.originalPrice
      : sum > 0
      ? Math.round((sum + Number.EPSILON) * 100) / 100
      : item.price;

  return {
    id: item.id,
    name: item.name,
    description: item.description || '',
    imageUrl: item.imageUrl || DEFAULT_COMBO_IMAGE_URL,
    category: 'Combos',
    items,
    originalPrice,
    comboPrice: item.price,
    active: item.comboActive !== undefined ? item.comboActive !== false : item.available !== false,
    available: item.available !== false,
    featured: Boolean(item.featured),
    tags: Array.isArray(item.tags) && item.tags.length > 0 ? item.tags : ['Combo'],
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    syncSource: 'firestore',
  };
}

export function comboToMenuItemDocument(
  combo: Combo,
  catalogMap: Map<string, Pick<MenuItem, 'id' | 'name' | 'price' | 'available'>>,
  timestampIso?: string
): { menuItem: MenuItem; normalizedCombo: Combo } {
  const now = timestampIso || new Date().toISOString();
  const normalizedItems = normalizeComboComponents(combo.items);
  const evaluation = evaluateComboAvailability(
    {
      active: combo.active !== false,
      items: normalizedItems,
      originalPrice: combo.originalPrice,
    },
    catalogMap
  );

  const tags = Array.isArray(combo.tags) && combo.tags.length > 0 ? combo.tags : ['Combo', 'Especial'];
  const imageUrl = (combo.imageUrl || '').trim() || DEFAULT_COMBO_IMAGE_URL;
  const createdAt = combo.createdAt || now;
  const updatedAt = combo.updatedAt || now;
  const active = combo.active !== false;

  const normalizedCombo: Combo = {
    id: combo.id,
    name: combo.name.trim(),
    description: (combo.description || '').trim(),
    imageUrl,
    category: 'Combos',
    items: normalizedItems,
    originalPrice: evaluation.originalPrice,
    comboPrice: combo.comboPrice,
    active,
    available: evaluation.available,
    availabilityStatus: evaluation.availabilityStatus,
    missingComponents: evaluation.missingComponents,
    pausedComponents: evaluation.pausedComponents,
    componentStatuses: evaluation.componentStatuses,
    featured: Boolean(combo.featured),
    tags,
    createdAt,
    updatedAt,
  };

  // Documento sincronizado em menu_items/{combo.id} (sem costPrice, 100% compatível com firestore.rules)
  const menuItem: MenuItem = {
    id: normalizedCombo.id,
    name: normalizedCombo.name,
    description: normalizedCombo.description,
    category: 'Combos',
    price: normalizedCombo.comboPrice,
    prepTimeMinutes: 20,
    imageUrl,
    available: evaluation.available,
    featured: Boolean(normalizedCombo.featured),
    tags,
    addons: [],
    isCombo: true,
    comboActive: active,
    comboItems: normalizedItems,
    originalPrice: evaluation.originalPrice,
    createdAt,
    updatedAt,
  };

  return { menuItem, normalizedCombo };
}
