# concierge-service — file digest (singularity prompting, editorial arrangement, and evidence presentation)

---

## Architecture Overview

**Concierge Service:** The concierge-service module orchestrates the final synthesis layer—transforming structured claims, passages, and routing signals into a curated evidence substrate and prompt context for the singularity (editorial) model. It handles prompt construction, editorial thread arrangement, and spatial positioning of claims for human-centered reading.

```
Pipeline Output (artifact, mapping response)
         ↓
[EDITORIAL MAPPER] → buildEditorialPrompt()
         ├─ Passage index (density, routing, conflicts)
         ├─ Unclaimed groups (relevance scores)
         └─ Editorial instruction set → LLM → EditorialAST
         ↓
[EDITORIAL PARSER] → parseEditorialOutput()
         ├─ Validate threads + passage IDs
         ├─ Enforce anchor requirement per thread
         └─ Returns EditorialAST (validated)
         ↓
[EVIDENCE SUBSTRATE] → buildEvidenceSubstrate()
         ├─ Resolve thread items → passage text
         ├─ Format with role metadata
         └─ Combine editorial threads + mapping response
         ↓
[POSITION BRIEF] → buildPositionBrief()
         ├─ Bucket-anchor algorithm (support ratios)
         ├─ Format tensions side-by-side
         └─ Spatial arrangement for concierge
         ↓
[CONCIERGE PROMPT] → buildConciergePrompt()
         ├─ Singularity prompt template
         ├─ Prior context (if fresh spawn)
         ├─ Evidence substrate injection
         └─ User query wrapper
         ↓
Singularity Model Input
```

**Directory Organization:**

- `concierge-service.ts` — **Main API:** Prompt builders (Turn 1, 2, 3+), handoff protocol, prior context seeding
- `editorial-mapper.ts` — **Passage Indexing & Prompting:** Builds editorial prompt, parses LLM editorial output into EditorialAST
- `evidence-substrate.ts` — **Text Resolution:** Resolves editorial thread item IDs to batch text, formats for singularity input
- `position-brief.ts` — **Spatial Arrangement:** Bucket-anchor algorithm, tension visualization, geometric positioning for concierge context
- `ConciergeService.test.ts` — Unit tests for prompt builders and parsing functions

**Key Invariants:**

- **No text generation**: Editorial mapper only arranges pre-extracted passages; singularity model fills the final answer
- **Validation-first**: All editorial output validated before passing to concierge; hallucinated passage IDs dropped with error logging
- **Prior context threading**: Fresh spawns inherit prior constraints, decisions, and preferences via structured handoff
- **Spatial geometry**: Position brief uses visual arrangement (boxes, side-by-side) to convey tensions and structure without labels
- **Role-driven thread assembly**: Passages tagged with roles (anchor, support, context, reframe, alternative) to guide editorial arrangement

---

## concierge-service.ts

**Main API — Prompt Construction, Handoff Protocol, Prior Context**

Central point for building singularity/concierge prompts with multi-turn handoff support and prior context threading.

**Feature Flag:**
```typescript
export const HANDOFF_V2_ENABLED = false
```
Controls whether to enable multi-turn handoff protocol (Turn 2+ prompt variants, COMMIT detection, fresh-spawn logic). When false, all turns use plain `buildConciergePrompt`.

**Key Types:**

- `PriorContext` — Handoff distilled from prior conversation + commit summary for fresh spawns
  - `handoff: ConciergeDelta | null` — constraints, eliminated options, preferences, situational facts
  - `committed: string | null` — user's decision/commitment from prior interaction
  
- `ConciergePromptOptions` — Configuration for prompt building
  - `priorContext?: PriorContext` — threaded context from prior turn
  - `evidenceSubstrate?: string` — editorial threads + mapping response

**Handoff Protocol:**

`HANDOFF_PROTOCOL` — Model learns this format on Turn 2; model uses it to signal decision points on Turn 2+ until fresh spawn:

```
---HANDOFF---
constraints: [hard limits]
eliminated: [ruled-out options]
preferences: [trade-off signals]
context: [situational facts]
>>>COMMIT: [only if user commits]
---/HANDOFF---
```

Rules:
- Only include if meaningful context emerged
- Each handoff is complete (carries forward prior state)
- Terse per item (few words, semicolon-separated)
- `>>>COMMIT` signals user is ready to execute
- Never reference in visible response to user

