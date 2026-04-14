import {
  turnStreamingStateFamily,
  workflowProgressForTurnFamily,
  providerErrorsForTurnFamily,
  providerEffectiveStateFamily,
  providerArtifactFamily,
} from './workflow';
import { turnExpandedStateFamily } from './ui';
import { modelResponsePanelModeFamily, activeProbeDraftFamily } from './layout';
import { turnAtomFamily } from './chat';

export function cleanupTurnAtoms(
  turnIds: string[],
  turnIdProviderPairs: Array<{ turnId: string; providerId: string }>
): void {
  for (const turnId of turnIds) {
    turnAtomFamily.remove(turnId);
    turnStreamingStateFamily.remove(turnId);
    turnExpandedStateFamily.remove(turnId);
    workflowProgressForTurnFamily.remove(turnId);
    providerErrorsForTurnFamily.remove(turnId);
    modelResponsePanelModeFamily.remove(turnId);
    activeProbeDraftFamily.remove(turnId);
  }
  for (const pair of turnIdProviderPairs) {
    providerEffectiveStateFamily.remove(pair);
    providerArtifactFamily.remove(pair);
  }
}
