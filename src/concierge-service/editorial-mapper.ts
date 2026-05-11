/**
 * Editorial Mapper — reading-order selection.
 *
 * The editorial model receives the full corpus in document order (matching the
 * semantic mapper's view), with unclaimed-statement runs cordoned off in
 * ⟦UNCLAIMED_RUN⟧ blocks. Its job is to arrange a threaded reading document
 * by referencing claim IDs and unclaimed-run IDs.
 *
 * An unclaimed run that appears in any thread is "elevated" to category
 * 'unclaimedclaimed'. The mapper does NOT assign unclaimed runs to specific
 * claims — that remains outside its job. It only decides reading order +
 * which unclaimed text matters for the query.
 */

import type {
  Claim,
  EditorialAST,
  EditorialThread,
  UnclaimedRun,
} from '../../shared/types';
import type { CorpusTree, ModelNode } from '../../shared/types/corpus-tree';
import { extractJsonFromContent } from '../../shared/parsing-utils';

// ─────────────────────────────────────────────────────────────────────────
// Unclaimed-run extraction
// ─────────────────────────────────────────────────────────────────────────

/**
 * Walk the corpus per-model in document order; group consecutive statements
 * not in `claimedStatementIds` into runs. Run IDs are stable: `u_m{modelIndex}_{ordinal}`.
 */
export function buildUnclaimedRuns(
  corpus: CorpusTree,
  claimedStatementIds: ReadonlySet<string>
): UnclaimedRun[] {
  const runs: UnclaimedRun[] = [];

  for (const model of corpus.models) {
    let current: { ids: string[]; texts: string[] } | null = null;
    let runOrdinal = 0;
    const sortedParas = [...model.paragraphs].sort(
      (a, b) => a.paragraphOrdinal - b.paragraphOrdinal
    );

    const flush = () => {
      if (!current) return;
      runOrdinal += 1;
      runs.push({
        runId: `u_m${model.modelIndex}_${runOrdinal}`,
        modelIndex: model.modelIndex,
        statementIds: current.ids,
        text: current.texts.join(' ').trim(),
      });
      current = null;
    };

    for (const para of sortedParas) {
      const sortedStatements = [...(para.statements ?? [])].sort(
        (a, b) => a.statementOrdinal - b.statementOrdinal
      );
      for (const stmt of sortedStatements) {
        const sid = String(stmt.statementId ?? '');
        if (!sid) continue;
        if (claimedStatementIds.has(sid)) {
          flush();
        } else {
          if (!current) current = { ids: [], texts: [] };
          current.ids.push(sid);
          if (stmt.text) current.texts.push(stmt.text);
        }
      }
    }
    flush();
  }

  return runs;
}

// ─────────────────────────────────────────────────────────────────────────
// Prompt builder
// ─────────────────────────────────────────────────────────────────────────

/**
 * For a single model, emit its corpus body in document order. Claimed text
 * appears as natural prose (preserving paragraph breaks); unclaimed runs are
 * cordoned in ⟦UNCLAIMED_RUN⟧ … ⟦/UNCLAIMED_RUN⟧ blocks tagged with their run ID.
 */
function buildModelCorpusBody(
  model: ModelNode,
  claimedStatementIds: ReadonlySet<string>,
  runIdByFirstStatementId: ReadonlyMap<string, string>
): string {
  const lines: string[] = [];
  const sortedParas = [...model.paragraphs].sort(
    (a, b) => a.paragraphOrdinal - b.paragraphOrdinal
  );

  let openRunId: string | null = null;
  const closeRun = () => {
    if (openRunId) {
      lines.push(`⟦/UNCLAIMED_RUN⟧`);
      openRunId = null;
    }
  };

  for (let pi = 0; pi < sortedParas.length; pi++) {
    const para = sortedParas[pi];
    const sortedStatements = [...(para.statements ?? [])].sort(
      (a, b) => a.statementOrdinal - b.statementOrdinal
    );

    for (const stmt of sortedStatements) {
      const sid = String(stmt.statementId ?? '');
      if (!sid) continue;
      const text = stmt.text ?? '';
      if (claimedStatementIds.has(sid)) {
        closeRun();
        if (text) lines.push(text);
      } else {
        const runId = runIdByFirstStatementId.get(sid);
        if (runId) {
          closeRun();
          lines.push(`⟦UNCLAIMED_RUN id="${runId}"⟧`);
          openRunId = runId;
        }
        if (text) lines.push(text);
      }
    }

    if (pi < sortedParas.length - 1 && !openRunId) {
      lines.push('');
    }
  }

  closeRun();
  return lines.join('\n').trim();
}

