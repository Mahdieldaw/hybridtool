/**
 * HTOS NetRulesManager - Complete Implementation
 * Extracted from bg.refactored.non.stripped.js for standalone integration
 *
 * This module provides network rule management for Chrome extension using Declarative Net Request API,
 * supporting CSP modification, header manipulation, and tab-specific rules cleanup.
 */

import { DNRUtils } from './dnr-utils.js';

// =============================================================================
// TYPES
// =============================================================================

interface AlarmOptions {
  name?: string;
  once?: boolean;
  immediately?: boolean;
  delayInMinutes?: number;
  periodInMinutes?: number;
}

interface AlarmHandle {
  name: string;
  once: boolean;
  immediately: boolean;
  delayInMinutes: number;
  periodInMinutes: number | null;
  listener: (alarm: chrome.alarms.Alarm) => void;
}

interface TrackedNetRule {
  id: number;
  key: string;
  tabIds: number[] | null;
}

interface InputRule {
  key?: string;
  priority?: number;
  action: chrome.declarativeNetRequest.RuleAction;
  condition?: Partial<chrome.declarativeNetRequest.RuleCondition>;
}

interface NormalizedRule {
  id: number;
  priority: number;
  key: string;
  action: chrome.declarativeNetRequest.RuleAction;
  condition: chrome.declarativeNetRequest.RuleCondition;
}

interface InjectAEHeadersOptions {
  tabId: number;
  urlFilter: string;
  headerName: string;
  headerValue: string;
  durationMs?: number;
}

// =============================================================================
// UTILITY DEPENDENCIES
// =============================================================================

