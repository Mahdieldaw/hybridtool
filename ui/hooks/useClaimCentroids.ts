import { useMemo } from "react";
import type { PipelineSubstrateGraph } from "../../shared/contract";

export interface ClaimCentroid {
  claimId: string;
  label: string;
  x: number;
  y: number;
  hasPosition: boolean;
  sourceParagraphIds: string[];
  sourceStatementIds: string[];
  supporters: (string | number)[];
  provenanceBulk: number | null;
  role: string;
  type: string;
}

export function useClaimCentroids(
  claims: any[] | null | undefined,
  substrate: PipelineSubstrateGraph | null | undefined,
): ClaimCentroid[] {
  return useMemo(() => {
    if (!claims || !substrate?.nodes?.length) return [];

    // Build statementId → paragraphId + position from substrate nodes
    const stmtToPara = new Map<string, string>();
    const paraPosition = new Map<string, { x: number; y: number }>();

    for (const node of substrate.nodes) {
      const pid = String(node?.paragraphId ?? "").trim();
      if (!pid) continue;
      const x = Number(node?.x);
      const y = Number(node?.y);
      if (Number.isFinite(x) && Number.isFinite(y)) {
        paraPosition.set(pid, { x, y });
      }
      for (const sid of node?.statementIds ?? []) {
        if (sid) stmtToPara.set(String(sid), pid);
      }
    }

    const out: ClaimCentroid[] = [];
    for (const claim of claims) {
      const stmtIds: string[] = Array.isArray(claim.sourceStatementIds) ? claim.sourceStatementIds : [];
      const paraIds = stmtIds
        .map((sid: string) => stmtToPara.get(String(sid)))
        .filter((pid): pid is string => !!pid);
      const unique = Array.from(new Set(paraIds));

      let sumX = 0, sumY = 0, count = 0;
      for (const pid of unique) {
        const pos = paraPosition.get(pid);
        if (!pos) continue;
        sumX += pos.x;
        sumY += pos.y;
        count++;
      }

      out.push({
        claimId: String(claim.id ?? ""),
        label: String(claim.label ?? claim.id ?? ""),
        x: count > 0 ? sumX / count : 0,
        y: count > 0 ? sumY / count : 0,
        hasPosition: count > 0,
        sourceParagraphIds: unique,
        sourceStatementIds: stmtIds.map(String),
        supporters: Array.isArray(claim.supporters) ? claim.supporters : [],
        provenanceBulk: typeof claim.provenanceBulk === "number" ? claim.provenanceBulk : null,
        role: String(claim.role ?? ""),
        type: String(claim.type ?? ""),
      });
    }
    return out;
  }, [claims, substrate]);
}
