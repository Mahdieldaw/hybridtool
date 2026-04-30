# Topological Routing Pipeline Specification

## Phase 0 — Precondition
`majorityParagraphCount === 0` → floor immediately. No change from current.

## New Fields — Computed at initialisation

**dominatedParagraphCount (per claim)**
Subset of MAJ paragraphs where C won in genuinely contested space:
```
dominatedParagraphCount(C) = 
  C.majParagraphIds.filter(pid =>
    at least one other claim D ≠ C 
    where pid ∈ D.paragraphIds (any presence, not just MAJ)
  ).length
```

**exclusivityMass**
Per paragraph, statement level converted to paragraph unit:
```
exclusivityWeight(C, pid) = exclusiveStatements(C, pid) / totalStatements(pid)
```
Aggregate across all paragraphs C touches — sum not mean:
```
exclusivityMass(C) = Σ (pid ∈ C.paragraphIds) exclusivityWeight(C, pid)
```
Uses existing `claimStatements` and `totalStatements` from schema.

**sustainedMass**
Normalise both signals against corpus distribution (percentile rank within current run):
```
sustainedMass(C) = √(normMAXLEN(C) × normMAJ(C))
```
Where `normMAXLEN` and `normMAJ` are each claim's percentile rank on those fields across all candidates. Produces three natural cohorts:
* **Passage-heavy extreme** — high MAXLEN, low MAJ
* **Balanced middle** — neither extreme
* **MAJ-breadth extreme** — high MAJ, low MAXLEN

## Phase 1 — Minority classification
Compute `maxSupporterCount` (the highest number of genuine supporters any claim received during the LLM mapping phase).

For each claim C:
```
C.isMinority = C.supporters.length < maxSupporterCount / 2
```
Even supporter count edge case — claim with exactly `maxSupporterCount / 2` supporters → majority. Greater than or equal to half → majority. Strictly less than half → minority.

## Phase 2 — Minority ranking (four stages)
**Stage 1** — Assign sustainedMass cohort to each minority claim (`passage-heavy`, `balanced`, `maj-breadth`).

**Stage 2** — Within each cohort, seed by `MAXLEN DESC` then `majorityParagraphCount DESC`.

**Stage 3** — 2x2 competition using corrected signals:
Contested dominance (corrected denominator):
```
contestedDominance(C) = dominatedParagraphCount(C) / |{pid ∈ C.paragraphIds : ∃ D ≠ C where pid ∈ D.paragraphIds}|
```
*Numerator: paragraphs C holds MAJ in that are shared. Denominator: all paragraphs C appears in at all that any other claim also touches.*

Claims are assigned to 2x2 priority buckets based on whether their signals are above/below the minority pool median:
1. High contestedDominance + high exclusivityMass
2. High exclusivityMass + low contestedDominance
3. High contestedDominance + low exclusivityMass
4. Low both → **floor**

**Stage 4** — Tiebreaker execution
Surviving claims are sorted strictly by:
1. Bucket Priority (1 > 2 > 3)
2. `contestedDominance DESC`
3. `exclusivityMass DESC`
4. `supporters.length DESC` (high explicit support favoured for minority)
5. `MAXLEN DESC` (via stable seed-sort fallback)
6. `MAJ DESC` (via stable seed-sort fallback)

## Phase 3 — Minority peeling
Walk ranked minority pool in order. For each claim:
```
novelIds = C.majParagraphIds.filter(pid => !assignedSet.has(pid))
```
Record `routingMeasurements`:
* `novelParagraphCount = novelIds.length`
* `claimNoveltyRatio = novelIds.length / C.majorityParagraphCount`
* `corpusNoveltyRatio = novelIds.length / (totalCorpusParagraphs - assignedSet.size)`
* `contestedDominance` — from Phase 2
* `exclusivityMass` — from Phase 2
* `sustainedMassCohort` — from Phase 2
* `modelSpread` — recorded for concordance matrix

Position: index 0 → `leadMinority`, subsequent → `mechanism` (minority context).
Add paragraphs to board: `assignedSet.add(...C.majParagraphIds)`
*(First claim will always record claimNoveltyRatio = 1.0 — honest artefact, not a bug).*

## Phase 4 — Majority mechanism assignment
Sort majority candidates by sustainedMass cohort first (`maj-breadth` -> `balanced` -> `passage-heavy`), then `MAXLEN DESC`, then `MAJ DESC` within cohort. Pop largest overall by `sustainedMass` as `northStarCandidate`.

Tiebreakers within majority cohorts (inverted from minority):
1. `supporters.length ASC` favoured — high support flagged as generic common knowledge
2. `exclusivityMass DESC` as secondary tiebreaker

For each remaining majority candidate in order:
```
currentNSNovel = northStarCandidate.majParagraphIds
  .filter(pid => !assignedSet.has(pid)).length

projectedNSNovel = northStarCandidate.majParagraphIds
  .filter(pid => !assignedSet.has(pid) AND pid ∉ C.majParagraphIds).length

delta = currentNSNovel - projectedNSNovel

candidateContribution = C.majParagraphIds
  .filter(pid => !assignedSet.has(pid)).length
```
If `candidateContribution === 0` → **floor immediately** (skip to next candidate).

If `delta > candidateContribution` → **BREAK** (this candidate and all subsequent → floor).

Store per majority mechanism claim:
```
majorityGateSnapshot: { delta, currentNSNovel, projectedNSNovel, candidateContribution }
```

## Phase 5 — NorthStar
`northStarCandidate.landscapePosition = 'northStar'`
Record `novelParagraphCount` = remaining unassigned MAJ paragraphs.
`assignedSet.add(...northStarCandidate.majParagraphIds)`

## Phase 6 — Floor
All remaining unassigned → floor, `routingMeasurements: null`.

## Display structure for debugging
**Top table per claim — static fields:**
`landscapePosition`, `isMinority`, `sustainedMassCohort`, `MAXLEN`, `majorityParagraphCount`, `supporters.length`, `contestedDominance`, `exclusivityMass`

**Per-round board — iterative fields recorded at assignment time:**
`novelParagraphCount`, `claimNoveltyRatio`, `corpusNoveltyRatio`, and for majority claims `majorityGateSnapshot` showing delta, currentNSNovel, projectedNSNovel, candidateContribution at the moment of decision.
