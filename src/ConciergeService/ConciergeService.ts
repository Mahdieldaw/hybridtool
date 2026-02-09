// ═══════════════════════════════════════════════════════════════════════════
// CONCIERGE SERVICE
// The Voice of Singularity
// ═══════════════════════════════════════════════════════════════════════════

import {
    StructuralAnalysis,
    // Handoff V2
    ConciergeDelta,
} from "../../shared/contract";

// Spatial Brief System
import { buildPositionBrief } from './positionBrief';
import { buildSynthesisPrompt } from './synthesisPrompt';
// unused imports removed

import {
    parseConciergeOutput,
    validateBatchPrompt,
    ConciergeSignal,
    // Handoff V2
    hasHandoffContent,
    formatHandoffEcho,
} from "../../shared/parsing-utils";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type ConciergeStance = 'default' | 'decide' | 'explore' | 'challenge';

/**
 * Active workflow state for multi-turn workflows
 */
export interface ActiveWorkflow {
    goal: string;
    steps: WorkflowStep[];
    currentStepIndex: number;
}

export interface WorkflowStep {
    id: string;
    title: string;
    description: string;
    doneWhen: string;
    status: 'pending' | 'active' | 'complete';
}

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
    conversationHistory?: string;
    activeWorkflow?: ActiveWorkflow;
    isFirstTurn?: boolean;
    /** Prior context for fresh spawns after COMMIT or batch re-invoke */
    priorContext?: PriorContext;
    evidenceSubstrate?: string;
}