**Main Prompt Builders:**

**`buildConciergePrompt(userMessage, options?): string`**

Main entry point. Constructs singularity prompt with optional prior context and evidence substrate.

**Output structure:**
1. **Role framing** — "You are answering a real question from someone who needs to move forward"
2. **Context setting** — Multiple minds examined this → noise removed → landscape filtered by person
3. **Prior context section** (if `options.priorContext` provided)
   - What's been decided (commit summary)
   - Prior constraints, eliminated options, preferences, situational facts
4. **Evidence substrate** (if provided)
   - Editorial threads (arranged batch text)
   - Mapping response (semantic mapper output)
5. **Query wrapper** — User message in `<query>...</query>` tags (escaped to prevent fence breakage)
6. **Instruction** — "Answer. Go past what was said if needed. Stay rooted in person's actual situation."

User message escaped via `escapeUserMessage()` — wraps in code fence, defuses `</query>` sequences to prevent prompt injection.

**`buildTurn2Message(userMessage: string): string`**

Turn 2 specific (HANDOFF_V2): Injects handoff protocol before user message.

**Output:**
```
[HANDOFF_PROTOCOL]

User Message:
```...user message...```
```

**`buildTurn3PlusMessage(userMessage: string, pendingHandoff: ConciergeDelta | null): string`**

Turn 3+ specific (HANDOFF_V2): Echoes current handoff before user message.

**Output:**
```
[Formatted handoff echo with current constraints, eliminated, preferences, context]

User Message:
```...user message...```
```

Allows model to update or carry forward handoff state across turns.

**Helper Functions:**

- **`buildPriorContextSection(priorContext)`** — Formats constraints, eliminated, preferences, situation into readable sections
- **`escapeUserMessage(msg)`** — Wraps in code fence, defuses `</query>` sequences

**Exports:**

```typescript
export const ConciergeService = {
  buildConciergePrompt,
  buildTurn2Message,
  buildTurn3PlusMessage,
  HANDOFF_PROTOCOL,
  parseConciergeOutput,  // re-export from shared/parsing-utils
}
```

---

## editorial-mapper.ts

**Passage Indexing, Editorial Prompting, and AST Parsing**

Builds a passage index from density + routing data, generates editorial prompt for LLM arrangement, and validates editorial output into a structured AST.

**Passage Index Types:**

**`IndexedPassage`**
- `passageKey` — `claimId:modelIndex:startParagraphIndex` (unique key for editorial arrangement)
- `claimId, claimLabel, modelIndex, modelName` — Source identification
- `startParagraphIndex, endParagraphIndex, paragraphCount` — Range within model
- `text` — Full passage text (concatenated shadow paragraphs)
- `concentrationRatio, densityRatio, meanCoverageInLongestRun` — Routing metrics
- `landscapePosition` — northStar | eastStar | mechanism | floor (from passage routing)
- `isLoadBearing, isSoleSource` — Structural role indicators
- `conflictClusterIndex` — If part of conflict cluster (links to others for editorial arrangement)
- `continuity: { prev, next }` — Passage before/after in stream (source continuity metadata)

**`IndexedUnclaimedGroup`**
- `groupKey` — `unclaimed:claimId:modelIndex:paragraphIndex` (unique identifier)
- `nearestClaimId` — Closest claim by cosine similarity
- `paragraphs[]` — Array of unclaimed paragraph entries with statement texts
- `meanQueryRelevance, maxQueryRelevance` — Relevance scores

**`buildPassageIndex(...): { passages, unclaimed }`**

Constructs passage index from pipeline output.

**Input:**
- `claimDensity` — per-claim passage profiles
- `passageRouting` — routing result (load-bearing gates, landscape positions, clusters)
- `statementClassification` — claimed/unclaimed statement routing
- `shadow` — paragraph corpus
- `claims` — claim definitions
- `citationSourceOrder` — modelIndex → provider name mapping
- `continuityMap` — passage continuity metadata

**Output:**
- `passages[]` — IndexedPassage array sorted by claimId + modelIndex + startParagraphIndex
- `unclaimed[]` — IndexedUnclaimedGroup array

**Algorithm:**

1. Build lookups: paragraph → (modelIndex, paragraphIndex), claims → labels, clusters → claimId → clusterIndex
2. Iterate density profiles → construct passages with text concatenation and routing metadata
3. Extract unclaimed groups → map to nearest claim + format statement texts

