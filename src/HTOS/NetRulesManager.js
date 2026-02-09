/**
 * HTOS NetRulesManager - Complete Implementation
 * Extracted from bg.refactored.non.stripped.js for standalone integration
 *
 * This module provides network rule management for Chrome extension using Declarative Net Request API,
 * supporting CSP modification, header manipulation, and tab-specific rules cleanup.
 */

import { DNRUtils } from "../core/dnr-utils.js";

// =============================================================================
// UTILITY DEPENDENCIES
// =============================================================================

const utils = {
  // Type checking utilities
  is: {
    null: (e) => e === null,
    defined: (e) => undefined !== e,
    undefined: (e) => undefined === e,
    nil: (e) => e == null,
    boolean: (e) => typeof e == "boolean",
    number: (e) => typeof e == "number",
    string: (e) => typeof e == "string",
    symbol: (e) => typeof e == "symbol",
    function: (e) => typeof e == "function",
    array: (e) => Array.isArray(e),
    object: (e) => Object.prototype.toString.call(e) === "[object Object]",
    error: (e) => e instanceof Error,
    empty: (e) =>
      !!utils.is.nil(e) ||
      (utils.is.array(e)
        ? e.length === 0
        : utils.is.object(e)
          ? Object.keys(e).length === 0
          : !!utils.is.string(e) && e.trim().length === 0),
  },

  // Array utility for ensuring array type
  ensureArray: (e) => (Array.isArray(e) ? e : [e]),

  // Chrome alarms utility
  chrome: {
    alarms: {
      run: (e, t = {}) => {
        // Check if chrome.alarms API is available
        if (!chrome.alarms || !chrome.alarms.onAlarm) {
          console.warn(
            "[htos] chrome.alarms API not available, skipping alarm setup",
          );
          if (t.immediately) e();
          return null;
        }
        const a = {
          name: t.name || utils.generateId(),
          once: t.once || !1,
          immediately: t.immediately || !1,
          delayInMinutes: t.delayInMinutes || 1,
          periodInMinutes: t.once ? null : t.periodInMinutes || 1,
          listener: (t) => {
            t.name === a.name &&
              (a.once &&
                (chrome.alarms.onAlarm.removeListener(a.listener),
                  chrome.alarms.clear(a.name)),
                e());
          },
        };
        return (
          chrome.alarms.onAlarm.addListener(a.listener),
          chrome.alarms.create(a.name, {
            delayInMinutes: a.delayInMinutes,
            periodInMinutes: a.periodInMinutes,
          }),
          a.immediately && e(),
          a
        );
      },
      off: (e) => {
        if (!chrome.alarms || !chrome.alarms.onAlarm) return;
        e &&
          (typeof e == "string"
            ? chrome.alarms.clear(e)
            : (chrome.alarms.onAlarm.removeListener(e.listener),
              chrome.alarms.clear(e.name)));
      },
    },
  },

  // Time constants
  time: {
    MINUTE: 60000,
    HOUR: 3600000,
  },

  // ID generator utility
  generateId: () => `htos-${Date.now()}-${Math.random().toString(36).slice(2)}`,
};

// =============================================================================
// NET RULES MANAGER IMPLEMENTATION
// =============================================================================