const utils = {
  is: {
    null: (e: unknown): e is null => e === null,
    defined: (e: unknown): boolean => undefined !== e,
    undefined: (e: unknown): e is undefined => undefined === e,
    nil: (e: unknown): e is null | undefined => e == null,
    boolean: (e: unknown): e is boolean => typeof e === 'boolean',
    number: (e: unknown): e is number => typeof e === 'number',
    string: (e: unknown): e is string => typeof e === 'string',
    symbol: (e: unknown): e is symbol => typeof e === 'symbol',
    function: (e: unknown): e is (...args: unknown[]) => unknown => typeof e === 'function',
    array: (e: unknown): e is unknown[] => Array.isArray(e),
    object: (e: unknown): boolean => Object.prototype.toString.call(e) === '[object Object]',
    error: (e: unknown): e is Error => e instanceof Error,
    empty(e: unknown): boolean {
      if (e == null) return true;
      if (Array.isArray(e)) return e.length === 0;
      if (Object.prototype.toString.call(e) === '[object Object]')
        return Object.keys(e as Record<string, unknown>).length === 0;
      if (typeof e === 'string') return e.trim().length === 0;
      return false;
    },
  },

  ensureArray<T>(e: T | T[]): T[] {
    return Array.isArray(e) ? e : [e];
  },

  chrome: {
    alarms: {
      run(callback: () => void, options: AlarmOptions = {}): AlarmHandle | null {
        if (!chrome.alarms?.onAlarm) {
          console.warn('[htos] chrome.alarms API not available, skipping alarm setup');
          if (options.immediately) callback();
          return null;
        }
        const handle: AlarmHandle = {
          name: options.name ?? utils.generateId(),
          once: options.once ?? false,
          immediately: options.immediately ?? false,
          delayInMinutes: options.delayInMinutes ?? 1,
          periodInMinutes: options.once ? null : (options.periodInMinutes ?? 1),
          listener(alarm: chrome.alarms.Alarm) {
            if (alarm.name !== handle.name) return;
            if (handle.once) {
              chrome.alarms.onAlarm.removeListener(handle.listener);
              chrome.alarms.clear(handle.name);
            }
            callback();
          },
        };
        chrome.alarms.onAlarm.addListener(handle.listener);
        chrome.alarms.create(handle.name, {
          delayInMinutes: handle.delayInMinutes,
          ...(handle.periodInMinutes != null && { periodInMinutes: handle.periodInMinutes }),
        });
        if (handle.immediately) callback();
        return handle;
      },

      off(handle: string | AlarmHandle | null | undefined): void {
        if (!chrome.alarms?.onAlarm || !handle) return;
        if (typeof handle === 'string') {
          chrome.alarms.clear(handle);
        } else {
          chrome.alarms.onAlarm.removeListener(handle.listener);
          chrome.alarms.clear(handle.name);
        }
      },
    },
  },

  time: {
    MINUTE: 60_000,
    HOUR: 3_600_000,
  } as const,

  generateId(): string {
    return `htos-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  },
};

// =============================================================================
// NET RULES MANAGER IMPLEMENTATION
// =============================================================================

const DEFAULT_RESOURCE_TYPES = [
  'main_frame',
  'sub_frame',
  'stylesheet',
  'script',
  'image',
  'font',
  'object',
  'xmlhttprequest',
  'ping',
  'csp_report',
  'media',
  'websocket',
  'webtransport',
  'webbundle',
  'other',
] as chrome.declarativeNetRequest.ResourceType[];

const NetRulesManager = {
  _lastRuleId: 1,
  _rules: [] as TrackedNetRule[],

  async init(): Promise<void> {
    this._lastRuleId = 1;
    this._rules = [];
    await this._dropAllSessionRules();
    this._cleanupTabRulesPeriodically();
  },

  getNextRuleId(): number {
    return this._lastRuleId++;
  },

  // =============================================================================
  // PUBLIC API METHODS
  // =============================================================================

  async register(e: InputRule | InputRule[]): Promise<string | string[]> {
    const isArray = Array.isArray(e);

    const normalizedRules: NormalizedRule[] = utils.ensureArray(e).map((inputRule): NormalizedRule => {
      const ruleId = this.getNextRuleId();
      const { key: inputKey, condition: inputCondition, priority: inputPriority, ...rest } = inputRule;
      return {
        ...rest,
        id: ruleId,
        priority: inputPriority ?? 1,
        key: inputKey ?? String(ruleId),
        condition: {
          resourceTypes: DEFAULT_RESOURCE_TYPES,
          ...inputCondition,
        } as chrome.declarativeNetRequest.RuleCondition,
      };
    });

    // Remove duplicates by key (keep last occurrence)
    const ruleMap = new Map<string, NormalizedRule>();
    normalizedRules.forEach((r) => ruleMap.set(r.key, r));
    const filteredRules = Array.from(ruleMap.values());

    const existingKeys =
      this._rules.length > 0 ? new Set(filteredRules.map((rule) => rule.key)) : null;
    const rulesToRemove = this._rules
      .filter((rule) => existingKeys && existingKeys.has(rule.key))
      .map((rule) => rule.id);

    const prevRules = [...this._rules];

    const newEntries: TrackedNetRule[] = filteredRules.map((rule) => ({
      id: rule.id,
      key: rule.key,
      tabIds: rule.condition.tabIds ?? null,
    }));
    this._rules.push(...newEntries);

    const ruleKeys = filteredRules.map((rule) => rule.key);
    const addRules = filteredRules.map(
      ({ key: _key, ...r }) => r as chrome.declarativeNetRequest.Rule
    );

    try {
      await this._unregisterByIds(rulesToRemove);
      await chrome.declarativeNetRequest.updateSessionRules({ addRules });
    } catch (err) {
      // Reconcile internal state against Chrome's actual live rules to avoid
      // tracking IDs that Chrome already removed (which happens when unregister
      // succeeds but addRules fails).
      try {
        const liveRules = await chrome.declarativeNetRequest.getSessionRules();
        const liveIds = new Set(liveRules.map((r) => r.id));
        this._rules = prevRules.filter((r) => liveIds.has(r.id));
      } catch {
        // If we can't read Chrome state, fall back to empty to avoid phantom entries
        this._rules = [];
      }
      throw err;
    }

    return isArray ? ruleKeys : ruleKeys[0];
  },

  async unregister(e: string | string[]): Promise<void> {
    const keys = utils.ensureArray(e);
    if (keys.length === 0) return;
    const ruleIds = this._rules.filter((rule) => keys.includes(rule.key)).map((rule) => rule.id);
    await this._unregisterByIds(ruleIds);
  },

  // =============================================================================
  // INTERNAL METHODS
  // =============================================================================

  async _unregisterByIds(ruleIds: number[]): Promise<void> {
    if (ruleIds.length === 0) return;

    // snapshot before mutation so we can roll back on Chrome API failure
    const prevRules = [...this._rules];
    this._rules = this._rules.filter((rule) => !ruleIds.includes(rule.id));

    try {
      await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: ruleIds });
    } catch (err) {
      // Chrome rejected the removal - restore tracking to stay consistent
      this._rules = prevRules;
      throw err;
    }
  },

  async _dropAllSessionRules(): Promise<void> {
    const sessionRules = await chrome.declarativeNetRequest.getSessionRules();
    if (sessionRules.length !== 0) {
      await chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: sessionRules.map((rule) => rule.id),
      });
    }
  },

  _cleanupTabRulesPeriodically(): void {
    utils.chrome.alarms.run(this._cleanUpTabRules.bind(this), {
      name: 'netRules.cleanupTabRules',
      periodInMinutes: 5,
    });
  },

  async _cleanUpTabRules(): Promise<void> {
    const rulesToRemove: number[] = [];
    const rulesSnapshot = [...this._rules];

    for (const rule of rulesSnapshot) {
      if (!rule.tabIds) continue;

      let hasValidTab = false;

      for (const tabId of rule.tabIds) {
        if (!tabId) continue;
        if (tabId === -1) {
          // keep rule if applies to all tabs
          hasValidTab = true;
          break;
        }

        try {
          await chrome.tabs.get(tabId);
          hasValidTab = true;
          break;
        } catch (_err) {
          // Tab doesn't exist, continue checking other tabs
        }
      }

      if (!hasValidTab) {
        rulesToRemove.push(rule.id);
      }
    }

    await this._unregisterByIds(rulesToRemove);
  },
};

// =============================================================================
// CSP CONTROLLER - Manages Content Security Policy rules
// =============================================================================

const CSPController = {
  _ruleIds: [] as string[],

  async init(): Promise<void> {
    this._ruleIds = [];
    await this._updateNetRules();
  },

  async _updateNetRules(): Promise<void> {
    await NetRulesManager.unregister(this._ruleIds);
    this._ruleIds = [];

    // CSP rules must be explicitly configured with specific URL patterns.
    // A blanket urlFilter:'*' would strip CSP headers from every response, which is
    // both a security risk and a violation of Manifest V3 review guidelines.
    // Callers should pass targeted URL filters (e.g. 'https://example.com/*') here.
    const cspRules: InputRule[] = [];

    if (cspRules.length === 0) return;
    const ruleKeys = await NetRulesManager.register(cspRules);
    this._ruleIds.push(...utils.ensureArray(ruleKeys));
  },
};

// =============================================================================
// USER AGENT CONTROLLER - Manages User-Agent header rules
// =============================================================================

const UserAgentController = {
  async init(): Promise<void> {
    const userAgentRules = this._createUaRules();
    const langRules = this._createLangRules();
    await NetRulesManager.register([...userAgentRules, ...langRules]);
  },

  _createUaRules(): InputRule[] {
    const createUrlFilter = (agent: string) => `*://*/*_vua=${agent}*`;

    // Example user agents - in real implementation this would come from configuration
    const userAgents: Record<string, string> = {
      desktop:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      mobile:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    };

    return Object.keys(userAgents)
      .filter((key) => key !== 'auto')
      .map((key) => ({
        condition: {
          urlFilter: createUrlFilter(key),
          resourceTypes: ['main_frame', 'sub_frame'] as chrome.declarativeNetRequest.ResourceType[],
        },
        action: {
          type: chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
          requestHeaders: [
            {
              header: 'user-agent',
              operation: chrome.declarativeNetRequest.HeaderOperation.SET,
              value: userAgents[key],
            },
          ],
        },
      }));
  },

  _createLangRules(): InputRule[] {
    const createLangUrlFilter = (lang: string) => `*://*/*_vlang=${lang}*`;

    const formatLanguage = (lang: string): string =>
      lang.includes('_')
        ? `${lang.replace('_', '-')},${lang.slice(0, lang.indexOf('_'))};q=0.9`
        : `${lang};q=0.9`;

    // Example languages - in real implementation this would come from configuration
    const languages: Record<string, string> = {
      en: 'en',
      es: 'es',
      fr: 'fr',
      de: 'de',
      en_US: 'en_US',
    };

    return Object.keys(languages)
      .filter((key) => key !== 'auto')
      .map((key) => ({
        condition: {
          urlFilter: createLangUrlFilter(key),
          resourceTypes: ['main_frame', 'sub_frame'] as chrome.declarativeNetRequest.ResourceType[],
        },
        action: {
          type: chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
          requestHeaders: [
            {
              header: 'accept-language',
              operation: chrome.declarativeNetRequest.HeaderOperation.SET,
              value: formatLanguage(languages[key]),
            },
          ],
        },
      }));
  },
};

