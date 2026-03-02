export function dehydrateArtifact(fullArtifact: any): any {
  if (!fullArtifact || typeof fullArtifact !== "object") return fullArtifact;

  const artifact = fullArtifact as any;
  const out: any = { ...artifact };

  for (const k of [
    "blastRadiusFilter",
    "completeness",
    "traversal",
    "traversalAnalysis",
    "traversalGraph",
    "forcingPoints",
    "pipelineGate",
    "modelOrdering",
    "regionProfiles",
    "regionization",
    "shapeSignals",
    "statementScores",
    "preSemantic",
    "basinInversion",
    "surveyRationale",
    "surveyGates",
    "statementAllocation",
    "continuousField",
  ]) {
    if (out[k] !== undefined) delete out[k];
  }

  const stripClaimDupes = (claims: any[]): any[] => {
    return (claims || []).map((c) => {
      if (!c || typeof c !== "object") return c;
      const cc: any = { ...c };

      if (cc.sourceStatements !== undefined) {
        const existingIds = Array.isArray(cc.sourceStatementIds) ? cc.sourceStatementIds : [];
        if (existingIds.length === 0 && Array.isArray(cc.sourceStatements)) {
          const ids = cc.sourceStatements
            .map((s: any) => s?.id ?? s?.statementId ?? s?.sid ?? null)
            .filter((x: any) => x != null && String(x).trim().length > 0)
            .map((x: any) => String(x));
          if (ids.length > 0) cc.sourceStatementIds = ids;
        }
        delete cc.sourceStatements;
      }

      if (cc.sourceRegions !== undefined) {
        const existingIds = Array.isArray(cc.sourceRegionIds) ? cc.sourceRegionIds : [];
        if (existingIds.length === 0 && Array.isArray(cc.sourceRegions)) {
          const ids = cc.sourceRegions
            .map((r: any) => r?.id ?? r?.regionId ?? null)
            .filter((x: any) => x != null && String(x).trim().length > 0)
            .map((x: any) => String(x));
          if (ids.length > 0) cc.sourceRegionIds = ids;
        }
        delete cc.sourceRegions;
      }

      if (cc.provenanceWeights !== undefined) delete cc.provenanceWeights; // legacy: was a Map, didn't serialize — stripped for cleanliness
      return cc;
    });
  };

  if (artifact?.semantic && typeof artifact.semantic === "object") {
    const semantic = artifact.semantic as any;
    const claims = Array.isArray(semantic.claims) ? semantic.claims : null;
    if (claims) {
      const nextSemantic: any = { ...semantic, claims: stripClaimDupes(claims) };
      if (nextSemantic.claimProvenance !== undefined) delete nextSemantic.claimProvenance;
      out.semantic = nextSemantic;
    }
  }

  if (Array.isArray(artifact?.claims)) {
    out.claims = stripClaimDupes(artifact.claims);
  }

  if (artifact?.geometry && typeof artifact.geometry === "object") {
    const geometry = artifact.geometry as any;
    const nextGeometry: any = { ...geometry };
    for (const k of ["diagnostics", "query", "preSemantic", "basinInversion", "statementScores", "shapeSignals"]) {
      if (nextGeometry[k] !== undefined) delete nextGeometry[k];
    }
    if (nextGeometry.substrate !== undefined) delete nextGeometry.substrate;
    out.geometry = nextGeometry;
  }

  if (artifact?.shadow && typeof artifact.shadow === "object") {
    out.shadow = {};
  }

  return out;
}

export function hydrateArtifact(dehydratedArtifact: any): any {
  if (!dehydratedArtifact || typeof dehydratedArtifact !== "object") return dehydratedArtifact;

  const artifact = dehydratedArtifact as any;
  const out: any = { ...artifact };

  const rawStatements = artifact?.shadow?.statements;
  const statementLookup = (() => {
    if (Array.isArray(rawStatements)) {
      const m = new Map<string, any>();
      for (const s of rawStatements) {
        const id = String(s?.id ?? s?.statementId ?? s?.sid ?? "").trim();
        if (!id) continue;
        if (!m.has(id)) m.set(id, s);
      }
      return m;
    }
    if (rawStatements && typeof rawStatements === "object") {
      const m = new Map<string, any>();
      for (const [k, v] of Object.entries(rawStatements)) {
        const id = String(k || "").trim();
        if (!id) continue;
        if (!m.has(id)) m.set(id, v);
      }
      return m;
    }
    return null;
  })();

  const rawRegions = artifact?.shadow?.regions;
  const regionLookup = (() => {
    if (Array.isArray(rawRegions)) {
      const m = new Map<string, any>();
      for (const r of rawRegions) {
        const id = String(r?.id ?? r?.regionId ?? "").trim();
        if (!id) continue;
        if (!m.has(id)) m.set(id, r);
      }
      return m;
    }
    return null;
  })();

  const hydrateClaims = (claims: any[]): any[] => {
    return (claims || []).map((c) => {
      if (!c || typeof c !== "object") return c;
      const cc: any = { ...c };

      // Hydrate statements
      const sIds = Array.isArray(cc.sourceStatementIds) ? cc.sourceStatementIds : [];
      if (!Array.isArray(cc.sourceStatements) && sIds.length > 0 && statementLookup) {
        const statements = sIds
          .map((id: any) => statementLookup.get(String(id)))
          .filter((x: any) => x != null);
        if (statements.length > 0) cc.sourceStatements = statements;
      }

      // Hydrate regions
      const rIds = Array.isArray(cc.sourceRegionIds) ? cc.sourceRegionIds : [];
      if (!Array.isArray(cc.sourceRegions) && rIds.length > 0 && regionLookup) {
        const regions = rIds
          .map((id: any) => regionLookup.get(String(id)))
          .filter((x: any) => x != null);
        if (regions.length > 0) cc.sourceRegions = regions;
      }

      return cc;
    });
  };

  if (artifact?.semantic && typeof artifact.semantic === "object") {
    const semantic = artifact.semantic as any;
    const claims = Array.isArray(semantic.claims) ? semantic.claims : null;
    if (claims) {
      out.semantic = { ...semantic, claims: hydrateClaims(claims) };
    }
  }

  if (Array.isArray(artifact?.claims)) {
    out.claims = hydrateClaims(artifact.claims);
  }

  return out;
}

