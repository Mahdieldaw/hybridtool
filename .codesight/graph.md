# Dependency Graph

## Most Imported Files (change these carefully)

- `shared\corpus-utils.ts` — imported by **16** files
- `ui\services\extension-api.ts` — imported by **15** files
- `ui\config\constants.ts` — imported by **15** files
- `shared\messaging.ts` — imported by **13** files
- `src\shadow\shadow-paragraph-projector.ts` — imported by **11** files
- `src\shadow\shadow-extractor.ts` — imported by **10** files
- `shared\types\contract.ts` — imported by **9** files
- `src\geometry\types.ts` — imported by **9** files
- `src\geometry\annotate.ts` — imported by **8** files
- `src\shadow\index.ts` — imported by **8** files
- `src\providers\auth-manager.js` — imported by **8** files
- `src\shadow\statement-types.ts` — imported by **8** files
- `ui\utils\provider-helpers.ts` — imported by **8** files
- `ui\shared\CopyButton.tsx` — imported by **8** files
- `shared\types\provider.ts` — imported by **7** files
- `src\clustering\distance.ts` — imported by **7** files
- `shared\citation-utils.ts` — imported by **7** files
- `src\errors\handler.ts` — imported by **7** files
- `src\concierge-service\editorial-mapper.ts` — imported by **6** files
- `src\persistence\types.ts` — imported by **6** files

## Import Map (who imports what)

- `shared\corpus-utils.ts` ← `src\execution\deterministic-pipeline.ts`, `src\system\connection-handler.ts`, `ui\chat\TurnOutputRouter.tsx`, `ui\hooks\chat\usePortMessageHandler.ts`, `ui\hooks\instrument\useClaimCentroids.ts` +11 more
- `ui\services\extension-api.ts` ← `ui\App.tsx`, `ui\chat\ChatInput.tsx`, `ui\hooks\chat\useChat.ts`, `ui\hooks\chat\usePortMessageHandler.ts`, `ui\hooks\chat\useRoundActions.ts` +10 more
- `ui\config\constants.ts` ← `ui\chat\ChatInput.tsx`, `ui\chat\CouncilOrbs.tsx`, `ui\chat\CouncilOrbsVertical.tsx`, `ui\chat\SingularityOutputView.tsx`, `ui\chat\TurnOutputRouter.tsx` +10 more
- `shared\messaging.ts` ← `src\execution\io\context-manager.ts`, `src\execution\io\context-resolver.ts`, `src\execution\io\turn-emitter.ts`, `src\execution\pipeline\mapping-phase.ts`, `src\execution\pipeline\recompute-handler.ts` +8 more
- `src\shadow\shadow-paragraph-projector.ts` ← `shared\corpus-utils.ts`, `src\clustering\embeddings.ts`, `src\execution\utils\geometry-runner.ts`, `src\geometry\annotate.ts`, `src\geometry\engine.ts` +6 more
- `src\shadow\shadow-extractor.ts` ← `shared\corpus-utils.ts`, `src\clustering\embeddings.ts`, `src\execution\utils\geometry-runner.ts`, `src\geometry\annotate.ts`, `src\geometry\engine.ts` +5 more
- `shared\types\contract.ts` ← `shared\types\index.ts`, `shared\types\turns.ts`, `src\execution\io\context-manager.ts`, `src\execution\io\context-resolver.ts`, `src\execution\pipeline\singularity-phase.ts` +4 more
- `src\geometry\types.ts` ← `src\execution\utils\geometry-runner.ts`, `src\geometry\algorithms\basin-inversion-bayesian.ts`, `src\geometry\annotate.ts`, `src\geometry\engine.ts`, `src\geometry\index.ts` +4 more
- `src\geometry\annotate.ts` ← `src\execution\deterministic-pipeline.h1.test.ts`, `src\execution\deterministic-pipeline.ts`, `src\execution\deterministic-pipeline.ts`, `src\execution\utils\geometry-runner.ts`, `src\geometry\engine.ts` +3 more
- `src\shadow\index.ts` ← `src\execution\deterministic-pipeline.ts`, `src\execution\deterministic-pipeline.ts`, `src\execution\pipeline\mapping-phase.ts`, `src\execution\pipeline\recompute-handler.ts`, `src\shadow\test.ts` +3 more
