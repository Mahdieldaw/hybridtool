// ═══════════════════════════════════════════════════════════════════════════
// STATEMENT TYPES - SHADOW MAPPER V2
// ═══════════════════════════════════════════════════════════════════════════
//
// Philosophy: Separate WHAT a statement is (stance) from WHAT it signals (relationships)
//
// STANCES (7 types in 3 pairs + 1 fallback):
//   Positive     | Negative
//   -------------|-------------
//   Prescriptive | Cautionary     (action: do vs don't)
//   Prerequisite | Dependent      (order: before vs after)
//   Assertive    | Uncertain      (certainty: is vs might)
//
// SIGNALS (3 boolean flags):
//   - sequence: indicates ordering/dependency (before/after/then)
//   - tension: indicates conflict/tradeoff (but/however/vs)
//   - conditional: indicates context-dependency (if/when/unless)
//
// Changes require human review (see GUARDRAILS.md)
// ═══════════════════════════════════════════════════════════════════════════

export type Stance =
    | 'prescriptive'  // Do X, use Y, ensure Z
    | 'cautionary'    // Don't do X, avoid Y, risk of Z
    | 'prerequisite'  // Before X, first Y, requires Z
    | 'dependent'     // After X, once Y, then Z
    | 'assertive'     // X is Y, does Z, provides W
    | 'uncertain'     // Might X, unclear Y, depends on Z
    | 'unclassified'; // Embedding score below threshold / no reliable classification

// Priority order: higher priority wins when multiple patterns match
// Rationale: Structural relationships (order) > Actions > Facts
export const STANCE_PRIORITY: Stance[] = [
    'prerequisite',   // 6 - "Before" signals hard order (Top)
    'dependent',      // 5 - "After" signals hard order
    'cautionary',     // 4 - Warnings / Risks
    'prescriptive',   // 3 - Action recommendations
    'uncertain',      // 2 - Hedges and caveats
    'assertive',      // 1 - Default factual
    'unclassified',   // 0 - Fallback for low-confidence embeddings (Bottom)
];

// Pattern definitions for each stance
export const STANCE_PATTERNS: Record<Stance, RegExp[]> = {
    cautionary: [
        /\bdon'?t\b/i,
        /\bdo\s+not\b/i,
        /\bavoid\b/i,
        /\bnever\b/i,
        /\brisk\b/i,
        /\bcareful\b/i,
        /\bcaution\b/i,
        /\bwarning\b/i,
        /\bdanger\b/i,
        /\bpitfall\b/i,
        /\btrap\b/i,
        /\bmistake\b/i,
        /\berror\b/i,
        /\bproblem\s+with\b/i,
        /\bwatch\s+out\b/i,
        /\bbe\s+aware\b/i,
        /\bbeware\b/i,
        /\bcan\s+lead\s+to\s+problems\b/i,
        /\bshould\s+not\b/i,
        /\bshouldn'?t\b/i,
    ],

    prerequisite: [
        /\bbefore\b/i,
        /\bfirst\b/i,
        /\bprior\s+to\b/i,
        /\brequires?\b/i,
        /\bneeds?\s+to\s+have\b/i,
        /\bprerequisite\b/i,
        /\bprecondition\b/i,
        /\bmust\s+(come|happen|occur)\s+before\b/i,
        /\bfoundation\s+for\b/i,
        /\bgroundwork\b/i,
        /\bcan'?t\s+.{0,20}\s+without\s+first\b/i,
        /\benables?\b/i,
        /\bunblocks?\b/i,
        /\ballows?\s+you\s+to\b/i,
        /\binitially\b/i,
    ],

    dependent: [
        /\bafter\b/i,
        /\bonce\b/i,
        /\bthen\s+you\s+can\b/i,
        /\bfollowing\s+this\b/i,
        /\bsubsequent\b/i,
        /\bonly\s+after\b/i,
        /\bwhen\s+.{0,20}\s+is\s+(done|complete|ready)\b/i,
        /\bhaving\s+(done|completed|established)\b/i,
        /\bin\s+the\s+next\s+step\b/i,
        /\bdownstream\b/i,
    ],

    prescriptive: [
        /\bshould\b/i,
        /\bmust\b/i,
        /\bought\s+to\b/i,
        /\bneed\s+to\b/i,
        /\bhave\s+to\b/i,
        /\bensure\b/i,
        /\bmake\s+sure\b/i,
        /\balways\b/i,
        /\brequired\b/i,
        /\bessential\b/i,
        /\bcritical\s+to\b/i,
        /\bimperative\b/i,
        /\brecommend\b/i,
        /\bsuggest\b/i,
        /\badvise\b/i,
        /^use\s+\w/i,
        /^apply\s+\w/i,
        /^consider\s+\w/i,
        /^implement\s+\w/i,
    ],

    uncertain: [
        /\bmight\b/i,
        /\bmay\b/i,
        /\bcould\b/i,
        /\bpossibly\b/i,
        /\bperhaps\b/i,
        /\bmaybe\b/i,
        /\bunclear\b/i,
        /\bunknown\b/i,
        /\buncertain\b/i,
        /\bdepends\b/i,
        /\bnot\s+sure\b/i,
        /\bhard\s+to\s+(say|know|tell)\b/i,
        /\bdifficult\s+to\s+know\b/i,
        /\b(it|that)\s+varies\b/i,
        /\bin\s+some\s+cases\b/i,
    ],

    assertive: [
        /\bworks?\b/i,
        /\bperforms?\b/i,
        /\bprovides?\b/i,
        /\boffers?\b/i,
        /\bincludes?\b/i,
        /\bexists?\b/i,
        /\bcontains?\b/i,
        /\bsupports?\b/i,
        /\bis\s+(essential|critical|required|necessary)\b/i,
        /\b(demonstrates|proves|confirms)\s+that\b/i,
    ],
    unclassified: [],
};

