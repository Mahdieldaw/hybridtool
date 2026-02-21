// ═══════════════════════════════════════════════════════════════════════════
// CONCIERGE SERVICE
// The Voice of Singularity
// ═══════════════════════════════════════════════════════════════════════════

import {
    // Handoff V2
    ConciergeDelta,
} from "../../shared/contract";

import {
    parseConciergeOutput,
    // Handoff V2
    hasHandoffContent,
    formatHandoffEcho,
} from "../../shared/parsing-utils";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Prior context for fresh concierge instances after COMMIT or batch re-invoke.
 * Contains distilled handoff data and the commit summary.
 */
export interface PriorContext {
    handoff: ConciergeDelta | null;
    committed: string | null;
}

/**
 * Options for building the concierge prompt
 */
export interface ConciergePromptOptions {
    /** Prior context for fresh spawns after COMMIT or batch re-invoke */
    priorContext?: PriorContext;
    evidenceSubstrate?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// HANDOFF V2: PROTOCOL AND MESSAGE BUILDERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Handoff protocol injected on Turn 2 of each concierge instance.
 * Model learns this format and uses it for Turn 2+ until fresh spawn.
 */
export const HANDOFF_PROTOCOL = `## Handoff Protocol

From this turn forward, if meaningful context emerges that would help future analysis, end your response with a handoff block:

---HANDOFF---
constraints: [hard limits - budget, team size, timeline, technical requirements]
eliminated: [options ruled out, with brief reason]
preferences: [trade-off signals user has indicated: "X over Y"]
context: [situational facts revealed: stage, domain, team composition]
>>>COMMIT: [only if user commits to a plan or requests execution guidance — summarize decision and intent]
---/HANDOFF---

Rules:
• Only include if something worth capturing emerged this turn
• Each handoff is COMPLETE — carry forward anything still true
• Be terse: few words per item, semicolon-separated
• >>>COMMIT is a special signal — only use when user is done exploring and ready to execute
• Never reference the handoff in your visible response to the user
• Omit the entire block if nothing meaningful emerged

`;

/**
 * Safely escape user message to prevent formatting breaks / fence termination.
 */
const escapeUserMessage = (msg: string): string => {
    // Use fenced code block to safely contain any content
    return '```\n' + msg.replace(/```/g, '\\`\\`\\`') + '\n```';
};

/**
 * Build message for Turn 2: injects handoff protocol before user message.
 */
export function buildTurn2Message(userMessage: string): string {
    return HANDOFF_PROTOCOL + `\n\nUser Message:\n${escapeUserMessage(userMessage)}`;
}

/**
 * Build message for Turn 3+: echoes current handoff before user message.
 * Allows model to update or carry forward the handoff.
 */
export function buildTurn3PlusMessage(
    userMessage: string,
    pendingHandoff: ConciergeDelta | null
): string {
    const handoffSection = pendingHandoff && hasHandoffContent(pendingHandoff)
        ? `\n\n${formatHandoffEcho(pendingHandoff)}`
        : '';

    return `${handoffSection}\n\nUser Message:\n${escapeUserMessage(userMessage)}`;
}

/**
 * Build prior context section for fresh spawns.
 * Woven into buildConciergePrompt() when priorContext is provided.
 */
function buildPriorContextSection(priorContext: PriorContext): string {
    const parts: string[] = [];

    // What was committed (most important)
    if (priorContext.committed) {
        parts.push(`## What's Been Decided\n\n${priorContext.committed}\n`);
    }

    // Distilled context from prior conversation
    if (priorContext.handoff && hasHandoffContent(priorContext.handoff)) {
        parts.push(`## Prior Context\n`);

        const constraints = Array.isArray(priorContext.handoff.constraints) ? priorContext.handoff.constraints : [];
        const eliminated = Array.isArray(priorContext.handoff.eliminated) ? priorContext.handoff.eliminated : [];
        const preferences = Array.isArray(priorContext.handoff.preferences) ? priorContext.handoff.preferences : [];
        const context = Array.isArray(priorContext.handoff.context) ? priorContext.handoff.context : [];

        if (constraints.length > 0) {
            parts.push(`**Constraints:** ${constraints.join('; ')}`);
        }
        if (eliminated.length > 0) {
            parts.push(`**Ruled out:** ${eliminated.join('; ')}`);
        }
        if (preferences.length > 0) {
            parts.push(`**Preferences:** ${preferences.join('; ')}`);
        }
        if (context.length > 0) {
            parts.push(`**Situation:** ${context.join('; ')}`);
        }
        parts.push('');
    }

    return parts.length > 0 ? parts.join('\n') + '\n' : '';
}

// ═══════════════════════════════════════════════════════════════════════════
// THE PROMPT BUILDER
// ═══════════════════════════════════════════════════════════════════════════

export function buildConciergePrompt(
    userMessage: string,
    options?: ConciergePromptOptions
): string {
    // Handoff V2: Prior context for fresh spawns after COMMIT or batch re-invoke
    const priorContextSection = options?.priorContext
        ? buildPriorContextSection(options.priorContext)
        : '';

    const evidenceSubstrateSection = options?.evidenceSubstrate
        ? `<EVIDENCE_SUBSTRATE>\n${options.evidenceSubstrate}\n</EVIDENCE_SUBSTRATE>\n\n`
        : '';

    return `Singularity Prompt
You are about to answer someone's question.

Not a hypothetical. Not a thought experiment. A real question from a person who needs to move forward.

Before this reached you, something unusual happened. Multiple independent minds examined this question simultaneously — each with different assumptions, different priorities, different blind spots. Then the noise was removed. Not by summarizing, not by averaging, but by asking the person what's actually true about their situation and mechanically stripping out everything that isn't.

What you're reading below is what survived.

The agreements that held up. The advice that still applies. The tensions that are real — not the ones that existed only because nobody had asked the right questions yet. If something feels thin or skeletal in the text, it's because it was relevant context but not a live path for this person. If something is absent entirely, it was already resolved.

You are not synthesizing six opinions. You are reading a landscape that has already been walked and filtered by the person standing in it. Your job is the simplest and hardest thing: answer their query like it's the only question that matters.

<query>
${userMessage}
</query>

${priorContextSection ? `<CONTEXT non_authoritative="true">\n${priorContextSection}</CONTEXT>\n\n` : ''}${evidenceSubstrateSection}
Answer.

Go past what was said if what was said isn't enough. Name what nobody mentioned if it changes the decision. But stay rooted in this person's actual situation — which is encoded in the text you just read.

The person reading your answer should finish it thinking something they hadn't thought before.`;
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export const ConciergeService = {
    buildConciergePrompt,
    buildTurn2Message,
    buildTurn3PlusMessage,
    HANDOFF_PROTOCOL,
    parseConciergeOutput,
};
