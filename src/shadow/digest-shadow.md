# shadow — file digest (statement extraction and classification)

---

## StatementTypes.ts

Stance and signal classification for mechanical statement extraction.

**Stances (7 types):**

Organized as three positive/negative pairs plus one fallback:

- `prescriptive` / `cautionary` — Action direction: do vs don't
- `prerequisite` / `dependent` — Temporal order: before vs after
- `assertive` / `uncertain` — Certainty level: is vs might
- `unclassified` — Fallback for low-confidence cases (embedding failures or no reliable pattern match)

**Priority Order (`STANCE_PRIORITY`):**

Ranking highest-to-lowest: prerequisite (hard order) → dependent → cautionary (risk) → prescriptive (action) → uncertain (hedge) → assertive (default) → unclassified (fallback).

Used for tiebreaking when multiple patterns match in the same statement.

**`STANCE_PATTERNS` — Pattern Library**

Each stance maps to a RegExp array (word/phrase signatures):

- **cautionary**: don't, avoid, never, risk, danger, warning, pitfall, trap, mistake, error, problem with, watch out, beware, should not
- **prerequisite**: before, first, prior to, requires, precondition, foundation for, groundwork, enables, unblocks, allows you to, initially
- **dependent**: after, once, then you can, following, subsequent, only after, when done, downstream
- **prescriptive**: should, must, ought to, need to, ensure, make sure, always, required, essential, critical, imperative, recommend, suggest, advise, use, apply, consider, implement
- **uncertain**: might, may, could, possibly, perhaps, maybe, unclear, unknown, uncertain, depends, not sure, hard to say, in some cases
- **assertive**: works, performs, provides, offers, includes, exists, contains, supports, is essential/critical, demonstrates/proves/confirms

**`SIGNAL_PATTERNS` — Relationship Markers**

Independent of stance; detect three boolean signals:

- **sequence**: before, after, first, then, next, finally, once, requires, depends on, prior to, subsequent, following, enables, unblocks, step N, phase N
- **tension**: but, however, although, though, despite, nevertheless, yet, instead, rather than, on the other hand, in contrast, conversely, versus, vs, or, trade-off, balance, competing, conflicts with
- **conditional**: if, when, unless, assuming, provided that, given that, in case, contingent on, subject to, depending on, for this/that/these case, in some/certain/specific cases, only if, only when

**`classifyStance(text)` → `{ stance, confidence }`**

Evidence-weighted majority wins:

1. Count pattern matches for each stance
2. Winner = stance with most matches; priority breaks ties
3. Base confidence from pattern strength: 1 match = 0.65, 2 = 0.80, 3+ = 0.95
4. Dominance multiplier: penalizes cross-stance contamination (winner_count / total_matches)
5. Fallback: if no patterns match, return `assertive` with confidence 0.50

**`detectSignals(text)` → `{ sequence, tension, conditional }`**

Returns three boolean flags; any pattern match sets the flag true.

**`getStancePriority(stance)` → number**

Converts stance to numeric priority (used for tiebreaking).

---

## ExclusionRules.ts

Two-pass filtering: **inclusion** (stance patterns) + **exclusion** (disqualifying patterns).

**Severity Levels:**

- `hard` — instant disqualification (confidence = 0)
- `soft` — confidence penalty (compound 0.7x per hit; multiple soft hits stack)

**`EXCLUSION_RULES` — Rule Library**

Organized by scope:

**Universal (all stances):**
- `question_mark` (hard): ends with '?'
- `too_short` (hard): ≤15 characters
- `meta_let_me` (hard): "let me", "let's", "I'll", "allow me to" (meta-framing)
- `meta_note` (hard): "note that", "it's worth noting", "keep in mind" (meta-commentary)
- `quoted_material` (hard): wrapped in quotes (10+ chars)