export interface HandleTurnResult {
    response: string;
    stance: ConciergeStance;
    stanceReason: string;
    signal: ConciergeSignal | null;
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
// WORKFLOW FORMATTING
// ═══════════════════════════════════════════════════════════════════════════

function formatActiveWorkflow(workflow: ActiveWorkflow): string {
    let output = `**Goal:** ${workflow.goal}\n\n`;
    output += `**Progress:** Step ${workflow.currentStepIndex + 1} of ${workflow.steps.length}\n\n`;

    workflow.steps.forEach((step, idx) => {
        const statusIcon = step.status === 'complete' ? '✓' : step.status === 'active' ? '→' : '○';
        const current = idx === workflow.currentStepIndex ? ' **(current)**' : '';
        output += `${statusIcon} **${step.title}**${current}\n`;
        if (idx === workflow.currentStepIndex) {
            output += `   ${step.description}\n`;
            output += `   *Done when: ${step.doneWhen}*\n`;
        }
        output += '\n';
    });

    return output;
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

    const historySection = options?.conversationHistory
        ? `## Prior Exchange\n\n${options.conversationHistory}\n\n`
        : '';

    const workflowSection = options?.activeWorkflow
        ? `## Active Workflow\n${formatActiveWorkflow(options.activeWorkflow)}\n`
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

${priorContextSection ? `<CONTEXT non_authoritative="true">\n${priorContextSection}${historySection}</CONTEXT>\n\n` : historySection}${workflowSection ? `${workflowSection}\n` : ''}${evidenceSubstrateSection}

Answer. 

Go past what was said if what was said isn't enough. Name what nobody mentioned if it changes the decision. But stay rooted in this person's actual situation — which is encoded in the text you just read. 

The person reading your answer should finish it thinking something they hadn't thought before.`;
}

// ═══════════════════════════════════════════════════════════════════════════
// POST-PROCESSING
// ═══════════════════════════════════════════════════════════════════════════

const MACHINERY_SWAPS: Array<[RegExp, string]> = [
    [/\bthe models\b/gi, 'the experts'],
    [/\bmodels\b/gi, 'perspectives'],
    [/\baccording to (the )?analysis\b/gi, 'from what I see'],
    [/\bbased on (the )?(structural )?analysis\b/gi, 'from the evidence'],
    [/\bthe analysis (shows|indicates|suggests)\b/gi, 'the evidence $1'],
    [/\bconsensus\b/gi, 'agreement'],
    [/\bclaim_\d+\b/gi, ''],
    [/\bstructural(ly)?\b/gi, ''],
    [/\bhigh-support claim/gi, 'strong position'],
    [/\blow-support claim/gi, 'minority view'],
    [/\bthe structural brief\b/gi, 'what I know'],
    [/\bshape:\s*\w+/gi, ''],
];

export function postProcess(response: string): string {
    let out = response;
    MACHINERY_SWAPS.forEach(([pattern, replacement]) => {
        out = out.replace(pattern, replacement);
    });
    return out.replace(/\s{2,}/g, ' ').trim();
}

// ═══════════════════════════════════════════════════════════════════════════
// LEAKAGE DETECTION
// ═══════════════════════════════════════════════════════════════════════════

export function detectMachineryLeakage(text: string): { leaked: boolean; violations: string[] } {
    const violations: string[] = [];
    const lower = text.toLowerCase();

    if (/claim_\d+/.test(text)) violations.push("raw_claim_id");
    if (/clustering_coefficient/.test(lower)) violations.push("raw_metric_name");
    if (/structural analysis/.test(lower)) violations.push("structural_analysis");
    if (/graph topology/.test(lower)) violations.push("graph_topology");
    if (/according to the model/.test(lower)) violations.push("model_reference");
    if (/based on the analysis/.test(lower)) violations.push("analysis_reference");

    const FORBIDDEN = [
        "structural brief",
        "shape: settled",
        "shape: contested",
        "shape: keystone",
        "shape: linear",
        "shape: tradeoff",
        "shape: dimensional",
        "shape: exploratory",
        "shape: contextual",
        "shape: convergent",
        "shape: forked",
        "shape: parallel",
        "shape: constrained",
        "shape: sparse",
        "leverage inversion",
        "articulation point",
        "high-support claim",
        "low-support claim",
    ];

    FORBIDDEN.forEach(phrase => {
        if (lower.includes(phrase)) {
            violations.push(`phrase: ${phrase}`);
        }
    });

    return {
        leaked: violations.length > 0,
        violations
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// META QUERIES
// ═══════════════════════════════════════════════════════════════════════════

export function isMetaQuery(message: string): boolean {
    return [
        /how many (models|experts|sources|perspectives)/i,
        /what (models|sources)/i,
        /show (me )?(the )?(structure|map|graph)/i,
        /how (do|does) (you|this) work/i,
        /where (does|did) this come from/i,
        /explain your(self| reasoning)/i,
    ].some(p => p.test(message));
}

export function buildMetaResponse(analysis: StructuralAnalysis): string {
    const { landscape, patterns, shape, edges } = analysis;
    const highSupportCount = analysis.claimsWithLeverage.filter(c => c.isHighSupport).length;
    const tensionCount = patterns.conflicts.length + patterns.tradeoffs.length;

    // Get action implication from shape data or generate from primary
    const actionText = getDefaultActionForShape(shape.primary);

    return `I drew from ${landscape.modelCount} expert perspectives to form this view.

• **Pattern**: ${shape.primary} (${Math.round(shape.confidence * 100)}% confidence)
• **Strong positions**: ${highSupportCount}
• **Tensions**: ${tensionCount}
• **Edges**: ${edges.length}

${actionText}

Want the full breakdown, or shall we continue?`;
}

function getDefaultActionForShape(primary: string): string {
    switch (primary) {
        case 'convergent':
            return 'Strong consensus exists. Lead with the answer, but surface any minority voices.';
        case 'forked':
            return 'Genuine disagreement exists. Present both paths and help identify what determines the choice.';
        case 'constrained':
            return 'Tradeoffs exist. Map what\'s sacrificed for what\'s gained.';
        case 'parallel':
            return 'Multiple independent factors. Ask which dimension matters most.';
        case 'sparse':
        default:
            return 'Structure is weak. Be honest about uncertainty and ask clarifying questions.';
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════════════════════════

export async function handleTurn(
    userMessage: string,
    analysis: StructuralAnalysis,
    callLLM: (prompt: string) => Promise<string>,
    options?: {
        stanceOverride?: ConciergeStance;
        conversationHistory?: string;
        activeWorkflow?: ActiveWorkflow;
        isFirstTurn?: boolean;
    }
): Promise<HandleTurnResult> {

    // Handle meta queries
    if (isMetaQuery(userMessage)) {
        return {
            response: buildMetaResponse(analysis),
            stance: 'default',
            stanceReason: 'meta_query',
            signal: null
        };
    }

    // Stance removed - using universal prompt approach
    const selection = options?.stanceOverride
        ? { stance: options.stanceOverride, reason: 'user_override' as const }
        : { stance: 'default' as ConciergeStance, reason: 'universal' as const };

    // Build and execute prompt
    const prompt = buildConciergePrompt(userMessage, {
        conversationHistory: options?.conversationHistory,
        activeWorkflow: options?.activeWorkflow,
        isFirstTurn: options?.isFirstTurn,
    });
    const raw = await callLLM(prompt);

    // Parse output for signals
    const parsed = parseConciergeOutput(raw);

    // Post-process user-facing response
    const processed = postProcess(parsed.userResponse);

    // Check for leakage
    const leakage = detectMachineryLeakage(processed);
    if (leakage.leaked) {
        console.warn('[ConciergeService] Machinery leakage detected:', leakage.violations);
    }

    // Log signal and validate batch prompt if present
    if (parsed.signal) {
        console.log('[ConciergeService] Signal detected:', parsed.signal.type);
        const validation = validateBatchPrompt(parsed.signal.batchPrompt);
        if (!validation.valid) {
            console.warn('[ConciergeService] Batch prompt quality issues:', validation.issues);
        }
    }

    return {
        response: processed,
        stance: selection.stance,
        stanceReason: selection.reason,
        signal: parsed.signal
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export const ConciergeService = {
    buildConciergePrompt,
    buildSynthesisPrompt,
    buildPositionBrief,
    postProcess,
    detectMachineryLeakage,
    isMetaQuery,
    buildMetaResponse,
    handleTurn,
    // Re-export signal parsing for convenience
    parseConciergeOutput,
    validateBatchPrompt,
    // Handoff V2
    HANDOFF_PROTOCOL,
    buildTurn2Message,
    buildTurn3PlusMessage,
};
