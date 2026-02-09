/**
 * Centralized authentication configuration
 * Shared between AuthManager, tests, and documentation
 */

export const AUTH_COOKIES = [
    {
        provider: "chatgpt",
        domain: "chatgpt.com",
        name: "__Secure-next-auth.session-token",
        url: "https://chatgpt.com"
    },
    {
        provider: "claude",
        domain: "claude.ai",
        name: "sessionKey",
        url: "https://claude.ai"
    },
    {
        provider: "gemini",
        domain: "google.com",
        name: "__Secure-1PSID",
        url: "https://gemini.google.com"
    },
    {
        provider: "qwen",
        domain: "qianwen.com",
        name: "tongyi_sso_ticket",
        url: "https://qianwen.com"
    }
] as const;

export const GEMINI_VARIANTS = ['gemini', 'gemini-pro', 'gemini-exp'] as const;

export const PROVIDER_URLS: Record<string, string> = {
    chatgpt: 'https://chatgpt.com',
    claude: 'https://claude.ai',
    gemini: 'https://gemini.google.com',
    'gemini-pro': 'https://gemini.google.com',
    'gemini-exp': 'https://gemini.google.com',
    qwen: 'https://qianwen.com'
};

export type ProviderId = typeof AUTH_COOKIES[number]['provider'] | typeof GEMINI_VARIANTS[number];
