

# Counter-Response to Shadow Extraction Audit

The audit is thorough and mostly correct in its findings. Several flags are real bugs. Several are correctly identified behaviors that the report mischaracterizes as problems. A few are non-issues dressed up as concerns. Here's what actually needs to happen, grouped by what they affect.

---

## Before Anything Else: What Does Stance Classification Actually Do Downstream?

The report treats stance classification as if the entire pipeline depends on it. Before prescribing fixes, the question is: what breaks if stance is wrong?

Stance appears in the instrumentation cards as metadata. It appears in `computeSignalWeight()` which feeds ShadowDelta scoring. It appears in contested paragraph detection. It does NOT feed into embeddings, provenance reconstruction, competitive allocation, blast surface, twin detection, conflict validation, or synthesis. The geometry layer ignores it entirely.

If every statement were classified as "unclassified," the geometric pipeline would produce identical claims, identical provenance, identical blast surface scores, identical conflict validation, identical routing, identical questions, and identical synthesis. The only casualties would be diagnostic labels in the UI and the signal weight metadata.

This means E-10 through E-16 (stance classification problems) are **diagnostic quality issues, not pipeline correctness issues**. They should be fixed, but they are lower priority than anything that affects what enters or doesn't enter the corpus. The report ranks E-10, E-11, E-12, E-14 as HIGH risk. They are HIGH risk for diagnostic accuracy. They are LOW risk for pipeline output.

---

## Priority 1: What Enters the Corpus (Conservation Law Violations)

### E-03 — Tables: FIXED BY NEW ARCHITECTURE

Tables currently get silently dropped by `isSubstantive()`. The fix is the cell decomposition architecture we've designed:

**At extraction time:** Detect tables by markdown structure (consecutive lines with `|` characters, at least one separator line matching `[-:|]+`). Extract the full table block. Parse into header row and data rows. Decompose each cell into an atomic unit using the structural punctuation template:

```
row_header — column_header: cell_value
```

These cell-units enter a **table sidecar** keyed by `(modelIndex, tableIndex)`. They do NOT enter the main statement corpus. They get embedded separately after provenance reconstruction, allocated to claims via claim-centric scoring on their embeddings, and pruned at cell granularity based on claim survival. Surviving cells are reassembled into valid markdown tables for synthesis.

Store alongside each cell-unit: `{ rowIndex, colIndex, rowHeader, colHeader }` for reconstruction after pruning.

The surrounding prose above and below the table enters the main corpus normally through the existing paragraph/statement path.

### E-01 — Single-Newline List Collapse: REAL BUG, SPECIFIC FIX

The paragraph splitter uses `split(/\n\n+/)`. Single-newline-separated list items collapse into one blob. The sentence splitter then fails on them because list items don't end with `[.!?]`.

**The fix is not to split on single newlines universally** — that would shatter prose paragraphs that use soft wrapping. The fix is to detect list blocks specifically:

Before the double-newline split, scan for contiguous lines that start with list markers (`- `, `* `, `• `, `1. `, `2. `, etc.). Extract these blocks as list groups. Each list item becomes its own statement directly — it does not go through sentence splitting because list items are already atomic units. Strip the bullet/number prefix before embedding.

Non-list content proceeds through the existing double-newline paragraph split and sentence splitting unchanged.

### E-02 — Markdown Not Stripped: REAL BUG, PREPROCESSING PASS

Add a preprocessing function that runs on every paragraph's text BEFORE `isSubstantive()`, `classifyStance()`, or embedding:

Strip `**` and `__` (bold), `*` and `_` (italic), `~~` (strikethrough). Strip `#` header prefixes. Strip `>` blockquote prefixes. Strip `|` table pipe characters and `---` separator lines (though tables should already be extracted before this point). Strip backtick code markers. Preserve the semantic text content.

This function produces **clean text** used for word counting, stance classification, and embedding. The original raw markdown text is preserved separately for display in the UI — the user should see what the model actually wrote, including formatting.

