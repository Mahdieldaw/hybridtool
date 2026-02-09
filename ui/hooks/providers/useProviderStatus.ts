import { useEffect, useCallback, useState } from 'react';
import { useAtom } from 'jotai';
import { providerAuthStatusAtom } from '../../state/atoms';
import api from '../../services/extension-api';

export interface UseProviderStatusOptions {
  /**
   * If true, performs API verification on mount (slower but authoritative)
   * If false, only does cookie-based refresh (fast but less reliable)
   */
  verifyOnMount?: boolean;
}

export interface UseProviderStatusReturn {
  /**
   * Current auth status for all providers
   * Format: { chatgpt: true, claude: false, ... }
   */
  status: Record<string, boolean>;

  /**
   * Manually refresh auth status (cookie-based, fast)
   */
  manualRefresh: () => Promise<Record<string, boolean>>;

  /**
   * Verify auth via API (slower but authoritative)
   * @param providerId - Optional specific provider to verify, or all if omitted
   */
  verifyAuth: (providerId?: string) => Promise<Record<string, boolean>>;

  /**
   * True while API verification is in progress
   */
  isVerifying: boolean;
}

export function useProviderStatus(
  options: UseProviderStatusOptions = {},
  enabled: boolean = true,
): UseProviderStatusReturn {
  const [status, setStatus] = useAtom(providerAuthStatusAtom);
  const [isVerifying, setIsVerifying] = useState(false);
  const verifyOnMount = !!options.verifyOnMount;

  useEffect(() => {
    if (!enabled) return;
    if (
      typeof chrome === "undefined" ||
      !chrome?.storage?.local ||
      !chrome?.runtime?.sendMessage
    ) {
      return;
    }

    // 1. Instant load from storage (cached, no network)
    chrome.storage.local.get(['provider_auth_status'], (result) => {
      if (result.provider_auth_status) {
        setStatus(result.provider_auth_status as Record<string, boolean>);
      }
    });

    // 2. Optional: verify via API on mount
    if (verifyOnMount) {
      setIsVerifying(true);
      chrome.runtime
        .sendMessage({ type: 'VERIFY_AUTH_TOKEN' })
        .then((response) => {
          if (response?.success) {
            setStatus(response.data);
          }
        })
        .catch((err) => {
          console.warn('[useProviderStatus] API verification failed:', err);
        })
        .finally(() => {
          setIsVerifying(false);
        });
    } else {
      // Fast cookie-based refresh (background, non-blocking)
      api.refreshAuthStatus().catch((err) => {
        console.warn('[useProviderStatus] Cookie refresh failed:', err);
      });
    }

    // 3. Listen for live updates from AuthManager
    const listener = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
      if (area === 'local' && changes.provider_auth_status) {
        setStatus((changes.provider_auth_status.newValue as Record<string, boolean>) || ({} as Record<string, boolean>));
      }
    };

    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, [enabled, setStatus, verifyOnMount]);

  /**
   * Manually refresh auth status (cookie-based, fast)
   */
  const manualRefresh = useCallback(async () => {
    const fresh = await api.refreshAuthStatus();
    setStatus(fresh);
    return fresh;
  }, [setStatus]);

  /**
   * Verify auth via API (slower but authoritative)
   */
  const verifyAuth = useCallback(async (providerId?: string) => {
    if (typeof chrome === 'undefined' || !chrome?.runtime?.sendMessage) {
      console.warn('[useProviderStatus] Chrome APIs unavailable');
      return status;
    }
    setIsVerifying(true);

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'VERIFY_AUTH_TOKEN',
        payload: providerId ? { providerId } : undefined
      });

      if (response?.success) {
        setStatus((prev: Record<string, boolean>) => ({ ...prev, ...response.data }));
        return response.data;
      }

      throw new Error(response?.error || 'Verification failed');
    } finally {
      setIsVerifying(false);
    }
  }, [setStatus]);

  return {
    status,
    manualRefresh,
    verifyAuth,
    isVerifying
  };
}
