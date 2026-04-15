import type { LLMProvider } from '../types';

// Provider icons are light-weight and color-driven via tokens to remain dark-mode safe
import { ChatGPTIcon, ClaudeIcon, GeminiIcon, QwenIcon, GrokIcon } from '../shared/Icons';

// Import SVG Logos
import ChatGPTLogo from '../assets/providers/chatgpt.svg';
import ClaudeLogo from '../assets/providers/claude.svg';
import GeminiLogo from '../assets/providers/gemini.svg';
import QwenLogo from '../assets/providers/qwen.svg';

// Central registry for provider metadata used by the UI (lanes/rail)
// - Do NOT hard-code hex colors inside Rail; colors live here (or in tokens)

export interface ProviderConfig extends LLMProvider {
  // Icon component for micro-cards and badges
  icon?: (props: { size?: number; style?: React.CSSProperties }) => JSX.Element;
  logoSrc?: string;
}

// Initial providers (seeded). This is the only place you should edit to add a new provider by config-only.
export const INITIAL_PROVIDERS: ProviderConfig[] = [
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    color: '#10A37F',
    logoBgClass: 'bg-green-500',
    hostnames: ['chat.openai.com', 'chatgpt.com'],
    icon: ChatGPTIcon,
    logoSrc: ChatGPTLogo,
  },
  {
    id: 'claude',
    name: 'Claude',
    color: '#FF7F00',
    logoBgClass: 'bg-orange-500',
    hostnames: ['claude.ai'],
    icon: ClaudeIcon,
    logoSrc: ClaudeLogo,
  },
  {
    id: 'gemini',
    name: 'Gemini',
    color: '#4285F4',
    logoBgClass: 'bg-blue-500',
    hostnames: ['gemini.google.com'],
    icon: GeminiIcon,
    logoSrc: GeminiLogo,
  },
  {
    id: 'gemini-pro',
    name: 'Gemini 2.5 Pro',
    color: '#3B82F6',
    logoBgClass: 'bg-blue-600',
    hostnames: ['gemini.google.com'],
    icon: GeminiIcon,
    logoSrc: GeminiLogo,
  },
  {
    id: 'gemini-exp', // Must match the key in GeminiModels
    name: 'Gemini 3.0',
    color: '#8B5CF6', // Purple to distinguish from others
    logoBgClass: 'bg-purple-600',
    hostnames: ['gemini.google.com'],
    icon: GeminiIcon,
    logoSrc: GeminiLogo,
  },
  {
    id: 'qwen',
    name: 'Qwen',
    color: '#00A9E0',
    logoBgClass: 'bg-cyan-500',
    hostnames: ['qianwen.com', 'qianwen.aliyun.com'],
    icon: QwenIcon,
    emoji: '🤖',
    logoSrc: QwenLogo,
  },
  {
    id: 'grok',
    name: 'Grok',
    color: '#293944',
    logoBgClass: 'bg-sky-500',
    hostnames: ['grok.com'],
    icon: GrokIcon,
  },
];

// Mutable list used by the LaneFactory/Rail
let providers: ProviderConfig[] = [...INITIAL_PROVIDERS];

export function getProviderById(id: string): ProviderConfig | undefined {
  return providers.find((p) => p.id === id);
}

// Provider color mapping for orb animations
export const PROVIDER_COLORS: Record<string, string> = {
  claude: '#E07850',
  gemini: '#3B82F6',
  'gemini-pro': '#06B6D4',
  'gemini-exp': '#8B5CF6',
  chatgpt: '#10A37F',
  qwen: '#F59E0B',
  grok: '#293944ff',
  default: '#64748B',
};

export const PROVIDER_ACCENT_COLORS: Record<string, string> = {
  claude: '#C75B3A',
  gemini: '#1D4ED8',
  'gemini-pro': '#0891B2',
  'gemini-exp': '#6D28D9',
  chatgpt: '#047857',
  qwen: '#D97706',
  grok: '#293944ff',
  default: '#475569',
};
