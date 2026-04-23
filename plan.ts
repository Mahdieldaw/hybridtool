Overview
Replace the default diamond / donut glyph rendering with SVG metaball footprints coloured by landscape position.Paragraph nodes dim by default and restore on selection.All existing substrate mode behaviour is preserved untouched.

    Step 1 — Extend the ClaimCentroid type
File: src / hooks / instrument / useClaimCentroids.ts(or wherever ClaimCentroid is defined)
Add landscapePosition as an optional field:
typescriptexport type LandscapePosition = 'northStar' | 'eastStar' | 'mechanism' | 'floor';

export interface ClaimCentroid {
    claimId: string;
    x: number;
    y: number;
    hasPosition: boolean;
    sourceParagraphIds: string[];
    paraCanonicalFractions: Map<string, number>;
    label?: string;
    landscapePosition?: LandscapePosition; // ADD THIS
}
In the hook's computation, wire landscapePosition from the passage routing result. The passage routing result already exists in the pipeline output as passageRouting.claims[claimId].landscapePosition or equivalent. Find where ClaimCentroid objects are constructed and add:
typescriptlandscapePosition: passageRoutingResult?.claims?.find(c => c.claimId === claimId)?.landscapePosition ?? undefined,
    The exact field path depends on how passageRouting is accessed in the hook.Search for where sourceParagraphIds is assembled — landscapePosition goes in the same construction block.

        Step 2 — Add landscape position colour constants to ParagraphSpaceView.tsx
Add near the top of the file alongside BASIN_COLORS and MAPPER_EDGE_COLORS:
typescriptconst LANDSCAPE_COLORS: Record<string, { fill: string; stroke: string; label: string }> = {
    northStar: {
        fill: 'rgba(251, 230, 160, 0.85)',   // warm pale gold
        stroke: 'rgba(251, 200, 80, 0.95)',
        label: 'North Star',
    },
    eastStar: {
        fill: 'rgba(147, 197, 253, 0.75)',   // cool blue
        stroke: 'rgba(96, 165, 250, 0.90)',
        label: 'East Star',
    },
    mechanism: {
        fill: 'rgba(110, 231, 183, 0.60)',   // muted teal-green
        stroke: 'rgba(52, 211, 153, 0.80)',
        label: 'Mechanism',
    },
    floor: {
        fill: 'rgba(148, 163, 184, 0.35)',   // slate, visually recessive
        stroke: 'rgba(148, 163, 184, 0.55)',
        label: 'Floor',
    },
};

const LANDSCAPE_FALLBACK = {
    fill: 'rgba(245, 158, 11, 0.60)',      // original amber, for claims with no position
    stroke: 'rgba(245, 158, 11, 0.85)',
    label: 'Unknown',
};

// Base radius and weight scale for footprint circles
const FOOTPRINT_BASE_R = 18;
const FOOTPRINT_WEIGHT_SCALE = 28;
const FOOTPRINT_MIN_R = 8;

Step 3 — Add the SVG metaball filter to<defs>
Inside the SVG element, add a < defs > block.Search for the opening < svg tag in the render return and add immediately after it:
tsx < defs >
    <filter id="metaball-merge" x = "-40%" y = "-40%" width = "180%" height = "180%" color - interpolation - filters="sRGB" >
        <feGaussianBlur in="SourceGraphic" stdDeviation = "8" result = "blur" />
            <feColorMatrix
      in="blur"
mode = "matrix"
values = "1 0 0 0 0
0 1 0 0 0
0 0 1 0 0
0 0 0 18 - 7"
result = "merged"
    />
    <feComposite in="SourceGraphic" in2 = "merged" operator = "atop" />
        </filter>
        </defs>
The feColorMatrix values 18 - 7 control the metaball threshold.Higher first value = tighter merge radius.Lower second value = more aggressive fill.These can be tuned visually — 18 - 7 is a good starting point for footprints of this scale.

    Step 4 — Compute footprint circle data per claim