// =============================================================================
// ARKOSE CONTROLLER - Manages iframe anti-framing bypass
// =============================================================================

const ArkoseController = {
  _iframeUrl: '',

  async init(): Promise<void> {
    await DNRUtils.initialize();
    this._iframeUrl = 'https://tcr9i.chat.openai.com';
    await this._allowArkoseIframe();
  },

  async _allowArkoseIframe(): Promise<void> {
    if (!this._iframeUrl) return;

    await NetRulesManager.register({
      condition: {
        urlFilter: `${this._iframeUrl}*`,
      },
      action: {
        type: chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
        responseHeaders: [
          {
            header: 'content-security-policy',
            operation: chrome.declarativeNetRequest.HeaderOperation.REMOVE,
          },
          {
            header: 'permissions-policy',
            operation: chrome.declarativeNetRequest.HeaderOperation.REMOVE,
          },
        ],
      },
    });
  },

  async injectAEHeaders({
    tabId,
    urlFilter,
    headerName,
    headerValue,
    durationMs,
  }: InjectAEHeadersOptions): Promise<number> {
    try {
      const ruleId = NetRulesManager.getNextRuleId();
      await DNRUtils.registerHeaderRule({
        tabId,
        urlFilter,
        resourceTypes: [chrome.declarativeNetRequest.ResourceType.XMLHTTPREQUEST],
        headerName,
        headerValue,
        operation: 'set',
        providerId: 'arkose',
        ruleId,
        durationMs,
      });

      // Track in NetRulesManager so ID space stays consistent and tab cleanup works
      NetRulesManager._rules.push({
        id: ruleId,
        key: String(ruleId),
        tabIds: tabId != null ? [tabId] : null,
      });

      console.debug(`ArkoseController: Injected AE header ${headerName} for tab ${tabId}`);
      return ruleId;
    } catch (error) {
      console.error('ArkoseController: Failed to inject AE headers:', error);
      throw error;
    }
  },

  async removeAEHeaderRule(ruleId: number): Promise<void> {
    try {
      await DNRUtils.removeRule(ruleId);
      // Sync removal from NetRulesManager tracking
      NetRulesManager._rules = NetRulesManager._rules.filter((r) => r.id !== ruleId);
      console.debug(`ArkoseController: Removed AE header rule ${ruleId}`);
    } catch (error) {
      console.error('ArkoseController: Failed to remove AE header rule:', error);
      throw error;
    }
  },

  async removeAllAEHeaderRules(): Promise<void> {
    // Capture the IDs DNRUtils is tracking for 'arkose' BEFORE removal,
    // so we can sync NetRulesManager._rules after DNRUtils clears its own state.
    // DNRUtils maps are keyed by rule ID (number), so filter by providerId rather
    // than calling .get('arkose') which the JS source incorrectly assumed.
    const arkoseIds = new Set<number>([
      ...Array.from(DNRUtils.scopedRules.values())
        .filter((r) => r.providerId === 'arkose')
        .map((r) => r.id),
      ...Array.from(DNRUtils.sessionRules.values())
        .filter((r) => r.providerId === 'arkose')
        .map((r) => r.id),
    ]);

    try {
      await DNRUtils.removeProviderRules('arkose');
      if (arkoseIds.size > 0) {
        NetRulesManager._rules = NetRulesManager._rules.filter((r) => !arkoseIds.has(r.id));
      }
      console.debug('ArkoseController: Removed all AE header rules');
    } catch (error) {
      console.error('ArkoseController: Failed to remove all AE header rules:', error);
      throw error;
    }
  },
};

// =============================================================================
// EXPORT
// =============================================================================

export { NetRulesManager, CSPController, UserAgentController, ArkoseController, utils };

if (typeof window !== 'undefined') {
  const w = window as unknown as Record<string, unknown>;
  w['HTOSNetRulesManager'] = NetRulesManager;
  w['HTOSCSPController'] = CSPController;
  w['HTOSUserAgentController'] = UserAgentController;
  w['HTOSArkoseController'] = ArkoseController;
  w['HTOSNetRulesUtils'] = utils;
}