Two text fields per statement: `rawText` (original, for display) and `cleanText` (stripped, for all processing).

### E-09 — Meta-Pattern Filter Over-Reach: REAL BUG, NARROW FIX

The pattern `/^(let me|I'll|I will|I can|I would)\b/i` catches LLM throat-clearing but also catches argumentative claims starting with "I would argue."

**Fix:** Change the meta-pattern to require that the phrase is followed by a non-argumentative continuation. Specifically: keep the filter for "I would" ONLY when followed by hedging verbs like "suggest," "recommend," "say," "note," "point out," "like to." Don't filter "I would argue," "I would contend," "I would assert."

Or simpler: remove "I would" from the meta-pattern entirely. The remaining patterns ("let me," "I'll," "I will," "I can") catch the actual throat-clearing. "I would" in argumentative voice is too valuable to risk.

### E-19 — assertive_hypothetical_would Hard Exclusion: REMOVE

`/\bwould\s+be\b/i` as a **hard** exclusion on assertive statements is indefensible. "The blast radius would be large for orphan-heavy claims" is a structural prediction. "The cascade would be catastrophic" is a risk assessment. These are substantive analytical statements being silently destroyed.

**Fix:** Delete this hard exclusion rule entirely. If "would be" sentences need marking, make it a soft exclusion that reduces confidence — but given E-18 (soft exclusions are dead code), this means it does nothing until soft exclusions are implemented. Which is fine. Better to let these statements through than to destroy them.

### E-20 — Metaphor Exclusion: KEEP BUT NARROW

"Claims are like attractors in a basin" is load-bearing. "It's like a Swiss Army knife" is noise. The difference is whether the analogy introduces structural concepts or is decorative.

**Fix:** Keep the rule but make it soft (confidence penalty, once soft exclusions are implemented). For now, since soft exclusions are dead code, remove the hard version. Metaphors should enter the corpus and let the geometry determine their relevance through competitive allocation.

### E-21 — Cautionary Hypothetical: KEEP AS SOFT, WHICH MEANS INACTIVE

The report is correct that probabilistic causal claims are substantive. "This could lead to false claim ownership" is a risk statement the pipeline should preserve. The rule is already marked soft, which means it currently does nothing (E-18). Leave it as soft. When soft exclusions are implemented as confidence penalties, these statements will get slightly lower confidence — which is semantically correct (they ARE hedged) — without being removed from the corpus.

### E-22 — prereq_requires_subject: NARROW THE PATTERN

"Requires a stable embedding model" should not be caught. The pattern `/requires\s+a\/an\/the\/some\/more\/less/` is too broad. It fires on structural prerequisites. **Fix:** Remove this pattern. If it was meant to catch padding like "requires a certain amount of effort," that's a substantive claim about effort requirements, not noise.

---

## Priority 2: Extraction Mechanics

### E-04 & E-05 — Hardcoded Limits and Silent Truncation: REAL BUGS

2000 statements and 2000 candidates as fixed limits are arbitrary. With 6 models producing ~50 paragraphs each with ~3 statements per paragraph, you get ~900 statements — safely under the limit. But a model that produces a long, detailed response could push one model's contribution past the remaining budget, and the current code stops mid-model.

**Fix for E-05 (the critical one):** If a limit is hit, complete the current model's extraction before stopping. Never produce a partial model representation. Add a flag to the extraction output: `truncated: boolean, truncatedAtModel: number | null`. Downstream consumers can see that truncation occurred.

**Fix for E-04:** Make limits proportional to model count. `SENTENCE_LIMIT = 500 × modelCount`. For 6 models, that's 3000. For 2 models, 1000. This scales with the actual input size. Document the per-model budget explicitly.

### E-06 — Sentence Splitter End-of-Block: MINOR FIX

Add `$` (end of string) as a valid split boundary alongside `\s+`:

```
protectedText.split(/(?<=[.!?])(?:\s+|$)/)
```

