/**
 * HTOS DNR Rule Auditor
 * - Provides visibility into live DNR rule matches for debugging
 * - Uses chrome.declarativeNetRequest.onRuleMatchedDebug
 * - Safe, opt-in debugging tool for development
 *
 * Build-phase safe: emitted to dist/core/*
 */

import { DNRUtils } from "./dnr-utils.js";

/**
 * DNR Rule Auditor for debugging rule behavior
 */
export class DNRRuleAuditor {
  /** Helper: gated debug logger (off by default) */
  static dbg(...args) {
    if (DNRUtils?.debugEnabled) console.debug(...args);
  }
  /**
   * Enable the DNR rule auditor (debug mode only)
   */
  static async enableAuditor() {
    if (this.isEnabled) {
      this.dbg("DNR Auditor: Already enabled");
      return true;
    }
    // Check if declarativeNetRequestFeedback permission is available
    if (
      typeof chrome === "undefined" ||
      !chrome.declarativeNetRequest ||
      !chrome.declarativeNetRequest.onRuleMatchedDebug
    ) {
      console.warn(
        "DNR Auditor: onRuleMatchedDebug not available (requires declarativeNetRequestFeedback permission)",
      );
      return false;
    }
    try {
      // Create listener for rule matches
      this.listener = (details) => {
        this.recordRuleMatch(details);
      };
      // Add listener
      chrome.declarativeNetRequest.onRuleMatchedDebug.addListener(
        this.listener,
      );
      this.isEnabled = true;
      this.dbg("DNR Auditor: Enabled successfully");
      return true;
    } catch (error) {
      console.error("DNR Auditor: Failed to enable:", error);
      return false;
    }
  }
  /**
   * Disable the DNR rule auditor
   */
  static disableAuditor() {
    if (!this.isEnabled) {
      return;
    }
    if (this.listener && chrome.declarativeNetRequest?.onRuleMatchedDebug) {
      chrome.declarativeNetRequest.onRuleMatchedDebug.removeListener(
        this.listener,
      );
    }
    this.listener = null;
    this.isEnabled = false;
    this.dbg("DNR Auditor: Disabled");
  }
  /**
   * Record a rule match event
   */
  static recordRuleMatch(details) {
    const matchEvent = {
      ruleId: details.rule.ruleId,
      tabId: details.request.tabId,
      url: details.request.url,
      method: details.request.method,
      resourceType: details.request.type,
      timestamp: Date.now(),
    };
    // Try to identify the provider associated with this rule
    matchEvent.providerId = this.identifyProvider(
      details.rule.ruleId,
      details.request.url,
    );
    // Add to matches array
    this.matches.push(matchEvent);
    // Trim old matches if we exceed the limit
    if (this.matches.length > this.MAX_STORED_MATCHES) {
      this.matches = this.matches.slice(-this.MAX_STORED_MATCHES);
    }
    // Log the match for immediate visibility
    this.dbg("DNR Rule Match:", {
      ruleId: matchEvent.ruleId,
      provider: matchEvent.providerId,
      url: matchEvent.url,
      method: matchEvent.method,
      type: matchEvent.resourceType,
      tabId: matchEvent.tabId,
    });
  }
  /**
   * Try to identify which provider a rule belongs to
   */
  static identifyProvider(ruleId, url) {
    // Check URL patterns to identify provider
    if (url.includes("claude.ai")) {
      return "claude";
    }
    if (url.includes("gemini.google.com")) {
      return "gemini";
    }
    if (url.includes("chatgpt.com") || url.includes("openai.com")) {
      return "chatgpt";
    }
    // Check rule ID ranges (if we use consistent ranges per provider)
    if (ruleId >= 10000 && ruleId < 20000) {
      return "scoped-rules";
    }
    return undefined;
  }
  /**
   * Get auditor statistics
   */
  static getStats() {
    const matchesByRule = new Map();
    const matchesByProvider = new Map();
    for (const match of this.matches) {
      // Count by rule ID
      const ruleCount = matchesByRule.get(match.ruleId) || 0;
      matchesByRule.set(match.ruleId, ruleCount + 1);
      // Count by provider
      if (match.providerId) {
        const providerCount = matchesByProvider.get(match.providerId) || 0;
        matchesByProvider.set(match.providerId, providerCount + 1);
      }
    }
    return {
      totalMatches: this.matches.length,
      matchesByRule,
      matchesByProvider,
      recentMatches: this.matches.slice(-50), // Last 50 matches
    };
  }
  /**
   * Get recent matches for a specific provider
   */
  static getProviderMatches(providerId, limit = 20) {
    return this.matches
      .filter((match) => match.providerId === providerId)
      .slice(-limit);
  }
  /**
   * Get recent matches for a specific rule ID
   */
  static getRuleMatches(ruleId, limit = 20) {
    return this.matches
      .filter((match) => match.ruleId === ruleId)
      .slice(-limit);
  }
  /**
   * Clear stored match history
   */
  static clearHistory() {
    this.matches = [];
    this.dbg("DNR Auditor: Match history cleared");
  }
  /**
   * Check if auditor is currently enabled
   */
  static isAuditorEnabled() {
    return this.isEnabled;
  }
  /**
   * Export match data for analysis
   */
  static exportMatches() {
    const exportData = {
      timestamp: new Date().toISOString(),
      totalMatches: this.matches.length,
      matches: this.matches,
      stats: this.getStats(),
    };
    return JSON.stringify(
      exportData,
      (_key, value) => {
        // Convert Maps to objects for JSON serialization
        if (value instanceof Map) {
          return Object.fromEntries(value);
        }
        return value;
      },
      2,
    );
  }
  /**
   * Generate a summary report of rule activity
   */
  static generateReport() {
    const stats = this.getStats();
    const now = new Date();
    const oneHourAgo = now.getTime() - 60 * 60 * 1000;
    const recentMatches = this.matches.filter(
      (match) => match.timestamp > oneHourAgo,
    );
    const topRules = Array.from(stats.matchesByRule.entries())
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10);
    const topProviders = Array.from(stats.matchesByProvider.entries()).sort(
      ([, a], [, b]) => b - a,
    );
    return `
DNR Rule Auditor Report - ${now.toISOString()}
${"=".repeat(50)}

Total Matches: ${stats.totalMatches}
Matches in Last Hour: ${recentMatches.length}

Top Rules by Match Count:
${topRules.map(([ruleId, count]) => `  Rule ${ruleId}: ${count} matches`).join("\n")}

Matches by Provider:
${topProviders.map(([provider, count]) => `  ${provider}: ${count} matches`).join("\n")}

Recent Activity (last 10 matches):
${stats.recentMatches
  .slice(-10)
  .map(
    (match) =>
      `  ${new Date(match.timestamp).toLocaleTimeString()} - Rule ${match.ruleId} (${match.providerId || "unknown"}) - ${match.method} ${match.url}`,
  )
  .join("\n")}
`;
  }
}
DNRRuleAuditor.isEnabled = false;
DNRRuleAuditor.matches = [];
DNRRuleAuditor.MAX_STORED_MATCHES = 1000;
DNRRuleAuditor.listener = null;