// Signal patterns - detect relationships independent of stance
export interface SignalPatterns {
    sequence: RegExp[];
    tension: RegExp[];
    conditional: RegExp[];
}

export const SIGNAL_PATTERNS: SignalPatterns = {
    sequence: [
        /\bbefore\b/i,
        /\bafter\b/i,
        /\bfirst\b/i,
        /\bthen\b/i,
        /\bnext\b/i,
        /\bfinally\b/i,
        /\bonce\b/i,
        /\brequires?\b/i,
        /\bdepends\s+on\b/i,
        /\bprior\s+to\b/i,
        /\bsubsequent\b/i,
        /\bfollowing\b/i,
        /\bpreceding\b/i,
        /\bstep\s+\d+\b/i,
        /\bphase\s+\d+\b/i,
        /\benables?\b/i,
        /\bunblocks?\b/i,
    ],

    tension: [
        /\bbut\b/i,
        /\bhowever\b/i,
        /\balthough\b/i,
        /\bthough\b/i,
        /\bdespite\b/i,
        /\bnevertheless\b/i,
        /\byet\b/i,
        /\binstead\b/i,
        /\brather\s+than\b/i,
        /\bon\s+the\s+other\s+hand\b/i,
        /\bin\s+contrast\b/i,
        /\bconversely\b/i,
        /\bversus\b/i,
        /\bvs\.?\b/i,
        /\bor\b/i,
        /\btrade-?off\b/i,
        /\bbalance\b/i,
        /\btension\b/i,
        /\bcompeting\b/i,
        /\bconflicts?\s+with\b/i,
    ],

    conditional: [
        /\bif\b/i,
        /\bwhen\b/i,
        /\bunless\b/i,
        /\bassuming\b/i,
        /\bprovided\s+that\b/i,
        /\bgiven\s+that\b/i,
        /\bin\s+case\b/i,
        /\bcontingent\s+on\b/i,
        /\bsubject\s+to\b/i,
        /\bdepending\s+on\b/i,
        /\bfor\s+(this|that|these)\s+case\b/i,
        /\bin\s+(some|certain|specific)\s+cases\b/i,
        /\bonly\s+if\b/i,
        /\bonly\s+when\b/i,
    ],
};

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

export function getStancePatterns(stance: Stance): RegExp[] {
    return STANCE_PATTERNS[stance];
}

export function getStancePriority(stance: Stance): number {
    const idx = STANCE_PRIORITY.indexOf(stance);
    if (idx === -1) return 0; // Default priority for unknown stance
    return STANCE_PRIORITY.length - idx;
}

export function getSignalPatterns(signalType: keyof SignalPatterns): RegExp[] {
    return SIGNAL_PATTERNS[signalType];
}

/**
 * Classify stance using evidence-weighted majority wins.
 * The stance with the most pattern matches wins; priority breaks ties.
 * If no patterns match, returns assertive with low confidence (residual fallback).
 */
export function classifyStance(text: string): { stance: Stance; confidence: number } {
    const matchCounts = new Map<Stance, number>();
    let totalMatches = 0;

    for (const stance of STANCE_PRIORITY) {
        const patterns = STANCE_PATTERNS[stance];
        const matches = patterns.filter(p => p.test(text)).length;
        if (matches > 0) {
            matchCounts.set(stance, matches);
            totalMatches += matches;
        }
    }

    // No patterns matched at all: residual assertive fallback.
    // 0.50 = neutral "no strong stance signal", not "this statement is weak".
    if (totalMatches === 0) return { stance: 'assertive', confidence: 0.50 };

    // Majority wins: stance with most matches; priority as tiebreaker
    let bestStance: Stance = 'assertive';
    let bestCount = 0;
    let bestPriority = 0;

    for (const [stance, count] of matchCounts) {
        const priority = getStancePriority(stance);
        if (count > bestCount || (count === bestCount && priority > bestPriority)) {
            bestStance = stance;
            bestCount = count;
            bestPriority = priority;
        }
    }

    // Base confidence from winner pattern strength: 1 match = 0.65, 2 = 0.80, 3+ = 0.95
    const baseConfidence = Math.min(1.0, 0.5 + (bestCount * 0.15));

    // Dominance ratio: penalize cross-stance contamination
    const dominanceRatio = bestCount / totalMatches;
    const confidence = baseConfidence * dominanceRatio;

    return { stance: bestStance, confidence };
}

/**
 * Detect signals in text (returns boolean flags)
 */
export function detectSignals(text: string): {
    sequence: boolean;
    tension: boolean;
    conditional: boolean;
} {
    return {
        sequence: SIGNAL_PATTERNS.sequence.some(p => p.test(text)),
        tension: SIGNAL_PATTERNS.tension.some(p => p.test(text)),
        conditional: SIGNAL_PATTERNS.conditional.some(p => p.test(text)),
    };
}

/**
 * Compute signal weight for scoring (used in ShadowDelta)
 */
export function computeSignalWeight(signals: {
    sequence: boolean;
    tension: boolean;
    conditional: boolean;
}): number {
    let weight = 0;
    if (signals.conditional) weight += 3;
    if (signals.sequence) weight += 2;
    if (signals.tension) weight += 1;
    return weight;
}