**Editorial Prompting:**

**`buildEditorialPrompt(userQuery, passages, unclaimed, corpusShape): string`**

Generates instruction prompt for editorial LLM to arrange passages into threaded document.

**Output sections:**

1. **Role** — "You are an editorial arranger. Arrange passages into threaded reading document."
   - CRITICAL CONSTRAINTS:
     - No new text generation
     - Every passage ID must come from provided list
     - Each thread must have at least one anchor
     - No passage appears in multiple threads

2. **User Query** — Original query being answered

3. **Corpus Shape** — Metadata for editorial context
   - Passage count, claim count, conflict count
   - Concentration spread (min/max/mean)
   - Landscape composition (northStar/mechanism/eastStar/floor counts)

4. **Passages** — Full passage inventory with metadata
   ```
   ### passageKey
   - Model: modelName (index)
   - Claim: "label" (id)
   - Landscape: <position>
   - Concentration: X, Density: Y, μRunCovg: Z
   - Load-bearing: true/false [SOLE SOURCE] [CONFLICT cluster N] [length]
   
   <full passage text>
   ```

5. **Unclaimed Groups** (if any)
   - Nearest claim, relevance scores, statement texts

6. **Item Roles** — anchor | support | context | reframe | alternative

7. **Output Format** — JSON contract for EditorialAST
   ```json
   {
     "orientation": "single sentence describing landscape shape",
     "threads": [
       {
         "id": "thread_1",
         "label": "short title",
         "why_care": "one sentence on why this matters",
         "start_here": true,
         "items": [
           { "id": "<passageKey>", "role": "anchor" },
           { "id": "<passageKey>", "role": "support" }
         ]
       }
     ],
     "thread_order": ["thread_1", ...],
     "diagnostics": {
       "flat_corpus": false,
       "conflict_count": N,
       "notes": "editorial notes"
     }
   }
   ```

**Rules baked into prompt:**
- Orientation: single sentence only
- Every thread must contain ≥1 anchor
- Passage/unclaimed key used ≤1 times across all threads
- thread_order must list every thread id
- start_here: true on exactly one thread
- Prefer 2-5 rich threads over many thin ones
- Group conflict passages (same cluster) together with roles "anchor" + "alternative"

---

## Editorial Output Parser

**`parseEditorialOutput(rawText, validPassageKeys, validUnclaimedKeys): EditorialParseResult`**

Validates editorial LLM output and transforms into EditorialAST.

**Input:**
- `rawText` — Raw editorial LLM response (may contain JSON + surrounding text)
- `validPassageKeys` — Set of valid `passageKey` strings from `buildPassageIndex()`
- `validUnclaimedKeys` — Set of valid `groupKey` strings from unclaimed groups

**Validation Pipeline:**

1. **Extract JSON** — Parse JSON from code fence or structured content
2. **Orientation validation** — Check for non-empty string
3. **Threads array** — Require threads[] present
4. **Per-thread validation:**
   - Check thread.id, label, why_care, items array
   - Per-item validation:
     - Reject hallucinated IDs (not in validPassageKeys ∪ validUnclaimedKeys)
     - Reject duplicate IDs within editorial output
     - Map role to valid set; default to "support" if unknown
   - Require ≥1 anchor; promote first item if needed
5. **Exactly one start_here** — Enforce (default to first thread if none set)
6. **thread_order validation** — Ensure all thread IDs present and valid
7. **Diagnostics** — Parse flat_corpus flag and conflict_count

**Error handling:**
- Non-fatal errors logged in `errors[]` (hallucinated IDs, missing anchors, invalid roles)
- Parser succeeds if ≥1 valid thread remains
- Success = `{ success: true, ast: EditorialAST, errors: [] }`
- Failure = `{ success: false, ast: undefined, errors: [...] }`

**Output: `EditorialAST`**
```typescript
{
  orientation: string;
  threads: EditorialThread[];
  thread_order: string[];
  diagnostics: { flat_corpus: boolean; conflict_count: number; notes: string };
}
```

---

## evidence-substrate.ts

**Text Resolution and Evidence Presentation**

Transforms editorial AST + artifact into a readable text substrate for singularity model input.

**Passage Resolution (mirrors UI hook `usePassageResolver`):**

