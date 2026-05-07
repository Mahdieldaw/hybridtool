export const PROMPT_TEMPLATES = {
  withBridgeAndPrior: (basePrompt = '', bridgeContext = '', previousAnswer = '') =>
    `
<prior_context>
${previousAnswer || ''}
</prior_context>

<reactive_bridge>
${bridgeContext || ''}
</reactive_bridge>

${basePrompt || ''}`.trim(),

  withBridgeOnly: (basePrompt = '', bridgeContext = '') =>
    `
<reactive_bridge>
${bridgeContext || ''}
</reactive_bridge>

${basePrompt || ''}`.trim(),

  withPriorOnly: (basePrompt = '', previousAnswer = '') =>
    `
<prior_context>
${previousAnswer || ''}
</prior_context>

${basePrompt || ''}`.trim(),

  withInlinedAttachments: (
    basePrompt = '',
    attachments: Array<{ filename: string; mimeType: string; text: string }> = []
  ) => {
    if (!attachments.length) return basePrompt || '';
    const blocks = attachments
      .map(
        (a) =>
          `<attachment filename="${a.filename}" mime="${a.mimeType}">\n${a.text}\n</attachment>`
      )
      .join('\n\n');
    return `${blocks}\n\n${basePrompt || ''}`.trim();
  },
};