This ensures the last sentence in a paragraph is correctly separated even without trailing whitespace.

### E-07 — Abbreviation Protection: ACCEPT RISK

The `|||` replacement for periods in abbreviations and decimals is a hack but it works for the common cases. Nested abbreviations within list items are a theoretical risk but would require a list item starting with a number followed by an abbreviation — a rare pattern. The list block detection from E-01's fix would handle most list items before they reach sentence splitting, reducing this risk further.

**Action:** No change. Document the known limitation. The fix for E-01 (list detection) mitigates the worst cases.

### E-08 — 5-Word Minimum: LOWER TO 3

Four-word statements like "Embeddings define the substrate" are substantive. Two-word fragments like "For example" are not. Three words is the minimum for a subject-verb-object structure, which is the smallest meaningful assertion in English.

**Fix:** Change threshold from 5 to 3. Document: "3 words is the minimum for subject-verb-object structure." Note that this operates on clean text (after markdown stripping), so markdown artifacts don't inflate the count.

---

## Priority 3: Stance Classification Cleanup

These are diagnostic improvements, not pipeline-critical fixes.

### E-10 — Priority vs Evidence: CHANGE TO EVIDENCE-WEIGHTED

The priority ordering means a single "requires" match overrides 8 assertive matches. This was designed as a tiebreaker but functions as an override.

**Fix:** Change classification to majority-wins with priority as tiebreaker. Count pattern matches per stance. The stance with the most unique pattern matches wins. If tied, the higher-priority stance wins. Assertive matches from copula verbs (see E-11) don't count — they're excluded from the competition.

### E-11 & E-12 — Assertive Patterns Are Noise: DEMOTE TO RESIDUAL

The patterns `/\bis\b/`, `/\bare\b/`, `/\bdo\b/` match every English sentence. They make assertive a universal background signal that suppresses every other stance's confidence.

**Fix:** Remove copula verbs from assertive patterns entirely. Make assertive the **residual stance** — assigned when no other stance fires. This is how it actually functions conceptually: "this statement asserts something" is the default for any statement that isn't a prerequisite, caution, prescription, uncertainty, or dependency. Making it explicit removes the noise from the confidence calculation.

If assertive needs its own positive patterns, use assertion-specific constructions: "is essential," "is critical," "is the primary," "is required," "demonstrates that," "proves that," "confirms that." These are genuinely assertive rather than merely containing copula verbs.

### E-13 — Hedges as Uncertainty: MOVE TO ASSERTIVE

"Typically" and "usually" are frequency qualifiers on assertions, not uncertainty markers. "Competitive allocation typically produces correct assignments" is an assertive claim. 

**Fix:** Remove `/\btypically\b/` and `/\busually\b/` from uncertain patterns. These sentences will now fall through to assertive (as residual) or match whatever other stance their content supports. Correct behavior.

### E-14 — Prescriptive Patterns on Descriptive Sentences: NARROW PATTERNS

"The system uses embeddings" matching prescriptive because of `/\buse\b/` is wrong. The word "use" in third person descriptive is not a prescription.

**Fix:** Prescriptive patterns should require imperative or second-person construction: `/\byou\s+should\s+use\b/`, `/\buse\s+(?:a|an|the)\b/` at sentence start (imperative), `/\bconsider\s+(?:using|applying)\b/`. Third-person "uses" is descriptive, not prescriptive.

### E-15 & E-16 — Signal Overlap and Weights: DOCUMENT ONLY

Signal patterns sharing vocabulary with stance patterns is a real overlap but the downstream impact is limited to ShadowDelta scoring, which is a diagnostic. The fixed weights (conditional=3, sequence=2, tension=1) are undocumented assumptions.

**Fix:** Document the weights and their rationale. Add them to the instrumentation output so they're visible. No code change needed unless ShadowDelta scoring proves to be driving decisions it shouldn't be — and currently it's metadata.

---

## Priority 4: Exclusion Rules Audit

