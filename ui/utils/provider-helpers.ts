import {
  INITIAL_PROVIDERS,
  getProviderById as registryGetById,
} from "../providers/providerRegistry";
import { PROVIDER_COLORS } from "../constants";
import type { ProviderConfig } from "../providers/providerRegistry";

/**
 * Get the full configuration object for a provider.
 */
export function getProviderConfig(
  providerId: string,
): ProviderConfig | undefined {
  return (
    registryGetById(providerId) ||
    INITIAL_PROVIDERS.find((p) => p.id === providerId)
  );
}

/**
 * Get the display name for a provider, with a fallback to the ID.
 */
export function getProviderName(providerId: string): string {
  const config = getProviderConfig(providerId);
  return config?.name || providerId || "Unknown Model";
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

/**
 * Helper to check if a provider requires auth/login
 * (Wraps your auth logic if you have a centralized status map, 
 * otherwise just checks if the provider exists in the config)
 */
export function isProviderValid(providerId: string): boolean {
  return !!getProviderConfig(providerId);
}
