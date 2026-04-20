import type { ProviderKey } from '../../shared/types/provider';
import { selectBestProvider, PROVIDER_PRIORITIES } from '../../shared/provider-config';
import { getProviderLocks } from '../providers/provider-locks';
import type { ProviderLocks } from '../providers/provider-locks';

// Provider login URLs (duplicated from auth-config.ts for JS compatibility)
const PROVIDER_URLS: Record<string, string> = {
  chatgpt: 'https://chatgpt.com',
  claude: 'https://claude.ai',
  gemini: 'https://gemini.google.com',
  'gemini-pro': 'https://gemini.google.com',
  'gemini-exp': 'https://gemini.google.com',
  qwen: 'https://qianwen.com',
  grok: 'https://grok.com',
};

export function getProviderUrl(providerId: string): string {
  return PROVIDER_URLS[providerId] || 'the provider website';
}

export function createAuthErrorMessage(
  unauthorizedProviders: string[],
  context: string
): string | null {
  if (!unauthorizedProviders || unauthorizedProviders.length === 0) return null;

  const providerList = unauthorizedProviders.join(', ');
  const urlList = unauthorizedProviders.map((p) => `  • ${p}: ${getProviderUrl(p)}`).join('\n');

  return (
    `The following providers are not authenticated: ${providerList}\n\n` +
    `Please log in at:\n${urlList}\n\n` +
    `Context: ${context}`
  );
}

// Narrowing helpers
const VALID_PROVIDER_KEYS: ReadonlySet<string> = new Set([
  'claude',
  'chatgpt',
  'gemini',
  'gemini-pro',
  'gemini-exp',
  'qwen',
  'grok',
]);

function isProviderKey(p?: string | null): p is ProviderKey {
  return typeof p === 'string' && VALID_PROVIDER_KEYS.has(p.toLowerCase());
}

function normalizeToProviderKeyArray(input: (string | ProviderKey)[] | undefined): ProviderKey[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((s) => (typeof s === 'string' ? s.toLowerCase() : String(s)))
    .filter((s): s is ProviderKey => isProviderKey(s));
}

export async function runPreflight(
  request: {
    providers?: string[] | ProviderKey[];
    mapper?: string | ProviderKey | null;
    singularity?: string | ProviderKey | null;
  },
  authStatus: Record<string, boolean>,
  availableProviders: string[] = []
): Promise<{
  providers: ProviderKey[];
  mapper: ProviderKey | null;
  singularity: ProviderKey | null;
  warnings: string[];
}> {
  let locks: ProviderLocks = { mapping: false, singularity: false };
  const warnings: string[] = [];

  try {
    locks = await getProviderLocks();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    warnings.push(`Failed to fetch provider locks: ${msg}`);
  }

  // === Filter batch providers ===
  // Only block if explicitly false (not authorized)
  // Allow undefined/null (unknown - will verify on actual use)
  const availableLower = availableProviders.map((p) => String(p || '').toLowerCase());

  let providersRaw: string[] = (request.providers ?? []).filter((pid: string | ProviderKey) => {
    const id = String(pid || '').toLowerCase();
    const status = authStatus[id];
    if (status === false) {
      warnings.push(`Provider "${pid}" is not authorized and was removed from batch`);
      return false;
    }
    return true;
  }) as string[];

  // If no providers left, pick smart defaults
  if (providersRaw.length === 0) {
    providersRaw = PROVIDER_PRIORITIES.batch
      .filter((pid) => {
        const status = authStatus[pid.toLowerCase()];
        const notExplicitlyFalse = status !== false;
        return notExplicitlyFalse && availableLower.includes(pid.toLowerCase());
      })
      .slice(0, 3) as string[];
  }

  // === Mapper ===
  let mapper: ProviderKey | null = null;
  if (request.mapper) {
    const m = String(request.mapper || '').toLowerCase();
    if (authStatus[m] === false) {
      const candidate = selectBestProvider('mapping', authStatus, availableProviders) as
        | string
        | null;
      if (locks.mapping) {
        if (isProviderKey(candidate)) {
          warnings.push(
            `Mapper "${request.mapper}" is locked but unauthorized; using "${candidate}" for this request`
          );
          mapper = candidate;
        } else {
          warnings.push(
            `Mapper "${request.mapper}" is locked but unauthorized and no fallback available`
          );
          mapper = 'gemini';
        }
      } else {
        mapper = isProviderKey(candidate) ? candidate : 'gemini';
      }
    } else {
      mapper = isProviderKey(m) ? m : null;
    }
  } else {
    const candidate = selectBestProvider('mapping', authStatus, availableProviders) as
      | string
      | null;
    mapper = isProviderKey(candidate) ? candidate : 'gemini';
  }

  // === Singularity ===
  const singularityExplicitlyDisabled =
    Object.prototype.hasOwnProperty.call(request || {}, 'singularity') && !request.singularity;
  let singularity: ProviderKey | null = singularityExplicitlyDisabled ? null : null;
  if (!singularityExplicitlyDisabled) {
    if (request.singularity) {
      const s = String(request.singularity || '').toLowerCase();
      if (authStatus[s] === false) {
        const candidate = selectBestProvider('singularity', authStatus, availableProviders) as
          | string
          | null;
        if (locks.singularity) {
          if (isProviderKey(candidate)) {
            warnings.push(
              `Singularity provider "${request.singularity}" is locked but unauthorized; using "${candidate}" for this request`
            );
            singularity = candidate;
          } else {
            warnings.push(
              `Singularity provider "${request.singularity}" is locked but unauthorized and no fallback available`
            );
            singularity = 'gemini';
          }
        } else {
          singularity = isProviderKey(candidate) ? candidate : 'gemini';
        }
      } else {
        singularity = isProviderKey(s) ? s : null;
      }
    } else {
      const candidate = selectBestProvider('singularity', authStatus, availableProviders) as
        | string
        | null;
      singularity = isProviderKey(candidate) ? candidate : 'gemini';
    }
  }

  const providers = normalizeToProviderKeyArray(providersRaw);

  return { providers, mapper, singularity, warnings };
}