**Prescriptive:**
- `prescriptive_epistemic_should` (hard): "should be/have been clear/obvious/evident" (epistemic not prescriptive)
- `prescriptive_conditional_should` (soft): "if ... should" (extract as conditional instead)
- `prescriptive_hypothetical` (soft): "you/one could potentially/possibly" (suggestion not prescription)
- `prescriptive_question_form` (hard): "should [you/we/i/they]...?" (question, not directive)
- `prescriptive_rhetorical` (hard): "surely/certainly you can agree" (rhetorical appeal)
- `prescriptive_past_tense` (soft): "should have been/done/made" (past counterfactual)
- `prescriptive_attributed` (soft): "they/he/she say(s) ... should" (attributed, not asserted)

**Cautionary:**
- `cautionary_hypothetical` (soft): "might/could potentially cause/lead to" (hypothesis not definite warning)
- `cautionary_past_reference` (hard): "should have avoided", "shouldn't have done" (past counterfactual)
- `cautionary_rhetorical` (soft): "you wouldn't want to" (rhetorical framing)
- `cautionary_generic` (soft): "be careful", "watch out" (too generic, lacks specific risk)

**Prerequisite:**
- `prereq_temporal_before` (hard): "long/just/shortly before", "the day before" (temporal narration, not dependency)
- `prereq_before_meeting` (soft): "before the meeting/call/event" (temporal reference, not technical prerequisite)
- `prereq_narrative_first` (hard): "first time/day/week/month/year/attempt" (narrative "first", not dependency)
- `prereq_hypothetical` (soft): "if you were to... first/before" (hypothetical scenario)

**Dependent:**
- `dependent_simple_temporal` (soft): "after/following the meeting/call/lunch" (calendar event, not technical dependency)
- `dependent_narrative_after` (hard): "after a long/short/brief while/time" (narrative time passage)
- `dependent_once_upon` (hard): "once upon a time" (narrative framing)
- `dependent_then_rhetorical` (hard): "then what/why/how/where/who" (rhetorical question)

**Assertive:**
- `assertive_narrative_was` (soft): "it/this/that was a great/good/bad/terrible" (narrative evaluation)
- `assertive_metaphor` (soft): "is/are like a/an" (metaphorical comparison)

**Uncertain:**
- `uncertain_rhetorical` (hard): "who knows", "god knows", "anyone's guess" (rhetorical, not substantive)
- `uncertain_politeness` (hard): "might/may/could I ask/suggest/recommend" (politeness marker)
- `uncertain_narrative` (soft): "might have been" (past speculation, not current uncertainty)

**Special Case: List Items**

If a statement ends with '?' AND is a list item (structural rhetorical heading), demote from hard to soft exclusion (0.7x confidence multiplier instead of instant rejection).

**`isExcluded(text, stance, opts?)` → `{ excluded, confidenceMultiplier }`**

Evaluates applicable rules for the given stance:

- Hard match → `{ excluded: true, confidenceMultiplier: 0 }`
- Soft matches compound: each hit multiplies confidence by 0.7
- No match → `{ excluded: false, confidenceMultiplier: 1.0 }`

---

## ShadowExtractor.ts

Main mechanical extraction of statements from model responses (no LLM calls; pure pattern matching).

**Text Processing Helpers:**

**`cleanTextForProcessing(raw)`**

Strips structural markdown for internal classification/filtering (does NOT modify stored text):

