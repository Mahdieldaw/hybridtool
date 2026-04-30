# project-htos — Overview

> **Navigation aid.** This article shows WHERE things live (routes, models, files). Read actual source files before implementing new features or making changes.

**project-htos** is a typescript project built with raw-http.

## Scale

84 UI components · 121 library files · 4 middleware layers · 6 environment variables

**UI:** 84 components (react) — see [ui.md](./ui.md)

**Libraries:** 121 files — see [libraries.md](./libraries.md)

## High-Impact Files

Changes to these files have the widest blast radius across the codebase:

- `shared\corpus-utils.ts` — imported by **17** files
- `ui\services\extension-api.ts` — imported by **15** files
- `ui\config\constants.ts` — imported by **15** files
- `shared\messaging.ts` — imported by **13** files
- `src\shadow\shadow-paragraph-projector.ts` — imported by **11** files
- `src\shadow\shadow-extractor.ts` — imported by **10** files

## Required Environment Variables

- `HTOS_GEMINI_COLD_START_BACKOFF_BASE_MS` — `docs\test\retry-policy.test.ts`
- `HTOS_GEMINI_COLD_START_BACKOFF_JITTER` — `docs\test\retry-policy.test.ts`
- `HTOS_GEMINI_COLD_START_BACKOFF_MAX_MS` — `docs\test\retry-policy.test.ts`
- `HTOS_GEMINI_COLD_START_BACKOFF_MULTIPLIER` — `docs\test\retry-policy.test.ts`
- `HTOS_GEMINI_COLD_START_MAX_RETRIES` — `docs\test\retry-policy.test.ts`
- `NODE_ENV` — `scripts\build-common.js`

---
_Back to [index.md](./index.md) · Generated 2026-04-30_