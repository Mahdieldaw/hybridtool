/**
 * AuthManager - Centralized authentication status management
 * 
 * Architecture:
 * - Cookie checks (fast, ~10ms) for UI responsiveness
 * - API verification (authoritative, ~200ms) for accuracy
 * - Real-time event listeners for immediate updates
 * - Idempotent initialization safe for multiple calls
 * 
 * NOTE: Verification endpoints are LIGHTWEIGHT
 * - No DNR rules needed
 * - No Proof-of-Work required
 * - No Arkose tokens needed
 * - Just credentials: 'include'
 */

import { AUTH_COOKIES, GEMINI_VARIANTS } from '../shared/auth-config';

class AuthManager {
    constructor() {
        // Cookie status cache
        this._cookieStatus = {};
        this._cookieStatusTs = 0;

        // API verification cache
        this._verificationCache = new Map();

        // Cache TTLs
        this.COOKIE_CACHE_TTL = 60 * 1000;           // 1 minute
        this.VERIFICATION_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

        // Initialization flag
        this._initialized = false;
        this._initPromise = null;
        this._cookieListenersSetup = false;
    }

    /**
     * Initialize AuthManager
     * Idempotent - safe to call multiple times
     */
    async initialize() {
        if (this._initialized) {
            console.log('[AuthManager] Already initialized, skipping');
            return;
        }
        if (this._initPromise) {
            await this._initPromise;
            return;
        }

        this._initPromise = (async () => {
            console.log('[AuthManager] Initializing...');

            const stored = await chrome.storage.local.get('provider_auth_status');
            this._cookieStatus = stored.provider_auth_status || {};

            await this.checkAllCookies();

            if (!this._cookieListenersSetup) {
                const cookiesApi = chrome?.cookies;
                const canListen =
                    cookiesApi &&
                    cookiesApi.onChanged &&
                    typeof cookiesApi.onChanged.addListener === 'function';
                if (canListen) {
                    this._setupCookieListeners();
                    this._cookieListenersSetup = true;
                }
            }

            this._initialized = true;
            console.log('[AuthManager] Initialized:', this._cookieStatus);
        })();

        try {
            await this._initPromise;
        } finally {
            this._initPromise = null;
        }
    }

    /**
     * Get auth status (fast, cached)
     * Used by preflight before workflows
     */
    async getAuthStatus(forceRefresh = false) {
        const now = Date.now();

        // Return cached if fresh
        if (!forceRefresh && now - this._cookieStatusTs < this.COOKIE_CACHE_TTL) {
            return this._cookieStatus;
        }

        // Otherwise refresh
        await this.checkAllCookies();
        return this._cookieStatus;
    }

    /**
     * Cookie-based check for all providers
     * EXACT COPY of checkProviderLoginStatus() from sw-entry.js
     * Fast (~10ms) but not 100% reliable (cookie exists ≠ valid session)
     */
    async checkAllCookies() {
        const status = {};

        await Promise.all(AUTH_COOKIES.map(async (config) => {
            try {
                const cookie = await chrome.cookies.get({
                    url: config.url,
                    name: config.name
                });
                const isAuthenticated = !!cookie;
                status[config.provider] = isAuthenticated;

                // Handle Gemini variants
                if (config.provider === "gemini") {
                    GEMINI_VARIANTS.forEach(variant => {
                        status[variant] = isAuthenticated;
                    });
                }

                console.log(`[AuthManager] ${config.provider}: ${isAuthenticated ? 'authenticated' : 'not authenticated'}`);
            } catch (e) {
                console.warn(`[AuthManager] Failed to check ${config.provider}`, e);
                status[config.provider] = false;

                if (config.provider === "gemini") {
                    GEMINI_VARIANTS.forEach(variant => {
                        status[variant] = false;
                    });
                }
            }
        }));

        // TODO(HTOS-2317): Grok cookie auth check disabled due to unstable cookie name; see https://github.com/HTOS/htos/issues/2317

        // Update cache and storage
        this._cookieStatus = status;
        this._cookieStatusTs = Date.now();
        await chrome.storage.local.set({ provider_auth_status: status });

        return status;
    }

    /**
     * API-based verification (slower but authoritative)
     * Call this after 401/403 errors or for explicit user verification
     */
    async verifyProvider(providerId) {
        const baseProvider = providerId.split('-')[0]; // Normalize gemini-exp → gemini
        const cached = this._verificationCache.get(baseProvider);
        const now = Date.now();

        // Return cached if fresh
        if (cached && now - cached.ts < this.VERIFICATION_CACHE_TTL) {
            console.log(`[AuthManager] Using cached verification for ${providerId}: ${cached.valid}`);
            return cached.valid;
        }

        console.log(`[AuthManager] Verifying ${providerId} via API...`);
        let valid = false;

        try {
            switch (baseProvider) {
                case 'claude':
                    valid = await this._verifyClaude();
                    break;
                case 'chatgpt':
                    valid = await this._verifyChatGPT();
                    break;
                case 'gemini':
                    valid = await this._verifyGemini();
                    break;
                case 'qwen':
                    valid = await this._verifyQwen();
                    break;
                case 'grok':

                    break;
                default:
                    // Unknown provider, fall back to cookie check
                    console.warn(`[AuthManager] Unknown provider ${baseProvider}, using cookie check`);
                    valid = this._cookieStatus[providerId] ?? false;
            }
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.warn(`[AuthManager] Verification failed for ${providerId}:`, msg);
            // Fall back to cookie status
            valid = this._cookieStatus[providerId] ?? false;
        }

        // Update verification cache
        this._verificationCache.set(baseProvider, { ts: now, valid });

        // Update cookie status if verification disagrees
        const providerIds = baseProvider === 'gemini'
            ? GEMINI_VARIANTS
            : [providerId];

        let changed = false;
        for (const pid of providerIds) {
            if (this._cookieStatus[pid] !== valid) {
                console.log(`[AuthManager] Verification updated status for ${pid}: ${this._cookieStatus[pid]} → ${valid}`);
                this._cookieStatus[pid] = valid;
                changed = true;
            }
        }

        if (changed) {
            await chrome.storage.local.set({ provider_auth_status: this._cookieStatus });
        }

        return valid;
    }

