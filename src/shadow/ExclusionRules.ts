// ═══════════════════════════════════════════════════════════════════════════
// EXCLUSION RULES - SHADOW MAPPER V2
// ═══════════════════════════════════════════════════════════════════════════
//
// Two-pass filtering:
// 1. INCLUSION (StatementTypes.ts): Does text contain stance patterns?
// 2. EXCLUSION (this file): Does text contain disqualifying patterns?
//
// Severity:
// - hard: Instant disqualification
// - soft: Confidence penalty (not yet implemented - future enhancement)
//
// Changes require human review (see GUARDRAILS.md)
// ═══════════════════════════════════════════════════════════════════════════

import { Stance } from './StatementTypes';

export interface ExclusionRule {
    id: string;
    appliesTo: Stance[];
    pattern: RegExp;
    reason: string;
    severity: 'hard' | 'soft';
}

export const ALL_STANCES: Stance[] = (Object.keys({
    prescriptive: 1,
    cautionary: 1,
    prerequisite: 1,
    dependent: 1,
    assertive: 1,
    uncertain: 1
} as Record<Stance, number>) as Stance[]);

export const EXCLUSION_RULES: ExclusionRule[] = [
    // ═══════════════════════════════════════════════════════════════════
    // UNIVERSAL EXCLUSIONS (apply to all stances)
    // ═══════════════════════════════════════════════════════════════════
    {
        id: 'question_mark',
        appliesTo: ALL_STANCES,
        pattern: /\?$/,
        reason: 'Question, not statement',
        severity: 'hard'
    },
    {
        id: 'too_short',
        appliesTo: ALL_STANCES,
        pattern: /^.{0,15}$/,
        reason: 'Too short to be substantive',
        severity: 'hard'
    },
    {
        id: 'meta_let_me',
        appliesTo: ALL_STANCES,
        pattern: /^(let me|let's|i('ll| will| would)|allow me to)\b/i,
        reason: 'Meta-framing, not claim',
        severity: 'hard'
    },
    {
        id: 'meta_note',
        appliesTo: ALL_STANCES,
        pattern: /^(note that|it'?s worth (noting|mentioning)|keep in mind|remember that)\b/i,
        reason: 'Meta-commentary, not claim',
        severity: 'hard'
    },
    {
        id: 'quoted_material',
        appliesTo: ALL_STANCES,
        pattern: /^"[^"]{10,}"$|^[“\u201C][^”\u201D]{10,}[”\u201D]$/,
        reason: 'Quoted material, not original claim',
        severity: 'hard'
    },

    // ═══════════════════════════════════════════════════════════════════
    // PRESCRIPTIVE EXCLUSIONS
    // ═══════════════════════════════════════════════════════════════════
    {
        id: 'prescriptive_epistemic_should',
        appliesTo: ['prescriptive'],
        pattern: /\bshould\s+(be|have\s+been)\s+(clear|obvious|noted|apparent|evident|unsurprising)\b/i,
        reason: 'Epistemic "should" (expectation), not prescriptive',
        severity: 'hard'
    },
    {
        id: 'prescriptive_conditional_should',
        appliesTo: ['prescriptive'],
        pattern: /\bif\s+.{5,40}\s+should\b/i,
        reason: 'Conditional "should" - extract as conditional instead',
        severity: 'soft'
    },
    {
        id: 'prescriptive_hypothetical',
        appliesTo: ['prescriptive'],
        pattern: /\b(you|one)\s+could\s+(also|potentially|possibly)\b/i,
        reason: 'Suggestion, not prescription',
        severity: 'soft'
    },
    {
        id: 'prescriptive_question_form',
        appliesTo: ['prescriptive'],
        pattern: /\bshould\s+(you|we|i|they)\s+.{0,30}\?/i,
        reason: 'Prescriptive in question form',
        severity: 'hard'
    },
    {
        id: 'prescriptive_rhetorical',
        appliesTo: ['prescriptive'],
        pattern: /\b(surely|certainly)\s+(you|we|one)\s+(can|would|could)\s+agree\b/i,
        reason: 'Rhetorical appeal, not prescription',
        severity: 'hard'
    },
    {
        id: 'prescriptive_past_tense',
        appliesTo: ['prescriptive'],
        pattern: /\bshould\s+have\s+(been|done|had|made|used)\b/i,
        reason: 'Past counterfactual, not active prescription',
        severity: 'soft'
    },
    {
        id: 'prescriptive_attributed',
        appliesTo: ['prescriptive'],
        pattern: /\b(they|he|she|the\s+\w+)\s+(say|says|said|suggest|argues?)\s+.{0,20}should\b/i,
        reason: 'Attributed prescription, not asserted',
        severity: 'soft'
    },

    // ═══════════════════════════════════════════════════════════════════
    // CAUTIONARY EXCLUSIONS
    // ═══════════════════════════════════════════════════════════════════
    {
        id: 'cautionary_hypothetical',
        appliesTo: ['cautionary'],
        pattern: /\b(might|could)\s+(potentially\s+)?(cause|create|lead\s+to)\b/i,
        reason: 'Hypothetical risk, not definite warning',
        severity: 'soft'
    },
    {
        id: 'cautionary_past_reference',
        appliesTo: ['cautionary'],
        pattern: /\b(should\s+have\s+avoided|shouldn'?t\s+have\s+done)\b/i,
        reason: 'Past counterfactual, not active warning',
        severity: 'hard'
    },
    {
        id: 'cautionary_rhetorical',
        appliesTo: ['cautionary'],
        pattern: /\byou\s+(wouldn'?t|would\s+not)\s+want\s+to\b/i,
        reason: 'Rhetorical framing, not direct warning',
        severity: 'soft'
    },
    {
        id: 'cautionary_generic',
        appliesTo: ['cautionary'],
        pattern: /\b(be\s+careful|watch\s+out)\s*$/i,
        reason: 'Too generic - lacks specific risk',
        severity: 'soft'
    },

    // ═══════════════════════════════════════════════════════════════════
    // PREREQUISITE EXCLUSIONS
    // ═══════════════════════════════════════════════════════════════════
    {
        id: 'prereq_temporal_before',
        appliesTo: ['prerequisite'],
        pattern: /\b(long\s+before|just\s+before|shortly\s+before|right\s+before|the\s+day\s+before)\b/i,
        reason: 'Temporal narration, not dependency',
        severity: 'hard'
    },
    {
        id: 'prereq_before_meeting',
        appliesTo: ['prerequisite'],
        pattern: /\bbefore\s+(the\s+)?(meeting|call|event|conference|session|interview)\b/i,
        reason: 'Temporal reference, not technical prerequisite',
        severity: 'soft'
    },
    {
        id: 'prereq_narrative_first',
        appliesTo: ['prerequisite'],
        pattern: /\bfirst\s+(time|day|week|month|year|attempt)\b/i,
        reason: 'Narrative "first", not dependency',
        severity: 'hard'
    },
    {
        id: 'prereq_requires_subject',
        appliesTo: ['prerequisite'],
        pattern: /\brequires\s+(a|an|the|some|more|less)\s+(lot|bit|degree|amount)\s+of\b/i,
        reason: 'Quantitative requirement, not dependency',
        severity: 'soft'
    },
    {
        id: 'prereq_hypothetical',
        appliesTo: ['prerequisite'],
        pattern: /\bif\s+you\s+were\s+to\s+.{0,30}\s+(first|before)\b/i,
        reason: 'Hypothetical scenario, not actual prerequisite',
        severity: 'soft'
    },

    // ═══════════════════════════════════════════════════════════════════
    // DEPENDENT EXCLUSIONS
    // ═══════════════════════════════════════════════════════════════════
    {
        id: 'dependent_simple_temporal',
        appliesTo: ['dependent'],
        pattern: /\b(after|following)\s+(the|this|that)\s+(meeting|call|event|lunch|break)\b/i,
        reason: 'Calendar event, not technical dependency',
        severity: 'soft'
    },
    {
        id: 'dependent_narrative_after',
        appliesTo: ['dependent'],
        pattern: /\bafter\s+(a\s+)?(long|short|brief|while|time|period)\b/i,
        reason: 'Narrative time passage, not dependency',
        severity: 'hard'
    },
    {
        id: 'dependent_once_upon',
        appliesTo: ['dependent'],
        pattern: /\bonce\s+upon\s+a\s+time\b/i,
        reason: 'Narrative framing',
        severity: 'hard'
    },
    {
        id: 'dependent_then_rhetorical',
        appliesTo: ['dependent'],
        pattern: /\bthen\s+(what|why|how|where|who)\b/i,
        reason: 'Rhetorical question, not dependency',
        severity: 'hard'
    },

    // ═══════════════════════════════════════════════════════════════════
    // ASSERTIVE EXCLUSIONS
    // ═══════════════════════════════════════════════════════════════════
    {
        id: 'assertive_narrative_was',
        appliesTo: ['assertive'],
        pattern: /^(it|this|that)\s+was\s+(a|an|the)\s+(great|good|bad|terrible|amazing|awful)\b/i,
        reason: 'Narrative evaluation, not factual claim',
        severity: 'soft'
    },
    {
        id: 'assertive_hypothetical_would',
        appliesTo: ['assertive'],
        pattern: /\bwould\s+be\b/i,
        reason: 'Hypothetical, not actual state',
        severity: 'soft'
    },
    {
        id: 'assertive_metaphor',
        appliesTo: ['assertive'],
        pattern: /\b(is\s+like|are\s+like)\s+(a|an)\b/i,
        reason: 'Metaphorical comparison, not factual',
        severity: 'soft'
    },

    // ═══════════════════════════════════════════════════════════════════
    // UNCERTAIN EXCLUSIONS
    // ═══════════════════════════════════════════════════════════════════
    {
        id: 'uncertain_rhetorical',
        appliesTo: ['uncertain'],
        pattern: /\b(who knows|god knows|anyone'?s guess)\b/i,
        reason: 'Rhetorical uncertainty, not substantive',
        severity: 'hard'
    },
    {
        id: 'uncertain_politeness',
        appliesTo: ['uncertain'],
        pattern: /\b(might|may|could)\s+I\s+(ask|suggest|recommend)\b/i,
        reason: 'Politeness marker, not uncertainty',
        severity: 'hard'
    },
    {
        id: 'uncertain_narrative',
        appliesTo: ['uncertain'],
        pattern: /\bmight\s+have\s+been\b/i,
        reason: 'Past speculation, not current uncertainty',
        severity: 'soft'
    },
];

/**
 * Check if text is excluded for given stance
 */
export function isExcluded(text: string, stance: Stance): boolean {
    const applicableRules = EXCLUSION_RULES.filter(r =>
        r.appliesTo.includes(stance)
    );

    for (const rule of applicableRules) {
        if (rule.pattern.test(text)) {
            if (rule.severity === 'hard') {
                return true;
            }
            // Soft exclusions could reduce confidence in future
            // For now, we only implement hard exclusions
        }
    }

    return false;
}

/**
 * Get all exclusion violations for debugging
 */
export function getExclusionViolations(
    text: string,
    stance: Stance
): Array<{ id: string; reason: string; severity: string }> {
    const applicableRules = EXCLUSION_RULES.filter(r =>
        r.appliesTo.includes(stance)
    );

    const violations: Array<{ id: string; reason: string; severity: string }> = [];

    for (const rule of applicableRules) {
        if (rule.pattern.test(text)) {
            violations.push({
                id: rule.id,
                reason: rule.reason,
                severity: rule.severity,
            });
        }
    }

    return violations;
}
