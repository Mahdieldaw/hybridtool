```markdown
What we are building
A bottom-up passage routing system that assigns landscape positions to claims by peeling from the margins inward. Minorities are identified and routed first, smallest to largest. The majority NorthStar emerges last as the claim that best fills what the minorities left behind.

Phase 0 — Precondition
A claim must have at least one majority paragraph to be considered for routing at all. A majority paragraph is one where this claim has majority ownership — more than 50% of the statements in that paragraph belong to this claim. Any claim with zero majority paragraphs is floored immediately. No further evaluation.

```ts
if C.majParagraphIds.length === 0 → floor
    ```

Phase 1 — Minority classification
Before any routing begins, every claim is permanently labelled minority or majority. This label never changes during routing.
The total corpus paragraph pool is the count of unique paragraph IDs across all claims, deduplicated. A paragraph appearing in multiple claims is counted once.
Sort all claims by their majority paragraph count, smallest to largest. Walk up from the bottom, accumulating a running total. A claim is minority if adding it to the running total keeps you below half the total corpus. The moment adding the next claim would push you over that halfway point, stop. Everything accumulated so far is minority. Everything from that point up is majority.

```ts
totalCorpusParagraphs = unique paragraphIds across all claims, deduplicated

sort all claims by majParagraphIds.length ASC

cumulativeCount = 0
for each claim C in sorted order:
    if cumulativeCount + C.majParagraphIds.length < totalCorpusParagraphs * 0.5:
        C.isMinority = true
cumulativeCount += C.majParagraphIds.length
  else:
C.isMinority = false
    ```

Labels are frozen after this step.

Phase 2 — Minority ranking
Minorities do not compete for survival against each other — they all get routed unless they fail a quality check. The quality check is not an arbitrary threshold. It is a relative ranking derived from two structural signals measured against the full claim space before any routing begins.
Signal 1 — Contested dominance
How many of this claim's majority paragraphs are paragraphs where at least one other claim also has presence, but this claim holds majority ownership. This means the claim is winning in contested territory — territory the corpus itself has validated as structurally significant by having multiple claims touch it.

```ts
contestedDominance(C) =
    C.majParagraphIds.filter(pid =>
        at least one other claim has any presence in pid
    ).length / C.majParagraphIds.length
        ```

Signal 2 — Exclusivity
How many of this claim's majority paragraphs appear in no other claim at all. Territory only this claim enters.

```ts
exclusivityRatio(C) =
    C.majParagraphIds.filter(pid =>
        no other claim has any presence in pid
    ).length / C.majParagraphIds.length
        ```

Why contested dominance ranks above exclusivity
Contested dominance is the stronger signal because shared paragraphs are already validated territory — other claims put structural weight there. Winning in that space means the claim is saying something significant about content the corpus has already identified as important. Exclusivity cannot make that claim. An exclusive paragraph just means no other claim went there — which could mean the territory is genuinely irreplaceable, or it could mean no other claim thought it worth touching. Exclusivity amplifies contested dominance but cannot substitute for it.
The 2x2 ranking:

1. High contested dominance + high exclusivity → dominates in shared territory and holds unique ground. Strongest minority candidate. Routed first.

2. High exclusivity + low contested dominance → brings irreplaceable content but unproven in contested space. Irreplaceable still beats duplicated. Routed second tier.

3. High contested dominance + low exclusivity → structurally dominant where it matters but mostly overlapping with others. Routed third tier.

4. Low both → nothing irreplaceable, nothing dominant. Floored.

The bottom of this competition floors naturally. No arbitrary threshold is imposed.

```ts
sort minorityPool by:
1. contestedDominance DESC
2. exclusivityRatio DESC
    ```

All minorities that clear Phase 0 are routed. The 2x2 determines order only — it is not a gate. There is no floor applied within the minority pool.

Phase 3 — Minority peeling (iterative)
Initialise the assigned set:

```ts
assignedSet = new Set<string>()
    ```

At each iteration, take the top-ranked unassigned minority claim. Assign it its position. Update the assigned set. Repeat until the minority pool is exhausted.

```ts
winner = top of sorted minorityPool
winner.landscapePosition = nextMinorityPosition()
// leadMinority for first assigned, mechanism for subsequent

assignedSet.add(...winner.majParagraphIds)
    ```

Novelty measurements are computed at each iteration for instrument panel visibility and for retrospective EastStar identification later:

```ts
novelParagraphs(C) = C.majParagraphIds
    .filter(pid => !assignedSet.has(pid)).length

