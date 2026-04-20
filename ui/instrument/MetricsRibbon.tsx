import React, { useState, useMemo } from 'react';
import {
  StructuralAnalysis,
  ProblemStructure,
  MapperArtifact,
  PassageRoutingResult,
  PassageClaimProfile,
  ValidatedConflict,
  StructureLayer,
} from '../../shared/types'; // StructureLayer now properly exported
import { StructuralSummary } from './StructuralSummary';

interface MetricsRibbonProps {
  artifact?: MapperArtifact;
  analysis?: StructuralAnalysis;
  problemStructure?: ProblemStructure;
}

/** Agreement indicator: emerald check or amber warning */
const Agree: React.FC<{ agree: boolean }> = ({ agree }) => (
  <span className={agree ? 'text-emerald-400/70' : 'text-amber-400/70'}>{agree ? '✓' : '⚠'}</span>
);

/** A single dim/value pair like "mapper 2" */
const DualCell: React.FC<{ dim: string; value: React.ReactNode }> = ({ dim, value }) => (
  <div className="flex items-center gap-1.5">
    <span className="text-text-muted/50">{dim}</span>
    <span className="text-text-primary">{value}</span>
  </div>
);

/** A labeled row with flex-wrap children and optional agreement indicator */
const DualRow: React.FC<{
  label: string;
  agree?: boolean | null;
  children: React.ReactNode;
}> = ({ label, agree, children }) => (
  <div className="min-w-0">
    <div className="text-text-secondary text-xs mb-1.5">{label}</div>
    <div className="flex items-center gap-3 flex-wrap text-xs min-w-0">
      {children}
      {agree !== null && agree !== undefined && <Agree agree={agree} />}
    </div>
  </div>
);

/** Extract geometric data from the artifact (auto-forwarded, not typed on MapperArtifact) */
function extractGeometric(artifact?: MapperArtifact) {
  const a = artifact as any;
  const passageRouting: PassageRoutingResult | undefined = a?.passageRouting ?? undefined;
  const validatedConflicts: ValidatedConflict[] | undefined = a?.conflictValidation ?? undefined;
  const preSemantic = a?.geometry?.preSemantic ?? undefined;
  return { passageRouting, validatedConflicts, preSemantic };
}

function computeDualSignals(analysis: StructuralAnalysis, artifact?: MapperArtifact) {
  const { passageRouting, validatedConflicts, preSemantic } = extractGeometric(artifact);
  const claims = analysis.claimsWithLeverage;
  const claimMap = new Map(claims.map((c) => [c.id, c]));

  // 1. Conflicts — mapper vs geometry
  const structConflicts =
    (analysis.patterns.conflicts?.length ?? 0) + (analysis.patterns.tradeoffs?.length ?? 0);
  const geoValidated = validatedConflicts?.filter((c) => c.validated);
  const geoConflicts = geoValidated?.length ?? null;
  const geoOnly = geoValidated?.filter((c) => !c.mapperLabeledConflict).length ?? null;
  const mapperOnly = validatedConflicts
    ? validatedConflicts.filter((c) => c.mapperLabeledConflict && !c.validated).length
    : null;
  const conflictsAgree =
    geoConflicts !== null
      ? (structConflicts === 0 && geoConflicts === 0) || (structConflicts > 0 && geoConflicts > 0)
      : null;

  // 2. Consensus shape — support ratio vs passage spread
  const totalClaims = claims.length;
  const highSupportCount = claims.filter((c) => c.isHighSupport).length;
  const highSupportPct = totalClaims > 0 ? Math.round((highSupportCount / totalClaims) * 100) : 0;

  let passageBacked: number | null = null;
  let passageWeak: number | null = null;
  if (passageRouting) {
    const profiles = Object.values(passageRouting.claimProfiles) as PassageClaimProfile[];
    passageBacked = profiles.filter(
      (p) => p.landscapePosition === 'northStar' || p.landscapePosition === 'mechanism'
    ).length;
    passageWeak = profiles.filter(
      (p) => p.landscapePosition === 'eastStar' || p.landscapePosition === 'floor'
    ).length;
  }

  // 3. Hub / load-bearing — graph topology vs passage concentration
  const graph = analysis.graph;
  const hubId = graph?.hubClaim ?? null;
  const hubLabel = hubId ? (claimMap.get(hubId)?.label ?? hubId) : null;
  const hubZ = graph?.hubDominance ?? null;

  let geoHubId: string | null = null;
  let geoHubLabel: string | null = null;
  let geoHubConcentration: number | null = null;
  if (passageRouting) {
    let maxConc = -1;
    for (const [id, profile] of Object.entries(passageRouting.claimProfiles)) {
      const p = profile as PassageClaimProfile;
      if (p.concentrationRatio > maxConc) {
        maxConc = p.concentrationRatio;
        geoHubId = id;
        geoHubConcentration = p.concentrationRatio;
      }
    }
    if (geoHubId) {
      geoHubLabel = claimMap.get(geoHubId)?.label ?? geoHubId;
    }
  }
  const hubAgree = hubId !== null && geoHubId !== null ? hubId === geoHubId : null;

  // 4. Fragmentation — graph components vs geometric regions
  const componentCount = graph?.componentCount ?? null;
  const regionCount = preSemantic?.regions?.length ?? null;

  return {
    structConflicts,
    geoConflicts,
    geoOnly,
    mapperOnly,
    conflictsAgree,
    highSupportPct,
    highSupportCount,
    passageBacked,
    passageWeak,
    hubId,
    hubLabel,
    hubZ,
    geoHubId,
    geoHubLabel,
    geoHubConcentration,
    hubAgree,
    componentCount,
    regionCount,
  };
}

