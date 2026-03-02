Below is some guidance on how we can go about this. I'm thinking it is likely best we follow the order of steps in terms of building the skeleton first and then move the panels over.

Regarding the ParagraphSpace view, I'm very much interested in keeping it as part of the design. In its new form, let's look at that as well. On to you for the plan. Let's see. 

First: ParagraphSpace.

Right now it’s a pseudo-terrain viewer. It mixes layout artifacts, KNN relics, stance paint, and aesthetic force-directed gravity and pretends that’s geometry.

In v2 it becomes one of two things:

Option A. A pure spatial lens of an existing L1 layer.
It is no longer a tab.
It is no longer a data source.
It is a toggle on Mutual Graph or Basin Inversion.

That means:

It can only render:
• Mutual recognition edges
• Region hulls from connected components
• Basin membership coloring
• Optional claim centroid markers

It cannot render:
• KNN edges
• Strong edges
• Stance colors
• Node coordinates as numbers
• “Fragile/keystone” decorations

In this version, ParagraphSpace is a visualization adapter. It has no logic authority. If the substrate card says D < 0.10 and geometry is skipped, the spatial view is disabled. Full stop.

Option B. Kill it for now.
And rebuild it after competitive + continuous are live, when you actually know which spatial signals matter.

If you are serious about panel-first discipline, Option A is fine but only after the measurement cards are clean. If you want velocity, kill it temporarily and reintroduce it grounded in L1 only.

Now the ordering.

Do not migrate by feature. Migrate by structural dependency.

The order is:

Phase 0. Freeze new metric work.
No continuous.
No refinements.
Instrument first.

Phase 1. Build the skeleton layout only.

Implement:

• Field Health Bar
• Topology Map stripped to L1 sizing and region coloring
• Measurement Inspector shell
• Layer dropdown
• Entity selection model

No detailed cards yet. Just prove that selection drives inspector state correctly.

This forces the mental model shift.

Phase 2. Migrate L1 layers only.

Implement measurement cards for:

• Substrate
• Mutual Graph
• Basin Inversion
• Query Relevance

Delete their old panels as you migrate them.
Do not duplicate.

When this phase is done, you should be able to operate the system without any of the old tabs.

Phase 3. Integrate Competitive Provenance into the new structure.

Add:

• Competitive layer card
• Entropy distribution
• Per-claim bulk table
• Statement allocation detail view
• Cross-signal comparison panel

This is where your paragraph space question becomes clearer, because now node sizing is truly provenanceBulk, not legacy supporter count.

Phase 4. Add Cross-Signal Compare as a first-class primitive.

Before continuous exists.

Make it generic. Any numeric measurement vs any other.

This becomes your calibration engine. Without it, continuous is blind.

Phase 5. Only then introduce Continuous Field.

Add it as just another layer card.
Use cross-signal compare to validate:

weight(S,C) vs evidenceScore
old pruning relevance vs competitive weight
z_claim vs z_core

If it doesn’t add discrimination, you will see it immediately.

Now, subtle but important:

Do not restructure Blast Radius yet.
Migrate it as-is into the L2 policy card with visible weights.
Then later evaluate if it deserves to live.

Why?

Because policy blends are fragile.
If you rewrite them while also rewriting the UI, you won’t know what changed.

Now about the paragraph space one more time.

If you keep it, it must obey this invariant:

Spatial view is downstream of L1.
It never computes.
It only renders.

That means its props look like:

mutualEdges
regionMembership
basinMembership
claimCentroids
nodeSize = provenanceBulk

Nothing else.

If it needs to compute anything to display, it’s violating your new discipline.

Finally, your plan’s biggest strength is the selection model.

That’s the real shift.

The sheet is no longer:
“Which tab am I on?”

It is:
“What entity is selected, and which measurement layer am I inspecting?”

That is the difference between a dashboard and an instrument.

You’re not rearranging UI.
You’re changing epistemology.