**`buildLookupCacheFromIndex(passages, unclaimed): EvidenceSubstrateLookupCache`**

Pre-computes passage resolutions (text, modelName, claimLabel) from the `buildPassageIndex` output. This skips artifact traversal during rapid re-resolution. Attach to `cognitiveArtifact._editorialLookupCache`.

**`buildResolver(artifact, citationSourceOrder): (itemId: string) => PassageResolution | null`**

Builds a resolver function that maps editorial item IDs to actual passage text (fallback path if cache unavailable).

**Resolution logic:**

1. **Unclaimed group** (itemId starts with `unclaimed:`)
   - Lookup unclaimed group by key
   - Concatenate unclaimed statement texts
   - Return with modelName="unclaimed", claimLabel=nearestClaimId

2. **Passage** (itemId = `claimId:modelIndex:startParagraphIndex`)
   - Parse claimId, modelIndex, startParagraphIndex
   - Lookup passage in density profiles
   - Concatenate shadow paragraph text from startParagraphIndex → endParagraphIndex
   - Map modelIndex → model name via citationSourceOrder
   - Return with full text, modelName, claimLabel

**Inputs to resolver:**
- `artifact` — CognitiveArtifact with shadow, semantic.claims, claimDensity, statementClassification
- `citationSourceOrder` — Maps modelIndex → provider display name

---

**Editorial Formatting:**

**`formatEditorialThreads(ast, resolve): string`**

Renders EditorialAST into human-readable text format for evidence substrate.

**Output format:**

```
[orientation sentence]

--- thread_label ---
[why_care text]

[ANCHOR | modelName | claimLabel]
[passage text]

[SUPPORT | modelName | claimLabel]
[passage text]

--- next_thread_label ---
...
```

Walks threads in `thread_order`, resolves each item ID, formats with role + model + claim labels.

---

**Evidence Substrate Assembly:**

**`buildEvidenceSubstrate(artifact, mappingText, citationSourceOrder): string`**

Main API: Combines editorial threads + mapping response into a text substrate for singularity.

**Output sections:**

1. **EDITORIAL THREADS** (if EditorialAST present + artifact has shadow data)
   ```
   === EDITORIAL THREADS ===
   [formatted editorial threads]
   ```

2. **MAPPING RESPONSE** (if mappingText provided)
   ```
   === MAPPING RESPONSE ===
   [raw mapping LLM output]
   ```

Returns concatenated sections or empty string if no content.

---

## position-brief.ts

**Spatial Arrangement of Claims for Concierge Context**

Constructs a geometric brief showing claims arranged by support ratio, with tensions visualized side-by-side and buckets separated by dividers.

**Philosophy:**

- Edges describe the problem (logical relationships)
- Support counts describe the models (voting)
- Transmit geometry (arrangement), not hierarchy or rankings
- Concierge interprets spatial arrangement in context of user's question

Concierge sees: side-by-side boxes (tensions), dividers (buckets). Does NOT see: rankings, percentages, shape names.

**Utility Functions:**

- **`shuffle(array): T[]`** — Fisher-Yates shuffle
- **`wrapText(text, width): string[]`** — Wrap lines to specified width
- **`formatSideBySide(a, b): string`** — Format two claims in box format with box-drawing characters (implies alternatives/tensions)

**Bucket-Anchor Algorithm:**

**`buildPositionBrief(analysis): string`**

Main entry point.

**Input:** `StructuralAnalysis` — claimsWithLeverage[], edges[]

**Algorithm:**

1. **Sort by support** — Descending (highest support first)
2. **Split at midpoint**
   - mid = floor(length / 2)
   - mainstream = top half (higher support)
   - anchors = bottom half (lower support, outliers)
   - If length=1: mainstream=[], anchors=[claim]
3. **Create buckets** — One bucket per anchor
4. **Distribute mainstream claims**
   - For each mainstream: find edge to any anchor → assign to that bucket
   - Unassigned: distribute round-robin
5. **Randomize bucket order** — Shuffle buckets (no ranking conveyed)
6. **Assemble brief**
   - Per bucket:
     - Anchor text (first)
     - Tension pairs (side-by-side boxes) from conflict/tradeoff edges
     - Remaining unpaired claims (randomized)
     - Divider between buckets (`───`)

**Output:** Text with boxes, dividers, no labels or shape names.

**Variant:**

**`buildPositionBriefFromClaims(claims): string`**