export const MetricsRibbon: React.FC<MetricsRibbonProps> = ({
  artifact,
  analysis,
  problemStructure,
}) => {
  const [showDetails, setShowDetails] = useState(false);

  const dual = useMemo(
    () => (analysis ? computeDualSignals(analysis, artifact) : null),
    [analysis, artifact]
  );

  if (!analysis || !dual) return null;

  const substrate = artifact?.substrate;
  const paragraphProjection = artifact?.paragraphProjection;

  const hasAnyGeo =
    dual.geoConflicts !== null ||
    dual.passageBacked !== null ||
    dual.geoHubId !== null ||
    dual.regionCount !== null;

  return (
    <div className="bg-surface-raised border border-border-subtle rounded-lg px-4 py-3 h-full">
      {/* Structure type */}
      <div className="flex items-center gap-3 mb-3">
        {problemStructure && (
          <span className="text-xs font-medium text-brand-400 capitalize">
            {problemStructure.primary} structure
          </span>
        )}

        <div className="flex-1" />

        <button
          onClick={() => setShowDetails(!showDetails)}
          className="text-[10px] text-text-muted hover:text-text-primary"
        >
          {showDetails ? 'hide details' : 'show details'}
        </button>
      </div>

      {/* Structural summary lines — now receives layers array */}
      <StructuralSummary
        analysis={analysis}
        problemStructure={problemStructure}
        layers={analysis.layers}
      />

      {/* Expandable details */}
      {showDetails && (
        <div className="mt-4 pt-3 border-t border-border-subtle text-xs text-text-muted space-y-2">
          {problemStructure?.evidence && (
            <div>
              <span className="text-text-secondary">Evidence:</span>
              <ul className="mt-1 space-y-0.5 text-[11px]">
                {problemStructure.evidence.slice(0, 5).map((e, idx) => (
                  <li key={`${e}-${idx}`}>• {e}</li>
                ))}
              </ul>
            </div>
          )}
          {analysis.layers && analysis.layers.length > 1 && (
            <div>
              <span className="text-text-secondary">Layers:</span>
              <ul className="mt-1 space-y-0.5 text-[11px]">
                {analysis.layers.map((layer: StructureLayer, i: number) => (
                  <li key={i}>
                    {i + 1}. {layer.primary} ({layer.involvedModelCount} models)
                  </li>
                ))}
              </ul>
            </div>
          )}
          {paragraphProjection && (
            <div>
              <span className="text-text-secondary">Paragraphs:</span>{' '}
              {paragraphProjection.totalParagraphs} ({paragraphProjection.contestedCount} contested)
            </div>
          )}
          {substrate && (
            <div>
              <span className="text-text-secondary">Substrate:</span> {substrate.meta.nodeCount}{' '}
              nodes · {substrate.meta.embeddingBackend}
            </div>
          )}
          {/* Dual-signal instrumentation */}
          {hasAnyGeo && (
            <div className="mt-4 pt-3 border-t border-border-subtle space-y-3 min-w-0 overflow-hidden">
              <div className="text-[10px] text-text-muted/50 uppercase tracking-widest">
                Mapper vs Geometry
              </div>

              {/* Conflicts */}
              <DualRow label="Conflicts" agree={dual.conflictsAgree}>
                <DualCell dim="mapper" value={dual.structConflicts} />
                <DualCell dim="geometry" value={dual.geoConflicts ?? '—'} />
                {dual.geoOnly != null && dual.geoOnly > 0 && (
                  <span className="text-[10px] text-amber-400/70">{dual.geoOnly} geo-only</span>
                )}
                {dual.mapperOnly != null && dual.mapperOnly > 0 && (
                  <span className="text-[10px] text-amber-400/70">
                    {dual.mapperOnly} mapper-only
                  </span>
                )}
              </DualRow>

              {/* Consensus */}
              <DualRow label="Consensus">
                <DualCell dim="high-support" value={`${dual.highSupportPct}%`} />
                {dual.passageBacked !== null ? (
                  <>
                    <DualCell dim="passage-backed" value={dual.passageBacked} />
                    <DualCell dim="weak" value={dual.passageWeak} />
                  </>
                ) : (
                  <span className="text-[10px] text-text-muted/40">no passage data</span>
                )}
              </DualRow>

              {/* Hub */}
              <div className="min-w-0">
                <div className="text-text-secondary text-xs mb-1.5">Hub</div>
                <div className="space-y-1.5 text-xs min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-text-muted/50 shrink-0 w-14">graph</span>
                    {dual.hubLabel ? (
                      <>
                        <span className="text-text-primary truncate min-w-0" title={dual.hubLabel}>
                          {dual.hubLabel}
                        </span>
                        <span className="text-text-muted/40 shrink-0">
                          z={dual.hubZ?.toFixed(1)}
                        </span>
                      </>
                    ) : (
                      <span className="text-text-muted/40">none</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-text-muted/50 shrink-0 w-14">geometry</span>
                    {dual.geoHubId !== null ? (
                      <>
                        <span
                          className="text-text-primary truncate min-w-0"
                          title={dual.geoHubLabel ?? undefined}
                        >
                          {dual.geoHubLabel}
                        </span>
                        {dual.geoHubConcentration !== null && (
                          <span className="text-text-muted/40 shrink-0">
                            c={dual.geoHubConcentration.toFixed(2)}
                          </span>
                        )}
                        {dual.hubAgree !== null && (
                          <span className="shrink-0">
                            <Agree agree={dual.hubAgree} />
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-text-muted/40">—</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Fragmentation */}
              <DualRow label="Fragmentation">
                <DualCell dim="components" value={dual.componentCount ?? '—'} />
                <DualCell dim="regions" value={dual.regionCount ?? '—'} />
              </DualRow>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default MetricsRibbon;
