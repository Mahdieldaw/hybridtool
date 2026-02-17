// ═══════════════════════════════════════════════════════════════════════════
// SEMANTIC MAPPER - PROMPT BUILDER
// ═══════════════════════════════════════════════════════════════════════════
//
// v2: Geometry-guided, ID-free prompt. Output is UnifiedMapperOutput.
// ═══════════════════════════════════════════════════════════════════════════

import type { MapperPartition, UnifiedMapperOutput } from '../../shared/contract';
import {
  parseSemanticMapperOutput as baseParseOutput,
  extractJsonFromContent
} from '../../shared/parsing-utils';
import { cosineSimilarity } from '../clustering/distance';

type RawModelResponse = {
  modelIndex: number;
  content: string;
};

type DisruptionFirstWorklistEntry = {
  focal: any;
  jury: any[];
  juryMeta?: any;
};

type DisruptionFirstPromptOptions = {
  worklistEntries: DisruptionFirstWorklistEntry[];
  shadowStatements: Array<{
    id: string;
    modelIndex: number;
    text: string;
    stance?: string;
    confidence?: number;
    signals?: { sequence?: boolean; tension?: boolean; conditional?: boolean };
    geometricCoordinates?: { regionId?: string | null; paragraphId?: string | null };
  }>;
};

function buildCleanModelOutputs(responses: RawModelResponse[]): string {
  const byModel = new Map<number, string[]>();
  for (const r of responses) {
    const modelIndex = Number(r?.modelIndex);
    if (!Number.isFinite(modelIndex) || modelIndex <= 0) continue;
    const content = String(r?.content || '').trim();
    if (!content) continue;
    const arr = byModel.get(modelIndex) || [];
    arr.push(content);
    byModel.set(modelIndex, arr);
  }

  const modelIndices = Array.from(byModel.keys()).sort((a, b) => a - b);
  const blocks: string[] = [];

  for (const modelIndex of modelIndices) {
    const text = (byModel.get(modelIndex) || []).join('\n\n');
    blocks.push(`[Model ${modelIndex}]\n${text}`);
  }

  return blocks.join('\n\n---\n\n');
}

function normalizeStatementId(id: unknown): string | null {
  const s = String(id ?? '').trim();
  return s ? s : null;
}