const NetRulesManager = {
  async init() {
    // Bind public API methods (these are already the correct implementations)
    this.register = this.register.bind(this);
    this.unregister = this.unregister.bind(this);

    // Initialize internal state
    this._lastRuleId = 1;
    this._rules = [];

    // Drop all existing session rules to start clean
    await this._dropAllSessionRules();

    // Start periodic cleanup for tab-specific rules
    this._cleanupTabRulesPeriodically();
  },

  getNextRuleId() {
    return this._lastRuleId++;
  },

  // =============================================================================
  // PUBLIC API METHODS
  // =============================================================================

  /**
   * Register one or more network rules
   * @param {Object|Array} e - Rule or array of rules to register
   * @returns {String|Array} - Rule key(s) for unregistration
   */
  async register(e) {
    const isArray = Array.isArray(e);

    // Normalize to array and assign IDs
    const normalizedRules = utils.ensureArray(e).map((inputRule) => {
      const ruleId = this.getNextRuleId();

      return {
        id: ruleId,
        priority: 1,
        ...inputRule,
        key: inputRule.key || String(ruleId),
        condition: {
          resourceTypes: [
            "main_frame",
            "sub_frame",
            "stylesheet",
            "script",
            "image",
            "font",
            "object",
            "xmlhttprequest",
            "ping",
            "csp_report",
            "media",
            "websocket",
            "webtransport",
            "webbundle",
            "other",
          ],
          ...inputRule.condition,
        },
      };
    });

    // Remove duplicates by key (keep last occurrence)
    // Use a Map to keep only the last occurrence by key (ES2021 compatible replacement for findLastIndex)
    const ruleMap = new Map();
    normalizedRules.forEach(r => ruleMap.set(r.key, r));
    const filteredRules = Array.from(ruleMap.values());

    // Find existing rules with same keys to replace
    const existingKeys =
      this._rules.length > 0 ? new Set(filteredRules.map((rule) => rule.key)) : null;
    const rulesToRemove = this._rules
      .filter((rule) => existingKeys && existingKeys.has(rule.key))
      .map((rule) => rule.id);

    // Track new rules for cleanup
    this._rules.push(
      ...filteredRules.map((rule) => ({
        id: rule.id,
        key: rule.key,
        tabIds: rule.condition.tabIds || null,
      })),
    );

    const ruleKeys = filteredRules.map((rule) => rule.key);

    // Build the payload for the DNR API without mutating original objects (remove the HTOS-internal 'key')
    const addRules = filteredRules.map(({ key, ...r }) => r);

    // Update Chrome declarative net request rules
    await chrome.declarativeNetRequest.updateSessionRules({
      addRules: addRules,
    });

    // Remove replaced rules
    await this._unregisterByIds(rulesToRemove);

    return isArray ? ruleKeys : ruleKeys[0];
  },

  /**
   * Unregister rules by their keys
   * @param {String|Array} e - Rule key(s) to unregister
   */
  async unregister(e) {
    const keys = utils.ensureArray(e);
    if (keys.length === 0) return;

    const ruleIds = this._rules
      .filter((rule) => keys.includes(rule.key))
      .map((rule) => rule.id);

    await this._unregisterByIds(ruleIds);
  },

  // =============================================================================
  // INTERNAL METHODS
  // =============================================================================

  /**
   * Unregister rules by their internal IDs
   * @param {Array} ruleIds - Array of rule IDs to remove
   */
  async _unregisterByIds(ruleIds) {
    if (ruleIds.length === 0) return;

    // Remove from internal tracking
    this._rules = this._rules.filter((rule) => !ruleIds.includes(rule.id));

    // Remove from Chrome
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: ruleIds,
    });
  },

  /**
   * Drop all existing session rules (cleanup on init)
   */
  async _dropAllSessionRules() {
    const sessionRules = await chrome.declarativeNetRequest.getSessionRules();

    if (sessionRules.length !== 0) {
      await chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: sessionRules.map((rule) => rule.id),
      });
    }
  },

  /**
   * Set up periodic cleanup of tab-specific rules
   */
  _cleanupTabRulesPeriodically() {
    utils.chrome.alarms.run(this._cleanUpTabRules.bind(this), {
      name: "netRules.cleanupTabRules",
      periodInMinutes: 5,
    });
  },

  /**
   * Clean up rules for tabs that no longer exist
   */
  async _cleanUpTabRules() {
    const rulesToRemove = [];
    const rulesSnapshot = [...this._rules];

    // Check each rule with tab restrictions
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
        } catch (error) {
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
  init() {
    this._ruleIds = [];
    this._updateNetRules();
    // Note: In a real implementation, this would react to settings changes
    // this._updateNetRulesWhenCspSettingsChange();
  },

  /**
   * Update network rules based on CSP settings
   * This is a simplified version - in the full implementation it would read from shared state
   */
  async _updateNetRules() {
    // Unregister existing rules
    await NetRulesManager.unregister(this._ruleIds);
    this._ruleIds = [];

    const removeCspHeaderAction = {
      type: "modifyHeaders",
      responseHeaders: [
        {
          header: "content-security-policy",
          operation: "remove",
        },
      ],
    };

    // Example CSP rule - in real implementation this would be configurable
    const cspRules = [
      {
        condition: {
          urlFilter: "*", // Apply to all URLs
        },
        action: removeCspHeaderAction,
      },
    ];

    const ruleKeys = await NetRulesManager.register(cspRules);
    this._ruleIds.push(...utils.ensureArray(ruleKeys));
  },
};

// =============================================================================
// USER AGENT CONTROLLER - Manages User-Agent header rules
// =============================================================================

