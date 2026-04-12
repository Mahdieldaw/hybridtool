import {
  INITIAL_PROVIDERS,
  getProviderById as registryGetById,
} from '../providers/providerRegistry';
import { PROVIDER_COLORS } from '../constants';
import type { ProviderConfig } from '../providers/providerRegistry';
import { normalizeProviderId } from './provider-id-mapper';

/**
 * Get the full configuration object for a provider.
 */
export function getProviderConfig(providerId: string): ProviderConfig | undefined {
  return registryGetById(providerId) || INITIAL_PROVIDERS.find((p) => p.id === providerId);
}

/**
 * Get the display name for a provider, with a fallback to the ID.
 */
export function getProviderName(providerId: string): string {
  const config = getProviderConfig(providerId);
  return config?.name || providerId || 'Unknown Model';
}

/**
 * Get the color for a provider, with a safe fallback to default/violet.
 */
export function getProviderColor(providerId: string): string {
  // Check specific color map first
  if (PROVIDER_COLORS[providerId]) {
    return PROVIDER_COLORS[providerId];
  }

  // Check config object
  const config = getProviderConfig(providerId);
  if (config?.color) {
    return config.color;
  }

  // Fallback
  return PROVIDER_COLORS['default'] || '#8b5cf6';
}

/**
 * Get the logo source for a provider, if available.
 */
export function getProviderLogo(providerId: string): string | undefined {
  return getProviderConfig(providerId)?.logoSrc;
}

export function getProviderAbbreviation(providerId: string): string {
  const pid = normalizeProviderId(String(providerId || ''));
  if (pid === 'chatgpt') return 'CH';
  if (pid === 'qwen') return 'QW';
  if (pid === 'claude') return 'CL';
  if (pid === 'gemini') return 'GE';
  if (pid === 'gemini-pro') return 'GE2.5';
  if (pid === 'gemini-exp') return 'GE3';
  if (pid === 'grok') return 'GR';
  return (getProviderName(pid) || pid || 'M').slice(0, 4).toUpperCase();
}

export function resolveProviderIdFromCitationOrder(
  modelIndex: number | null | undefined,
  citationSourceOrder?: Record<string | number, string>
): string | null {
  if (!citationSourceOrder || modelIndex == null || !Number.isFinite(modelIndex)) return null;
  const raw = citationSourceOrder[modelIndex];
  const pid = raw ? normalizeProviderId(String(raw)) : '';
  return pid ? pid : null;
}
