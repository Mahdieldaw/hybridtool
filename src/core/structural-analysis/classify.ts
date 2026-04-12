//(Responsibility: Structure isolation and iterative distribution evaluation)

import { EnrichedClaim, Edge, StructureLayer } from '../../../shared/contract';
import { MeasuredCorpus } from './measure';
/** Minimum prerequisite-chain length to qualify for chain pattern detection */
export const MIN_CHAIN_LENGTH = 3;

export interface DistributionAnalysis {
  claims: EnrichedClaim[];
  kValues: number[];
  meanK: number;
  totalMass: number;
  salient: EnrichedClaim[];
  peripheral: EnrichedClaim[];
}

export const analyzeDistribution = (claims: EnrichedClaim[]): DistributionAnalysis => {
  const kValues = claims.map((c) => c.supporters.length);
  const totalMass = kValues.reduce((sum, k) => sum + k, 0);
  const meanK = claims.length > 0 ? totalMass / claims.length : 0;

  const salient = claims
    .filter((c) => c.supporters.length > meanK)
    .sort((a, b) => b.supporters.length - a.supporters.length);
  const peripheral = claims.filter((c) => c.supporters.length <= meanK);

  return { claims, kValues, meanK, totalMass, salient, peripheral };
};

export const finalizeInteractionProfiles = (
  corpus: MeasuredCorpus,
  globalDist: DistributionAnalysis
) => {
  // Claims are fully constructed by measureCorpus (isSalient, isHighSupport, isKeystone,
  // hubDominance are all baked in). Only profile objects need patching here.
  const salientIds = new Set(globalDist.salient.map((c) => c.id));

  corpus.profiles.conflictInfos.forEach((ci: any) => {
    const aSal = salientIds.has(ci.claimA.id);
    const bSal = salientIds.has(ci.claimB.id);
    ci.claimA.isSalient = aSal;
    ci.claimB.isSalient = bSal;
    ci.isBothSalient = aSal && bSal;
    ci.isBothHighSupport = ci.isBothSalient; // Backwards contract safety
    ci.isHighVsLow = (aSal && !bSal) || (!aSal && bSal);

    const aKey = corpus.claims.find((c) => c.id === ci.claimA.id)?.isKeystone;
    const bKey = corpus.claims.find((c) => c.id === ci.claimB.id)?.isKeystone;
    ci.involvesKeystone = !!(aKey || bKey);
  });

  corpus.profiles.conflicts.forEach((c: any) => {
    c.isBothConsensus = salientIds.has(c.claimA.id) && salientIds.has(c.claimB.id);
  });

  corpus.profiles.tradeoffs.forEach((t: any) => {
    const aSal = salientIds.has(t.claimA.id);
    const bSal = salientIds.has(t.claimB.id);
    t.symmetry = aSal && bSal ? 'both_consensus' : !aSal && !bSal ? 'both_singular' : 'asymmetric';
  });
};