export function buildEditorialPrompt(
  userQuery: string,
  corpus: CorpusTree,
  unclaimedRuns: UnclaimedRun[],
  claims: Array<Pick<Claim, 'id' | 'label' | 'text'>>,
  claimedStatementIds: ReadonlySet<string>
): string {
  const runIdByFirstStatementId = new Map<string, string>();
  for (const run of unclaimedRuns) {
    if (run.statementIds.length > 0) {
      runIdByFirstStatementId.set(run.statementIds[0], run.runId);
    }
  }

  const sortedModels = [...corpus.models].sort((a, b) => a.modelIndex - b.modelIndex);
  const corpusSection = sortedModels
    .map((m) => ({
      modelIndex: m.modelIndex,
      body: buildModelCorpusBody(m, claimedStatementIds, runIdByFirstStatementId),
    }))
    .filter((b) => b.body.length > 0)
    .map((b) => `[Model ${b.modelIndex}]\n${b.body}`)
    .join('\n\n---\n\n');

  const claimsSection =
    claims.length > 0
      ? claims
          .map((c) => {
            const label = c.label ? ` — "${c.label}"` : '';
            const body = c.text ? `\n${c.text}` : '';
            return `### ${c.id}${label}${body}`;
          })
          .join('\n\n')
      : '(no claims)';

  return `You are arranging threads in the most structurally tailored way to respond to the user query, using the model responses below.

The responses contain claimed text and unclaimed runs. Claimed text is evidence already captured by the semantic mapper. Unclaimed runs are uncaptured text.

Arrange relevant claimed IDs into threads by their utility to the solution of the user query. Include an unclaimed-run ID only when that unclaimed text gives a better answer path, adds new answer material.

Unclaimed runs enter the output only by ID. Any unclaimed-run IDs you include are treated downstream as surfaced unclaimed text: one recovered-text group, selected run by run on individual merit. No separate claim assignment, category, or omission note is expected.

## User Query

${userQuery}

## Corpus

${corpusSection}

## Claim Inventory

${claimsSection}

## Thread Construction

A thread is an assembled passage.

Group IDs that belong together as one passage of answer material.

Use claim count as the first estimate for thread count. Four claims usually suggests around three or four threads, sometimes two if claims belong in the same passage, and fewer if some claims do not help answer the query.

Unclaimed runs undergo the same relevance test as claims. They enter only when they improve the assembled passage.

Choose each thread label after arranging its items. The label should describe the full assembled passage, including everything the selected items are stating.

## Roles

anchor: main evidence unit the thread turns on
development: extends, supports, explains, or connects the anchor
alternative: materially different answer path, objection, or competing view

## Output

Return only JSON inside a code fence.

\`\`\`json
{
  "orientation": "One sentence describing the answer landscape.",
  "threads": [
    {
      "id": "thread_1",
      "label": "All-encompassing label for the full assembled passage",
      "why_care": "One sentence explaining why this passage matters for the query.",
      "start_here": true,
      "items": [
        { "id": "<claim_id or unclaimed_run_id>", "role": "anchor" },
        { "id": "<claim_id or unclaimed_run_id>", "role": "development" }
      ]
    }
  ],
  "thread_order": ["thread_1"],
  "diagnostics": {
    "flat_corpus": false,
    "notes": ""
  }
}
\`\`\`

Output expectations:
- Use IDs found in the Corpus or Claim Inventory.
- Each thread has an anchor.
- Each ID appears at most once.
- One thread has "start_here": true.
- "thread_order" contains every thread id.
- Thread count follows the relevant evidence shape, using claim count as the first estimate.`;
}

// ─────────────────────────────────────────────────────────────────────────
// Parser
// ─────────────────────────────────────────────────────────────────────────

export interface EditorialParseResult {
  success: boolean;
  ast?: EditorialAST;
  errors: string[];
}

const VALID_ROLES = new Set(['anchor', 'development', 'alternative']);

