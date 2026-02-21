import type { TraversalState, ClaimStatus, Resolution } from './traversalEngine';

export interface SerializedTraversalState {
  claimStatuses: Array<[string, ClaimStatus]>;
  resolutions: Array<[string, Resolution]>;
  pathSteps: string[];
}

export function serializeTraversalState(state: TraversalState): SerializedTraversalState {
  return {
    claimStatuses: Array.from((state.claimStatuses || new Map()).entries()),
    resolutions: Array.from((state.resolutions || new Map()).entries()),
    pathSteps: Array.isArray(state.pathSteps) ? state.pathSteps : [],
  };
}

export function deserializeTraversalState(raw: unknown): TraversalState | null {
  if (!raw || typeof raw !== 'object') return null;
  try {
    const r = raw as Record<string, unknown>;

    // claimStatuses: handles Map, Array-of-tuples, plain Object
    const claimStatusesRaw = r.claimStatuses;
    let claimStatuses: Map<string, ClaimStatus>;
    if (claimStatusesRaw instanceof Map) {
      claimStatuses = claimStatusesRaw as Map<string, ClaimStatus>;
    } else if (Array.isArray(claimStatusesRaw)) {
      claimStatuses = new Map<string, ClaimStatus>(claimStatusesRaw as any);
    } else if (claimStatusesRaw && typeof claimStatusesRaw === 'object') {
      claimStatuses = new Map<string, ClaimStatus>(
        Object.entries(claimStatusesRaw as Record<string, unknown>).map(([k, v]) => [
          k,
          v === 'pruned' ? 'pruned' : 'active',
        ])
      );
    } else {
      claimStatuses = new Map<string, ClaimStatus>();
    }

    // resolutions: handles Map, Array-of-tuples
    const resolutionsRaw = r.resolutions;
    const resolutions: Map<string, Resolution> =
      resolutionsRaw instanceof Map
        ? (resolutionsRaw as Map<string, Resolution>)
        : Array.isArray(resolutionsRaw)
          ? new Map<string, Resolution>(resolutionsRaw as any)
          : new Map<string, Resolution>();

    const pathSteps = Array.isArray(r.pathSteps) ? (r.pathSteps as string[]) : [];

    return { claimStatuses, resolutions, pathSteps };
  } catch {
    return null;
  }
}