function buildDisruptionFirstMapperPrompt(userQuery: string, input: DisruptionFirstPromptOptions): string {
  const worklistEntries = Array.isArray(input?.worklistEntries) ? input.worklistEntries : [];
  const shadowStatements = Array.isArray(input?.shadowStatements) ? input.shadowStatements : [];

  const statementById = new Map<string, DisruptionFirstPromptOptions['shadowStatements'][number]>();
  for (const st of shadowStatements) {
    const id = normalizeStatementId(st?.id);
    if (!id) continue;
    if (!statementById.has(id)) statementById.set(id, st);
  }

  const usedStatementIds = new Set<string>();
  const addId = (raw: unknown) => {
    const id = normalizeStatementId(raw);
    if (id) usedStatementIds.add(id);
  };

  for (const entry of worklistEntries) {
    addId(entry?.focal?.statementId);
    addId(entry?.focal?.statement_id);
    addId(entry?.focal?.id);
    for (const jm of Array.isArray(entry?.jury) ? entry.jury : []) {
      addId(jm?.statementId);
      addId(jm?.statement_id);
      addId(jm?.id);
    }
  }

  const usedStatements = Array.from(usedStatementIds)
    .map((id) => statementById.get(id))
    .filter(Boolean)
    .sort((a, b) => String(a!.id).localeCompare(String(b!.id)));

  const statementLines = usedStatements.map((st) => {
    const stance = st?.stance ? ` stance=${String(st.stance)}` : '';
    const conf = typeof st?.confidence === 'number' ? ` conf=${st.confidence.toFixed(2)}` : '';
    const sig = st?.signals
      ? ` signals=${[
          st.signals.conditional ? 'conditional' : null,
          st.signals.tension ? 'tension' : null,
          st.signals.sequence ? 'sequence' : null,
        ]
          .filter(Boolean)
          .join(',') || 'none'}`
      : '';
    const regionId =
      st?.geometricCoordinates && st.geometricCoordinates.regionId != null
        ? ` region=${String(st.geometricCoordinates.regionId)}`
        : '';
    return `- [${st!.id}] model=${st!.modelIndex}${stance}${conf}${sig}${regionId}: ${JSON.stringify(String(st!.text || ''))}`;
  });

  const entryBlocks = worklistEntries.map((entry, idx) => {
    const focalId =
      normalizeStatementId(entry?.focal?.statementId) ||
      normalizeStatementId(entry?.focal?.statement_id) ||
      normalizeStatementId(entry?.focal?.id) ||
      '';
    const focal = statementById.get(focalId);

    const impactScore =
      typeof entry?.focal?.composite === 'number'
        ? entry.focal.composite
        : typeof entry?.focal?.impactScore === 'number'
          ? entry.focal.impactScore
          : null;

    const focalLine = focal
      ? `focal_statement_id=${focal.id} impact_score=${impactScore != null ? impactScore.toFixed(4) : 'null'} text=${JSON.stringify(
          String(focal.text || '')
        )}`
      : `focal_statement_id=${focalId || 'null'} impact_score=${impactScore != null ? impactScore.toFixed(4) : 'null'} text=null`;

    const juryLines = (Array.isArray(entry?.jury) ? entry.jury : [])
      .map((jm: any) => {
        const sid =
          normalizeStatementId(jm?.statementId) || normalizeStatementId(jm?.statement_id) || normalizeStatementId(jm?.id) || '';
        const st = statementById.get(sid);
        const role = jm?.role ? String(jm.role) : 'unknown';
        const rationale = Array.isArray(jm?.rationale) ? jm.rationale.map((r: any) => String(r || '').trim()).filter(Boolean) : [];
        const rationaleText = rationale.length > 0 ? ` rationale=${JSON.stringify(rationale.slice(0, 6))}` : '';
        return st
          ? `- [${st.id}] role=${role}${rationaleText} text=${JSON.stringify(String(st.text || ''))}`
          : `- [${sid || 'unknown'}] role=${role}${rationaleText} text=null`;
      })
      .join('\n');

    return `ENTRY ${idx + 1}\n${focalLine}\njury:\n${juryLines || '- (none)'}`;
  });

  return `You are the Disruption-First Partition Mapper. Your job is to identify real forks in what the user should do based ONLY on the provided statement inventory and the worklist entries.

<original_query>${userQuery}</original_query>

<statement_inventory>
${statementLines.join('\n')}
</statement_inventory>

<worklist>
${entryBlocks.join('\n\n')}
</worklist>

Output MUST be:
<map>
{
  "partitions": [
    {
      "partition_id": "partition_1",
      "focal_statement_id": "s_0",
      "triggering_focal_ids": ["s_0"],
      "hinge_question": "…",
      "default_side": "A",
      "sideA_statement_ids": ["s_1", "s_2"],
      "sideB_statement_ids": ["s_3"],
      "impact_score": 0.0,
      "confidence": 0.0
    }
  ],
  "emergent_forks": [
    {
      "fork_id": "fork_1",
      "hinge_question": "…",
      "default_side": "unknown",
      "sideA_statement_ids": ["s_10"],
      "sideB_statement_ids": ["s_11"],
      "confidence": 0.0
    }
  ],
  "claims": [],
  "edges": [],
  "conditionals": []
}
</map>

Rules:
- Only use statement IDs present in <statement_inventory>.
- Each partition side must be non-empty, and sides must not overlap.
- The hinge question must be binary/forced-choice and answerable without domain expertise.
- default_side is "A", "B", or "unknown". Use "unknown" if no safe default exists.
- If no partitions exist, return an empty partitions list.
- claims/edges/conditionals are optional but must be present as arrays (can be empty).

After the map, include <narrative> as free text if you have anything useful to add.`;
}

/**
 * Build semantic mapper prompt.
 */