claimNoveltyRatio(C) = novelParagraphs(C) / C.majParagraphIds.length

remaining = totalCorpusParagraphs - assignedSet.size
corpusNoveltyRatio(C) = remaining > 0
    ? novelParagraphs(C) / remaining
    : 0
        ```

These are recorded per claim at time of assignment. Phase 3 is execution and recording only. Routing order is fully determined by Phase 2. The novelty measurements here are instruments, not decisions — they record what each assignment looked like at its moment of execution. For the first minority assigned, claimNoveltyRatio will always be 1.0 (trivially true, assignedSet is empty) and corpusNoveltyRatio will be the claim's raw MAJ paragraph count divided by totalCorpusParagraphs. These are honest artefacts of an empty assignedSet, not meaningful routing signals. They become meaningful from the second assignment onward and are preserved for EastStar retrospective normalisation and concordance matrix seeding.

Phase 4 — Majority iterative assignment
After all minorities are peeled, the majority candidates compete. Not all will be routed.
Sort majority candidates by majority paragraph count, smallest to largest. Hold back the largest — that is your NorthStar candidate. Work upward through the rest.
Before assigning each candidate, project what the NorthStar candidate would have left to contribute if this assignment proceeds. If the NorthStar would lose more novel paragraphs than this candidate can contribute, stop; the NorthStar fills the gap now.

```ts
majorityCandidates = unassigned claims where isMinority == false
  sorted by majParagraphIds.length ASC

northStarCandidate = majorityCandidates[last]

for each C in majorityCandidates except northStarCandidate:

    currentNorthStarNovel = northStarCandidate.majParagraphIds
        .filter(pid => !assignedSet.has(pid)).length

projectedNorthStarNovel = northStarCandidate.majParagraphIds
    .filter(pid => !assignedSet.has(pid) && !C.majParagraphIds.includes(pid)).length

delta = currentNorthStarNovel - projectedNorthStarNovel

candidateContribution = C.majParagraphIds
    .filter(pid => !assignedSet.has(pid)).length

if delta > candidateContribution:
    break  // NorthStar loses more than this candidate adds — stop

C.landscapePosition = 'mechanism'
assignedSet.add(...C.majParagraphIds)

northStarCandidate.landscapePosition = 'northStar'
assignedSet.add(...northStarCandidate.majParagraphIds)
    ```

Phase 5 — Floor

```ts
all remaining unassigned claims → landscapePosition = 'floor'
    ```

Deferred measurements — not computed during routing
EastStar identification is retrospective. After routing completes, the claim across both minority and majority pools whose corpusNoveltyRatio at time of assignment was most disproportionate to the corpus state at that moment is the EastStar candidate. Minority and majority claims require a normalisation step before direct comparison — the exact mechanism is deferred to the concordance matrix. EastStar is a corpus-wide designation, not a minority-only one.
Load-bearing is computed after the full concordance matrix is available. It requires novelty signals, structural gap coverage, evidence distribution, and passage continuity across claims. It cannot be honestly computed during routing. Reserved as a null field until then.
Per-claim output fields

```ts
{
    landscapePosition: 'northStar' | 'leadMinority' | 'mechanism' | 'floor',
        isMinority: boolean,
            isLoadBearing: null,  // deferred
                routingMeasurements: {
        contestedDominance: number,        // minority ranking signal
            exclusivityRatio: number,          // minority ranking signal
                claimNoveltyRatio: number,         // at time of assignment
                    corpusNoveltyRatio: number,        // at time of assignment
                        novelParagraphCount: number,
    // modelSpread and modelSpreadContext deferred — 
    // wired when modelSpread is active in concordance matrix
  } | null
}
```

EastStar is not assigned during routing. It is a retrospective corpus-wide designation determined after the concordance matrix is available. The leadMinority position marks the first minority assigned and is the primary candidate for EastStar designation, but minority and majority claims are compared on equal footing in the retrospective pass. The landscapePosition field will be updated from leadMinority to eastStar at that point if the designation is confirmed.

Invariants

- MAJ precondition is never relaxed
- isMinority labels are frozen after Phase 1 and never recomputed
- totalCorpusParagraphs is computed once before the loop and never changes
- assignedSet updates immediately after every assignment
- The majority stopping condition uses no magic numbers or tunable thresholds — the corpus state at each step defines the stopping point through the delta comparison alone
- EastStar and load-bearing are never assigned during routing
```