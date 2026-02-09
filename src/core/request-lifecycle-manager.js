/**
 * HTOS Request Lifecycle Management
 */

// Centralized error map
export const HTOSErrorMap = {
  csp: "csp",
  oldVersion: "old-version",
  tooManyRequests: "too-many-requests",
  commandConfigError: "command-config-error",
  functionsNotSupported: "functions-not-supported",
  visionNotSupported: "vision-not-supported",
  openaiLogin: "openai-login",
  openaiCloudflare: "openai-cloudflare",
  openaiBadModel: "openai-bad-model",
  openaiBadApiKey: "openai-bad-api-key",
  openaiChatNotFound: "openai-chat-not-found",
  openaiServerError: "openai-server-error",
  openaiSessionFailedToFetch: "openai-session-failed-to-fetch",
  openaiLicenseFailedToFetch: "openai-license-failed-to-fetch",
  openaiRequestsLimit: "openai-requests-limit",
  openaiMessageTooLong: "openai-message-too-long",
  openaiSwitchToWssRequired: "openai-switch-to-wss-required",
  openaiTooManyRequestsFiles: "openai-too-many-requests-files",
  geminiLogin: "gemini-login",
  geminiNoAccess: "gemini-no-access",
  geminiUnexpected: "gemini-unexpected",
  claudeLogin: "claude-login",
  claudeBadModel: "claude-bad-model",
  claudeUnexpected: "claude-unexpected",
  claudeFreeLimitExceeded: "claude-free-limit-exceeded",
  qwenLogin: "qwen-login",
  qwenBadApiKey: "qwen-bad-api-key",
  qwenUnexpected: "qwen-unexpected",
  cloudgptNetwork: "cloudgpt-network",
  cloudgptUnknown: "cloudgpt-unknwon",
  cloudgptUnexpected: "cloudgpt-unexpeceted",
  cloudgptNoLogin: "cloudgpt-no-login",
  cloudgptNoSpace: "cloudgpt-no-space",
  cloudgptNoTokens: "cloudgpt-no-tokens",
  cloudgptFunctionsNotSupported: "functions-not-supported",
  cloudgptFailedToReadResponse: "cloudgpt-failed-to-read-response",
};

/**
 * HTOS Request Lifecycle Management - Extracted from HTOS1
 *
 * Manages request lifecycle with abort controllers, timeouts, and state persistence.
 * Unified patterns for provider communication with proper cleanup semantics.
 */

// Build-phase safe: emitted to dist/core/*

export class HTOSRequestLifecycleManager {
  constructor(utils, sharedState) {
    this.utils = utils;
    this.sharedState = sharedState;
    this._abortControllers = {};
    this._lastAskFinishedAt = -1;
    this.REQUEST_THROTTLE_MS = 2000;
  }

  /**
   * Initialize the lifecycle manager
   * Clears all existing abort controllers and resets state
   */
  init() {
    this._lastAskFinishedAt = -1;
    this._abortControllers = {};
  }

  /**
   * Create and register an abort controller for a request
   * @param {string} requestId - Unique identifier for the request (typically chat.id)
   * @returns {AbortController} The created abort controller
   */
  createAbortController(requestId) {
    // Clean up any existing controller for this request
    this.cleanup(requestId);

    // Create new controller
    this._abortControllers[requestId] = new AbortController();
    return this._abortControllers[requestId];
  }

  /**
   * Get the abort signal for a request
   * @param {string} requestId - Request identifier
   * @returns {AbortSignal|null} The abort signal or null if not found
   */
  getSignal(requestId) {
    const controller = this._abortControllers[requestId];
    return controller ? controller.signal : null;
  }

  /**
   * Abort a specific request and clean up resources
   * @param {string} requestId - Request identifier to abort
   */
  abort(requestId) {
    const controller = this._abortControllers[requestId];
    if (controller) {
      controller.abort();
      delete this._abortControllers[requestId];
    }
  }

  /**
   * Clean up abort controller without aborting (for completed requests)
   * @param {string} requestId - Request identifier to clean up
   */
  cleanup(requestId) {
    if (this._abortControllers[requestId]) {
      delete this._abortControllers[requestId];
    }
  }

  /**
   * Check if a request is still active (has an abort controller)
   * @param {string} requestId - Request identifier
   * @returns {boolean} True if request is active
   */
  isActive(requestId) {
    return !!this._abortControllers[requestId];
  }

  /**
   * Enforce throttling between requests
   * @returns {Promise<void>} Promise that resolves after throttle period
   */
  async enforceThrottle() {
    const timeSinceLastRequest = Date.now() - this._lastAskFinishedAt;
    const throttleDelay = this.REQUEST_THROTTLE_MS - timeSinceLastRequest;

    if (throttleDelay > 0) {
      await this.utils.sleep(throttleDelay);
    }
  }

  /**
   * Mark a request as finished for throttling purposes
   */
  markRequestFinished() {
    this._lastAskFinishedAt = Date.now();
  }

  /**
   * Generate a unique request ID using nano ID
   * @returns {string} Unique identifier
   */
  generateRequestId() {
    return this.utils.id.nano();
  }

