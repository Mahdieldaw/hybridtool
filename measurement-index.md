# Measurement Index

This index defines the core mass metrics used to quantify claim influence and distribution within the system.

## Core Mass Metrics

### presenceMass
**Logic:** `Σ(claimStatements / paragraphTotal)`
The raw volume of presence across the corpus. It measures the aggregate "weight" of a claim by summing its statement coverage in every paragraph where it appears, regardless of whether other claims are also present.

### territorialMass
**Logic:** `Σ(Σ(1/k) / paragraphTotal)`
*Where `k` is the number of claims sharing a specific statement.*
A measure of fractional-credit exclusivity. It allocates "territory" to a claim based on its statement presence, but divides the credit for any shared statements among all contributing claims. This represents the claim's shared footprint.

### sovereignMass
**Logic:** `Σ(exclusiveStatements / paragraphTotal)`
The measure of undisputed authority. It only calculates the mass derived from statements that are exclusively held by a single claim. This represents the "sole-holder" volume, where no other claim contests the specific evidentiary territory.

### recognitionMass
**Logic:** `percentileRankAsc(mutualRankDegree, allDegrees)`
A connectivity-based metric representing the relative status of a node within the mutual rank graph. A value of 0 indicates no recognition, while 1 represents top-ranked connectivity within the network.

### contestedDominance
**Logic:** `dominatedCount / contestedTouchedCount`
*Where `dominatedCount` is the number of Major paragraphs where other claims are present, and `contestedTouchedCount` is the total number of paragraphs touched by the claim where other claims are present.*
A ratio measuring how much of a claim's "home territory" (Major paragraphs) is being contested by others, relative to its total contested footprint. It quantifies the degree to which a claim's primary influence is under pressure.

### MAJ (Major Paragraph Presence)
**Logic:** `paragraphCoverage > 0.5`
A binary threshold metric identifying paragraphs where a claim holds a "majority" stake. A paragraph is considered a "Major" paragraph for a claim if that claim's statement coverage within the paragraph exceeds 50%. This identifies the claim's primary areas of influence.

---

**Invariant:** `sovereignMass ≤ territorialMass ≤ presenceMass`
