import type { StructuralAnalysis } from '../../../shared/contract';
import type { GeometricSubstrate } from '../types';
import type { DiagnosticsResult, PreSemanticInterpretation } from './types';
import { computeDiagnostics } from './diagnostics';

export function validateStructuralMapping(
    preSemantic: PreSemanticInterpretation,
    postSemantic: StructuralAnalysis,
    substrate?: GeometricSubstrate | null,
    statementEmbeddings?: Map<string, Float32Array> | null,
    paragraphs?: Array<{ id: string; modelIndex: number; statementIds: string[] }> | null
): DiagnosticsResult {
    return computeDiagnostics(preSemantic, postSemantic, substrate, statementEmbeddings, paragraphs);
}
