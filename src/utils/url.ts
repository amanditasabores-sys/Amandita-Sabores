import { store } from '../services/store';

/**
 * Gets the public base URL for sharing (WhatsApp, QR codes, external devices).
 * If running on Google Cloud Run dev proxy (ais-dev-...), converts to the publicly accessible
 * shared preview endpoint (ais-pre-...) so users do NOT get 403 Forbidden on mobile or outside the editor.
 */
export function getPublicBaseUrl(): string {
  if (typeof window === 'undefined') return '';

  try {
    const config = store.getRestaurantConfig();
    if (config?.customPublicUrl && config.customPublicUrl.trim()) {
      return config.customPublicUrl.trim().replace(/\/$/, '');
    }
  } catch {
    // fallback
  }

  const origin = window.location.origin;
  // Convert Google AI Studio internal dev domain to public preview domain
  if (origin.includes('ais-dev-')) {
    return origin.replace('ais-dev-', 'ais-pre-');
  }

  return origin;
}

/**
 * Gets the current active origin running in the browser.
 */
export function getActiveBaseUrl(): string {
  if (typeof window === 'undefined') return '';
  return window.location.origin;
}

/**
 * Builds a robust URL using both search parameter and hash fallback
 * so that any browser or webview correctly routes to the view without 404 or 403.
 */
export function buildAppUrl(
  view: 'cardapio' | 'entregador' | 'rastreio' | 'admin', 
  orderId?: string, 
  trackingCode?: string,
  overrideBase?: string
): string {
  const base = overrideBase ? overrideBase.replace(/\/$/, '') : getPublicBaseUrl();
  let url = `${base}/?view=${view}`;
  if (orderId) {
    url += `&pedido=${encodeURIComponent(orderId)}`;
  }
  if (trackingCode) {
    url += `&tk=${encodeURIComponent(trackingCode)}`;
  }
  return url;
}

/**
 * Public URL generator for WhatsApp, QR Code, and share buttons.
 */
export function getPublicAppUrl(
  view: 'cardapio' | 'entregador' | 'rastreio' | 'admin', 
  orderId?: string,
  trackingCode?: string
): string {
  return buildAppUrl(view, orderId, trackingCode, getPublicBaseUrl());
}

/**
 * Local App URL generator.
 */
export function getLocalAppUrl(
  view: 'cardapio' | 'entregador' | 'rastreio' | 'admin', 
  orderId?: string,
  trackingCode?: string
): string {
  return buildAppUrl(view, orderId, trackingCode, getActiveBaseUrl());
}