export const detectShape = (
  dist: DistributionAnalysis,
  edges: Edge[],
  totalModelCount?: number
): StructureLayer => {
  const { salient, totalMass, claims } = dist;
  const salientIds = new Set(salient.map((c) => c.id));
  const modelCount = totalModelCount ?? 0;

  const salientEdges = edges.filter(
    (e) => e.from !== e.to && salientIds.has(e.from) && salientIds.has(e.to)
  );
  const salientConflicts = salientEdges.filter((e) => e.type === 'conflicts');
  const salientTradeoffs = salientEdges.filter((e) => e.type === 'tradeoff');
  const salientSupports = salientEdges.filter(
    (e) => e.type === 'supports' || e.type === 'prerequisite'
  );

  if (salientConflicts.length > 0) {
    const best = salientConflicts
      .map((e) => ({
        edge: e,
        a: salient.find((c) => c.id === e.from)!,
        b: salient.find((c) => c.id === e.to)!,
        energy:
          salient.find((c) => c.id === e.from)!.supporters.length +
          salient.find((c) => c.id === e.to)!.supporters.length,
      }))
      .sort((x, y) => y.energy - x.energy)[0];

    const coverage = totalMass > 0 ? best.energy / totalMass : 0;
    const [highClaim, lowClaim] =
      best.a.supporters.length >= best.b.supporters.length ? [best.a, best.b] : [best.b, best.a];
    const causalClaimIds = [highClaim.id, lowClaim.id];

    // Compute involvedModelCount from causal claims
    const involvedSet = new Set<number>();
    for (const id of causalClaimIds) {
      dist.claims.find((c) => c.id === id)?.supporters.forEach((s) => involvedSet.add(s));
    }

    return {
      primary: 'forked',
      causalClaimIds,
      coverage,
      evidence: [
        `Conflict between "${highClaim.label}" (${highClaim.supporters.length} models) and "${lowClaim.label}" (${lowClaim.supporters.length} models)`,
        `Coverage: ${(coverage * 100).toFixed(0)}% of layer attention`,
      ],
      involvedModelCount: involvedSet.size,
      totalModelCount: modelCount,
      claimASupportCount: highClaim.supporters.length,
      claimBSupportCount: lowClaim.supporters.length,
    };
  }

  if (salientTradeoffs.length > 0) {
    const best = salientTradeoffs
      .map((e) => ({
        edge: e,
        a: salient.find((c) => c.id === e.from)!,
        b: salient.find((c) => c.id === e.to)!,
        energy:
          salient.find((c) => c.id === e.from)!.supporters.length +
          salient.find((c) => c.id === e.to)!.supporters.length,
      }))
      .sort((x, y) => y.energy - x.energy)[0];

    const coverage = totalMass > 0 ? best.energy / totalMass : 0;
    const causalClaimIds = [best.a.id, best.b.id];

    // Compute involvedModelCount from causal claims
    const involvedSet = new Set<number>();
    for (const id of causalClaimIds) {
      dist.claims.find((c) => c.id === id)?.supporters.forEach((s) => involvedSet.add(s));
    }

    return {
      primary: 'constrained',
      causalClaimIds,
      coverage,
      evidence: [
        `Tradeoff between "${best.a.label}" (${best.a.supporters.length} models) and "${best.b.label}" (${best.b.supporters.length} models)`,
        `Coverage: ${(coverage * 100).toFixed(0)}% of layer attention`,
      ],
      involvedModelCount: involvedSet.size,
      totalModelCount: modelCount,
    };
  }

  if (salient.length === 1) {
    const top = salient[0];
    const coverage = totalMass > 0 ? top.supporters.length / totalMass : 0;
    const causalClaimIds = [top.id];

    // Compute involvedModelCount from causal claims
    const involvedSet = new Set<number>();
    for (const id of causalClaimIds) {
      dist.claims.find((c) => c.id === id)?.supporters.forEach((s) => involvedSet.add(s));
    }

    return {
      primary: 'convergent',
      causalClaimIds,
      coverage,
      evidence: [
        `"${top.label}" concentrates model attention (${top.supporters.length} models)`,
        `Coverage: ${(coverage * 100).toFixed(0)}% of layer attention`,
      ],
      involvedModelCount: involvedSet.size,
      totalModelCount: modelCount,
    };
  }

  if (salient.length > 1 && salientSupports.length > 0) {
    const connectedSalientIds = new Set<string>();
    salientSupports.forEach((e) => {
      connectedSalientIds.add(e.from);
      connectedSalientIds.add(e.to);
    });
    const causalClaimIds = Array.from(connectedSalientIds);
    const causalMass = causalClaimIds.reduce(
      (sum, id) => sum + (salient.find((c) => c.id === id)?.supporters.length || 0),
      0
    );
    const coverage = totalMass > 0 ? causalMass / totalMass : 0;
    const top = salient.find((c) => c.id === causalClaimIds[0]) || salient[0];

    // Compute involvedModelCount from causal claims
    const involvedSet = new Set<number>();
    for (const id of causalClaimIds) {
      dist.claims.find((c) => c.id === id)?.supporters.forEach((s) => involvedSet.add(s));
    }

    return {
      primary: 'convergent',
      causalClaimIds,
      coverage,
      evidence: [
        `${causalClaimIds.length} salient claims form a reinforcing cluster`,
        `"${top.label}" leads with ${top.supporters.length} models`,
        `Coverage: ${(coverage * 100).toFixed(0)}% of layer attention`,
      ],
      involvedModelCount: involvedSet.size,
      totalModelCount: modelCount,
    };
  }

  if (salient.length > 1) {
    const salientMass = salient.reduce((s, c) => s + c.supporters.length, 0);
    const coverage = totalMass > 0 ? salientMass / totalMass : 0;
    const causalClaimIds = salient.map((c) => c.id);

    // Compute involvedModelCount from causal claims
    const involvedSet = new Set<number>();
    for (const id of causalClaimIds) {
      dist.claims.find((c) => c.id === id)?.supporters.forEach((s) => involvedSet.add(s));
    }

    return {
      primary: 'parallel',
      causalClaimIds,
      coverage,
      evidence: [
        `${salient.length} independently salient claims with no tension edges between them`,
        `Coverage: ${(coverage * 100).toFixed(0)}% of layer attention`,
      ],
      involvedModelCount: involvedSet.size,
      totalModelCount: modelCount,
    };
  }

  const top =
    claims.length > 0
      ? [...claims].sort((a, b) => b.supporters.length - a.supporters.length)[0]
      : null;
  return {
    primary: 'sparse',
    causalClaimIds: [],
    coverage: 0,
    evidence: top
      ? [
          `Flat distribution — no claim separates from the pack`,
          `"${top.label}" has a slight edge (${top.supporters.length} models)`,
        ]
      : [`No claims to analyze`],
    involvedModelCount: 0,
    totalModelCount: modelCount,
  };
};

export const computeLayers = (corpus: MeasuredCorpus): StructureLayer[] => {
  const layers: StructureLayer[] = [];
  let currentClaims = [...corpus.claims];

  while (currentClaims.length >= 2) {
    const totalMass = currentClaims.reduce((sum, c) => sum + c.supporters.length, 0);
    if (totalMass === 0) break;

    const dist = analyzeDistribution(currentClaims);
    const layer = detectShape(dist, corpus.edges, corpus.stats.modelCount);

    if (layer.primary === 'sparse') {
      if (layers.length === 0) layers.push(layer);
      break;
    }

    if (layers.length > 0) {
      const prev = layers[layers.length - 1];
      if (prev.primary === layer.primary && layer.coverage < 1 / currentClaims.length) break;
    }

    if (layer.causalClaimIds.length === 0) break;

    layers.push(layer);
    const causalSet = new Set(layer.causalClaimIds);
    currentClaims = currentClaims.filter((c) => !causalSet.has(c.id));
  }

  return layers;
};
