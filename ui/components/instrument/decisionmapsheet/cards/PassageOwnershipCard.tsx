import { useCallback, useMemo, useState } from 'react';
import clsx from 'clsx';
import {
  fmtPct,
  safeArr,
  resolveProviderIdFromCitationOrder,
  getProviderConfig,
  getProviderAbbreviation,
  getProviderColor,
  CopyButton,
} from './CardBase';

// ============================================================================
// PASSAGE OWNERSHIP CARD — per-model text view with claim highlighting
// ============================================================================

export function PassageOwnershipCard({ artifact }: { artifact: any }) {
  const [selectedClaimId, setSelectedClaimId] = useState<string | null>(null);
  const [openModelIndex, setOpenModelIndex] = useState<number | null>(null);

  // ── Claims list from density profiles ──────────────────────────────────
  const claims = useMemo(() => {
    const profiles: Record<string, any> = artifact?.claimDensity?.profiles ?? {};
    const allClaims = safeArr<any>(artifact?.semantic?.claims ?? artifact?.claims);
    const labelById = new Map<string, string>();
    for (const c of allClaims) {
      const id = String(c?.id ?? '').trim();
      if (id) labelById.set(id, String(c?.label ?? id));
    }
    return Object.keys(profiles)
      .map((id) => ({ id, label: labelById.get(id) ?? id }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [artifact]);

  // ── Set of statement IDs owned by the selected claim ───────────────────
  const ownedStatementIds = useMemo(() => {
    if (!selectedClaimId) return new Set<string>();
    const allClaims = safeArr<any>(artifact?.semantic?.claims ?? artifact?.claims);
    const claim = allClaims.find((c: any) => String(c?.id ?? '') === selectedClaimId);
    const ids = safeArr<string>(claim?.sourceStatementIds).map(String);
    return new Set(ids);
  }, [selectedClaimId, artifact]);

  // ── Coverage & passage lookup for selected claim ───────────────────────
  const { coverageByKey, passageRanges } = useMemo(() => {
    const profile = selectedClaimId
      ? (artifact?.claimDensity?.profiles ?? {})[selectedClaimId]
      : null;
    const covMap = new Map<string, number>(); // "modelIndex:paragraphIndex" → coverage
    for (const entry of safeArr<any>(profile?.paragraphCoverage)) {
      const key = `${entry.modelIndex}:${entry.paragraphIndex}`;
      covMap.set(key, entry.coverage ?? 0);
    }
    const passages = safeArr<any>(profile?.passages);
    return { coverageByKey: covMap, passageRanges: passages };
  }, [selectedClaimId, artifact]);

  // ── Is a paragraph within a passage? ───────────────────────────────────
  const isInPassage = (mi: number, pi: number): boolean => {
    return passageRanges.some(
      (p: any) => p.modelIndex === mi && pi >= p.startParagraphIndex && pi <= p.endParagraphIndex
    );
  };

  // ── Group shadow paragraphs by modelIndex ──────────────────────────────
  const modelGroups = useMemo(() => {
    const paragraphs = safeArr<any>(artifact?.shadow?.paragraphs);
    const byModel = new Map<number, any[]>();
    for (const p of paragraphs) {
      const mi = p.modelIndex as number;
      if (!byModel.has(mi)) byModel.set(mi, []);
      byModel.get(mi)!.push(p);
    }
    // Sort paragraphs within each model by index
    for (const arr of byModel.values()) {
      arr.sort((a: any, b: any) => (a.paragraphIndex ?? 0) - (b.paragraphIndex ?? 0));
    }
    return Array.from(byModel.entries())
      .sort(([a], [b]) => a - b)
      .map(([mi, paras]) => {
        const order =
          artifact?.citationSourceOrder ?? artifact?.meta?.citationSourceOrder ?? undefined;
        const pid = resolveProviderIdFromCitationOrder(mi, order);
        return {
          modelIndex: mi,
          providerId: pid,
          name: pid
            ? (getProviderConfig(pid)?.name ?? getProviderAbbreviation(pid))
            : `Model #${mi}`,
          color: pid ? getProviderColor(pid) : '#94a3b8',
          paragraphs: paras,
        };
      });
  }, [artifact]);

  // ── Per-model hit summary (owned stmts / coverage paras) ──────────────
  const modelHitCounts = useMemo(() => {
    if (!selectedClaimId) return new Map<number, { stmts: number; paras: number }>();
    const m = new Map<number, { stmts: number; paras: number }>();
    for (const g of modelGroups) {
      let stmts = 0;
      let paras = 0;
      for (const p of g.paragraphs) {
        const pi = p.paragraphIndex as number;
        const hasCoverage = coverageByKey.has(`${g.modelIndex}:${pi}`);
        if (hasCoverage) paras++;
        for (const s of safeArr<any>(p.statements)) {
          if (ownedStatementIds.has(String(s?.id ?? ''))) stmts++;
        }
      }
      m.set(g.modelIndex, { stmts, paras });
    }
    return m;
  }, [selectedClaimId, modelGroups, coverageByKey, ownedStatementIds]);

  // ── Helper: build copy text/html for a single claim ─────────────────────
  const buildClaimCopy = useCallback(
    (claimId: string) => {
      const allClaims = safeArr<any>(artifact?.semantic?.claims ?? artifact?.claims);
      const claim = allClaims.find((c: any) => String(c?.id ?? '') === claimId);
      const ownedIds = new Set(safeArr<string>(claim?.sourceStatementIds).map(String));

      const profile = (artifact?.claimDensity?.profiles ?? {})[claimId];
      const covMap = new Map<string, number>();
      for (const entry of safeArr<any>(profile?.paragraphCoverage)) {
        covMap.set(`${entry.modelIndex}:${entry.paragraphIndex}`, entry.coverage ?? 0);
      }
      const passages = safeArr<any>(profile?.passages);
      const inPass = (mi: number, pi: number) =>
        passages.some(
          (p: any) =>
            p.modelIndex === mi && pi >= p.startParagraphIndex && pi <= p.endParagraphIndex
        );

      const esc = (s: string) =>
        s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const claimLabel = claims.find((c) => c.id === claimId)?.label ?? claimId;
      const plain: string[] = [];
      const html: string[] = [];

      plain.push(`PASSAGE OWNERSHIP: ${claimLabel} (${claimId})`);
      html.push(`<h2 style="margin:0 0 8px">Passage Ownership: ${esc(claimLabel)}</h2>`);

      for (const g of modelGroups) {
        let stmtCount = 0;
        let paraCount = 0;
        for (const p of g.paragraphs) {
          if (covMap.has(`${g.modelIndex}:${p.paragraphIndex}`)) paraCount++;
          for (const s of safeArr<any>(p.statements)) {
            if (ownedIds.has(String(s?.id ?? ''))) stmtCount++;
          }
        }
        const hitsDesc =
          stmtCount > 0
            ? `${stmtCount} stmt${stmtCount !== 1 ? 's' : ''}, ${paraCount} para${paraCount !== 1 ? 's' : ''}`
            : 'no hits';

        plain.push('');
        plain.push(`═══ ${g.name} (${hitsDesc}) ═══`);
        html.push(
          `<h3 style="border-bottom:1px solid #ddd;padding-bottom:4px;margin:16px 0 8px">${esc(g.name)} <span style="font-weight:normal;color:#888;font-size:12px">(${esc(hitsDesc)})</span></h3>`
        );

        for (const para of g.paragraphs) {
          const paraIdx = para.paragraphIndex as number;
          const covKey = `${g.modelIndex}:${paraIdx}`;
          const hasCoverage = covMap.has(covKey);
          const isPassage = inPass(g.modelIndex, paraIdx);
          const coverage = covMap.get(covKey) ?? 0;
          const stmts = safeArr<any>(para.statements);
          const hasOwned = stmts.some((s: any) => ownedIds.has(String(s?.id ?? '')));
          if (!hasCoverage && !hasOwned) continue;

          plain.push(
            `  ${isPassage ? `[PASSAGE ¶${paraIdx} ${fmtPct(coverage)}]` : `[¶${paraIdx} ${fmtPct(coverage)}]`}`
          );
          const borderStyle = isPassage
            ? 'border-left:3px solid #f59e0b;background:#fef3c7;padding:4px 8px;margin:4px 0;border-radius:3px'
            : hasCoverage
              ? 'border-left:3px solid #94a3b8;background:#f8fafc;padding:4px 8px;margin:4px 0;border-radius:3px'
              : 'padding:4px 8px;margin:4px 0';
          const passageTag = isPassage
            ? `<span style="font-size:10px;color:#d97706;font-weight:600">PASSAGE</span> `
            : '';
          html.push(`<div style="${borderStyle}">`);
          html.push(
            `<div style="font-size:10px;color:#888;margin-bottom:2px">${passageTag}¶${paraIdx} — ${fmtPct(coverage)} coverage</div>`
          );

          for (const s of stmts) {
            const text = String(s?.text ?? '');
            if (ownedIds.has(String(s?.id ?? ''))) {
              plain.push(`    >> ${text}`);
              html.push(
                `<mark style="background:#bae6fd;color:#0c4a6e;border-radius:2px;padding:0 2px">${esc(text)}</mark> `
              );
            } else {
              plain.push(`       ${text}`);
              html.push(`<span style="color:#888">${esc(text)}</span> `);
            }
          }
          html.push('</div>');
        }
      }
      return { plain, html };
    },
    [artifact, claims, modelGroups]
  );

  // ── Copy text/html: single claim when selected, all claims otherwise ───
  const { copyText, copyHtml } = useMemo(() => {
    if (claims.length === 0) return { copyText: '', copyHtml: '' };

    const claimIds = selectedClaimId ? [selectedClaimId] : claims.map((c) => c.id);
    const allPlain: string[] = [];
    const allHtml: string[] = [
      '<div style="font-family:system-ui,sans-serif;font-size:13px;line-height:1.6">',
    ];

    for (let i = 0; i < claimIds.length; i++) {
      const { plain, html } = buildClaimCopy(claimIds[i]);
      if (i > 0) {
        allPlain.push('', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', '');
        allHtml.push('<hr style="border:none;border-top:2px solid #ddd;margin:24px 0" />');
      }
      allPlain.push(...plain);
      allHtml.push(...html);
    }

    allHtml.push('</div>');
    return { copyText: allPlain.join('\n'), copyHtml: allHtml.join('\n') };
  }, [selectedClaimId, claims, buildClaimCopy]);

  if (claims.length === 0) return null;

  return (
    <div className="space-y-2">
      {/* ── Claim selector + copy button ───────────────────────────── */}
      <div className="flex items-center gap-2 mb-2">
        <select
          className="flex-1 min-w-0 text-[11px] bg-surface-raised border border-border-subtle rounded-md px-2 py-1.5 text-text-primary focus:outline-none focus:border-brand-500"
          value={selectedClaimId ?? ''}
          onChange={(e) => {
            const v = e.target.value || null;
            setSelectedClaimId(v);
            setOpenModelIndex(null);
          }}
        >
          <option value="">Select a claim…</option>
          {claims.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
        <CopyButton
          text={copyText}
          html={copyHtml}
          label={selectedClaimId ? 'Copy passage ownership' : 'Copy all claims'}
          variant="icon"
        />
      </div>

      {selectedClaimId && (
        <div className="space-y-2">
          {/* ── Legend ──────────────────────────────────────────────── */}
          <div className="flex items-center gap-4 text-[9px] text-text-muted">
            <span className="flex items-center gap-1">
              <span className="inline-block w-2.5 h-2.5 rounded-sm bg-sky-500/20 border border-sky-500/40" />{' '}
              owned statement
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-2.5 h-2.5 rounded-sm border-l-2 border-l-amber-400 bg-amber-500/5" />{' '}
              passage paragraph
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-2.5 h-2.5 rounded-sm border-l-2 border-l-white/20 bg-white/3" />{' '}
              covered paragraph
            </span>
          </div>

          {/* ── Model accordions ───────────────────────────────────── */}
          {modelGroups.map((g) => {
            const isOpen = openModelIndex === g.modelIndex;
            const hits = modelHitCounts.get(g.modelIndex);
            return (
              <div key={g.modelIndex} className="rounded-md border border-white/10 overflow-hidden">
                {/* header */}
                <button
                  type="button"
                  className="w-full px-3 py-2 flex items-center justify-between hover:bg-white/5 transition-colors"
                  onClick={() => setOpenModelIndex(isOpen ? null : g.modelIndex)}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <div
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: g.color }}
                    />
                    <span className="text-[11px] text-text-primary truncate">{g.name}</span>
                    {hits && hits.stmts > 0 && (
                      <span className="text-[9px] text-sky-400 font-mono">
                        {hits.stmts} stmt{hits.stmts !== 1 ? 's' : ''} · {hits.paras} para
                        {hits.paras !== 1 ? 's' : ''}
                      </span>
                    )}
                    {hits && hits.stmts === 0 && (
                      <span className="text-[9px] text-text-muted font-mono italic">no hits</span>
                    )}
                  </div>
                  <span className="text-[10px] text-text-muted">{isOpen ? '▲' : '▼'}</span>
                </button>

                {/* body */}
                {isOpen && (
                  <div className="px-3 pb-3 space-y-1">
                    {g.paragraphs.map((para: any, pi: number) => {
                      const paraIdx = para.paragraphIndex as number;
                      const covKey = `${g.modelIndex}:${paraIdx}`;
                      const hasCoverage = coverageByKey.has(covKey);
                      const inPassage = isInPassage(g.modelIndex, paraIdx);
                      const coverage = coverageByKey.get(covKey) ?? 0;

                      return (
                        <div
                          key={para.id ?? pi}
                          className={clsx(
                            'rounded-sm py-1 px-2 transition-colors',
                            inPassage
                              ? 'border-l-2 border-l-amber-400 bg-amber-500/5'
                              : hasCoverage
                                ? 'border-l-2 border-l-white/20 bg-white/3'
                                : 'border-l-2 border-l-transparent'
                          )}
                        >
                          {/* paragraph header with coverage */}
                          {hasCoverage && (
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className="text-[8px] text-text-muted font-mono">
                                ¶{paraIdx}
                              </span>
                              <span className="text-[8px] text-text-muted font-mono">
                                {fmtPct(coverage)}
                              </span>
                              {inPassage && (
                                <span className="text-[8px] text-amber-400 font-mono">passage</span>
                              )}
                            </div>
                          )}
                          {/* statements */}
                          {safeArr<any>(para.statements).map((s: any, si: number) => {
                            const stmtId = String(s?.id ?? '');
                            const owned = ownedStatementIds.has(stmtId);
                            return (
                              <div
                                key={stmtId || si}
                                className={clsx(
                                  'text-[10px] font-mono whitespace-pre-wrap break-words leading-relaxed',
                                  owned
                                    ? 'bg-sky-500/15 text-sky-200 rounded-sm px-1 -mx-1 border border-sky-500/30'
                                    : 'text-text-muted'
                                )}
                              >
                                {String(s?.text ?? '')}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
