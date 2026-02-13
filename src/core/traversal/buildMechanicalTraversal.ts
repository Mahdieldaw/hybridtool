import type { CognitiveArtifact, StructuralAnalysis } from '../../../shared/contract';
import { computeStructuralAnalysis } from '../PromptMethods';
import { conditionalFinder, type ConditionalFinderOutput } from './conditionalFinder';
import { conflictDeriver, type ConflictDeriverOutput } from './conflictDeriver';

export interface TraversalAnalysis {
  conditionals: ConditionalFinderOutput;
  conflicts: ConflictDeriverOutput;
  summary: {
    totalTier0Gates: number;
    totalTier1Conflicts: number;
    wouldPauseTraversal: boolean;
    conflictsBlockedByGates: number;
    conflictsUnblocked: number;
    prunabilityAssessment: 'high' | 'moderate' | 'low' | 'none';
    assessmentEvidence: string[];
  };
  processingTimeMs: number;
}

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function emptyConflictResult(): ConflictDeriverOutput {
  return {
    conflicts: [],
    meta: {
      totalConflictEdges: 0,
      enrichedConflicts: 0,
      passingFilter: 0,
      blockedByGates: 0,
      processingTimeMs: 0,
    },
    filteredOutReasons: {},
  };
}

export async function buildMechanicalTraversal(
  artifact: CognitiveArtifact,
  opts?: { statementEmbeddings?: Map<string, Float32Array> | null }
): Promise<TraversalAnalysis> {
  const start = nowMs();

  const claims = Array.isArray(artifact?.semantic?.claims) ? artifact.semantic.claims : [];
  const edges = Array.isArray(artifact?.semantic?.edges) ? artifact.semantic.edges : [];
  const statements = Array.isArray((artifact as any)?.shadow?.statements) ? ((artifact as any).shadow.statements as any[]) : [];
  const statementEmbeddings = opts?.statementEmbeddings ?? null;

  const conditionals = await conditionalFinder({
    claims: claims as any,
    statements: statements as any,
    statementEmbeddings: statementEmbeddings instanceof Map ? statementEmbeddings : null,
    edges: edges as any,
  });

  const strongGates = conditionals.conditions.filter((c) => c?.gateAnalysis?.gateStrength === 'strong');

  let structuralAnalysis: StructuralAnalysis | null = null;
  try {
    structuralAnalysis = computeStructuralAnalysis(artifact);
  } catch {
    structuralAnalysis = null;
  }

  const conflicts =
    structuralAnalysis && typeof structuralAnalysis === 'object'
      ? conflictDeriver({
        structuralAnalysis,
        claims: claims as any,
        statements: statements as any,
        conditionalGates: strongGates,
      })
      : emptyConflictResult();

  const totalTier0Gates = strongGates.length;
  const totalTier1Conflicts = conflicts.conflicts.filter((c) => c.passedFilter).length;
  const wouldPauseTraversal = totalTier0Gates > 0 || totalTier1Conflicts > 0;

  const conflictsBlockedByGates = conflicts.conflicts.filter((c) => c.passedFilter && c.blockedByGates.length > 0).length;
  const conflictsUnblocked = totalTier1Conflicts - conflictsBlockedByGates;

  const weakGatesExist = conditionals.conditions.some((c) => c?.gateAnalysis?.gateStrength === 'weak');

  let prunabilityAssessment: TraversalAnalysis['summary']['prunabilityAssessment'] = 'none';
  if (totalTier0Gates >= 2 || totalTier1Conflicts >= 2) prunabilityAssessment = 'high';
  else if (totalTier0Gates >= 1 || totalTier1Conflicts >= 1) prunabilityAssessment = 'moderate';
  else if (weakGatesExist) prunabilityAssessment = 'low';
  else if (conditionals.conditions.length === 0 && conflicts.conflicts.length === 0) prunabilityAssessment = 'none';

  const assessmentEvidence: string[] = [];
  if (totalTier0Gates > 0) assessmentEvidence.push(`${totalTier0Gates} strong conditional gate(s) detected`);
  else if (weakGatesExist) assessmentEvidence.push('Weak conditional gates detected, but none strong');
  else assessmentEvidence.push('No conditional structure found in source evidence');

  if (totalTier1Conflicts > 0) assessmentEvidence.push(`${totalTier1Conflicts} conflict(s) pass the forcing-point filter`);
  else assessmentEvidence.push('No conflicts pass the forcing-point filter');

  if (conflictsBlockedByGates > 0) assessmentEvidence.push(`${conflictsBlockedByGates} passing conflict(s) blocked by strong gates`);

  return {
    conditionals,
    conflicts,
    summary: {
      totalTier0Gates,
      totalTier1Conflicts,
      wouldPauseTraversal,
      conflictsBlockedByGates,
      conflictsUnblocked,
      prunabilityAssessment,
      assessmentEvidence,
    },
    processingTimeMs: nowMs() - start,
  };
}