Wrapper: builds minimal StructuralAnalysis-like object from claims[], calls buildPositionBrief.

---

## Integration with Broader System

**Upstream (consumes):**

- **Provenance Pipeline** → enrichedClaims, edges, conflict validation
- **Passage Routing** → claimDensityResult, passageRoutingResult, landscape positions
- **Statement Classification** → statementClassification.unclaimedGroups
- **Shadow Extraction** → paragraphs, statements, full text
- **Semantic Mapper** → mapping response, claims, edges
- **Structural Analysis** → graph topology, cascade risks, structural patterns

**Downstream (consumed by):**

- **Singularity Model** → receives concierge prompt + evidence substrate
- **UI Editorial Display** → renderEditorialAST (threads arranged in accordion/tabs)
- **Turn Finalization** → evidence substrate persisted in aiTurn context
- **Prior Context Threading** → handoff data carried to next session/fresh spawn

**Key Relationships:**

- **Editorial Mapper** → outputs instruction prompt for editorial LLM
- **Editorial Parser** → validates editorial LLM output, drops hallucinated IDs
- **Evidence Substrate** → resolves editorial item IDs to actual text (bidirectional with UI's usePassageResolver)
- **Position Brief** → spatial arrangement (no-label, geometric) sent to concierge alongside singularity prompt
- **Concierge Service** → orchestrates prompt construction with handoff protocol + prior context seeding

---

## Key Design Principles

**No Text Generation:** Editorial mapper arranges pre-extracted passages; singularity model fills the final answer (no hallucinated citations).

**Validation-First:** All editorial output validated before downstream use; hallucinated passage IDs logged and dropped (graceful degradation).

**Prior Context Threading:** Fresh spawns inherit prior constraints, decisions, preferences via structured handoff (ConciergeDelta); enables multi-turn coherence without full conversation history.

**Spatial Geometry:** Position brief uses visual arrangement (boxes, dividers, randomization) to convey tensions and structure without explicit rankings or labels.

**Role-Driven Assembly:** Passages tagged with roles (anchor, support, context, reframe, alternative) to guide editorial arrangement and reading flow.

**Citation Source Order:** Maps modelIndex → provider display name for editorial presentation (who said what).

**Continuity Metadata:** Passage continuity (prev/next) carried through editorial arrangement for thread coherence.

**Graceful Degradation:** All steps wrapped in validation; missing data → empty sections, not crashes.

---

## Summary

**Concierge Service Architecture:**

The concierge-service module orchestrates **final synthesis** for the singularity (editorial) model through four coordinated stages:

1. **Editorial Mapper** (editorial-mapper.ts) — Passage indexing, editorial prompting, AST parsing
2. **Evidence Substrate** (evidence-substrate.ts) — Text resolution, editorial formatting, combined substrate assembly
3. **Position Brief** (position-brief.ts) — Spatial claim arrangement via bucket-anchor algorithm
4. **Concierge Prompting** (concierge-service.ts) — Prompt construction with handoff protocol and prior context threading

**Key Properties:**

- **No hallucination risk** — Editorial LLM only arranges; singularity LLM answers (bidirectional validation)
- **Spatial over hierarchical** — Position brief conveys tensions geometrically, not rankings
- **Multi-turn coherent** — Handoff protocol threads constraints, decisions, preferences across turns
- **Validation-focused** — All editorial output validated; graceful degradation on missing/malformed data
- **Source traceable** — Every passage tagged with model name, claim, role, routing metrics

**Entry Points:**

- **Editorial arrangement:** `buildEditorialPrompt(...)` → `parseEditorialOutput(...)`
- **Evidence substrate:** `buildEvidenceSubstrate(artifact, mappingText, citationSourceOrder)`
- **Position brief:** `buildPositionBrief(analysis)`
- **Concierge prompt:** `buildConciergePrompt(userMessage, options?)`
- **Multi-turn (V2):** `buildTurn2Message(...)`, `buildTurn3PlusMessage(...)`

**File Checklist:**

- concierge-service.ts — prompt builders, handoff protocol, prior context seeding
- editorial-mapper.ts — passage indexing, editorial prompting, AST parsing
- evidence-substrate.ts — text resolution, editorial formatting, substrate assembly
- position-brief.ts — bucket-anchor algorithm, spatial arrangement
- ConciergeService.test.ts — unit tests
