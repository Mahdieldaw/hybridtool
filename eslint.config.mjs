import js from '@eslint/js';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

const commonGlobals = {
  // Universal globals
  console: 'readonly',
  // Browser globals
  window: 'readonly',
  document: 'readonly',
  navigator: 'readonly',
  chrome: 'readonly',
  indexedDB: 'readonly',
  localStorage: 'readonly',
  sessionStorage: 'readonly',
  fetch: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  performance: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  postMessage: 'readonly',
  requestAnimationFrame: 'readonly',
  cancelAnimationFrame: 'readonly',
  WebAssembly: 'readonly',
  crypto: 'readonly',
  Blob: 'readonly',
  File: 'readonly',
  FileReader: 'readonly',
  FormData: 'readonly',
  XMLHttpRequest: 'readonly',
  TextDecoder: 'readonly',
  TextEncoder: 'readonly',
  // Events
  Event: 'readonly',
  CustomEvent: 'readonly',
  MouseEvent: 'readonly',
  KeyboardEvent: 'readonly',
  PointerEvent: 'readonly',
  AbortController: 'readonly',
  AbortSignal: 'readonly',
  // DOM elements
  HTMLDivElement: 'readonly',
  HTMLElement: 'readonly',
  HTMLCanvasElement: 'readonly',
  HTMLInputElement: 'readonly',
  HTMLTextAreaElement: 'readonly',
  HTMLImageElement: 'readonly',
  HTMLButtonElement: 'readonly',
  HTMLVideoElement: 'readonly',
  SVGElement: 'readonly',
  SVGSVGElement: 'readonly',
  Element: 'readonly',
  Node: 'readonly',
  EventTarget: 'readonly',
  DOMException: 'readonly',
  DOMRect: 'readonly',
  DOMParser: 'readonly',
  // Web APIs
  location: 'readonly',
  screen: 'readonly',
  alert: 'readonly',
  atob: 'readonly',
  btoa: 'readonly',
  structuredClone: 'readonly',
  queueMicrotask: 'readonly',
  setImmediate: 'readonly',
  getComputedStyle: 'readonly',
  // Fetch & HTTP
  Request: 'readonly',
  Response: 'readonly',
  Headers: 'readonly',
  // Blob & File
  Image: 'readonly',
  ImageData: 'readonly',
  ImageBitmap: 'readonly',
  OffscreenCanvas: 'readonly',
  // Messaging
  MessageChannel: 'readonly',
  MessagePort: 'readonly',
  BroadcastChannel: 'readonly',
  // Observers
  ResizeObserver: 'readonly',
  IntersectionObserver: 'readonly',
  // IndexedDB
  IDBDatabase: 'readonly',
  IDBObjectStore: 'readonly',
  IDBIndex: 'readonly',
  IDBCursor: 'readonly',
  IDBCursorWithValue: 'readonly',
  IDBRequest: 'readonly',
  IDBOpenDBRequest: 'readonly',
  IDBTransaction: 'readonly',
  IDBKeyRange: 'readonly',
  IDBValidKey: 'readonly',
  IDBTransactionMode: 'readonly',
  IDBObjectStoreParameters: 'readonly',
  IDBIndexParameters: 'readonly',
  IDBVersionChangeEvent: 'readonly',
  // WebGPU
  GPUBufferUsage: 'readonly',
  GPUMapMode: 'readonly',
  GPUDevice: 'readonly',
  GPUValidationError: 'readonly',
  // Misc
  parent: 'readonly',
  crossOriginIsolated: 'readonly',
  caches: 'readonly',
  reportError: 'readonly',
  ReadableStream: 'readonly',
  CSS: 'readonly',
  AudioContext: 'readonly',
  ClipboardItem: 'readonly',
  MSApp: 'readonly',
  // Web Workers
  self: 'readonly',
  Worker: 'readonly',
  WorkerGlobalScope: 'readonly',
  ServiceWorkerGlobalScope: 'readonly',
  onmessage: 'writable',
  onmessageerror: 'writable',
  // Node globals
  global: 'readonly',
  process: 'readonly',
  Buffer: 'readonly',
  require: 'readonly',
  __dirname: 'readonly',
  __filename: 'readonly',
  exports: 'writable',
  module: 'writable',
  // Jest
  expect: 'readonly',
  jest: 'readonly',
  test: 'readonly',
  describe: 'readonly',
  it: 'readonly',
  beforeEach: 'readonly',
  afterEach: 'readonly',
  beforeAll: 'readonly',
  afterAll: 'readonly',
  // React/JSX
  JSX: 'readonly',
  React: 'readonly',
};

export default [
  {
    files: ['**/*.js'],
    languageOptions: {
      globals: commonGlobals,
    },
  },
  js.configs.recommended,

  {
    files: ['**/*.ts', '**/*.tsx'],

    languageOptions: {
      parser: tsParser,
      globals: commonGlobals,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: {
          jsx: true,
        },
      },
    },

    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
      '@typescript-eslint': tseslint,
    },

    rules: {
      'react/react-in-jsx-scope': 'off',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      '@typescript-eslint/no-unused-vars': 'warn',
    },

    settings: {
      react: {
        version: 'detect',
      },
    },
  },
];
