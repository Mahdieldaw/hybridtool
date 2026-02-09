import type { ShadowStatement } from './ShadowExtractor';
import type { Stance } from './StatementTypes';
import { STANCE_PRIORITY } from './StatementTypes';

export interface ShadowParagraph {
    id: string;
    modelIndex: number;
    paragraphIndex: number;

    statementIds: string[];

    dominantStance: Stance;
    stanceHints: Stance[];
    contested: boolean;
    confidence: number;

    signals: { sequence: boolean; tension: boolean; conditional: boolean };

    statements: Array<{
        id: string;
        text: string;
        stance: Stance;
        signals: string[];
    }>;

    _fullParagraph: string;
}

export interface ParagraphProjectionResult {
    paragraphs: ShadowParagraph[];
    meta: {
        totalParagraphs: number;
        byModel: Record<number, number>;
        contestedCount: number;
        processingTimeMs: number;
    };
}

function clipText(text: string, maxChars: number): string {
    const normalized = String(text || '').trim();
    if (normalized.length <= maxChars) return normalized;
    return normalized.slice(0, Math.max(0, maxChars)).trim();
}

function stancePrecedence(stance: Stance): number {
    const idx = STANCE_PRIORITY.indexOf(stance);
    return idx >= 0 ? idx : Number.POSITIVE_INFINITY;
}

function compareStances(a: Stance, b: Stance): number {
    const pa = stancePrecedence(a);
    const pb = stancePrecedence(b);
    if (pa !== pb) return pa - pb;
    if (a === b) return 0;
    return a < b ? -1 : 1;
}

function computeDominantStance(
    stances: Stance[],
    confidencesByStance: Map<Stance, number>
): { dominantStance: Stance; contested: boolean; stanceHints: Stance[] } {
    const stanceSet = new Set<Stance>(stances);
    const stanceHints = STANCE_PRIORITY.filter(s => stanceSet.has(s));

    const contested =
        (stanceSet.has('prescriptive') && stanceSet.has('cautionary')) ||
        (stanceSet.has('assertive') && stanceSet.has('uncertain'));

    if (contested) {
        const contestedStances = Array.from(stanceSet).sort(compareStances);
        return {
            dominantStance: contestedStances[0] ?? 'assertive',
            contested: true,
            stanceHints,
        };
    }

    let best: Stance = 'assertive';
    let bestWeight = -Infinity;
    for (const stance of stanceSet) {
        const weight = confidencesByStance.get(stance) ?? 0;
        if (weight > bestWeight) {
            best = stance;
            bestWeight = weight;
            continue;
        }
        if (weight === bestWeight) {
            const precedenceCmp = compareStances(stance, best);
            if (precedenceCmp < 0) {
                best = stance;
                continue;
            }
            if (precedenceCmp === 0 && stance < best) {
                best = stance;
            }
        }
    }

    return { dominantStance: best, contested: false, stanceHints };
}

export function projectParagraphs(statements: ShadowStatement[]): ParagraphProjectionResult {
    const startTime = performance.now();
    const MAX_STATEMENT_CHARS = 320;

    const groups = new Map<
        string,
        Array<{ stmt: ShadowStatement; sentenceIndex: number; encounter: number }>
    >();

    for (let encounter = 0; encounter < statements.length; encounter++) {
        const stmt = statements[encounter];
        const paragraphIndex = stmt.location?.paragraphIndex ?? 0;
        const sentenceIndex = stmt.location?.sentenceIndex ?? encounter;
        const key = `${stmt.modelIndex}:${paragraphIndex}`;

        const arr = groups.get(key) || [];
        arr.push({ stmt, sentenceIndex, encounter });
        groups.set(key, arr);
    }

    const paragraphKeys = Array.from(groups.keys())
        .map(key => {
            const [modelIndexStr, paragraphIndexStr] = key.split(':');
            return {
                key,
                modelIndex: Number(modelIndexStr),
                paragraphIndex: Number(paragraphIndexStr),
            };
        })
        .sort((a, b) =>
            (a.modelIndex - b.modelIndex) ||
            (a.paragraphIndex - b.paragraphIndex) ||
            (a.key < b.key ? -1 : 1)
        );

    const paragraphs: ShadowParagraph[] = [];
    const byModel: Record<number, number> = {};
    let contestedCount = 0;

    for (let i = 0; i < paragraphKeys.length; i++) {
        const { key, modelIndex, paragraphIndex } = paragraphKeys[i];
        const group = (groups.get(key) || [])
            .slice()
            .sort((a, b) =>
                (a.sentenceIndex - b.sentenceIndex) ||
                (a.encounter - b.encounter) ||
                (a.stmt.id < b.stmt.id ? -1 : 1)
            );

        byModel[modelIndex] = (byModel[modelIndex] || 0) + 1;

        const statementIds = group.map(g => g.stmt.id);

        const signalsAgg = group.reduce(
            (acc, g) => ({
                sequence: acc.sequence || !!g.stmt.signals?.sequence,
                tension: acc.tension || !!g.stmt.signals?.tension,
                conditional: acc.conditional || !!g.stmt.signals?.conditional,
            }),
            { sequence: false, tension: false, conditional: false }
        );

        const confidencesByStance = new Map<Stance, number>();
        let maxConfidence = 0;
        const stances: Stance[] = [];
        for (const g of group) {
            const stance = g.stmt.stance;
            stances.push(stance);
            const conf = typeof g.stmt.confidence === 'number' ? g.stmt.confidence : 0;
            maxConfidence = Math.max(maxConfidence, conf);
            confidencesByStance.set(stance, (confidencesByStance.get(stance) || 0) + conf);
        }

        const { dominantStance, contested, stanceHints } = computeDominantStance(
            stances,
            confidencesByStance
        );
        if (contested) contestedCount++;

        const statementsSurface = group.map(g => {
            const sigs: string[] = [];
            if (g.stmt.signals?.sequence) sigs.push('SEQ');
            if (g.stmt.signals?.tension) sigs.push('TENS');
            if (g.stmt.signals?.conditional) sigs.push('COND');

            return {
                id: g.stmt.id,
                text: clipText(g.stmt.text, MAX_STATEMENT_CHARS),
                stance: g.stmt.stance,
                signals: sigs,
            };
        });

        paragraphs.push({
            id: `p_${i}`,
            modelIndex,
            paragraphIndex,
            statementIds,
            dominantStance,
            stanceHints,
            contested,
            confidence: maxConfidence,
            signals: signalsAgg,
            statements: statementsSurface,
            _fullParagraph: group[0]?.stmt.fullParagraph ?? '',
        });
    }

    return {
        paragraphs,
        meta: {
            totalParagraphs: paragraphs.length,
            byModel,
            contestedCount,
            processingTimeMs: performance.now() - startTime,
        },
    };
}

