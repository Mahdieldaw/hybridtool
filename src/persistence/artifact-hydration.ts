export function dehydrateArtifact(fullArtifact: any): any {
  if (!fullArtifact || typeof fullArtifact !== "object") return fullArtifact;

  const artifact = fullArtifact as any;
  const out: any = { ...artifact };

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

      return cc;
    });
  };

  if (artifact?.semantic && typeof artifact.semantic === "object") {
    const semantic = artifact.semantic as any;
    const claims = Array.isArray(semantic.claims) ? semantic.claims : null;
    if (claims) {
      out.semantic = { ...semantic, claims: stripClaimDupes(claims) };
    }
  }

  if (Array.isArray(artifact?.claims)) {
    out.claims = stripClaimDupes(artifact.claims);
  }

  if (artifact?.geometry && typeof artifact.geometry === "object") {
    const geometry = artifact.geometry as any;
    const substrate = geometry.substrate;
    if (substrate && typeof substrate === "object" && !Array.isArray(substrate)) {
      const nextSubstrate: any = { ...substrate };
      if (nextSubstrate.allPairwiseSimilarities !== undefined) {
        delete nextSubstrate.allPairwiseSimilarities;
      }
      out.geometry = { ...geometry, substrate: nextSubstrate };
    }
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

  const hydrateClaims = (claims: any[]): any[] => {
    return (claims || []).map((c) => {
      if (!c || typeof c !== "object") return c;
      const cc: any = { ...c };
      const ids = Array.isArray(cc.sourceStatementIds) ? cc.sourceStatementIds : [];
      if (!Array.isArray(cc.sourceStatements) && ids.length > 0 && statementLookup) {
        const statements = ids
          .map((id: any) => statementLookup.get(String(id)))
          .filter((x: any) => x != null);
        if (statements.length > 0) cc.sourceStatements = statements;
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

