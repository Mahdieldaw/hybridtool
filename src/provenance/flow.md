# Blast Radius — Logical Flow (Mermaid)

```mermaid
graph LR
    A["claim-assembly.ts<br/>(Provenance)"] -->|LinkedClaim<br/>+ sourceStatementIds| B["claim-density.ts<br/>(Evidence Profiles)"]
    B -->|ClaimDensityResult<br/>passages, coverage| C["passage-routing.ts<br/>(Load-bearing Gate)"]
    B -->|ClaimDensityResult| D["conflict-validation.ts<br/>(Triangle Metric)"]
    A -->|Joint statements| E["provenance-refinement.ts<br/>(3-tier Allegiance)"]
    C -->|Routed claims| F["blast-surface.ts<br/>(Twin Map)"]
    D -->|Validated conflicts| F
    E -->|primaryClaim| F
    
    G["semantic-mapper.ts<br/>(L3: LLM)"] -.->|Parallel<br/>synthesis| H["Output:<br/>claims + edges"]
    F -->|Instrumentation| H
    C -->|Routing| H
```

**File-by-file breakdown:**

- `claim-assembly.ts` — 4-phase reconstruction: similarity matrix → competitive assignment → mixed-method merge → LinkedClaim construction
- `claim-density.ts` — Pure L1: passage detection (contiguous runs), coverage aggregates, model grouping
- `passage-routing.ts` — Load-bearing classification: structural contributors → concentration/density ratios → landscape gates (northStar/eastStar/mechanism/floor)
- `conflict-validation.ts` — Two-pass validation: exclusive statements → cross-pool proximity → triangle residual threshold
- `provenance-refinement.ts` — 3-tier allegiance signal: calibration pool → centroid fallback → passage dominance
- `blast-surface.ts` — Twin map (reciprocal best-match) + risk vectors (deletion, degradation, cascade fragility, isolation)
- `semantic-mapper.ts` — L3 LLM path: cross-read synthesis, independent of deterministic pipeline