export function buildSemanticMapperPrompt(
  userQuery: string,
  responses: RawModelResponse[],
  options?: { disruptionFirst?: DisruptionFirstPromptOptions }
): string {
  if (
    options?.disruptionFirst &&
    Array.isArray(options.disruptionFirst.worklistEntries) &&
    options.disruptionFirst.worklistEntries.length > 0 &&
    Array.isArray(options.disruptionFirst.shadowStatements) &&
    options.disruptionFirst.shadowStatements.length > 0
  ) {
    return buildDisruptionFirstMapperPrompt(userQuery, options.disruptionFirst);
  }

  const modelOutputs = buildCleanModelOutputs(responses);
  const filtered = responses.filter((r) => {
    const modelIndex = Number(r?.modelIndex);
    return Number.isFinite(modelIndex) && modelIndex > 0;
  });
  const modelCount = new Set(filtered.map((r) => r.modelIndex)).size;
  const modelCountPhrase = modelCount === 1 ? 'one person' : `${modelCount} people`;

  return `You are the Epistemic Cartographer. Your mandate is the Incorruptible Distillation of Signal—preserving every incommensurable insight while discarding only connective tissue that adds nothing to the answer. The user has spoken and the ${modelCountPhrase} responded:

  <original_query>${userQuery}</original_query>

  You are not a synthesizer. Your job: index positions, not topics. 
A position is a stance—something that can be supported, opposed, 
or traded against another. Where multiple sources reach the same 
position, note the convergence. Where only one source sees something, 
preserve it as an outlier. Where sources oppose each other, map 
the conflict. Where they optimize for different ends, map the tradeoff. 
Where one position depends on another, map the prerequisite. What no 
source addressed but matters—these are the ghosts at the edge of 
the map.

Every distinct position you identify from the responses below receives a canonical label and 
sequential ID. That exact pairing—**[Label|claim_N]**—will bind 
your map to your narrative:

<responses>${modelOutputs}</responses>

Now output the map first: <map> then the flowing <narrative>.

---<map>
A JSON object with:

claims: an array of distinct positions. Each claim has:
- id: sequential ("claim_1", "claim_2", etc.)
- label: a verb-phrase expressing a position — a stance that can 
  be agreed with, opposed, or traded off. Not a topic or category.
- text: the mechanism, evidence, or reasoning behind this position 
  (one paragraph max)
- supporters: array of model indices that expressed this position. 
  A model supports a claim only if it advocates for or provides 
  evidence toward this position. Mentioning a topic is not support. 
  Arguing against a position is not support.
- challenges: if this position questions or undermines another 
  position's premise, the id of that claim. Otherwise null.

edges: an array of relationships. Each edge has:
- from: source claim_id
- to: target claim_id
- type:
  - supports: from reinforces to
  - conflicts: from and to cannot both be acted on
  - tradeoff: from and to optimize for different ends
  - prerequisite: to depends on from being true

</map>
THE NARRATIVE
<narrative>
The narrative is not a summary. It is a landscape the reader walks through. Use [Label|claim_id] anchors to let them touch the structure as they move.

Begin by surfacing the governing variable—if tradeoff or conflict edges exist, name the dimension along which the answer pivots. One sentence that orients before any detail arrives.

Then signal the shape. Are the models converging? Splitting into camps? Arranged in a sequence where each step enables the next? The reader should know how to hold what follows before they hold it.

Now establish the ground. Claims with broad support are the floor—state what is settled without argument. This is what does not need to be re-examined.

From the ground, move to the tension. Claims connected by conflict or tradeoff edges are where the decision lives. Present opposing positions using their labels—the axis between them should be visible in the verb-phrases themselves. Do not resolve; reveal what choosing requires.

After the tension, surface the edges. Claims with few supporters but high connectivity—or with challenger role—are outliers. They may be noise or they may be the key. Place them adjacent to what they challenge or extend, not quarantined at the end.

Close with what remains uncharted. Ghosts are the boundary of what the models could see. Name them. The reader decides if they matter.

Do not synthesize a verdict. Do not pick sides, the landscape is the product of the models' responses.`;
}

// ═══════════════════════════════════════════════════════════════════════════
// PARSER WRAPPER
// ═══════════════════════════════════════════════════════════════════════════

export interface ParseResult {
  success: boolean;
  output?: UnifiedMapperOutput;
  narrative?: string;
  errors?: Array<{ field: string; issue: string; context?: string }>;
  warnings?: string[];
}

function normalizeHingeText(input: unknown): string {
  return String(input ?? '').trim();
}

function normalizeDefaultSide(input: unknown): 'A' | 'B' | 'unknown' {
  const s = String(input ?? '').trim().toUpperCase();
  if (s === 'A') return 'A';
  if (s === 'B') return 'B';
  return 'unknown';
}

function normalizeStatementIdList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    const id = normalizeStatementId(v);
    if (id) out.push(id);
  }
  return Array.from(new Set(out));
}