export function parseEditorialOutput(
  rawText: string,
  validClaimIds: ReadonlySet<string>,
  validRunIds: ReadonlySet<string>
): EditorialParseResult {
  const errors: string[] = [];
  const parsed = extractJsonFromContent(rawText);
  if (!parsed || typeof parsed !== 'object') {
    return { success: false, errors: ['Failed to extract JSON from editorial output'] };
  }

  const orientation = typeof parsed.orientation === 'string' ? parsed.orientation.trim() : '';
  if (!orientation) errors.push('Missing or empty orientation');

  if (!Array.isArray(parsed.threads)) {
    return { success: false, errors: ['Missing threads array'] };
  }

  const usedIds = new Set<string>();
  const elevatedRunIds: string[] = [];
  const validThreads: EditorialThread[] = [];

  for (const thread of parsed.threads) {
    if (!thread || typeof thread !== 'object') {
      errors.push('Invalid thread entry (not an object)');
      continue;
    }

    const threadId = typeof thread.id === 'string' ? thread.id : '';
    const label = typeof thread.label === 'string' ? thread.label : '';
    const whyCare = typeof thread.why_care === 'string' ? thread.why_care : '';
    const startHere = !!thread.start_here;

    if (!threadId) {
      errors.push('Thread missing id');
      continue;
    }
    if (!Array.isArray(thread.items)) {
      errors.push(`Thread "${threadId}" has no items array`);
      continue;
    }

    const validItems: Array<{
      id: string;
      role: 'anchor' | 'development' | 'alternative';
    }> = [];
    for (const item of thread.items) {
      if (!item || typeof item !== 'object') continue;
      const itemId = typeof item.id === 'string' ? item.id : '';
      const role = typeof item.role === 'string' ? item.role : '';

      const isClaim = validClaimIds.has(itemId);
      const isRun = validRunIds.has(itemId);
      if (!isClaim && !isRun) {
        errors.push(`Hallucinated ID "${itemId}" in thread "${threadId}" — dropped`);
        continue;
      }
      if (usedIds.has(itemId)) {
        errors.push(`Duplicate ID "${itemId}" in thread "${threadId}" — dropped`);
        continue;
      }
      if (!VALID_ROLES.has(role)) {
        errors.push(`Invalid role "${role}" for item "${itemId}" — defaulting to "development"`);
      }

      usedIds.add(itemId);
      if (isRun) elevatedRunIds.push(itemId);
      validItems.push({
        id: itemId,
        role: VALID_ROLES.has(role) ? (role as any) : 'development',
      });
    }

    const hasAnchor = validItems.some((i) => i.role === 'anchor');
    if (!hasAnchor) {
      if (validItems.length > 0) {
        validItems[0].role = 'anchor';
        errors.push(`Thread "${threadId}" had no anchor — promoted first item`);
      } else {
        errors.push(`Thread "${threadId}" is empty after validation — dropped`);
        continue;
      }
    }

    validThreads.push({
      id: threadId,
      label,
      why_care: whyCare,
      start_here: startHere,
      items: validItems,
    });
  }

  if (validThreads.length === 0) {
    return { success: false, errors: [...errors, 'No valid threads after validation'] };
  }

  const startCount = validThreads.filter((t) => t.start_here).length;
  if (startCount === 0) {
    validThreads[0].start_here = true;
    errors.push('No thread had start_here — defaulted to first thread');
  } else if (startCount > 1) {
    let found = false;
    for (const t of validThreads) {
      if (t.start_here && !found) {
        found = true;
        continue;
      }
      if (t.start_here) t.start_here = false;
    }
    errors.push('Multiple start_here threads — kept only first');
  }

  const validThreadIds = new Set(validThreads.map((t) => t.id));
  let threadOrder: string[];
  if (Array.isArray(parsed.thread_order)) {
    threadOrder = parsed.thread_order.filter(
      (id: unknown) => typeof id === 'string' && validThreadIds.has(id as string)
    ) as string[];
    for (const t of validThreads) {
      if (!threadOrder.includes(t.id)) threadOrder.push(t.id);
    }
  } else {
    threadOrder = validThreads.map((t) => t.id);
    errors.push('Missing thread_order — using thread array order');
  }

  const diag =
    parsed.diagnostics && typeof parsed.diagnostics === 'object' ? parsed.diagnostics : {};
  const diagnostics = {
    flat_corpus: !!diag.flat_corpus,
    notes: typeof diag.notes === 'string' ? diag.notes : '',
  };

  return {
    success: true,
    ast: {
      orientation,
      threads: validThreads,
      thread_order: threadOrder,
      elevatedRunIds,
      diagnostics,
    },
    errors,
  };
}
