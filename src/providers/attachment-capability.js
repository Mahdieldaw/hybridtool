// Default attachment-capability stub for provider adapters.
//
// Local attachments are a core feature of Singularity. Provider attachment
// upload is an OPTIONAL adapter capability — every provider must declare it
// at runtime (page-aware: model, plan, region, UI experiments can all gate it).
//
// Until each provider gets its own DOM-upload integration, all adapters return
// `unsupported`. Local persistence remains intact regardless.

/**
 * Default detector — returns `unsupported`. Adapters that implement provider
 * uploads should override `detectAttachmentCapability()` on their prototype
 * with a runtime check (inspect the live tab, model id, account tier, etc.).
 *
 * @returns {Promise<import('../../shared/types/attachment').ProviderAttachmentCapability>}
 */
export async function detectAttachmentCapabilityStub() {
  return {
    status: 'unsupported',
    reason: 'Provider attachment upload not implemented in this build',
  };
}