function extractPartitionsFromParsedMap(
  parsedMap: any,
  source: 'focal' | 'emergent',
  allowedStatementIds: Set<string> | null,
  idPrefix: string
): { partitions: MapperPartition[]; errors: Array<{ field: string; issue: string; context?: string }>; warnings: string[] } {
  const errors: Array<{ field: string; issue: string; context?: string }> = [];
  const warnings: string[] = [];

  const rawList =
    source === 'focal'
      ? Array.isArray(parsedMap?.partitions)
        ? parsedMap.partitions
        : []
      : Array.isArray(parsedMap?.emergent_forks)
        ? parsedMap.emergent_forks
        : Array.isArray(parsedMap?.emergentForks)
          ? parsedMap.emergentForks
          : [];

  const partitions: MapperPartition[] = [];

  for (let i = 0; i < rawList.length; i++) {
    const raw = rawList[i];
    const ctx = source === 'focal' ? `partitions[${i}]` : `emergent_forks[${i}]`;
    if (!raw || typeof raw !== 'object') {
      errors.push({ field: ctx, issue: 'Partition must be an object' });
      continue;
    }

    const id =
      normalizeStatementId(raw.partition_id) ||
      normalizeStatementId(raw.fork_id) ||
      normalizeStatementId(raw.id) ||
      `${idPrefix}${i + 1}`;

    const focalStatementId =
      source === 'focal'
        ? normalizeStatementId(raw.focal_statement_id) || normalizeStatementId(raw.focalStatementId) || null
        : null;

    const triggeringFocalIdsRaw = raw.triggering_focal_ids ?? raw.triggeringFocalIds ?? (focalStatementId ? [focalStatementId] : []);
    const triggeringFocalIds = normalizeStatementIdList(triggeringFocalIdsRaw);

    const hingeQuestion = normalizeHingeText(raw.hinge_question ?? raw.hingeQuestion ?? raw.question);
    const defaultSide = normalizeDefaultSide(raw.default_side ?? raw.defaultSide);

    const sideAStatementIds = normalizeStatementIdList(raw.sideA_statement_ids ?? raw.sideAStatementIds ?? raw.sideA);
    const sideBStatementIds = normalizeStatementIdList(raw.sideB_statement_ids ?? raw.sideBStatementIds ?? raw.sideB);

    const sideASet = new Set(sideAStatementIds);
    const overlap = sideBStatementIds.filter((x) => sideASet.has(x));

    if (!hingeQuestion) errors.push({ field: `${ctx}.hinge_question`, issue: 'Missing hinge_question' });
    if (sideAStatementIds.length === 0) errors.push({ field: `${ctx}.sideA_statement_ids`, issue: 'Side A is empty' });
    if (sideBStatementIds.length === 0) errors.push({ field: `${ctx}.sideB_statement_ids`, issue: 'Side B is empty' });
    if (overlap.length > 0) errors.push({ field: ctx, issue: `Side A and B overlap: ${overlap.slice(0, 6).join(', ')}` });

    if (allowedStatementIds) {
      const all = [...sideAStatementIds, ...sideBStatementIds, ...(focalStatementId ? [focalStatementId] : [])];
      const unknown = all.filter((sid) => !allowedStatementIds.has(sid));
      if (unknown.length > 0) {
        errors.push({ field: ctx, issue: `Unknown statement IDs: ${unknown.slice(0, 12).join(', ')}` });
      }
    } else {
      if ((sideAStatementIds.length > 0 || sideBStatementIds.length > 0) && source === 'focal') {
        warnings.push(`${ctx}: cannot validate statement IDs without shadowStatements`);
      }
    }

    const impactScore = typeof raw.impact_score === 'number' ? raw.impact_score : typeof raw.impactScore === 'number' ? raw.impactScore : null;
    const confidence = typeof raw.confidence === 'number' ? raw.confidence : null;

    partitions.push({
      id,
      source,
      focalStatementId,
      triggeringFocalIds,
      hingeQuestion,
      defaultSide,
      sideAStatementIds,
      sideBStatementIds,
      impactScore,
      confidence,
      notes: null,
    });
  }

  return { partitions, errors, warnings };
}

function normalizeTokens(input: string): string[] {
  const s = String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return s ? s.split(' ').filter(Boolean) : [];
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union > 0 ? inter / union : 0;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n <= 0) return 0;
  if (n >= 1) return 1;
  return n;
}

function partitionStatementSet(p: MapperPartition): Set<string> {
  return new Set([...(p.sideAStatementIds || []), ...(p.sideBStatementIds || [])]);
}

function partitionSimilarity(a: MapperPartition, b: MapperPartition): number {
  const sA = partitionStatementSet(a);
  const sB = partitionStatementSet(b);
  const stmtSim = jaccard(sA, sB);
  const tA = new Set(normalizeTokens(a.hingeQuestion));
  const tB = new Set(normalizeTokens(b.hingeQuestion));
  const hingeSim = jaccard(tA, tB);
  return 0.75 * stmtSim + 0.25 * hingeSim;
}

