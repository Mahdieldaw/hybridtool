export const PROMPT_TEMPLATES = {
    withBridgeAndPrior: (basePrompt = "", bridgeContext = "", previousAnswer = "") => `
<prior_context>
${previousAnswer || ""}
</prior_context>

<reactive_bridge>
${bridgeContext || ""}
</reactive_bridge>

${basePrompt || ""}`.trim(),

    withBridgeOnly: (basePrompt = "", bridgeContext = "") => `
<reactive_bridge>
${bridgeContext || ""}
</reactive_bridge>

${basePrompt || ""}`.trim(),

    withPriorOnly: (basePrompt = "", previousAnswer = "") => `
<prior_context>
${previousAnswer || ""}
</prior_context>

${basePrompt || ""}`.trim(),
};