Add this useMemo block after the existing scaledCentroids memo:
typescriptconst claimFootprints = useMemo(() => {
        if (!claimCentroids || !nodes.length) return [];

        return claimCentroids
            .filter((c) => c.hasPosition && c.paraCanonicalFractions.size > 0)
            .map((c) => {
                const colorStyle = c.landscapePosition
                    ? (LANDSCAPE_COLORS[c.landscapePosition] ?? LANDSCAPE_FALLBACK)
                    : LANDSCAPE_FALLBACK;

                // Weighted centroid for label anchor
                let wSumX = 0, wSumY = 0, wTotal = 0;

                const circles: Array<{ cx: number; cy: number; r: number }> = [];

                for (const n of nodes) {
                    const pid = String(n?.paragraphId ?? '').trim();
                    if (!pid) continue;
                    const fraction = c.paraCanonicalFractions.get(pid);
                    if (fraction === undefined || fraction <= 0) continue;

                    const cx = toX(Number(n.x));
                    const cy = toY(Number(n.y));
                    if (!Number.isFinite(cx) || !Number.isFinite(cy)) continue;

                    const r = Math.max(FOOTPRINT_MIN_R, FOOTPRINT_BASE_R + fraction * FOOTPRINT_WEIGHT_SCALE);
                    circles.push({ cx, cy, r });

                    wSumX += cx * fraction;
                    wSumY += cy * fraction;
                    wTotal += fraction;
                }

                if (circles.length === 0) return null;

                const labelX = wTotal > 0 ? wSumX / wTotal : circles[0].cx;
                const labelY = wTotal > 0 ? wSumY / wTotal : circles[0].cy;

                return {
                    claimId: c.claimId,
                    label: c.label ?? c.claimId,
                    circles,
                    labelX,
                    labelY,
                    colorStyle,
                    landscapePosition: c.landscapePosition,
                };
            })
            .filter(Boolean) as Array<{
                claimId: string;
                label: string;
                circles: Array<{ cx: number; cy: number; r: number }>;
                labelX: number;
                labelY: number;
                colorStyle: { fill: string; stroke: string; label: string };
                landscapePosition?: string;
            }>;
    }, [claimCentroids, nodes, toX, toY]);

Step 5 — Render footprints in the SVG
Add a new render layer before the paragraph node layer(so nodes render on top when visible).Find the comment {/* Paragraph nodes */ } or equivalent in the SVG render and insert this block before it:
tsx{/* ── Claim footprints (reading mode default) ── */ }
{
    claimFootprints.map((fp) => {
        const isSel = fp.claimId === selectedClaimId;
        const isHov = fp.claimId === hoveredClaimId;
        const isOtherSelected = !!selectedClaimId && !isSel;

        const groupOpacity = isOtherSelected ? 0.12 : isSel ? 1.0 : isHov ? 0.88 : 0.62;
        const strokeWidth = isSel ? 1.5 : isHov ? 1.0 : 0.5;

        return (
            <g
      key= {`footprint-${fp.claimId}`
    }
      style = {{ cursor: 'pointer' }}
onMouseEnter = {() => setHoveredClaimId(fp.claimId)}
onMouseLeave = {() => setHoveredClaimId(null)}
onClick = {(e) => {
    e.stopPropagation();
    onClaimClick?.(isSel ? null : fp.claimId);
}}
    >
    {/* Metaball blob group — filter merges overlapping circles */ }
    < g filter = "url(#metaball-merge)" opacity = { groupOpacity } >
    {
        fp.circles.map((circle, i) => (
            <circle
            key= { i }
            cx = { circle.cx }
            cy = { circle.cy }
            r = { circle.r }
            fill = { fp.colorStyle.fill }
            stroke = { fp.colorStyle.stroke }
            strokeWidth = { strokeWidth }
            />
        ))
    }
        </g>

{/* Label — always visible, dims with group */ }
<text
        x={ fp.labelX }
y = { fp.labelY }
textAnchor = "middle"
dominantBaseline = "middle"
fill = "#ffffff"
fontSize = { isSel? 12: isHov ? 11 : 10 }
fontWeight = { isSel? 700: 500 }
opacity = { isOtherSelected? 0.2: isSel ? 1.0 : isHov ? 0.9 : 0.75 }
style = {{ pointerEvents: 'none', userSelect: 'none' }}
      >
    { fp.label }
    </text>

{/* Selection ring at weighted centroid */ }
{
    (isSel || isHov) && (
        <circle
          cx={ fp.labelX }
    cy = { fp.labelY }
    r = { isSel? 6: 4 }
    fill = "none"
    stroke = { isSel? 'rgba(255,255,255,0.9)': 'rgba(255,255,255,0.4)' }
    strokeWidth = { isSel? 2: 1 }
    style = {{ pointerEvents: 'none' }
}
        />
      )}
</g>
  );
})}

