# Project Context

## Architecture

Chrome extension. The "backend" is a service worker (`src/sw-entry.ts`), not an HTTP server.
Communication is via chrome.runtime ports — no HTTP routes exist. Persistence uses IndexedDB
(`src/persistence/`), not an ORM.

## Entry Points

- Service worker: `src/sw-entry.ts`
- UI: `ui/index.tsx` → `ui/App.tsx`
- Offscreen document (embeddings): `src/offscreen/offscreen-entry.js`

## Backend Layers (src/)

- **execution/** — workflow engine, pipeline phases (batch → mapping → singularity), IO layer
- **providers/** — one adapter per AI provider: Codex, chatgpt, gemini, grok, qwen, cs-openai
- **persistence/** — IndexedDB via `simple-indexeddb-adapter.ts`; sessions, transactions, schema verification
- **clustering/** — embeddings generation and corpus search
- **geometry/** — claim geometry, basin inversion algorithms, regionalization
- **shadow/** — statement extraction and paragraph projection from model responses
- **provenance/** — claim classification, semantic mapping, structural analysis
- **concierge-service/** — editorial mapping, evidence substrate, position briefs
- **system/** — connection handler (port message routing), lifecycle, service registry, DNR rules
- **offscreen/** — offscreen document for embedding worker (runs outside service worker context)

## Shared Layer

`shared/` — types, messaging protocol, corpus utilities, provider config. Imported by both
src/ and ui/. Changes here have the widest blast radius.

## UI Layers (ui/)

- **state/** — Jotai atoms: chat.ts, layout.ts, provider.ts, ui.ts, workflow.ts
- **hooks/** — organized by domain: chat/, instrument/, providers/, reading/, ui/, workflow/
- **instrument/** — analysis cards and evidence table
- **reading/** — editorial document and passage rendering
- **shell/** — chrome (header, panels, toasts) and layout

## High-Impact Files

- `shared/corpus-utils.ts` — 18 importers
- `ui/services/extension-api.ts` — 15 importers
- `ui/config/constants.ts` — 15 importers
- `shared/messaging.ts` — 13 importers
- `src/shadow/shadow-paragraph-projector.ts` — 11 importers
- `src/shadow/shadow-extractor.ts` — 10 importers
- `src/geometry/types.ts` — 9 importers
- `shared/types/contract.ts` — 8 importers

## Codebase Navigation (Codesight Wiki)

Before any task involving unfamiliar files or components, read the relevant wiki article first.

- `.codesight/wiki/index.md` — start here for orientation
- `.codesight/wiki/overview.md` — architecture, high-impact files, entry points (~500 tokens)
- `.codesight/wiki/libraries.md` — all backend modules with exported function signatures (execution, geometry, provenance, shadow, clustering, persistence, providers, etc.)
- `.codesight/wiki/ui.md` — all 82 UI components with props and file paths
- `.codesight/graph.md` — full import dependency map (keep for blast radius checks)

Regenerate with `npx codesight --wiki` after significant structural changes. Do not manually edit wiki files.

**Workflow:** For any task touching an unfamiliar module, read the relevant wiki article before reading source files. Use `libraries.md` for backend, `ui.md` for components, `overview.md` for cross-cutting questions.