  /**
   * Get all active request IDs
   * @returns {string[]} Array of active request identifiers
   */
  getActiveRequestIds() {
    return Object.keys(this._abortControllers);
  }

  /**
   * Abort all active requests and clean up
   */
  abortAll() {
    for (const requestId of this.getActiveRequestIds()) {
      this.abort(requestId);
    }
  }

  /**
   * Check if throttle period has passed since last request
   * @returns {boolean} True if enough time has passed
   */
  canMakeRequest() {
    return Date.now() - this._lastAskFinishedAt >= this.REQUEST_THROTTLE_MS;
  }
}

/**
 * Request State Manager - handles state updates during request lifecycle
 */
export class HTOSRequestStateManager {
  constructor(sharedState) {
    this.sharedState = sharedState;
  }

  /**
   * Update question state in chat
   * @param {Object} chat - Chat object
   * @param {Object} updates - State updates
   */
  updateLastQuestion(chat, updates = {}) {
    const defaultUpdates = { role: "user" };
    chat.updateLastQuestion({ ...defaultUpdates, ...updates });
  }

  /**
   * Update answer state in chat with progress tracking
   * @param {Object} chat - Chat object
   * @param {Object} updates - State updates
   */
  updateLastAnswer(chat, updates = {}) {
    const defaultUpdates = { role: "assistant" };
    chat.updateLastAnswer({ ...defaultUpdates, ...updates });
  }

  /**
   * Mark answer as completed
   * @param {Object} chat - Chat object
   * @param {string} answerId - Answer identifier
   * @param {Object} finalUpdates - Final state updates
   */
  completeAnswer(chat, answerId, finalUpdates = {}) {
    chat.updateAnswer(answerId, {
      done: true,
      date: Date.now(),
      ...finalUpdates,
    });
  }

  /**
   * Handle request error and update state
   * @param {Object} chat - Chat object
   * @param {Object} error - Error object with classification
   * @param {string} errorDetails - Detailed error information
   */
  handleRequestError(chat, error, errorDetails) {
    const errorUpdate = {
      error: error.type || "unexpected",
      done: true,
    };

    if (typeof errorDetails === "string" && errorDetails) {
      errorUpdate.errorDetails = errorDetails;
    }

    chat.updateLastAnswer(errorUpdate);
  }

  /**
   * Remove incomplete answer (for aborted requests)
   * @param {Object} chat - Chat object
   */
  cleanupIncompleteAnswer(chat) {
    const lastAnswer = chat.lastAnswer;
    if (lastAnswer && !lastAnswer.done && lastAnswer.text === "") {
      chat.removeLastAnswer();
    }
  }
}

export class HTOSProviderStateManager {
  constructor(sharedState) {
    this.sharedState = sharedState;
  }
  updateOpenAIState(chat, chatId, messageId) {
    chat.openaiChatId = chatId;
    chat.openaiLastAnswerId = messageId;
  }
  updateGeminiState(chat, connection, token, cursor) {
    connection.token = token;
    chat.geminiCursor = cursor;
  }
  updateClaudeState(chat, connection, chatId, orgId) {
    chat.claudeChatId = chatId;
    connection.orgId = orgId;
  }
  resetProviderState(chat, provider) {
    switch (provider) {
      case "openai-session":
        chat.openaiChatId = null;
        break;
      case "gemini-session":
        chat.geminiCursor = null;
        break;
      case "claude-session":
        chat.claudeChatId = null;
        break;
    }
  }
}

export function classifyProviderError(provider, error) {
  const t = (s) => HTOSErrorMap[s] || s || HTOSErrorMap.claudeUnexpected;
  const type = error?.type || error?.code || null;
  const message =
    (typeof error === "string"
      ? error
      : error?.message || ""
    )?.toLowerCase?.() || "";
  if (type === "aborted" || message.includes("aborted")) {
    return { type: null, suppressed: true };
  }
  switch (provider) {
    case "gemini-session": {
      if (type === "login") return { type: t("geminiLogin") };
      if (type === "noGeminiAccess") return { type: t("geminiNoAccess") };
      if (type === "badToken") return { type: t("geminiLogin") };
      if (type === "failedToReadResponse")
        return { type: t("geminiUnexpected") };
      if (type === "network") return { type: t("geminiUnexpected") };
      if (type === "tooManyRequests") return { type: t("tooManyRequests") };
      return { type: t("geminiUnexpected") };
    }
    case "claude-session": {
      if (type === "tooManyRequests") return { type: t("tooManyRequests") };
      if (
        type === "freeLimitExceeded" ||
        message.includes("exceeded_limit") ||
        message.includes("free limit")
      )
        return { type: t("claudeFreeLimitExceeded") };
      if (type === "badModel") return { type: t("claudeBadModel") };
      if (type === "badOrgId") return { type: t("claudeLogin") };
      if (type === "failedToReadResponse")
        return { type: t("claudeUnexpected") };
      if (type === "network") return { type: t("claudeUnexpected") };
      return { type: t("claudeUnexpected") };
    }
    case "openai-session": {
      if (type === "login") return { type: t("openaiLogin") };
      if (type === "badModel") return { type: t("openaiBadModel") };
      if (type === "badApiKey") return { type: t("openaiBadApiKey") };
      if (type === "messageTooLong") return { type: t("openaiMessageTooLong") };
      if (type === "requestsLimit" || type === "tooManyRequests")
        return { type: t("openaiRequestsLimit") };
      if (type === "tooManyRequestsFiles")
        return { type: t("openaiTooManyRequestsFiles") };
      if (message.includes("cloudflare"))
        return { type: t("openaiCloudflare") };
      return { type: t("openaiServerError") };
    }
    case "qwen-session": {
      if (type === 401 || message.includes("incorrect api key"))
        return { type: t("qwenBadApiKey") };
      if (type === "login") return { type: t("qwenLogin") };
      if (type === "network" || message.includes("connection error"))
        return { type: t("cloudgptNetwork") };
      if (
        type === "tooManyRequests" ||
        message.includes("exceeds the model limit")
      )
        return { type: t("tooManyRequests") };
      return { type: t("qwenUnexpected") };
    }
    default: {
      if (type === "tooManyRequests") return { type: t("tooManyRequests") };
      if (type === "functionsNotSupported")
        return { type: t("functionsNotSupported") };
      return { type: t("cloudgptUnknown") };
    }
  }
}