    /**
     * Verify all providers in parallel
     * Returns: { claude: true, chatgpt: false, ... }
     */
    async verifyAll() {
        console.log('[AuthManager] Verifying all providers...');
        const baseProviders = ['claude', 'chatgpt', 'gemini', 'qwen', 'grok'];
        const results = {};

        await Promise.all(baseProviders.map(async (pid) => {
            results[pid] = await this.verifyProvider(pid);
        }));

        // Apply Gemini variants
        GEMINI_VARIANTS.forEach(variant => {
            results[variant] = results['gemini'];
        });

        console.log('[AuthManager] Verification complete:', results);
        return results;
    }

    /**
     * Claude: GET /api/organizations
     * Success: 200 + non-empty array with uuid
     * Failure: 403 = not logged in
     */
    async _verifyClaude() {
        const response = await fetch('https://claude.ai/api/organizations', {
            method: 'GET',
            credentials: 'include',
            signal: AbortSignal.timeout(5000),
        });

        if (response.status === 403) {
            return false;
        }

        if (!response.ok) {
            throw new Error(`Unexpected status: ${response.status}`);
        }

        const data = await response.json();
        return Array.isArray(data) && data.length > 0 && !!data[0]?.uuid;
    }

    /**
     * ChatGPT: GET /api/auth/session
     * Success: 200 + JSON with accessToken
     * Failure: No accessToken = not logged in
     * 
     * NOTE: Does NOT require offscreen document, PoW, or Arkose
     */
    async _verifyChatGPT() {
        const response = await fetch('https://chatgpt.com/api/auth/session', {
            method: 'GET',
            credentials: 'include',
            signal: AbortSignal.timeout(5000),
        });

        if (!response.ok) {
            return false;
        }

        try {
            const data = await response.json();
            return !!data?.accessToken;
        } catch {
            return false;
        }
    }

    /**
     * Gemini: GET /faq
     * Success: 200 + HTML contains "$authuser"
     * Failure: No $authuser = not logged in
     * 
     * NOTE: Does NOT require token extraction - just presence check
     */
    async _verifyGemini() {
        const response = await fetch('https://gemini.google.com/faq', {
            method: 'GET',
            credentials: 'include',
            signal: AbortSignal.timeout(5000),
        });

        if (!response.ok) {
            return false;
        }

        const html = await response.text();
        return html.includes('$authuser');
    }

    /**
     * Qwen: GET /
     * Success: 200 + HTML contains csrfToken
     * Failure: No csrfToken = not logged in
     * 
     * NOTE: Does NOT require CSRF extraction - just presence check
     */
    async _verifyQwen() {
        const response = await fetch('https://qianwen.com/', {
            method: 'GET',
            credentials: 'include',
            signal: AbortSignal.timeout(5000),
        });

        if (!response.ok) {
            return false;
        }

        const html = await response.text();
        // Robust presence check for csrfToken in script tags, JSON blobs, or meta elements
        return /csrfToken["']?\s*[:=]\s*["']([^"']+)["']/i.test(html) || html.includes('name="csrf-token"');
    }

    /**
     * Grok: GET /c
     * Success: 200 + HTML contains baggage + sentry-trace meta tags and Next.js chunks
     * Failure: 403 = blocked, or missing meta tags = site changed/broken
     */


    /**
     * Real-time cookie change detection
     * EXACT COPY of chrome.cookies.onChanged listener from sw-entry.js
     */
    _setupCookieListeners() {
        chrome.cookies.onChanged.addListener((changeInfo) => {
            void this.handleCookieChange(changeInfo);
        });
    }

    async handleCookieChange(changeInfo) {
        try {
            const { cookie, removed } = changeInfo;

            const match = AUTH_COOKIES.find(c =>
                cookie.domain.includes(c.domain) && cookie.name === c.name
            );

            if (!match) return;

            const wasAuthed = this._cookieStatus[match.provider];
            const nowAuthed = !removed;

            if (wasAuthed !== nowAuthed) {
                console.log(`[AuthManager] Cookie change: ${match.provider} ${wasAuthed} → ${nowAuthed}`);

                this._cookieStatus[match.provider] = nowAuthed;

                if (match.provider === "gemini") {
                    GEMINI_VARIANTS.forEach(variant => {
                        this._cookieStatus[variant] = nowAuthed;
                    });
                }

                this._verificationCache.delete(match.provider.split('-')[0]);

                await chrome.storage.local.set({
                    provider_auth_status: this._cookieStatus
                });
            }
        } catch (err) {
            console.error('[AuthManager] Error handling cookie change:', err);
        }
    }

    /**
     * Invalidate cache (call after suspected auth failure)
     */
    invalidateCache(providerId) {
        if (providerId) {
            const baseProvider = providerId.split('-')[0];
            this._verificationCache.delete(baseProvider);
            console.log(`[AuthManager] Invalidated cache for ${baseProvider}`);
        } else {
            this._verificationCache.clear();
            this._cookieStatusTs = 0;
            console.log('[AuthManager] Invalidated all caches');
        }
    }
}

export const authManager = new AuthManager();
