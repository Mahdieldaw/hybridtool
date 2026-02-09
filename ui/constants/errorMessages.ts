// ui/constants/errorMessages.ts

export const ERROR_DISPLAY_TEXT = {
  rate_limit: {
    title: 'Rate Limited',
    description: 'This provider is temporarily unavailable. It will automatically retry.',
    icon: '⏳'
  },
  auth_expired: {
    title: 'Login Required',
    description: 'Please log in to this provider again.',
    icon: '🔒'
  },
  timeout: {
    title: 'Timed Out',
    description: 'The request took too long. Click retry to try again.',
    icon: '⏱️'
  },
  circuit_open: {
    title: 'Temporarily Unavailable',
    description: 'Too many recent failures. Will automatically recover.',
    icon: '🔌'
  },
  content_filter: {
    title: 'Content Blocked',
    description: 'This provider blocked the response. Try rephrasing your request.',
    icon: '🚫'
  },
  input_too_long: {
    title: 'Input Too Long',
    description: 'Your message exceeds this provider\'s input limit. Shorten it and resend.',
    icon: '📏'
  },
  network: {
    title: 'Connection Failed',
    description: 'Could not reach the provider. Check your connection.',
    icon: '📡'
  },
  unknown: {
    title: 'Error',
    description: 'Something went wrong.',
    icon: '⚠️'
  }
} as const;