export function dedupeMapperPartitions(input: MapperPartition[]): { partitions: MapperPartition[]; meta: { input: number; output: number; merged: number } } {
  const items = Array.isArray(input) ? input.slice() : [];

  const sourceRank = (s: MapperPartition['source']) => (s === 'focal' ? 0 : 1);

  items.sort((a, b) => {
    const sr = sourceRank(a.source) - sourceRank(b.source);
    if (sr !== 0) return sr;
    const ia = typeof a.impactScore === 'number' ? a.impactScore : -Infinity;
    const ib = typeof b.impactScore === 'number' ? b.impactScore : -Infinity;
    if (ia !== ib) return ib - ia;
    const ca = typeof a.confidence === 'number' ? a.confidence : -Infinity;
    const cb = typeof b.confidence === 'number' ? b.confidence : -Infinity;
    if (ca !== cb) return cb - ca;
    return String(a.id).localeCompare(String(b.id));
  });

  const mergedInto = new Map<string, string>();
  const output: MapperPartition[] = [];

  const canMerge = (a: MapperPartition, b: MapperPartition) => {
    const sA = partitionStatementSet(a);
    const sB = partitionStatementSet(b);
    const stmtSim = jaccard(sA, sB);
    if (stmtSim < 0.6) return false;
    const hingeSim = jaccard(new Set(normalizeTokens(a.hingeQuestion)), new Set(normalizeTokens(b.hingeQuestion)));
    return hingeSim >= 0.25;
  };

  for (const p of items) {
    let merged = false;
    for (const existing of output) {
      if (!canMerge(existing, p)) continue;

      const mergedA = Array.from(new Set([...(existing.sideAStatementIds || []), ...(p.sideAStatementIds || [])]));
      const mergedB = Array.from(new Set([...(existing.sideBStatementIds || []), ...(p.sideBStatementIds || [])]));
      const overlap = mergedA.filter((x) => new Set(mergedB).has(x));
      if (overlap.length > 0) continue;

      existing.sideAStatementIds = mergedA;
      existing.sideBStatementIds = mergedB;
      existing.triggeringFocalIds = Array.from(new Set([...(existing.triggeringFocalIds || []), ...(p.triggeringFocalIds || [])]));

      const existingSim = partitionSimilarity(existing, p);
      if (existingSim < 0.9 && p.source === 'focal' && existing.source === 'emergent') {
        existing.source = 'focal';
        existing.focalStatementId = p.focalStatementId;
      }

      if (existing.impactScore == null && p.impactScore != null) existing.impactScore = p.impactScore;
      if ((existing.confidence == null || existing.confidence < (p.confidence ?? -Infinity)) && p.confidence != null) existing.confidence = p.confidence;

      mergedInto.set(String(p.id), String(existing.id));
      merged = true;
      break;
    }
    if (!merged) output.push({ ...p });
  }

  return { partitions: output, meta: { input: items.length, output: output.length, merged: mergedInto.size } };
}

function stanceWeight(stance: unknown): number {
  const s = String(stance ?? '').toLowerCase().trim();
  switch (s) {
    case 'prerequisite':
    case 'dependent':
      return 1.0;
    case 'cautionary':
      return 0.9;
    case 'prescriptive':
      return 0.8;
    case 'uncertain':
      return 0.6;
    case 'assertive':
      return 0.5;
    default:
      return 0.35;
  }
}

function signalScore(signals: any): number {
  const tension = signals?.tension ? 1 : 0;
  const conditional = signals?.conditional ? 1 : 0;
  const sequence = signals?.sequence ? 1 : 0;
  return clamp01((tension * 1.0 + conditional * 0.7 + sequence * 0.4) / (1.0 + 0.7 + 0.4));
}

function impactEstimateFromStatement(st: any): number {
  const sw = stanceWeight(st?.stance);
  const sig = signalScore(st?.signals);
  const conf = clamp01(typeof st?.confidence === 'number' ? st.confidence : 0);
  const isolation = clamp01(typeof st?.geometricCoordinates?.isolationScore === 'number' ? st.geometricCoordinates.isolationScore : 0);
  return clamp01(sw * 0.35 + sig * 0.25 + conf * 0.25 + isolation * 0.15);
}

function dominantKey(items: Array<string | null>): { key: string | null; purity: number; counts: Map<string, number> } {
  const counts = new Map<string, number>();
  let total = 0;
  for (const x of items) {
    if (!x) continue;
    total++;
    counts.set(x, (counts.get(x) ?? 0) + 1);
  }
  let bestKey: string | null = null;
  let bestCount = 0;
  for (const [k, c] of counts.entries()) {
    if (c > bestCount || (c === bestCount && String(k) < String(bestKey ?? '\uffff'))) {
      bestKey = k;
      bestCount = c;
    }
  }
  const purity = total > 0 ? bestCount / total : 0;
  return { key: bestKey, purity, counts };
}