### E-17 — Signal Loss From Exclusion Rules: IMPLEMENT SOFT EXCLUSIONS

The audit identifies multiple rules that discard structurally significant statements. The root problem is E-18: soft exclusions are dead code. Rules marked "soft" were intended to reduce confidence, not discard. They currently do nothing.

**Fix:** Implement soft exclusions as a confidence multiplier. A statement hitting a soft exclusion rule gets its confidence multiplied by 0.7 (or whatever factor). It stays in the corpus. It enters the geometry. It just carries lower confidence metadata. This preserves the conservation law while still marking hedged/conditional content as lower-confidence.

The specific rules that are currently hard but should be soft:
- `assertive_hypothetical_would` → soft (or remove entirely per E-19)
- `assertive_metaphor` → soft
- `cautionary_hypothetical` → already soft (remains so)
- `prescriptive_conditional_should` → soft, OR reclassify as conditional stance per audit recommendation

---

## Priority 5: Projector Issues

### E-23 — Incomplete Contest Detection: EXPAND

Add the missing combinations to contested detection:
- prerequisite AND dependent (structural ordering conflict)
- cautionary AND uncertain (risk with unknown magnitude)
- prescriptive AND uncertain (hedged recommendation)

Any paragraph with two stances from different epistemic categories is contested. The current two-combination check is too narrow.

### E-24 — clipText() Truncation: VERIFY CONSUMERS

The 320-character clip should only be used for UI display tooltips, never as the primary text source for any computation. **Verify** that all downstream consumers (synthesis, embedding, provenance) use the full `ShadowStatement.text`, not the clipped projector output. If any consumer uses the clipped version, fix the consumer. Don't remove the clip — it serves a UI purpose — but ensure it's never the canonical text reference.

### E-25 — Non-Deterministic Ordering: ACCEPT

Same-sentenceIndex tie-break being arbitrary is a LOW risk edge case that would require duplicate sentence indices from the splitter. The E-06 fix (end-of-string split boundary) reduces this probability further. No action needed.

---

## Table Handling Integration

The table cell decomposition enters the extraction layer as a new detection path at the top of the extraction pipeline, before paragraph splitting:

```
Raw model response
    ↓
1. Detect and extract table blocks → table sidecar (cell decomposition)
2. Detect and extract list blocks → direct to statements (one per item)
3. Double-newline paragraph split on remaining prose
4. Markdown preprocessing (strip formatting from clean text)
5. Sentence splitting on paragraphs
6. isSubstantive() filter (on clean text, with lowered 3-word threshold)
7. classifyStance() (on clean text, with fixed patterns)
8. Exclusion rules (with soft exclusions implemented)
```

Tables are fully handled in step 1 and never reach steps 2-8. Lists are handled in step 2 and skip sentence splitting. Prose goes through the existing pipeline with the fixes above.

---

## Summary of Actions by File

| File | Changes |
|------|---------|
| **ShadowExtractor.ts** | Add table detection + cell decomposition (step 1). Add list block detection (step 2). Add markdown preprocessing pass (step 4). Lower word threshold to 3. Narrow meta-pattern filter (remove "I would"). Make limits corpus-proportional. Complete current model on limit breach. Fix sentence splitter end-of-string. |
| **StatementTypes.ts** | Demote assertive to residual (remove copula patterns). Change classification to majority-wins with priority tiebreaker. Move "typically"/"usually" out of uncertain. Narrow prescriptive patterns to imperative/second-person. Document signal weights. |
| **ExclusionRules.ts** | Remove `assertive_hypothetical_would` hard rule. Implement soft exclusion multiplier. Convert `assertive_metaphor` to soft. Remove `prereq_requires_subject`. |
| **ShadowParagraphProjector.ts** | Expand contested detection combinations. Verify clipText() is never used as canonical source. |
| **New: TableSidecar type** | Data structure for extracted tables: cell-units with row/col indices, original markdown, model index. |