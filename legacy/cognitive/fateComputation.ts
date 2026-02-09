export type ParagraphFate = 'protected' | 'skeleton' | 'orphan' | 'mixed' | 'removed';

export function computeParagraphFates(
  paragraphs: Array<{ id: string; statementIds: string[] }>,
  claims: Array<{ id: string; sourceStatementIds?: string[] }>,
  claimStatuses: Map<string, 'active' | 'pruned'>,
): Map<string, ParagraphFate> {
  const statementToClaimIds = new Map<string, string[]>();
  for (const c of claims) {
    const sids = Array.isArray(c.sourceStatementIds) ? c.sourceStatementIds : [];
    for (const sid of sids) {
      const key = String(sid || '').trim();
      if (!key) continue;
      const arr = statementToClaimIds.get(key);
      if (arr) arr.push(c.id);
      else statementToClaimIds.set(key, [c.id]);
    }
  }

  const out = new Map<string, ParagraphFate>();

  for (const p of paragraphs) {
    const claimIds = new Set<string>();
    for (const sid of p.statementIds || []) {
      const key = String(sid || '').trim();
      if (!key) continue;
      for (const cid of statementToClaimIds.get(key) || []) {
        claimIds.add(cid);
      }
    }

    if (claimIds.size === 0) {
      out.set(p.id, 'orphan');
      continue;
    }

    let activeCount = 0;
    let prunedCount = 0;
    let unknownCount = 0;

    for (const cid of claimIds) {
      const status = claimStatuses.get(cid);
      if (status === 'active') activeCount++;
      else if (status === 'pruned') prunedCount++;
      else unknownCount++;
    }

    if (activeCount > 0 && prunedCount === 0 && unknownCount === 0) {
      out.set(p.id, 'protected');
    } else if (activeCount === 0 && prunedCount > 0 && unknownCount === 0) {
      out.set(p.id, 'skeleton');
    } else {
      out.set(p.id, 'mixed');
    }
  }

  return out;
}