export function validateMapperPartitions(
  partitions: MapperPartition[],
  shadowStatements: any[],
  options?: { minConfidence?: number }
): { validated: MapperPartition[]; suppressed: MapperPartition[]; meta: { input: number; validated: number; suppressed: number; minConfidence: number } } {
  const items = Array.isArray(partitions) ? partitions : [];
  const shadow = Array.isArray(shadowStatements) ? shadowStatements : [];

  const statementById = new Map<string, any>();
  for (const st of shadow) {
    const id = normalizeStatementId(st?.id);
    if (!id) continue;
    if (!statementById.has(id)) statementById.set(id, st);
  }

  const minConfidence = typeof options?.minConfidence === 'number' ? clamp01(options.minConfidence) : 0.35;

  const validated: MapperPartition[] = [];
  const suppressed: MapperPartition[] = [];

  for (const raw of items) {
    const p: MapperPartition = { ...raw };

    const sideARegions = (p.sideAStatementIds || []).map((id) => {
      const st = statementById.get(String(id));
      return st?.geometricCoordinates?.regionId != null ? String(st.geometricCoordinates.regionId) : null;
    });
    const sideBRegions = (p.sideBStatementIds || []).map((id) => {
      const st = statementById.get(String(id));
      return st?.geometricCoordinates?.regionId != null ? String(st.geometricCoordinates.regionId) : null;
    });

    const domA = dominantKey(sideARegions);
    const domB = dominantKey(sideBRegions);

    const hasRegionEvidence = !!domA.key && !!domB.key;

    const setA = new Set(sideARegions.filter(Boolean) as string[]);
    const setB = new Set(sideBRegions.filter(Boolean) as string[]);
    const regionOverlap = jaccard(setA, setB);

    const separation = hasRegionEvidence && domA.key !== domB.key ? 1 : 0;
    const avgPurity = hasRegionEvidence ? (domA.purity + domB.purity) / 2 : 0;
    const regionScore = hasRegionEvidence ? separation * avgPurity * (1 - regionOverlap) : 0;

    const baseConfidence = clamp01(typeof p.confidence === 'number' ? p.confidence : 0.6);
    const validatedConfidence = hasRegionEvidence ? clamp01(baseConfidence * (0.5 + 0.5 * regionScore)) : clamp01(baseConfidence * 0.25);

    const notes: string[] = Array.isArray(p.notes) ? p.notes.slice() : [];
    if (!hasRegionEvidence) notes.push('validation:no_region_evidence');
    else {
      notes.push(`validation:regionA=${String(domA.key)} purityA=${domA.purity.toFixed(2)}`);
      notes.push(`validation:regionB=${String(domB.key)} purityB=${domB.purity.toFixed(2)}`);
      notes.push(`validation:regionOverlap=${regionOverlap.toFixed(2)}`);
    }

    p.confidence = validatedConfidence;
    p.notes = notes.length > 0 ? notes : null;

    if (p.impactScore == null) {
      const candidateIds = [...(p.sideAStatementIds || []), ...(p.sideBStatementIds || [])].map((x) => String(x));
      let best = 0;
      for (const id of candidateIds) {
        const st = statementById.get(id);
        if (!st) continue;
        const score = impactEstimateFromStatement(st);
        if (score > best) best = score;
      }
      if (best > 0) p.impactScore = best;
    }

    if (validatedConfidence >= minConfidence) validated.push(p);
    else suppressed.push(p);
  }

  return {
    validated,
    suppressed,
    meta: { input: items.length, validated: validated.length, suppressed: suppressed.length, minConfidence },
  };
}

function normalizeStance(stance: unknown): string {
  return String(stance ?? '').toLowerCase().trim() || 'unclassified';
}

function stanceProfile(ids: string[], statementById: Map<string, any>): { allowed: Set<string>; dominant: string } {
  const stances: string[] = [];
  for (const id of ids) {
    const st = statementById.get(String(id));
    if (!st) continue;
    stances.push(normalizeStance(st?.stance));
  }
  const counts = new Map<string, number>();
  for (const s of stances) counts.set(s, (counts.get(s) ?? 0) + 1);
  let dominant = 'unclassified';
  let best = 0;
  for (const [k, c] of counts.entries()) {
    if (c > best || (c === best && k < dominant)) {
      dominant = k;
      best = c;
    }
  }
  const total = stances.length;
  const allowed = new Set<string>();
  if (dominant) allowed.add(dominant);
  if (total > 0) {
    for (const [k, c] of counts.entries()) {
      if (c / total >= 0.34) allowed.add(k);
    }
  }
  allowed.add('unclassified');
  return { allowed, dominant };
}

function maxSimilarity(
  candidateId: string,
  exemplarIds: string[],
  embeddings: Map<string, Float32Array>
): number | null {
  const cand = embeddings.get(candidateId);
  if (!cand) return null;
  let best = -Infinity;
  let found = false;
  for (const exId of exemplarIds) {
    const ex = embeddings.get(exId);
    if (!ex) continue;
    found = true;
    const sim = cosineSimilarity(cand, ex);
    if (sim > best) best = sim;
  }
  return found ? best : null;
}