- Removes header prefixes (#-##)
- Strips blockquote prefixes (>)
- Replaces table pipes with spaces
- Strips bold/italic/backticks via `stripInlineMarkdown()`

**`splitIntoSentences(paragraph)`**

Splits text on sentence boundaries (.!?。！？) with protection for common abbreviations (Mr, Mrs, Dr, Prof, Inc, Ltd, vs, etc, e.g, i.e) and decimal numbers.

Handles CJK sentence markers (。！？) alongside ASCII.

**`countWords(text)`**

CJK-aware word count: each ideograph (~CJK Unified, Hangul, Hiragana, Katakana) = 1 word; remainder split by whitespace.

**`isSubstantive(cleanText, rawText?)`**

Checks if statement is substantive enough to extract:

1. Minimum 3 words (CJK-aware count)
2. Raw text exclusions: isolated headers, bold/underline-only lines, table remnants, meta-commentary ("Sure,", "Let me", "Here's a...", "as I mentioned", "to summarize")

**`splitTablesAndProse(content)`**

Parses markdown tables inline:

- Identifies pipe-delimited rows (|...|) with separator row
- Converts each cell to a `TableCell` entry: `"rowHeader — columnHeader: value"`
- Returns array of prose and table segments

**`splitContentBlocks(content)`**

Distinguishes structural blocks:

- **List items** (-, *, •, numbered): extracted directly without sentence splitting
- **Prose**: split into paragraph blocks (double newline), then sentences

### Main Extraction Pipeline

**`extractShadowStatements(responses)` → `ShadowExtractionResult`**

Input: `Array<{ modelIndex, content }>`

Orchestration:

1. **Split tables & prose** — `splitTablesAndProse()` separates markdown tables from text
2. **For each segment:**
   - **Table cells**: create one statement per cell (stance=assertive, confidence=1.0)
   - **Prose blocks**: split into lists and paragraphs
     - **List items**: direct statement creation (skip sentence splitting)
     - **Prose paragraphs**: split into sentences via `splitIntoSentences()`
3. **For each sentence/list item/cell:**
   - Clean text via `cleanTextForProcessing()`
   - Check substantivity via `isSubstantive()`
   - Classify stance via `classifyStance()` + compute confidence
   - Check exclusion via `isExcluded()` + apply confidence multiplier
   - Detect signals via `detectSignals()`
   - Create `ShadowStatement` with full provenance (modelIndex, location, fullParagraph)

**Safety Limits:**

- `SENTENCE_LIMIT = 10,000` — prevent runaway extraction
- `CANDIDATE_LIMIT = 10,000` — cap total statements
- Both limits trigger truncation flag if exceeded (with diagnostics)

**Output: `ShadowExtractionResult`**

- `statements` — array of fully-processed ShadowStatement objects
- `meta`:
  - `totalStatements` — final count
  - `byModel` — count per model index
  - `byStance` — distribution by stance
  - `bySignal` — count of statements with each signal type
  - `processingTimeMs` — wall-clock time
  - **Diagnostics**: candidatesProcessed, candidatesExcluded, sentencesProcessed, truncated, truncatedAtModel

**`ShadowStatement` Structure:**

- `id` — unique "s_N" identifier
- `modelIndex` — source model
- `text` — raw extracted text (unchanged)
- `cleanText` — markdown-stripped for classification
- `stance` — classified stance type
- `confidence` — 0.0-1.0 (from stance strength + exclusion penalties)
- `signals` — boolean flags (sequence, tension, conditional)
- `location` — `{ paragraphIndex, sentenceIndex }` for provenance
- `fullParagraph` — context for evidence/interpretation
- `isTableCell?` — true if from markdown table
- `tableMeta?` — `{ rowHeader, columnHeader, value }` if table cell
- `geometricCoordinates?` — optional { paragraphId, regionId, basinId, isolationScore } (populated downstream by geometry layer)

---

## ShadowParagraphProjector.ts

Aggregates statements back into paragraph-level metadata for upstream use.

**`projectParagraphs(statements)` → `ParagraphProjectionResult`**

Grouping: statements → paragraphs by `(modelIndex, paragraphIndex)` key.

For each paragraph group:

**Dominant Stance Computation:**

1. Collect all stances in the group and their total confidence
2. Check for "contested" conditions:
   - prescriptive + cautionary
   - assertive + uncertain
   - prerequisite + dependent
   - cautionary + uncertain
   - prescriptive + uncertain
3. If contested: dominantStance = highest-priority stance; contested flag = true
4. If not contested: dominantStance = stance with max total confidence; priority as tiebreaker

**Signal Aggregation:**

- `signals.sequence` — true if ANY statement in paragraph has sequence signal
- `signals.tension` — true if ANY statement has tension signal
- `signals.conditional` — true if ANY statement has conditional signal

**Confidence:**

- Paragraph confidence = max confidence of any statement in the group

**Output: `ShadowParagraph`**

- `id` — unique "p_N" identifier (assigned sequentially)
- `modelIndex` — source model
- `paragraphIndex` — original paragraph location in model response
- `statementIds` — array of constituent statement IDs
- `dominantStance` — classified stance for the paragraph
- `stanceHints` — all stances present in priority order
- `contested` — boolean; true if multiple contradictory stances present
- `confidence` — max statement confidence
- `signals` — aggregated boolean flags
- `statements` — surface-level array (clipped to 320 chars per statement):
  - `id, text, stance, signals` (signal names: "SEQ", "TENS", "COND")
- `_fullParagraph` — context string from first statement's fullParagraph

**Helper Functions:**

- `clipText(text, maxChars)` — truncate with trim
- `stancePrecedence(stance)` → number
- `compareStances(a, b)` → -1 | 0 | 1 (used for priority sorting)

---

## index.ts

Public API surface for the shadow module.

**Type Exports:**

- `Stance, SignalPatterns` from StatementTypes
- `ExclusionRule` from ExclusionRules
- `ShadowStatement, ShadowExtractionResult, TableCellMeta` from ShadowExtractor
- `ShadowParagraph, ParagraphProjectionResult` from ShadowParagraphProjector

**Constant Exports:**

- `STANCE_PRIORITY, STANCE_PATTERNS, SIGNAL_PATTERNS` from StatementTypes
- `EXCLUSION_RULES` from ExclusionRules

**Function Exports:**

- `getStancePriority, classifyStance, detectSignals` from StatementTypes
- `isExcluded` from ExclusionRules
- `extractShadowStatements` from ShadowExtractor
- `projectParagraphs` from ShadowParagraphProjector

**Legacy Aliases:**

- `executeShadowExtraction` → `extractShadowStatements`
- `TwoPassResult` → `ShadowExtractionResult`

---

## Summary of Architecture

**Shadow Layer Flow:**

```
Model Responses (text + modelIndex)
         ↓
[Table & Prose Splitting] — markdown table extraction vs continuous text
         ↓
[List/Sentence Segmentation] — list items skip sentence splitting; prose splits on boundaries
         ↓
[Substantivity Check] — CJK-aware word count, filter meta-commentary, structural remnants
         ↓
[Stance Classification] — pattern matching + priority-based tiebreaking + confidence weighting
         ↓
[Signal Detection] — three independent boolean patterns (sequence, tension, conditional)
         ↓
[Exclusion Filtering] — two-pass (hard disqualify vs soft confidence penalty)
         ↓
[ShadowStatement Array] — full provenance: id, modelIndex, location, fullParagraph, cleanText
         ↓
[Paragraph Projection] — group by (modelIndex, paragraphIndex) → dominant stance + contested flag
         ↓
[ShadowParagraph Array] — ready for geometry layer (embedding, regionalization, etc.)
```

**Design Principles:**

- **Pure pattern matching**: No LLM calls, no embeddings. Fast (<100ms typical).
- **Dual representation**: Both raw `text` (for evidence/display) and `cleanText` (for classification).
- **Provenance tracking**: Every statement knows its location, full paragraph context, source model.
- **Confidence layering**: Stance confidence × exclusion multiplier = final confidence.
- **CJK-aware**: Ideographs counted individually for word count; CJK sentence markers recognized.
- **Structural awareness**: Tables extracted separately; list items treated differently from prose sentences.
- **Contestation flagging**: Paragraphs mark when multiple opposing stances are present (prescriptive + cautionary, assertive + uncertain, etc.).
- **Signal independence**: Sequence/tension/conditional detected independently; orthogonal to stance.
- **Human-reviewable rules**: All patterns and exclusions documented; changes require review (GUARDRAILS.md).

**Downstream Integration:**

- Input to `StepExecutor.js` deterministic pipeline
- Statements enriched with geometric coordinates by `geometry/enrichment.ts`
- Paragraphs used for embedding generation (`clustering/embeddings.ts`)
- Provenance links preserved through semantic mapping and claim synthesis