Step 6 — Dim paragraph nodes by default
Find the existing paragraph node render loop.It currently renders all nodes at full opacity.Add a default opacity calculation based on whether any claim is selected or hovered:
Find where individual node < circle > opacity is set.It likely already has selection - based opacity logic.Modify it to add:
typescript// Add this to the existing node opacity calculation
const footprintDimmed = (!!selectedClaimId || !!hoveredClaimId) && !isSource && !isHovered;
const baseNodeOpacity = footprintDimmed ? 0.15 : 0.45; // dim all nodes by default, further dim when claim active
The existing isSource check(whether the node is a source paragraph for the selected claim) already handles the "restore on selection" behaviour — source paragraphs of the selected claim light up because they pass the isSource gate.You're just adjusting the baseline opacity downward so the footprints are visually dominant by default.

Step 7 — Add landscape position legend
Add a small legend overlay alongside the existing legends.Insert after the risk vector legend block:
tsx{/* Landscape position legend */ }
<div className="absolute bottom-4 right-4 bg-black/40 border border-white/10 rounded-lg p-2.5 backdrop-blur-sm shadow-sm z-10 pointer-events-none" >
    <div className="flex flex-col gap-1.5" >
        <span className="text-[9px] uppercase font-bold text-text-muted tracking-wider mb-0.5" >
            Position
            </span>
{
    Object.entries(LANDSCAPE_COLORS).map(([pos, style]) => (
        <div key= { pos } className = "flex items-center gap-2" >
        <span
          className="w-3 h-3 rounded-sm inline-block border"
          style = {{
        backgroundColor: style.fill,
        borderColor: style.stroke,
    }}
        />
    < span className = "text-[10px] text-text-secondary" > { style.label } </span>
        </div>
    ))}
</div>
    </div>

Step 8 — Hide existing diamond / donut glyphs in default mode
The existing glyph render block is conditioned on showClaimDiamonds.That prop already exists.The parent component controls it.Two options:
Option A(preferred): Make footprints the new default and demote diamonds to substrate mode.In the parent component that renders ParagraphSpaceView, change the default value of showClaimDiamonds to false.The footprints replace them.Diamonds remain available in substrate mode by passing showClaimDiamonds = { true} explicitly.
Option B: Inside ParagraphSpaceView, suppress the diamond render when footprints are available:
typescriptconst showDiamondFallback = showClaimDiamonds && claimFootprints.length === 0;
Then condition the existing glyph render block on showDiamondFallback instead of showClaimDiamonds.
Option A is cleaner because it keeps the component's internal logic simple and puts the mode decision in the parent where it belongs.

What this does not change

All existing toggle props remain wired and functional
Basin rects, region hulls, mutual edges, mapper edges — all unaffected
The paragraph inspect panel — unaffected
The measuring cylinder(canonical fraction fill on source nodes) — unaffected, still renders on selection
The blast surface risk donuts — unaffected, still render when showRiskGlyphs is true and showClaimDiamonds is true(substrate mode)
The hull() function — unused by footprints but kept for region hull rendering


Tuning notes for the agent
After implementation, test with a real corpus and adjust:

FOOTPRINT_BASE_R — increase if footprints are too small to be legible, decrease if they overwhelm the paragraph nodes
FOOTPRINT_WEIGHT_SCALE — controls how much canonical fraction influences circle size; increase to make ownership differences more visible
feGaussianBlur stdDeviation — controls how much circles blur before merging; increase for softer footprints, decrease for crisper edges
feColorMatrix threshold values 18 - 7 — increase 18 to require tighter overlap before merging, decrease to merge more aggressively
Group opacity values 0.62 / 0.88 / 1.0 / 0.12 — the non - selected, hovered, selected, and other - selected states respectively