export class HTOSUnifiedRequestController {
  constructor(utils, sharedState) {
    this.lifecycleManager = new HTOSRequestLifecycleManager(utils, sharedState);
    this.stateManager = new HTOSRequestStateManager(sharedState);
    this.providerStateManager = new HTOSProviderStateManager(sharedState);
    this.utils = utils;
    this.sharedState = sharedState;
  }
  init() {
    this.lifecycleManager.init();
  }
  async startRequest(chatId, _options = {}) {
    const chat = this.sharedState.chats.get(chatId);
    if (!chat) {
      throw new Error(`Chat not found: ${chatId}`);
    }
    await this.lifecycleManager.enforceThrottle();
    const abortController = this.lifecycleManager.createAbortController(
      chat.id,
    );
    if (!this.lifecycleManager.isActive(chat.id)) {
      return null;
    }
    const answerId = this.lifecycleManager.generateRequestId();
    this.stateManager.updateLastQuestion(chat);
    this.stateManager.updateLastAnswer(chat, { answerId });
    return { chat, abortController, answerId, signal: abortController.signal };
  }
  completeRequest(context, result) {
    const { chat, answerId } = context;
    this.stateManager.completeAnswer(chat, answerId, {
      text: result.text,
      model: result.model || "",
    });
    this.lifecycleManager.cleanup(chat.id);
    this.lifecycleManager.markRequestFinished();
  }
  abortRequest(chatId) {
    const chat = this.sharedState.chats.get(chatId);
    if (!chat) return;
    this.lifecycleManager.abort(chat.id);
    this.stateManager.cleanupIncompleteAnswer(chat);
  }
  _resolveProviderType(chat) {
    try {
      const connectionId = chat?.connectionId || chat?.connection?.id;
      const connection = connectionId
        ? this.sharedState.ai?.connections?.get?.(connectionId)
        : chat?.connection || null;
      return connection?.type || connection?.id || null;
    } catch {
      return null;
    }
  }
  _classify(chat, error, fallbackClassification) {
    const provider =
      this._resolveProviderType(chat) ||
      fallbackClassification?.provider ||
      null;
    try {
      return classifyProviderError(provider, error);
    } catch {
      return { type: HTOSErrorMap.cloudgptUnknown };
    }
  }
  handleRequestError(context, error, errorClassification) {
    const { chat } = context;
    const classification =
      errorClassification || this._classify(chat, error, null);
    if (classification?.suppressed) {
      this.lifecycleManager.cleanup(chat.id);
      this.lifecycleManager.markRequestFinished();
      this.stateManager.cleanupIncompleteAnswer(chat);
      return;
    }
    this.stateManager.handleRequestError(
      chat,
      classification,
      this._errorToString(error),
    );
    this.lifecycleManager.cleanup(chat.id);
    this.lifecycleManager.markRequestFinished();
  }
  _errorToString(error) {
    if (typeof error === "string") return error;
    const type = error?.type ? `[${error.type}] ` : "";
    if (error?.message) return `${type}${error.message}`;
    if (error?.details) {
      try {
        return `${type}${JSON.stringify(error.details)}`;
      } catch {}
    }
    if (error?.toString) return `${type}${error.toString()}`;
    return `${type}Unknown error`;
  }
  getAbortSignal(chatId) {
    const chat = this.sharedState.chats.get(chatId);
    return chat ? this.lifecycleManager.getSignal(chat.id) : null;
  }
  isRequestActive(chatId) {
    const chat = this.sharedState.chats.get(chatId);
    return chat ? this.lifecycleManager.isActive(chat.id) : false;
  }
}

export function createHTOSRequestController(utils, sharedState) {
  return new HTOSUnifiedRequestController(utils, sharedState);
}
