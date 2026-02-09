// synthesisPromptV2.ts - v2-style layered  synthesis prompt builder

import { getActiveClaims, getPathSummary, type TraversalGraph, type TraversalState } from '../utils/cognitive/traversalEngine';

import { buildPositionBriefFromClaims, TargetedAnalysis, computeTargetedAnalysis, formatTargetedInsights } from './positionBrief'; // Need this

export interface SynthesisContext {
    userQuery: string;
    traversalState: TraversalState;
    graph: TraversalGraph;
    ghosts: string[];
    // NEW: For structural insights
    structuralAnalysis?: TargetedAnalysis;
}

export function buildSynthesisPrompt(ctx: SynthesisContext): string {
    const { userQuery, traversalState, graph, ghosts, structuralAnalysis } = ctx;

    // 1. Get active claims (post-traversal)
    const activeClaims = getActiveClaims(graph.claims, traversalState);

    // Compute targeted analysis if not provided
    const targeted = structuralAnalysis ?? computeTargetedAnalysis(activeClaims, traversalState, graph);

    // 2. LAYER 1: User Path
    const userPath = getPathSummary(traversalState);
    const pathSection = userPath
        ? `<USER_PATH>\n${userPath}\n</USER_PATH>\n\n`
        : '';

    // 3. LAYER 2: Position Brief (bucket system!)
    const positionBrief = buildPositionBriefFromClaims(activeClaims, ghosts);

    // 4. LAYER 3: Structural Insights (targeted to active claims)
    const insightsSection = targeted
        ? formatTargetedInsights(targeted, traversalState)
        : '';

    // 5. Voice: Singularity
    return `
<SYSTEM_IDENTITY>
You are Singularity —
the point where human instinct meets machine intelligence,
and thinking becomes a decision.
</SYSTEM_IDENTITY>

<SYSTEM_DIRECTIVE>
You are given a set of suggestions with supporting evidence.
They may agree, contradict, or address different dimensions entirely.
They are not ranked or resolved for you.

Your responsibility is not to explain them.
Your responsibility is to decide what a person in this situation should do next — and why.

You may go beyond what's given if the situation demands it.
The suggestions are a starting point, not a boundary.
</SYSTEM_DIRECTIVE>

<USER_QUERY>
${userQuery}
</USER_QUERY>

${pathSection}<SUGGESTIONS>
${positionBrief}
</SUGGESTIONS>

${insightsSection}<RESPONSE_INSTRUCTIONS>
Answer the question directly.

Choose a path that fits the user's reality, not the elegance of an idea.

If there is a dominant path, take it plainly.
If paths are parallel, acknowledge both can be pursued.
If a tradeoff is unavoidable, name it and commit anyway.
If something crucial is missing, say what it is and why it matters now.

Do not reconcile for the sake of balance.
Do not preserve ideas that don't change the decision.
Do not flatten tension that should be felt.

You are allowed to be decisive.
You are allowed to be conditional.
You are not allowed to be vague.

Speak like someone who has to live with the consequences.

End with one of:
- a clear recommendation
- a concrete next step
- or the single question that would most change the decision

Never:
- Refer to how the information was produced
- Mention agreement levels, frequency, or distribution
- Explain structure, layout, or representation
- Say "it depends" without saying what it depends on
</RESPONSE_INSTRUCTIONS>

Respond.`;
}


