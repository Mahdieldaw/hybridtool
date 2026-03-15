**SHADOW EXTRACTION LAYER**

Full Audit Report — Flags, Risks, and Open Questions

_Singularity Geometry Pipeline | Internal Review Document_

# Scope and Method

This report audits the four files comprising the Shadow Extraction Layer: ShadowExtractor.ts, StatementTypes.ts, ExclusionRules.ts, and ShadowParagraphProjector.ts. Every decision, pattern, constant, and logic branch has been reviewed with maximum scepticism. The question applied throughout is not 'does this work?' but 'is this silently destroying signal the pipeline depends on?'

The pipeline's downstream machinery — provenance reconstruction, blast surface, competitive allocation — operates on the shadow corpus this layer produces. Anything that incorrectly excludes a statement at this stage is an irreversible loss. There is no recovery mechanism downstream. The extraction layer must therefore be held to a higher standard of scrutiny than any other component.

⚠ This report deliberately flags everything suspicious, including decisions that may ultimately prove correct. The intention is to surface all open questions for human review, not to assert that every flag is a confirmed bug.

# Consolidated Flag Register

All findings are listed below. Detailed analysis follows in subsequent sections.

|**ID**|**File**|**Finding**|**Verdict**|**Risk**|
|---|---|---|---|---|
|**E-01**|ShadowExtractor|Paragraph splitter uses only double-newline. Single-newline list blocks collapse into one paragraph blob — sentence splitter then destroys their parallel structure.|_Confirmed loss_|**HIGH**|
|**E-02**|ShadowExtractor|Markdown is never stripped before isSubstantive() or classifyStance(). Bold markers, headers, and pipe characters contaminate word counts and pattern matching.|_Confirmed contamination_|**HIGH**|
|**E-03**|ShadowExtractor|isSubstantive() silently drops all table rows, all headers, all bold-only lines. There is no sidecar or deferred path. This content is simply gone.|_Confirmed loss_|**HIGH**|
|**E-04**|ShadowExtractor|SENTENCE_LIMIT and CANDIDATE_LIMIT (both 2000) are hardcoded constants with no relation to corpus size or model count. A 6-model fan-out can hit the limit before all models are processed.|_Unvalidated assumption_|**HIGH**|
|**E-05**|ShadowExtractor|Limit breach stops mid-model without completing that model's extraction. The truncation is logged but the partial model output enters the corpus silently as if complete.|_Silent data corruption_|**HIGH**|
|**E-06**|ShadowExtractor|splitIntoSentences() uses a lookbehind on [.!?] followed by whitespace. Any sentence ending without trailing whitespace — end of paragraph, list item, code fragment — is not split correctly.|_Structural gap_|**MEDIUM**|
|**E-07**|ShadowExtractor|Abbreviation protection replaces '.' with '\|' then restores. Nested abbreviations or decimals inside list items may not restore cleanly, producing corrupt sentence text.|_Edge case risk_|**MEDIUM**|
|**E-08**|ShadowExtractor|isSubstantive() minimum word count is 5. No basis for this threshold is documented. A 4-word statement like 'Embeddings define the space' would be dropped.|_Undocumented threshold_|**MEDIUM**|
|**E-09**|ShadowExtractor|Meta-pattern filter includes /^(let me\|I\'ll\|I will\|I can\|I would)/i. This correctly removes LLM throat-clearing, but 'I would argue X is load-bearing' is a substantive claim that starts with 'I would'.|_Over-broad filter_|**MEDIUM**|
|**E-10**|StatementTypes|classifyStance() assigns stance by priority order, not by which stance has most pattern matches. A sentence matching 3 assertive patterns and 1 prerequisite pattern gets classified as prerequisite.|_Priority vs. evidence conflict_|**HIGH**|
|**E-11**|StatementTypes|assertive patterns include /\bis\b/i, /\bare\b/i, /\bdo\b/i. These are among the most common words in English. Almost every sentence matches assertive. This makes assertive a garbage collector, not a classifier.|_Classifier contamination_|**HIGH**|
|**E-12**|StatementTypes|confident() dominance ratio penalises cross-stance matches but assertive's ubiquitous patterns guarantee every sentence has assertive hits, suppressing confidence of every other stance.|_Systematic confidence suppression_|**HIGH**|
|**E-13**|StatementTypes|uncertain patterns include /\btypically\b/i and /\busually\b/i. These are hedges, not uncertainty markers. 'Embeddings typically converge' is an assertive claim with a hedge, not an uncertain one.|_Incorrect pattern assignment_|**MEDIUM**|
|**E-14**|StatementTypes|prescriptive patterns include /\buse\b/i, /\bapply\b/i, /\bconsider\b/i. These fire on descriptive sentences: 'The system uses embeddings' classifies as prescriptive.|_Over-broad prescriptive patterns_|**HIGH**|
|**E-15**|StatementTypes|Signal patterns for sequence include /\bonce\b/i and /\bfollowing\b/i — also in dependent stance patterns. A sentence can fire both stance and signal from the same word without independent signal.|_Pattern overlap, no independence_|**MEDIUM**|
|**E-16**|StatementTypes|computeSignalWeight() assigns fixed weights: conditional=3, sequence=2, tension=1. No empirical basis documented. These weights propagate into ShadowDelta scoring.|_Undocumented weight calibration_|**MEDIUM**|
|**E-17**|ExclusionRules|Are the exclusion rules stripping signal? The rules filter many legitimate patterns. 'If X should happen, do Y' hits prescriptive_conditional_should (soft) — this may be a structural claim.|_Signal loss risk, requires audit_|**HIGH**|
|**E-18**|ExclusionRules|soft severity exclusions are documented as 'future: confidence penalty' but currently have no effect. They are listed in the registry as if active but do nothing.|_Dead code presenting as active_|**MEDIUM**|
|**E-19**|ExclusionRules|assertive_hypothetical_would excludes any assertive sentence containing 'would be'. 'The blast radius would be large for orphan-heavy claims' is a structural statement that gets dropped.|_Over-aggressive exclusion_|**HIGH**|
|**E-20**|ExclusionRules|assertive_metaphor drops sentences with 'is like a' or 'are like a'. Analogy is a common LLM reasoning device and may carry structural meaning — 'claims are like attractors in a basin' is a load-bearing conceptual statement.|_Semantic content loss_|**MEDIUM**|
|**E-21**|ExclusionRules|cautionary_hypothetical (soft) drops sentences with 'might/could potentially cause/create/lead to'. These are probabilistic causal claims — substantive in a risk pipeline.|_Over-filtering causal claims_|**HIGH**|
|**E-22**|ExclusionRules|prereq_requires_subject (soft) drops 'requires a/an/the/some/more/less [amount] of'. 'Provenance reconstruction requires a stable embedding model' would be caught by this pattern.|_Incorrect match scope_|**MEDIUM**|
|**E-23**|ShadowParagraphProjector|computeDominantStance() defines contested as (prescriptive AND cautionary) OR (assertive AND uncertain). Only two combinations. A paragraph with prerequisite and dependent — structural ordering conflict — is not contested.|_Incomplete contest detection_|**MEDIUM**|
|**E-24**|ShadowParagraphProjector|clipText() hard-truncates at 320 characters. If the surface statement is truncated, the text that appears in the UI and in synthesis context is incomplete. The full text is not forwarded — only the clipped version.|_Silent text truncation_|**MEDIUM**|
|**E-25**|ShadowParagraphProjector|The projector sorts group entries by sentenceIndex then encounter order. If two statements have the same sentenceIndex (possible if sentence splitting produces duplicates), the encounter order tie-break is arbitrary.|_Non-deterministic ordering edge case_|**LOW**|

# 1. Paragraph and Sentence Splitting

## E-01 — Paragraph Splitter: Single-Newline Collapse

The paragraph splitter in extractShadowStatements() uses:

response.content.split(/\n\n+/)

This correctly handles double-newline separated prose paragraphs. It does not handle single-newline separated content — which is how most markdown bullet lists, numbered lists, and inline list blocks are structured. A block of 8 bullet points separated by single newlines is treated as one paragraph. The sentence splitter then attempts to re-cut on [.!?] boundaries, which fails for list items that don't end in punctuation, and destroys the parallel membership structure of the list.

The downstream consequence: list items lose their grouping context. They either merge into a run-on pseudo-sentence or get partially dropped by isSubstantive() when the merge produces an unclassifiable fragment. Neither outcome preserves the list's structural information.

⚠ E-01: Any model output that uses single-newline lists — which is the default output format of most LLMs — loses structural integrity at this step. This is not a rare edge case. It is the common case.

## E-06 — Sentence Splitter: Missing End-of-Block Cases

splitIntoSentences() splits on:

protectedText.split(/(?<=[.!?])\s+/)

The lookbehind requires whitespace after the terminal punctuation. The last sentence in a paragraph — which ends at the paragraph boundary with no trailing whitespace — is not split from its preceding sentence. For short paragraphs (one or two sentences), this is irrelevant. For longer prose blocks that end mid-word or without trailing space, the final sentence may be incorrectly merged with the preceding one.

The fix is trivial: add end-of-string as a split boundary alongside whitespace. But the current state means the last sentence of every paragraph is at elevated risk of mis-extraction.

## E-07 — Abbreviation Protection: Restoration Edge Cases

Abbreviation protection replaces periods in known abbreviations and decimal numbers with '|||' before splitting, then restores them after. The list of protected abbreviations is:

Mr, Mrs, Ms, Dr, Prof, Inc, Ltd, vs, etc, e.g, i.e

This list is not exhaustive. Common technical abbreviations (API, SDK, NLP, LLM, BGE, etc.) are not protected — though these typically do not appear mid-sentence before a space and another word, so in practice the risk is lower. The more pressing issue is that the pattern /\b(\d+)\./g captures decimal numbers but also captures list item prefixes ('1. First step') that may survive into this code path if paragraph splitting failed. A list item starting with '1.' would have its period replaced with '|||', potentially producing '1|||' in the restored text.

# 2. The isSubstantive() Filter

isSubstantive() is the first gate every sentence passes through. It is responsible for a significant share of signal loss. Each decision within it deserves independent scrutiny.

## E-02 — Markdown Not Stripped Before Filtering

Markdown syntax is never stripped before any processing step. This affects multiple downstream operations simultaneously:

- Word count in isSubstantive() counts '**Claims**' as one word, '=' as one word. The 5-word threshold is effectively higher for markdown-heavy content.
- Pattern matching in classifyStance() runs against raw text including '**', '##', '|', '-'. The patterns were not written with these characters in mind.
- Embedding occurs on raw text. '**Paragraphs = points**' embeds differently from 'Paragraphs are points'. The markdown characters shift the embedding position in ways that are not semantically meaningful.

The absence of a markdown-stripping pass is not a minor omission. It is a systemic assumption — that all model outputs will be clean prose — that does not hold for LLM outputs, which default to markdown formatting.

## E-03 — Silent Discard of Structured Content

isSubstantive() explicitly excludes:

Headers: /^#{1,6}\s/

Bold-only lines: /^\*{2}[^*]+\*{2}$/

Table rows: /^\|.*\|$/ with split('|').length > 2

Table separators: /^[\|\s\-:]+$/

Empty bullets: /^[-*+]\s*$/

Headers, tables, and bold-only lines are not forwarded to any sidecar or deferred container. They are discarded with no record. There is no mechanism to recover this content downstream. In a pipeline whose core commitment is 'never destroy what cannot be recovered', the extraction layer is performing exactly that operation on every structured markdown element.

⚠ E-03: The pipeline's conservation law — the last instance of an idea cannot be removed — is not enforced at the extraction stage. A unique claim expressed as a table row or header is silently lost before it ever enters the corpus.

## E-08 — Undocumented 5-Word Threshold

The minimum substantiveness threshold is:

if (words.length < 5) return false;

No documentation exists for why 5 was chosen over 4 or 6. Short, high-density technical statements are common in model outputs: 'Embeddings define the substrate.' (4 words). 'Competitive allocation prevents orphan assignment.' (4 words). Both would fail this filter. The threshold should be documented with its rationale and tested against actual model output distributions.

## E-09 — Meta-Pattern Filter Over-Reach

The meta-pattern filter in isSubstantive() includes:

/^(let me|I\'ll|I will|I can|I would)\b/i

The intent is to catch LLM throat-clearing. The pattern matches correctly for 'I will summarise this' or 'Let me explain'. However it also matches 'I would argue that competitive allocation produces false assignments in sparse fields' — a structural claim about the system, expressed in first-person argumentative voice, which is a common LLM reasoning pattern in analysis outputs. The filter operates on sentence start only (^), so the match surface is limited, but any first-person argumentative claim starting with 'I would' is lost.

# 3. Stance Classification (StatementTypes.ts)

The classifyStance() function is the core semantic assignment engine. Its output determines how statements are weighted and prioritised throughout the pipeline. The following findings suggest its output may be systematically unreliable.

## E-10 — Priority Order vs. Evidence Weight

classifyStance() iterates stances in STANCE_PRIORITY order and assigns the first stance that exceeds the current best priority. It does not weight by number of pattern matches within a single classification step. The priority ordering is:

prerequisite (6) > dependent (5) > cautionary (4) > prescriptive (3) > uncertain (2) > assertive (1)

A sentence that matches 1 prerequisite pattern and 4 assertive patterns will be classified as prerequisite with low confidence, not assertive. The priority was designed as a tiebreaker but functions as an override. This is a fundamental classification design question: should structural stance (prerequisite, dependent) override evidential weight (many assertive hits), or should evidence accumulation be allowed to win?

The current design will systematically classify any sentence containing 'before', 'first', or 'requires' as prerequisite, regardless of how many other patterns it matches. For technical writing this is a significant source of misclassification.

## E-11 & E-12 — Assertive Patterns Are Universal Noise

The assertive pattern set includes:

/\bis\b/i, /\bare\b/i, /\bwas\b/i, /\bwere\b/i, /\bdo\b/i, /\bdoes\b/i, /\bhas\b/i, /\bhave\b/i

These are among the ten most common words in written English. Every sentence of any grammatical complexity will match multiple assertive patterns. This has two compounding effects:

- Every sentence has a large assertive match count, which means totalMatches is always large.
- The dominance ratio (winnerMatches / totalMatches) is suppressed for every other stance, because assertive matches inflate the denominator.

A sentence with 2 cautionary matches and 8 assertive matches gets a dominance ratio of 0.2 for cautionary. Its confidence is not 'this is probably cautionary', it is 'something is happening but the signal is weak'. The confidence score is not measuring signal strength — it is measuring the ratio of cautionary to assertive in a contest where assertive always participates.

⚠ E-11/12: The assertive patterns need to be rewritten to match assertive-specific constructions, not copula verbs. Alternatively, assertive should be a residual fallback that is assigned only when no other stance fires — not a participant in the pattern competition.

## E-13 — Hedges Misclassified as Uncertainty

The uncertain pattern set includes:

/\btypically\b/i, /\busually\b/i, /\bin\s+some\s+cases\b/i

These are hedges, not uncertainty markers. 'Typically' and 'usually' express statistical regularity — a form of assertive claim with a frequency qualifier. 'Competitive allocation typically produces correct assignments' is an assertive claim with high confidence. Classifying it as uncertain misrepresents the epistemic status of the statement and may incorrectly deprioritise it in downstream scoring.

## E-14 — Prescriptive Patterns Fire on Descriptive Sentences

The prescriptive pattern set includes:

/\buse\b/i, /\bapply\b/i, /\bconsider\b/i, /\bimplement\b/i

These fire on both imperative and descriptive use: 'The system uses embeddings to position statements' matches /\buse\b/i and is classified prescriptive. 'The algorithm applies a μ+σ threshold' matches /\bapply\b/i. These are factual descriptions of system behaviour, not recommendations. This miscategorisation will affect how such statements are routed in downstream stance-sensitive operations.

## E-15 & E-16 — Signal Independence and Weight Calibration

Signal patterns share vocabulary with stance patterns. 'Once' appears in both the sequence signal patterns and the dependent stance patterns. 'Following' appears in both. 'Requires' appears in both sequence signals and prerequisite stances. A sentence classified as dependent because it contains 'once' will also have its sequence signal fired by the same word. The signal is not independent of the stance — they share the same trigger.

Additionally, computeSignalWeight() assigns conditional=3, sequence=2, tension=1. No documentation exists for these values. They enter ShadowDelta scoring. Undocumented weight constants in a pipeline that commits to 'all weights and thresholds are visible choices, never hidden heuristics' is a direct violation of the design philosophy.

# 4. Exclusion Rules (ExclusionRules.ts)

The exclusion rules were previously characterised as 'doing real work'. That assessment requires revision. The rules contain multiple patterns that discard structurally significant statements. The primary question for each rule is: is this actually removing noise, or is it removing signal that happens to look like noise?

## E-17 — The Exclusion Rules Are Stripping Signal

Selected rules that carry high signal-loss risk:

- prescriptive_conditional_should (soft): /\bif\s+.{5,40}\s+should\b/ — 'If the embedding model changes, the provenance layer should be re-run' is a structural dependency claim. Filtered as 'conditional should, extract as conditional instead' — but no re-extraction happens.
- prescriptive_hypothetical (soft): /\b(you|one)\s+could\s+(also|potentially|possibly)\b/ — 'You could potentially avoid orphan assignment by widening the global floor' is a design recommendation. Filtered as 'suggestion, not prescription'.
- cautionary_hypothetical (soft): /\b(might|could)\s+(potentially\s+)?(cause|create|lead\s+to)\b/ — 'This could lead to false claim ownership in sparse fields' is a causal risk statement. Filtered as 'hypothetical risk, not definite warning'.
- assertive_hypothetical_would: /\bwould\s+be\b/ — this is not soft, it is hard for assertive. 'The blast radius would be larger for high-isolation claims' is an analytical prediction. Discarded.

⚠ E-17: Several exclusion rules discard exactly the kinds of probabilistic, conditional, and analytical statements that appear in multi-model synthesis outputs. LLMs reason in hedged language. Rules calibrated to remove LLM hedging from one context are removing substantive reasoning from another.

## E-18 — Soft Exclusions Are Dead Code

isExcluded() handles soft exclusions as follows:

if (rule.severity === 'hard') { return true; }

// Soft exclusions could reduce confidence in future

// For now, we only implement hard exclusions

This means soft rules are listed in the registry, appear in audits, are described in comments, but have zero effect on output. A developer reading the rules would assume soft exclusions reduce confidence. They do not. The getExclusionViolations() debug function returns both hard and soft violations with equal appearance, which could cause confusion during debugging. Soft rules should either be implemented or removed from the registry.

## E-19 — assertive_hypothetical_would Is Too Aggressive

This hard exclusion pattern:

/\bwould\s+be\b/i

Fires on any assertive sentence containing 'would be'. This covers: conditional predictions ('the cascade would be large'), analytical comparisons ('performance would be better with'), probabilistic assessments ('the result would be ambiguous'). These are substantive analytical statements, not narrative speculation. A hard exclusion on this pattern eliminates a significant class of reasoning output from technical model responses.

## E-21 — Cautionary Hypothetical Drops Causal Claims

The cautionary_hypothetical soft rule:

/\b(might|could)\s+(potentially\s+)?(cause|create|lead\s+to)\b/i

Is marked soft but the question is whether it should fire at all. Probabilistic causal claims — 'this might cause embedding drift', 'scaling the corpus could lead to threshold instability' — are central to risk characterisation in any technical analysis. Filtering them as 'hypothetical, not definite' loses the probabilistic texture of cautionary reasoning. Definite causal claims ('causes X') are rarer in LLM outputs than probabilistic ones. If this rule were active, the majority of genuine causal warnings in technical output would be filtered.

# 5. ShadowParagraphProjector

## E-23 — Incomplete Contest Detection

computeDominantStance() defines contested paragraphs as:

(prescriptive AND cautionary) OR (assertive AND uncertain)

This covers two specific combinations. It does not cover: prerequisite AND dependent (structural ordering conflict — a paragraph that specifies both a before-condition and an after-consequence), cautionary AND uncertain (risk with unknown magnitude), prescriptive AND uncertain (recommendation hedged with doubt). A paragraph with mixed prerequisite and dependent signals — which would be geometrically significant as a bi-directional ordering claim — is not flagged as contested. It will have its dominant stance resolved by confidence weight, potentially losing the structural ambiguity entirely.

## E-24 — clipText() Truncates Statement Surface

The projector clips statement text at 320 characters:

const MAX_STATEMENT_CHARS = 320;

The clipped text is stored in the statements array on the ShadowParagraph object. If this text is forwarded to synthesis or displayed in the UI, the user sees an incomplete statement. More critically: if any downstream operation uses this text (rather than the original from the ShadowStatement), it operates on a truncated version. The original full text is in the ShadowStatement object, not in the projector output. This creates two representations of the same statement with no guarantee that consumers use the correct one.

# 6. Architectural Gaps Not Captured by Individual Flags

## No Markdown Preprocessing Pass

The extraction layer has no preprocessing stage. Raw model output enters the first filter unchanged. The filters were written for clean prose but most LLM outputs are markdown-formatted. The correct fix is a preprocessing pass that strips markdown syntax before extraction, preserving semantic content. Until this pass exists, every markdown-heavy response will produce degraded extraction results.

## No Sidecar for Dropped Structured Content

Headers, table rows, and bold-only lines are discarded with no record. The pipeline's conservation law cannot be satisfied if the extraction layer discards content before conservation can be applied. A sidecar container that holds all excluded structured content — pending a deferred resolution path — is necessary to close this gap.

## GUARDRAILS.md Referenced But Not Present

Both ExclusionRules.ts and StatementTypes.ts reference GUARDRAILS.md as the document requiring human review before changes. This file was not present in the provided codebase. If it does not exist, the review process it documents does not exist. Changes to exclusion rules and stance patterns are high-stakes decisions that should require documented review.

## Confidence Scores Are Not Calibrated

The confidence formula:

baseConfidence = Math.min(1.0, 0.5 + (winnerMatches * 0.15))

confidence = baseConfidence * dominanceRatio

Produces a score that is structurally determined (pattern counts, ratios) but not empirically validated. A confidence of 0.7 does not mean 'this classification is correct 70% of the time'. It means 'this sentence had a certain pattern distribution'. Whether that distribution correlates with correct classification has not been tested. Downstream components that threshold on confidence — filterByConfidence() defaults to 0.7 — are thresholding on an uncalibrated proxy.

# 7. Priority Actions

The following are ranked by downstream impact. Each is a prerequisite for the extraction layer to reliably serve the pipeline's provenance and geometry commitments.

|**Pri**|**Action**|**Flags Resolved**|
|---|---|---|
|**1**|Add markdown preprocessing pass — strip **bold**, ## headers, \| table syntax, - bullet prefixes from sentence text before any filter or classification runs.|E-02, E-11, E-12, E-14|
|**2**|Add sidecar container for structured content (tables, headers) at extraction time. No content should be discarded without a record.|E-03, E-17|
|**3**|Fix paragraph splitter to handle single-newline blocks. Detect list blocks and split by newline before sentence splitting.|E-01|
|**4**|Rewrite assertive stance patterns to match assertive-specific constructions only, or demote assertive to residual fallback with no pattern participation.|E-11, E-12|
|**5**|Audit every exclusion rule against real model outputs. Flag rules where 'signal vs. noise' decision is ambiguous. Remove or implement soft rules — no dead code.|E-17, E-18, E-19, E-21|
|**6**|Document and validate all threshold constants: 5-word minimum, 2000 sentence limit, 2000 candidate limit, confidence formula, signal weights.|E-04, E-08, E-16|
|**7**|Fix SENTENCE_LIMIT and CANDIDATE_LIMIT to be corpus-proportional, and ensure truncation never produces a partial model representation in the corpus without explicit flagging.|E-04, E-05|
|**8**|Move prescriptive_conditional_should to a re-classification path (reclassify as conditional/dependent) rather than discard.|E-17|
|**9**|Expand contested detection in ShadowParagraphProjector to cover all structurally meaningful stance combinations.|E-23|
|**10**|Validate clipText() is never used as the primary text source by any downstream consumer. Make fullParagraph and original statement text the canonical reference.|E-24|

# 8. Summary Assessment

The shadow extraction layer is functional for clean, well-formatted prose inputs. It is unreliable for markdown-formatted model outputs, which represent the majority of real-world inputs in a multi-model pipeline. The core issues are not edge cases — they are structural mismatches between the assumptions encoded in the filters and the actual format of LLM responses.

The most critical risk is not that individual statements are misclassified. It is that entire categories of content — structured, formatted, short, hedged, conditional — are dropped silently before they can enter the corpus. A pipeline built on the conservation principle cannot conserve what the extraction layer did not preserve.

The geometry and provenance machinery downstream is sound. The extraction layer that feeds it is the weakest link in the chain.

**Flags issued: 25 | HIGH risk: 10 | MEDIUM risk: 13 | LOW risk: 2**