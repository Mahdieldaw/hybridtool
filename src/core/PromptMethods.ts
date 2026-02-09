export { computeStructuralAnalysis } from './structural-analysis/engine';
export { extractShadowStatements as executeShadowExtraction, computeShadowDelta as executeShadowDelta } from '../shadow';
export type { ShadowAudit, UnindexedStatement, TwoPassResult, DeltaResult } from '../shadow';
export type { ModeContext } from './structural-analysis/types';
