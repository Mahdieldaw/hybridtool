import type { PipelineLayer } from '../../../hooks/instrument/useInstrumentState';

/**
 * Pure function to format layer data for export/copying.
 * extracted from DecisionMapSheet.tsx
 */
export function getLayerCopyText(layer: PipelineLayer, artifact: any): string {
  if (!artifact) return '';
  const ser = (obj: any) => JSON.stringify(obj ?? null, null, 2);
  const safeArr = (v: any): any[] => (Array.isArray(v) ? v : []);

  switch (layer) {
    case 'geometry': {
      const basin = artifact?.geometry?.basinInversion ?? null;
      const sub = artifact?.geometry?.substrate ?? null;
      const nodes = safeArr(sub?.nodes).map((n: any) => ({
        id: n.id,
        mutualRankDegree: n.mutualRankDegree,
        isolationScore: n.isolationScore,
      }));
      return ser({
        pairwiseField: {
          nodeCount: nodes.length,
          pairCount: basin?.pairCount ?? null,
          mu: basin?.mu,
          sigma: basin?.sigma,
          p10: basin?.p10,
          p90: basin?.p90,
          discriminationRange: basin?.discriminationRange,
        },
        basinStructure: {
          status: basin?.status,
          T_v: basin?.T_v,
          basinCount: basin?.basinCount,
          basins: basin?.basins,
          pctHigh: basin?.pctHigh,
          pctValleyZone: basin?.pctValleyZone,
          pctLow: basin?.pctLow,
        },
        mutualGraph: {
          edgeCount: safeArr(sub?.mutualEdges).length,
          nodes,
        },
      });
    }
    case 'query-relevance':
      return ser(artifact?.geometry?.query);
    case 'competitive-provenance':
      return ser({
        claimProvenance: artifact?.claimProvenance,
        statementAllocation: artifact?.statementAllocation,
      });
    case 'provenance-comparison': {
      const saPerClaim: Record<string, any> = artifact?.statementAllocation?.perClaim ?? {};
      const stmtText = new Map<string, string>();
      for (const s of safeArr(artifact?.shadow?.statements)) {
        stmtText.set(String(s.id), String(s.text ?? ''));
      }
      const TOP_N = 10;
      const claims = safeArr(artifact?.semantic?.claims);
      return ser(
        claims.map((claim: any) => {
          const id = String(claim.id);
          const compRows: any[] = safeArr(saPerClaim[id]?.directStatementProvenance);
          return {
            id,
            label: String(claim.label ?? id),
            competitive: [...compRows]
              .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0))
              .slice(0, TOP_N)
              .map((r: any) => ({
                statementId: r.statementId,
                weight: r.weight,
                text: stmtText.get(String(r.statementId)) ?? r.statementId,
              })),
          };
        })
      );
    }
    case 'mixed-provenance':
      return ser(artifact?.mixedProvenance ?? null);
    case 'claim-statements': {
      const claims = safeArr(artifact?.semantic?.claims);
      const stmtText = new Map<string, string>();
      for (const s of safeArr(artifact?.shadow?.statements)) {
        stmtText.set(String(s.id ?? s.statementId ?? s.sid ?? ''), String(s.text ?? ''));
      }
      const ownership = artifact?.claimProvenance?.statementOwnership ?? {};
      const exclusivity = artifact?.claimProvenance?.claimExclusivity ?? {};
      const scClaimed = artifact?.statementClassification?.claimed ?? {};
      return ser(
        claims.map((c: any) => {
          const cid = String(c.id ?? '');
          const exData = exclusivity[cid];
          const exclusiveSet = new Set<string>(
            Array.isArray(exData?.exclusiveIds) ? exData.exclusiveIds.map(String) : []
          );
          const stmtIds: string[] = Array.isArray(c.sourceStatementIds)
            ? c.sourceStatementIds.map(String)
            : [];
          return {
            claimId: cid,
            label: String(c.label ?? cid),
            statements: stmtIds.map((sid) => {
              const owners: string[] = Array.isArray(ownership[sid])
                ? ownership[sid].map(String)
                : [];
              const entry = scClaimed[sid];
              const claimCount = Array.isArray(entry?.claimIds) ? entry.claimIds.length : 0;
              return {
                statementId: sid,
                text: stmtText.get(sid) ?? '',
                exclusive: exclusiveSet.has(sid),
                sharedWith: owners.filter((o: string) => o !== cid),
                fate: claimCount >= 2 ? 'supporting' : claimCount === 1 ? 'primary' : 'unclaimed',
              };
            }),
          };
        })
      );
    }
    case 'blast-radius': {
      const stmtText = new Map<string, string>();
      for (const s of safeArr(artifact?.shadow?.statements)) {
        stmtText.set(String(s.id), String(s.text ?? ''));
      }
      const expandStmtRefs = (value: any): any => {
        if (Array.isArray(value)) return value.map(expandStmtRefs);
        if (!value || typeof value !== 'object') return value;
        const out: any = {};
        for (const [k, v] of Object.entries(value)) {
          const key = String(k);
          const isIdsKey = /statementids/i.test(key);
          const isIdKey = /statementid/i.test(key);
          if (Array.isArray(v) && v.every((x) => typeof x === 'string' || typeof x === 'number')) {
            const ids = (v as any[]).map((x) => String(x));
            const allKnown = ids.length > 0 && ids.every((id) => stmtText.has(id));
            if (isIdsKey || allKnown) {
              out[k] = ids;
              out[`${key}Resolved`] = ids.map((id) => ({ id, text: stmtText.get(id) ?? '' }));
              continue;
            }
          }
          if (typeof v === 'string' || typeof v === 'number') {
            const sid = String(v);
            const known = stmtText.has(sid);
            if (isIdKey || (known && /id$/i.test(key))) {
              out[k] = sid;
              out[`${key}Text`] = stmtText.get(sid) ?? '';
              continue;
            }
          }
          if (isIdsKey && Array.isArray(v)) {
            const ids = (v as any[]).map((id) => String(id));
            out[k] = ids;
            out[`${key}Resolved`] = ids.map((id) => ({ id, text: stmtText.get(id) ?? '' }));
            continue;
          }
          out[k] = expandStmtRefs(v);
        }
        return out;
      };
      return ser({
        blastRadiusFilter: expandStmtRefs(artifact?.blastRadiusFilter),
        blastSurface: expandStmtRefs(artifact?.blastSurface),
        substrateSummary: artifact?.substrateSummary ?? null,
      });
    }
    case 'claim-density':
      return ser({
        claimDensity: artifact?.claimDensity ?? null,
        passageRouting: artifact?.passageRouting ?? null,
        surveyGates: artifact?.surveyGates ?? null,
      });
    case 'stmt-classification': {
      const sc = artifact?.statementClassification ?? null;
      if (!sc) return ser(null);
      const groups = safeArr(sc.unclaimedGroups);
      const claimedEntries = Object.values(sc.claimed ?? {}) as any[];
      return ser({
        summary: sc.summary ?? null,
        claimed: {
          total: claimedEntries.length,
          inPassage: claimedEntries.filter((e: any) => e.inPassage).length,
          outsidePassage: claimedEntries.filter((e: any) => !e.inPassage).length,
          multiClaim: claimedEntries.filter(
            (e: any) => Array.isArray(e.claimIds) && e.claimIds.length > 1
          ).length,
        },
        unclaimedGroups: groups.map((g: any, i: number) => {
          let uc = 0;
          for (const p of safeArr(g.paragraphs)) uc += safeArr(p.unclaimedStatementIds).length;
          return {
            index: i + 1,
            nearestClaimId: g.nearestClaimId ?? null,
            landscape: g.nearestClaimLandscapePosition ?? 'floor',
            paragraphCount: safeArr(g.paragraphs).length,
            unclaimedCount: uc,
            meanClaimSimilarity: g.meanClaimSimilarity ?? 0,
            meanQueryRelevance: g.meanQueryRelevance ?? 0,
            maxQueryRelevance: g.maxQueryRelevance ?? 0,
          };
        }),
      });
    }
    case 'bayesian-basins': {
      const bayesian = artifact?.geometry?.bayesianBasinInversion ?? null;
      const bMeta = bayesian?.meta?.bayesian ?? null;
      return ser({
        summary: {
          status: bayesian?.status,
          nodeCount: bayesian?.nodeCount,
          basinCount: bayesian?.basinCount,
          nodesWithBoundary: bMeta?.nodesWithBoundary,
          boundaryRatio: bMeta?.boundaryRatio,
          mutualInclusionPairs: bMeta?.mutualInclusionPairs,
          medianBoundarySim: bMeta?.medianBoundarySim,
          concentration: bMeta?.concentration,
          processingTimeMs: bayesian?.meta?.processingTimeMs,
        },
        basins: safeArr(bayesian?.basins).map((b: any) => ({
          basinId: b.basinId,
          size: Array.isArray(b.nodeIds) ? b.nodeIds.length : 0,
          trenchDepth: b.trenchDepth,
        })),
        profiles: safeArr(bMeta?.profiles).map((p: any) => ({
          nodeId: p.nodeId,
          changePoint: p.changePoint,
          boundarySim: p.boundarySim,
          logBayesFactor: p.logBayesFactor,
          posteriorConcentration: p.posteriorConcentration,
          inGroupSize: p.inGroupSize,
          totalPeers: p.totalPeers,
        })),
        globalField: {
          mu: bayesian?.mu,
          sigma: bayesian?.sigma,
          p10: bayesian?.p10,
          p90: bayesian?.p90,
          discriminationRange: bayesian?.discriminationRange,
          T_v: bayesian?.T_v,
        },
      });
    }
    case 'regions': {
      const ps = artifact?.geometry?.preSemantic;
      const regions = safeArr(ps?.regions || ps?.regionization?.regions);
      return ser({
        count: regions.length,
        regions: regions.map((r: any) => ({
          id: r.id,
          kind: r.kind,
          nodeCount: safeArr(r.nodeIds).length,
        })),
      });
    }
    case 'periphery': {
      const diag = artifact?.passageRouting?.routing?.diagnostics;
      const actualExcludedIds = new Set(safeArr(diag?.peripheralNodeIds));
      const paragraphs = safeArr(artifact?.shadow?.paragraphs);

      const basins = safeArr(artifact?.geometry?.basinInversion?.basins);
      let largestBasinId = null;
      if (basins.length > 0) {
        let best = basins[0];
        for (const b of basins) {
          if ((b.nodeIds?.length ?? 0) > (best.nodeIds?.length ?? 0)) best = b;
        }
        largestBasinId = best.basinId;
      }

      const regions =
        artifact?.geometry?.preSemantic?.regions ||
        artifact?.geometry?.preSemantic?.regionization?.regions ||
        [];
      const gapSingletons = new Set(
        safeArr(regions)
          .filter((r: any) => r.kind === 'gap' && safeArr(r.nodeIds).length === 1)
          .map((r: any) => String(r.nodeIds[0]))
      );

      // Exhaustive list for diagnostic mapping
      const allOutlierIds = new Set<string>();
      basins
        .filter((b) => b.basinId !== largestBasinId)
        .forEach((b) => safeArr(b.nodeIds).forEach((id) => allOutlierIds.add(String(id))));
      gapSingletons.forEach((id) => allOutlierIds.add(id));

      const basinByNodeId = diag?.basinByNodeId ?? {};

      const mapped = Array.from(allOutlierIds).map((id) => {
        const p = paragraphs.find((x) => String(x.id) === id);
        const bid = basinByNodeId[id];
        const isBasin = bid != null && bid !== largestBasinId;
        const isGap = gapSingletons.has(id);
        const excluded = actualExcludedIds.has(id);

        const types = [];
        if (isBasin) types.push('Basin Outlier');
        if (isGap) types.push('Region Outlier (Gap)');

        return {
          id,
          index: p?.paragraphIndex,
          status: excluded ? 'Excluded' : 'Core Protected',
          type: types.join(' & '),
          origin: bid != null ? `basin b_${bid}` : 'gap singleton',
          text: p?._fullParagraph || p?.text || '',
        };
      });

      return ser({
        corpusMode: diag?.corpusMode,
        peripheralRatio: diag?.peripheralRatio,
        actualExcludedCount: actualExcludedIds.size,
        totalPotentialOutliers: allOutlierIds.size,
        nodes: mapped,
      });
    }
    case 'raw-artifacts':
      return ser(artifact);
    default:
      return ser(artifact);
  }
}