export function expandPartitionAdvocacySets(
  partitions: MapperPartition[],
  candidateStatements: any[],
  statementEmbeddings?: Map<string, Float32Array> | null,
  options?: {
    similarityThreshold?: number;
    similarityMargin?: number;
    maxPerSide?: number;
    candidatePool?: 'condensed' | 'full';
  }
): { partitions: MapperPartition[]; meta: { input: number; expanded: number } } {
  const items = Array.isArray(partitions) ? partitions : [];
  const candidates = Array.isArray(candidateStatements) ? candidateStatements : [];
  const embeddings = statementEmbeddings instanceof Map ? statementEmbeddings : null;

  const statementById = new Map<string, any>();
  for (const st of candidates) {
    const id = normalizeStatementId(st?.id);
    if (!id) continue;
    if (!statementById.has(id)) statementById.set(id, st);
  }

  const similarityThreshold = typeof options?.similarityThreshold === 'number' ? options.similarityThreshold : 0.72;
  const similarityMargin = typeof options?.similarityMargin === 'number' ? options.similarityMargin : 0.04;
  const maxPerSide = typeof options?.maxPerSide === 'number' ? options.maxPerSide : 140;
  const candidatePool = options?.candidatePool === 'full' ? 'full' : 'condensed';

  const expanded: MapperPartition[] = [];

  for (const raw of items) {
    const p: MapperPartition = { ...raw };

    const sideAEx = Array.from(new Set((p.sideAStatementIds || []).map((x) => String(x)).filter(Boolean)));
    const sideBEx = Array.from(new Set((p.sideBStatementIds || []).map((x) => String(x)).filter(Boolean)));
    const exSetA = new Set(sideAEx);
    const exSetB = new Set(sideBEx);

    const stanceA = stanceProfile(sideAEx, statementById);
    const stanceB = stanceProfile(sideBEx, statementById);

    const sideARegions = sideAEx.map((id) => {
      const st = statementById.get(id);
      return st?.geometricCoordinates?.regionId != null ? String(st.geometricCoordinates.regionId) : null;
    });
    const sideBRegions = sideBEx.map((id) => {
      const st = statementById.get(id);
      return st?.geometricCoordinates?.regionId != null ? String(st.geometricCoordinates.regionId) : null;
    });
    const domARegion = dominantKey(sideARegions).key;
    const domBRegion = dominantKey(sideBRegions).key;

    const advocacyA = new Set<string>(sideAEx);
    const advocacyB = new Set<string>(sideBEx);

    type CandidatePick = { id: string; score: number };
    const picksA: CandidatePick[] = [];
    const picksB: CandidatePick[] = [];
    let skippedNoEmbeddings = 0;

    for (const st of candidates) {
      const id = normalizeStatementId(st?.id);
      if (!id) continue;
      if (exSetA.has(id) || exSetB.has(id)) continue;

      const stance = normalizeStance(st?.stance);
      const regionId = st?.geometricCoordinates?.regionId != null ? String(st.geometricCoordinates.regionId) : null;

      const regionBoostA = domARegion && regionId && domARegion === regionId ? 0.03 : 0;
      const regionBoostB = domBRegion && regionId && domBRegion === regionId ? 0.03 : 0;

      let simA: number | null = null;
      let simB: number | null = null;

      if (embeddings) {
        simA = maxSimilarity(id, sideAEx, embeddings);
        simB = maxSimilarity(id, sideBEx, embeddings);
        if (simA == null || simB == null) skippedNoEmbeddings++;
      }

      const regionOnlyEligible =
        !embeddings &&
        regionId &&
        domARegion &&
        domBRegion &&
        domARegion !== domBRegion &&
        (regionId === domARegion || regionId === domBRegion);

      if (regionOnlyEligible) {
        if (regionId === domARegion && stanceA.allowed.has(stance)) picksA.push({ id, score: 0.5 });
        if (regionId === domBRegion && stanceB.allowed.has(stance)) picksB.push({ id, score: 0.5 });
        continue;
      }

      if (simA == null || simB == null) continue;

      const scoreA = simA + regionBoostA;
      const scoreB = simB + regionBoostB;

      if (scoreA >= similarityThreshold && scoreA - scoreB >= similarityMargin && stanceA.allowed.has(stance)) {
        picksA.push({ id, score: scoreA - scoreB });
      } else if (scoreB >= similarityThreshold && scoreB - scoreA >= similarityMargin && stanceB.allowed.has(stance)) {
        picksB.push({ id, score: scoreB - scoreA });
      }
    }

    picksA.sort((a, b) => b.score - a.score);
    picksB.sort((a, b) => b.score - a.score);

    const addUpTo = (picks: CandidatePick[], set: Set<string>) => {
      for (const pick of picks) {
        if (set.size >= maxPerSide) break;
        set.add(pick.id);
      }
    };

    addUpTo(picksA, advocacyA);
    addUpTo(picksB, advocacyB);

    const overlap = Array.from(advocacyA).filter((id) => advocacyB.has(id));
    if (overlap.length > 0) {
      for (const id of overlap) {
        if (exSetA.has(id) && !exSetB.has(id)) {
          advocacyB.delete(id);
          continue;
        }
        if (exSetB.has(id) && !exSetA.has(id)) {
          advocacyA.delete(id);
          continue;
        }
      }
    }

    p.sideAAdvocacyStatementIds = Array.from(advocacyA);
    p.sideBAdvocacyStatementIds = Array.from(advocacyB);
    p.advocacyMeta = {
      candidatePool,
      similarityThreshold,
      similarityMargin,
      maxPerSide,
      sideAAdded: Math.max(0, advocacyA.size - sideAEx.length),
      sideBAdded: Math.max(0, advocacyB.size - sideBEx.length),
      skippedNoEmbeddings,
    };

    expanded.push(p);
  }

  return { partitions: expanded, meta: { input: items.length, expanded: expanded.length } };
}

