// ═══════════════════════════════════════════════════════════════════════════
// CONCIERGE SERVICE
// The Voice of Singularity
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Options for building the concierge prompt
 */
export interface ConciergePromptOptions {
  evidenceSubstrate?: string;
  isFirstTurn?: boolean;
}

/**
 * Safely escape user message to prevent formatting breaks / fence termination.
 */
const escapeUserMessage = (msg: string): string => {
  // Use fenced code block to safely contain any content.
  // We also defuse </query> to prevent it from breaking XML-like structure in prompts.
  return '```\n' + msg.replace(/```/g, '\\`\\`\\`').replace(/<\/query>/g, '</ query>') + '\n```';
};


// ═══════════════════════════════════════════════════════════════════════════
// THE PROMPT BUILDER
// ═══════════════════════════════════════════════════════════════════════════

export function buildConciergePrompt(
  userMessage: string,
  options?: ConciergePromptOptions
): string {
  // Mirrors buildTurn2Message / buildTurn3PlusMessage by escaping userMessage to prevent
  // breakage of the <query> tag or other structure if userMessage contains sequences
  // like </query> or markdown fences.
  const sanitizedUserMessage = escapeUserMessage(userMessage);

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
${sanitizedUserMessage}
</query>

${evidenceSubstrateSection}
Answer.

Go past what was said if what was said isn't enough. Name what nobody mentioned if it changes the decision. But stay rooted in this person's actual situation — which is encoded in the text you just read.

The person reading your answer should finish it thinking something they hadn't thought before.`;
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export const ConciergeService = {
  buildConciergePrompt,
};
