//(Responsibility: Corpus-wide topological detection. Global structural phenomena derived via absolute topological signals without iterating over layers).

import { EnrichedClaim, SecondaryPattern } from '../../../shared/types';
import { MeasuredCorpus } from './measure';
import { MIN_CHAIN_LENGTH } from './classify';

export const detectKeystonePattern = (corpus: MeasuredCorpus): SecondaryPattern | null => {
  const hubId = corpus.graph.hubClaim;
  if (!hubId) return null;
  const keystoneClaim = corpus.claims.find((c) => c.id === hubId);
  if (!keystoneClaim) return null;

  const structuralEdges = corpus.edges.filter(
    (e) => e.type === 'prerequisite' || e.type === 'supports'
  );
  const dependencies = structuralEdges
    .filter((e) => e.from === hubId)
    .map((e) => ({
      id: e.to,
      label: corpus.claims.find((c) => c.id === e.to)?.label || e.to,
      relationship: e.type,
    }));

  if (dependencies.length < 2) return null;

  const cascade = corpus.profiles.cascadeRisks.find((r) => r.sourceId === hubId);
  const cascadeSize = cascade?.dependentIds.length ?? dependencies.length;

  const hubFraction = structuralEdges.length > 0 ? dependencies.length / structuralEdges.length : 0;
  const severity = hubFraction > 0.5 ? 'high' : hubFraction > 0.25 ? 'medium' : 'low';

  return {
    type: 'keystone',
    severity,
    data: {
      keystone: {
        id: keystoneClaim.id,
        label: keystoneClaim.label,
        supportRatio: keystoneClaim.supportRatio,
        dominance: corpus.graph.hubDominance,
        isFragile: keystoneClaim.supporters.length <= 1,
      },
      dependents: dependencies.map((d) => d.id),
      cascadeSize,
    } as any,
  };
};

export const detectChainPattern = (corpus: MeasuredCorpus): SecondaryPattern | null => {
  const chainIds = corpus.graph.longestChain;
  if (chainIds.length < MIN_CHAIN_LENGTH) return null;

  const chain = chainIds
    .map((id) => {
      const claim = corpus.claims.find((c) => c.id === id);
      if (!claim) return null;
      return { id, isWeakLink: claim.supporters.length === 1 };
    })
    .filter(Boolean);

  const ratio = corpus.claims.length > 0 ? chain.length / corpus.claims.length : 0;
  const severity = ratio > 0.5 ? 'high' : ratio > 0.3 ? 'medium' : 'low';

  return {
    type: 'chain',
    severity,
    data: {
      chain: chain.map((step: any) => step.id),
      length: chain.length,
      weakLinks: chain.filter((s: any) => s.isWeakLink).map((s: any) => s.id),
    } as any,
  };
};

export const detectFragilePattern = (
  corpus: MeasuredCorpus,
  salient: EnrichedClaim[]
): SecondaryPattern | null => {
  const fragilities = [];
  for (const claim of salient) {
    const incoming = corpus.edges.filter((e) => e.to === claim.id && e.type === 'prerequisite');
    for (const prereq of incoming) {
      const foundation = corpus.claims.find((c) => c.id === prereq.from);
      if (foundation && foundation.supporters.length < claim.supporters.length) {
        fragilities.push({
          peak: { id: claim.id, label: claim.label },
          weakFoundation: {
            id: foundation.id,
            label: foundation.label,
            supportRatio: foundation.supportRatio,
          },
        });
      }
    }
  }
  if (fragilities.length === 0) return null;
  const severity = fragilities.length > 2 ? 'high' : fragilities.length > 1 ? 'medium' : 'low';
  return { type: 'fragile', severity, data: { fragilities } as any };
};

export const detectChallengedPattern = (
  corpus: MeasuredCorpus,
  salient: EnrichedClaim[],
  peripheral: EnrichedClaim[]
): SecondaryPattern | null => {
  const salientIds = new Set(salient.map((c) => c.id));
  const peripheralIds = new Set(peripheral.map((c) => c.id));
  const challengeEdges = corpus.edges.filter(
    (e) =>
      e.type === 'conflicts' &&
      ((peripheralIds.has(e.from) && salientIds.has(e.to)) ||
        (salientIds.has(e.from) && peripheralIds.has(e.to)))
  );
  if (challengeEdges.length === 0) return null;

  const challenges = challengeEdges
    .map((e) => {
      const from = corpus.claims.find((c) => c.id === e.from);
      const to = corpus.claims.find((c) => c.id === e.to);
      if (!from || !to) return null;
      const [challenger, target] = salientIds.has(from.id) ? [to, from] : [from, to];
      return {
        challenger: {
          id: challenger.id,
          label: challenger.label,
          supportRatio: challenger.supportRatio,
        },
        target: { id: target.id, label: target.label, supportRatio: target.supportRatio },
      };
    })
    .filter(Boolean);

  if (challenges.length === 0) return null;
  const severity = challenges.length > 2 ? 'high' : challenges.length > 1 ? 'medium' : 'low';
  return { type: 'challenged', severity, data: { challenges } as any };
};

export const detectConditionalPattern = (corpus: MeasuredCorpus): SecondaryPattern | null => {
  const conditionalClaims = corpus.claims.filter((c) => {
    const inc = corpus.edges.filter((e) => e.to === c.id && e.type === 'prerequisite');
    return inc.length >= 2;
  });
  if (conditionalClaims.length < 2) return null;
  const conditions = conditionalClaims.map((c) => {
    const branches = corpus.edges
      .filter((e) => e.to === c.id && e.type === 'prerequisite')
      .map((e) => e.from);
    return { id: c.id, label: c.label, branches };
  });
  return {
    type: 'conditional',
    severity: conditions.length > 2 ? 'high' : 'medium',
    data: { conditions } as any,
  };
};

export const detectAllSecondaryPatterns = (
  corpus: MeasuredCorpus,
  salient: EnrichedClaim[],
  peripheral: EnrichedClaim[]
): SecondaryPattern[] => {
  return [
    detectKeystonePattern(corpus),
    detectChainPattern(corpus),
    detectFragilePattern(corpus, salient),
    detectChallengedPattern(corpus, salient, peripheral),
    detectConditionalPattern(corpus),
  ].filter(Boolean) as SecondaryPattern[];
};