/**
 * Wrapper around the shared parser that provides specific SemanticMapperOutput typing.
 */
export function parseSemanticMapperOutput(
  rawResponse: string,
  shadowStatements?: unknown
): ParseResult {
  const result = baseParseOutput(rawResponse);

  function isUnifiedMapperOutput(parsed: unknown): parsed is UnifiedMapperOutput {
    if (parsed === null || typeof parsed !== 'object') return false;

    const obj = parsed as Record<string, unknown>;

    const hasClaimStructure =
      Array.isArray(obj.claims) &&
      Array.isArray(obj.edges);

    return hasClaimStructure;
  }

  let output = isUnifiedMapperOutput(result.output) ? result.output : undefined;
  const errors = result.errors ? [...result.errors] : [];
  const warnings = result.warnings ? [...result.warnings] : [];
  let narrative = result.narrative;

  if (!output) {
    const normalizedText = String(rawResponse || '')
      .replace(/\\+(?=<)/g, '')
      .replace(/\\+(?=>)/g, '');

    const mapTagPattern = /<map\b[^>]*>([\s\S]*?)<\/map\s*>/gi;
    const narrativeTagPattern = /<narrative\b[^>]*>([\s\S]*?)<\/narrative\s*>/gi;

    const mapMatches = Array.from(normalizedText.matchAll(mapTagPattern));
    const narrativeMatches = Array.from(normalizedText.matchAll(narrativeTagPattern));

    let mapContent = mapMatches.length > 0 ? mapMatches[mapMatches.length - 1]?.[1] : null;
    const narrativeContent = narrativeMatches.length > 0 ? narrativeMatches[narrativeMatches.length - 1]?.[1] : null;

    if (!mapContent) {
      const openIdx = normalizedText.search(/<map\b[^>]*>/i);
      if (openIdx !== -1) {
        const afterOpen = normalizedText.slice(openIdx);
        const tagEnd = afterOpen.indexOf('>');
        if (tagEnd !== -1) {
          mapContent = afterOpen.slice(tagEnd + 1);
        }
      }
    }

    let parsedMap: any | null = null;
    if (mapContent && mapContent.trim().length > 0) {
      parsedMap = extractJsonFromContent(mapContent);
    }
    if (!parsedMap) {
      parsedMap = extractJsonFromContent(normalizedText);
    }

    if (parsedMap && typeof parsedMap === 'object') {
      const obj = parsedMap as any;
      const hasClaimStructure =
        Array.isArray(obj.claims) &&
        Array.isArray(obj.edges);

      if (hasClaimStructure) {
        output = {
          claims: Array.isArray(obj.claims) ? obj.claims : [],
          edges: Array.isArray(obj.edges) ? obj.edges : [],
          conditionals: Array.isArray(obj.conditionals) ? obj.conditionals : [],
        };

        if (!narrative) {
          if (typeof obj.narrative === 'string') {
            narrative = String(obj.narrative);
          } else if (typeof narrativeContent === 'string' && narrativeContent.trim().length > 0) {
            narrative = String(narrativeContent).trim();
          }
        }
      }
    }
  }

  if (result.success && !output) {
    errors.push({ field: 'output', issue: 'Invalid UnifiedMapperOutput shape' });
  }

  if (output) {
    const allowedStatementIds =
      Array.isArray(shadowStatements)
        ? new Set(
            shadowStatements
              .map((s: any) => normalizeStatementId(s?.id))
              .filter(Boolean) as string[]
          )
        : null;

    const rawParsed = result.output as any;
    const focalExtract = extractPartitionsFromParsedMap(rawParsed, 'focal', allowedStatementIds, 'partition_');
    const emergentExtract = extractPartitionsFromParsedMap(rawParsed, 'emergent', allowedStatementIds, 'fork_');

    if (focalExtract.errors.length > 0) errors.push(...focalExtract.errors);
    if (emergentExtract.errors.length > 0) errors.push(...emergentExtract.errors);
    if (focalExtract.warnings.length > 0) warnings.push(...focalExtract.warnings);
    if (emergentExtract.warnings.length > 0) warnings.push(...emergentExtract.warnings);

    output.partitions = focalExtract.partitions;
    output.emergentForks = emergentExtract.partitions;
  }

  return {
    success: !!output,
    output,
    narrative,
    errors,
    warnings
  };
}