const UserAgentController = {
  async init() {
    const userAgentRules = this._createUaRules();
    const langRules = this._createLangRules();
    await NetRulesManager.register([...userAgentRules, ...langRules]);
  },

  /**
   * Create user agent modification rules
   */
  _createUaRules() {
    const createUrlFilter = (agent) => `*://*/*_vua=${agent}*`;

    // Example user agents - in real implementation this would come from configuration
    const userAgents = {
      desktop:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      mobile:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    };

    return Object.keys(userAgents)
      .filter((key) => key !== "auto")
      .map((key) => ({
        condition: {
          urlFilter: createUrlFilter(key),
          resourceTypes: ["main_frame", "sub_frame"],
        },
        action: {
          type: "modifyHeaders",
          requestHeaders: [
            {
              header: "user-agent",
              operation: "set",
              value: userAgents[key],
            },
          ],
        },
      }));
  },

  /**
   * Create language header modification rules
   */
  _createLangRules() {
    const createLangUrlFilter = (lang) => `*://*/*_vlang=${lang}*`;

    const formatLanguage = (lang) =>
      lang.includes("_")
        ? `${lang.replace("_", "-")},${lang.slice(0, lang.indexOf("_"))};q=0.9`
        : `${lang};q=0.9`;

    // Example languages - in real implementation this would come from configuration
    const languages = {
      en: "en",
      es: "es",
      fr: "fr",
      de: "de",
      en_US: "en_US",
    };

    return Object.keys(languages)
      .filter((key) => key !== "auto")
      .map((key) => ({
        condition: {
          urlFilter: createLangUrlFilter(key),
          resourceTypes: ["main_frame", "sub_frame"],
        },
        action: {
          type: "modifyHeaders",
          requestHeaders: [
            {
              header: "accept-language",
              operation: "set",
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
  async init() {
    // Initialize DNRUtils
    await DNRUtils.initialize();

    // Example iframe URL - in real implementation this would be configurable
    this._iframeUrl = "https://tcr9i.chat.openai.com";
    await this._allowArkoseIframe();
  },

  /**
   * Allow iframe by removing frame-blocking headers
   */
  async _allowArkoseIframe() {
    if (!this._iframeUrl) return;

    await NetRulesManager.register({
      condition: {
        urlFilter: `${this._iframeUrl}*`,
      },
      action: {
        type: "modifyHeaders",
        responseHeaders: [
          {
            header: "content-security-policy",
            operation: "remove",
          },
          {
            header: "permissions-policy",
            operation: "remove",
          },
        ],
      },
    });
  },

  /**
   * Inject AE (Arkose Enforcement) headers using DNRUtils
   * @param {Object} options - Header injection options
   * @param {number} options.tabId - Tab ID for scoped injection
   * @param {string} options.urlFilter - URL pattern to match
   * @param {string} options.headerName - Header name to inject
   * @param {string} options.headerValue - Header value to inject
   * @param {number} options.durationMs - Duration in milliseconds (optional)
   * @returns {Promise<number>} Rule ID
   */
  async injectAEHeaders({
    tabId,
    urlFilter,
    headerName,
    headerValue,
    durationMs,
  }) {
    try {
      const ruleId = NetRulesManager.getNextRuleId();
      await DNRUtils.registerHeaderRule({
        tabId,
        urlFilter,
        resourceTypes: [
          chrome.declarativeNetRequest.ResourceType.XMLHTTPREQUEST,
        ],
        headerName,
        headerValue,
        operation: "set",
        providerId: "arkose",
        ruleId,
        durationMs,
      });

      console.debug(
        `ArkoseController: Injected AE header ${headerName} for tab ${tabId}`,
      );
      return ruleId;
    } catch (error) {
      console.error("ArkoseController: Failed to inject AE headers:", error);
      throw error;
    }
  },

  /**
   * Remove AE header rule by ID
   * @param {number} ruleId - Rule ID to remove
   */
  async removeAEHeaderRule(ruleId) {
    try {
      await DNRUtils.removeRule(ruleId);
      console.debug(`ArkoseController: Removed AE header rule ${ruleId}`);
    } catch (error) {
      console.error(
        "ArkoseController: Failed to remove AE header rule:",
        error,
      );
      throw error;
    }
  },

  /**
   * Remove all AE header rules for arkose provider
   */
  async removeAllAEHeaderRules() {
    try {
      await DNRUtils.removeProviderRules("arkose");
      console.debug("ArkoseController: Removed all AE header rules");
    } catch (error) {
      console.error(
        "ArkoseController: Failed to remove all AE header rules:",
        error,
      );
      throw error;
    }
  },
};

// =============================================================================
// EXPORT
// =============================================================================

// For ES6 modules
export {
  NetRulesManager,
  CSPController,
  UserAgentController,
  ArkoseController,
  utils,
};

// For global browser usage
if (typeof window !== "undefined") {
  window["HTOSNetRulesManager"] = NetRulesManager;
  window["HTOSCSPController"] = CSPController;
  window["HTOSUserAgentController"] = UserAgentController;
  window["HTOSArkoseController"] = ArkoseController;
  window["HTOSNetRulesUtils"] = utils;
}
