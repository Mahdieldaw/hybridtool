import { Claim, Edge, MapperArtifact, ConciergeDelta } from './contract';

/**
 * Shared Parsing Utilities
 * 
 * Single source of truth for parsing mapping responses and concierge outputs.
 * Cleaned up to support Concise Semantic Mapper Output and Concierge signals.
 */

// ============================================================================ 
// CENTRALIZED JSON EXTRACTION
// ============================================================================ 

export function repairJson(text: string): string {
    const input = String(text ?? '');
    if (!input) return '';

    const fixInvalidStringEscapes = (src: string): string => {
        let out = '';
        let quote: '"' | "'" | null = null;
        let esc = false;

        const isAllowedEscape = (c: string) =>
            c === '"' || c === '\\' || c === '/' || c === 'b' || c === 'f' || c === 'n' || c === 'r' || c === 't' || c === 'u';

        for (let i = 0; i < src.length; i++) {
            const ch = src[i];
            const next = i + 1 < src.length ? src[i + 1] : '';

            if (quote) {
                if (esc) {
                    esc = false;
                    out += ch;
                    continue;
                }
                if (ch === '\\') {
                    if (next && !isAllowedEscape(next)) {
                        out += next;
                        i++;
                        continue;
                    }
                    esc = true;
                    out += ch;
                    continue;
                }
                out += ch;
                if (ch === quote) {
                    quote = null;
                }
                continue;
            }

            out += ch;
            if (ch === '"' || ch === "'") {
                quote = ch as any;
                esc = false;
            }
        }
        return out;
    };

    const stripComments = (src: string): string => {
        let out = '';
        let quote: '"' | "'" | null = null;
        let esc = false;

        for (let i = 0; i < src.length; i++) {
            const ch = src[i];
            const next = i + 1 < src.length ? src[i + 1] : '';

            if (quote) {
                out += ch;
                if (esc) { esc = false; continue; }
                if (ch === '\\') { esc = true; continue; }
                if (ch === quote) { quote = null; }
                continue;
            }

            if (ch === '"' || ch === "'") {
                quote = ch as any;
                out += ch;
                continue;
            }

            if (ch === '/' && next === '/') {
                while (i < src.length && src[i] !== '\n') i++;
                if (i < src.length && src[i] === '\n') out += '\n';
                continue;
            }

            if (ch === '/' && next === '*') {
                i += 2;
                while (i < src.length) {
                    const a = src[i];
                    const b = i + 1 < src.length ? src[i + 1] : '';
                    if (a === '*' && b === '/') { i++; break; }
                    i++;
                }
                continue;
            }
            out += ch;
        }
        return out;
    };

    const removeTrailingCommas = (src: string): string => {
        let out = '';
        let quote: '"' | "'" | null = null;
        let esc = false;

        for (let i = 0; i < src.length; i++) {
            const ch = src[i];

            if (quote) {
                out += ch;
                if (esc) { esc = false; continue; }
                if (ch === '\\') { esc = true; continue; }
                if (ch === quote) { quote = null; }
                continue;
            }

            if (ch === '"' || ch === "'") {
                quote = ch as any;
                out += ch;
                continue;
            }

            if (ch === ',') {
                let j = i + 1;
                while (j < src.length && /\s/.test(src[j])) j++;
                const nextNonWs = j < src.length ? src[j] : '';
                if (nextNonWs === '}' || nextNonWs === ']') continue;
            }
            out += ch;
        }
        return out;
    };

    const quoteUnquotedKeys = (src: string): string => {
        let out = '';
        let quote: '"' | "'" | null = null;
        let esc = false;
        let expectingKey = false;

        const isKeyStart = (c: string) => /[A-Za-z_]/.test(c);
        const isKeyChar = (c: string) => /[A-Za-z0-9_]/.test(c);

        for (let i = 0; i < src.length; i++) {
            const ch = src[i];

            if (quote) {
                out += ch;
                if (esc) { esc = false; continue; }
                if (ch === '\\') { esc = true; continue; }
                if (ch === quote) { quote = null; }
                continue;
            }

            if (ch === '"' || ch === "'") {
                quote = ch as any;
                out += ch;
                expectingKey = false;
                continue;
            }

            if (ch === '{' || ch === ',') {
                expectingKey = true;
                out += ch;
                continue;
            }

            if (expectingKey) {
                if (/\s/.test(ch)) { out += ch; continue; }
                if (ch === '}') { expectingKey = false; out += ch; continue; }
                if (ch === '"' || ch === "'") {
                    quote = ch as any;
                    out += ch;
                    expectingKey = false;
                    continue;
                }
                if (isKeyStart(ch)) {
                    let key = ch;
                    let k = i + 1;
                    while (k < src.length && isKeyChar(src[k])) {
                        key += src[k];
                        k++;
                    }
                    let ws = '';
                    let j = k;
                    while (j < src.length && /\s/.test(src[j])) {
                        ws += src[j];
                        j++;
                    }
                    if (j < src.length && src[j] === ':') {
                        out += `"${key}"${ws}:`;
                        i = j;
                        expectingKey = false;
                        continue;
                    }
                    out += key;
                    i = k - 1;
                    expectingKey = false;
                    continue;
                }
                expectingKey = false;
            }
            out += ch;
        }
        return out;
    };

    // Fix model double-colon pattern: "id": "claim_8": "label text..."
    // Occurs when the model merges an id value and the next field's key onto one line.
    // Reconstructs the missing key as "label" since that is always the next claim field.
    const fixDoubleColonValues = (src: string): string => {
        return src.replace(
            /"([^"]+)"\s*:\s*"([^"]*)"\s*:\s*"/g,
            (_match, key, val1) => `"${key}": "${val1}", "label": "`
        );
    };

    const noComments = stripComments(input);
    const noDoubleColon = fixDoubleColonValues(noComments);
    const noTrailing = removeTrailingCommas(noDoubleColon);
    const quotedKeys = quoteUnquotedKeys(noTrailing);
    return fixInvalidStringEscapes(quotedKeys);
}

export function extractJsonObject(text: string): { json: any | null; path: string } {
    const raw = String(text ?? '').trim();
    if (!raw) return { json: null, path: 'none' };

    const tryParse = (candidate: string): { ok: boolean; value: any } => {
        try {
            const parsed = JSON.parse(candidate);
            if (parsed && typeof parsed === 'object') return { ok: true, value: parsed };
            if (typeof parsed === 'string') {
                try {
                    const parsed2 = JSON.parse(parsed);
                    if (parsed2 && typeof parsed2 === 'object') return { ok: true, value: parsed2 };
                } catch { return { ok: false, value: null }; }
            }
        } catch { return { ok: false, value: null }; }
        return { ok: false, value: null };
    };

    const tryParseWithRepair = (candidate: string): { ok: boolean; value: any; repaired: boolean } => {
        const direct = tryParse(candidate);
        if (direct.ok) return { ok: true, value: direct.value, repaired: false };
        const repairedText = repairJson(candidate);
        if (repairedText && repairedText !== candidate) {
            const repaired = tryParse(repairedText);
            if (repaired.ok) return { ok: true, value: repaired.value, repaired: true };
        }
        return { ok: false, value: null, repaired: false };
    };

    const extractCodeBlock = (src: string): string | null => {
        const m = src.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/i);
        return m?.[1]?.trim() ? m[1].trim() : null;
    };

    const extractBalancedBraces = (src: string): string | null => {
        const startObj = src.indexOf('{');
        if (startObj === -1) return null;
        let depth = 0;
        let quote: '"' | "'" | null = null;
        let esc = false;

        for (let i = startObj; i < src.length; i++) {
            const ch = src[i];
            if (quote) {
                if (esc) { esc = false; continue; }
                if (ch === '\\') { esc = true; continue; }
                if (ch === quote) { quote = null; }
                continue;
            }
            if (ch === '"' || ch === "'") {
                quote = ch as any;
                continue;
            }
            if (ch === '{') depth++;
            if (ch === '}') {
                depth--;
                if (depth === 0) return src.slice(startObj, i + 1);
            }
        }
        return null;
    };

    const direct = tryParseWithRepair(raw);
    if (direct.ok) return { json: direct.value, path: direct.repaired ? 'repaired' : 'direct' };

    const code = extractCodeBlock(raw);
    if (code) {
        const fromCode = tryParseWithRepair(code);
        if (fromCode.ok) return { json: fromCode.value, path: fromCode.repaired ? 'repaired' : 'code_block' };
        const braceInCode = extractBalancedBraces(code);
        if (braceInCode) {
            const fromBrace = tryParseWithRepair(braceInCode);
            if (fromBrace.ok) return { json: fromBrace.value, path: fromBrace.repaired ? 'repaired' : 'brace_match' };
        }
    }

    const brace = extractBalancedBraces(raw);
    if (brace) {
        const fromBrace = tryParseWithRepair(brace);
        if (fromBrace.ok) return { json: fromBrace.value, path: fromBrace.repaired ? 'repaired' : 'brace_match' };
    }

    return { json: null, path: 'none' };
}

export function extractJsonFromContent(content: string | null): any | null {
    if (!content) return null;
    const extracted = extractJsonObject(content);
    if (extracted.json) return extracted.json;

    let jsonText = content.trim();
    const codeFenceMatch = jsonText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (codeFenceMatch) jsonText = codeFenceMatch[1].trim();

    const firstBrace = jsonText.indexOf('{');
    const lastBrace = jsonText.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
        try { return JSON.parse(jsonText.substring(firstBrace, lastBrace + 1)); } catch { }
    }
    try { return JSON.parse(jsonText); } catch { return null; }
}

// ============================================================================ 
// CONCIERGE BATCH REQUEST PARSING
// ============================================================================ 

export interface WorkflowSignal {
    type: 'GENERATE_WORKFLOW';
    goal: string;
    context: string;
    batchPrompt: string;
}

export interface StepHelpSignal {
    type: 'STEP_HELP_NEEDED';
    step: string;
    blocker: string;
    constraint: string;
    batchPrompt: string;
}

export type ConciergeSignal = WorkflowSignal | StepHelpSignal | null;

export interface ConciergeOutput {
    userResponse: string;
    signal: ConciergeSignal;
}

export function parseConciergeOutput(rawResponse: string): ConciergeOutput {
    if (!rawResponse) return { userResponse: '', signal: null };

    const signalMatch = rawResponse.match(/<<<SINGULARITY_BATCH_REQUEST>>>([\s\S]*?)<<<END_BATCH_REQUEST>>>/);
    if (!signalMatch) {
        return { userResponse: rawResponse.trim(), signal: null };
    }

    const userResponse = rawResponse.substring(0, rawResponse.indexOf('<<<SINGULARITY_BATCH_REQUEST>>>')).trim();
    const signalContent = signalMatch[1];
    const signal = parseSignalContent(signalContent);

    return { userResponse, signal };
}

function parseSignalContent(content: string): ConciergeSignal {
    if (!content) return null;

    const typeMatch = content.match(/TYPE:\s*(\w+)/i);
    const type = typeMatch?.[1]?.toUpperCase();

    const promptMatch = content.match(/PROMPT:\s*([\s\S]*?)$/);
    const batchPrompt = promptMatch?.[1]?.trim() || '';

    if (!batchPrompt) return null;

    if (type === 'WORKFLOW') {
        const goalMatch = content.match(/GOAL:\s*([\s\S]+?)(?=\n(?:STEP:|BLOCKER:|CONTEXT:|PROMPT:)|$)/);
        const contextMatch = content.match(/CONTEXT:\s*([\s\S]+?)(?=\n(?:PROMPT:)|$)/);
        return {
            type: 'GENERATE_WORKFLOW',
            goal: goalMatch?.[1]?.trim() || '',
            context: contextMatch?.[1]?.trim() || '',
            batchPrompt
        };
    }

    if (type === 'STEP_HELP') {
        const stepMatch = content.match(/STEP:\s*([\s\S]+?)(?=\n(?:BLOCKER:|CONTEXT:|PROMPT:)|$)/);
        const blockerMatch = content.match(/BLOCKER:\s*([\s\S]+?)(?=\n(?:CONTEXT:|PROMPT:)|$)/);
        const contextMatch = content.match(/CONTEXT:\s*([\s\S]+?)(?=\n(?:PROMPT:)|$)/);
        return {
            type: 'STEP_HELP_NEEDED',
            step: stepMatch?.[1]?.trim() || '',
            blocker: blockerMatch?.[1]?.trim() || '',
            constraint: contextMatch?.[1]?.trim() || '',
            batchPrompt
        };
    }

    return null;
}

export function validateBatchPrompt(prompt: string): { valid: boolean; issues: string[] } {
    const issues: string[] = [];
    if (!prompt) {
        issues.push('Prompt is empty');
        return { valid: false, issues };
    }
    const startsWithRole = /^You are (a |an |the )/i.test(prompt.trim());
    if (!startsWithRole) issues.push('Prompt should start with an expert role definition ("You are a...")');
    if (prompt.length < 200) issues.push('Prompt seems too short—may lack necessary context');
    const genericRoles = [
        /You are an? (expert|assistant|helper|AI)/i,
        /You are an? (software engineer|developer|marketer)\.?\s/i,
    ];
    if (genericRoles.some(p => p.test(prompt))) issues.push('Expert role may be too generic—add specific credentials and experience');
    if (!/context|situation|background/i.test(prompt)) issues.push('Prompt may be missing context section');
    if (!/provide|create|generate|output|deliverable/i.test(prompt)) issues.push('Prompt may be missing clear output specification');

    return { valid: issues.length === 0, issues };
}

// ============================================================================ 
// CONCIERGE HANDOFF PARSING (Phase 2: Conversational Evolution)
// ============================================================================ 

const HANDOFF_REGEX = /--- ?HANDOFF ?---\r?\n?([\s\S]*?)--- ?\/HANDOFF ?---/i;
const COMMIT_MARKER_REGEX = />>>COMMIT:\s*(.+)$/m;
const BLOCKED_COMMIT_PLACEHOLDERS = [
    '[decision summary]',
    '[what was decided and what user wants to do next]',
    '[only if user commits to a plan or requests execution guidance — summarize decision and intent]',
    '[only if user commits to a plan or requests execution guidance - summarize decision and intent]',
];

export interface ParsedHandoffResponse {
    userFacing: string;
    handoff: ConciergeDelta | null;
}

export function parseHandoffResponse(raw: string): ParsedHandoffResponse {
    if (!raw || typeof raw !== 'string') {
        return { userFacing: raw || '', handoff: null };
    }

    const match = raw.match(HANDOFF_REGEX);

    if (!match) {
        return { userFacing: raw.trim(), handoff: null };
    }

    const userFacing = raw.replace(HANDOFF_REGEX, '').trim();
    const handoff = parseHandoffBlock(match[1]);

    return { userFacing, handoff };
}

function parseCommitField(text: string): string | null {
    const match = text.match(COMMIT_MARKER_REGEX);
    if (!match?.[1]) return null;

    const commitText = match[1].trim();
    const lowerText = commitText.toLowerCase();

    if (BLOCKED_COMMIT_PLACEHOLDERS.some(p => lowerText === p.toLowerCase())) {
        return null;
    }

    if (/^\[[^\]]+\]$/.test(commitText)) {
        const inner = commitText.slice(1, -1).trim();
        const wordCount = inner.split(/\s+/).length;
        if (wordCount <= 3) return null;
    }

    return commitText;
}

function parseHandoffBlock(text: string): ConciergeDelta {
    const delta: ConciergeDelta = {
        constraints: [],
        eliminated: [],
        preferences: [],
        context: [],
        commit: null
    };

    if (!text || typeof text !== 'string') return delta;

    delta.commit = parseCommitField(text);

    for (const line of text.split('\n')) {
        if (line.trim().startsWith('>>>COMMIT:')) continue;

        const colonIndex = line.indexOf(':');
        if (colonIndex === -1) continue;

        const key = line.slice(0, colonIndex).trim().toLowerCase();
        const value = line.slice(colonIndex + 1).trim();

        if (!value || value.toLowerCase() === 'none') continue;

        const items = value.split(';').map(s => s.trim()).filter(s => s.length > 0);

        switch (key) {
            case 'constraints':
            case 'constraint':
                delta.constraints = Array.from(new Set([...delta.constraints, ...items]));
                break;
            case 'eliminated':
            case 'eliminate':
            case 'ruled out':
            case 'ruled_out':
                delta.eliminated = Array.from(new Set([...delta.eliminated, ...items]));
                break;
            case 'preferences':
            case 'preference':
            case 'trade-offs':
            case 'tradeoffs':
                delta.preferences = Array.from(new Set([...delta.preferences, ...items]));
                break;
            case 'context':
            case 'situation':
            case 'situational':
                delta.context = Array.from(new Set([...delta.context, ...items]));
                break;
        }
    }

    return delta;
}

export function hasHandoffContent(delta: ConciergeDelta | null | undefined): boolean {
    if (!delta) return false;
    return (
        (delta.constraints?.length ?? 0) > 0 ||
        (delta.eliminated?.length ?? 0) > 0 ||
        (delta.preferences?.length ?? 0) > 0 ||
        (delta.context?.length ?? 0) > 0 ||
        delta.commit !== null
    );
}

export function formatHandoffContext(handoff: ConciergeDelta | null | undefined): string | null {
    if (!handoff || !hasHandoffContent(handoff)) return null;

    const lines = ['[Conversation context since last analysis:]'];
    if ((handoff.constraints ?? []).length > 0) lines.push(`Constraints: ${handoff.constraints!.join('; ')}`);
    if ((handoff.eliminated ?? []).length > 0) lines.push(`Ruled out: ${handoff.eliminated!.join('; ')}`);
    if ((handoff.preferences ?? []).length > 0) lines.push(`Preferences: ${handoff.preferences!.join('; ')}`);
    if ((handoff.context ?? []).length > 0) lines.push(`Situation: ${handoff.context!.join('; ')}`);

    return lines.join('\n');
}

export function formatHandoffEcho(handoff: ConciergeDelta | null | undefined): string {
    if (!handoff) return '';
    const commit = handoff.commit ?? null;
    if (!hasHandoffContent(handoff)) return '';

    const lines: string[] = ['Your current handoff (update if needed):', '', '---HANDOFF---'];

    if ((handoff.constraints ?? []).length > 0) lines.push(`constraints: ${handoff.constraints!.join('; ')}`);
    if ((handoff.eliminated ?? []).length > 0) lines.push(`eliminated: ${handoff.eliminated!.join('; ')}`);
    if ((handoff.preferences ?? []).length > 0) lines.push(`preferences: ${handoff.preferences!.join('; ')}`);
    if ((handoff.context ?? []).length > 0) lines.push(`context: ${handoff.context!.join('; ')}`);
    if (commit) lines.push(`>>>COMMIT: ${commit}`);

    lines.push('---/HANDOFF---');
    return lines.join('\n');
}

// ============================================================================ 
// SEMANTIC MAPPER OUTPUT PARSING (V4)
// ============================================================================ 

export interface SemanticMapperParseError {
    field: string;
    issue: string;
}

export interface SemanticMapperParseResult {
    success: boolean;
    output?: {
        claims: Claim[];
        edges: Edge[];
    };
    narrative?: string;
    errors?: SemanticMapperParseError[];
    warnings?: string[];
}

export function parseSemanticMapperOutput(rawResponse: string): SemanticMapperParseResult {
    const errors: SemanticMapperParseError[] = [];
    const warnings: string[] = [];

    const normalizedText = String(rawResponse || '')
        .replace(/\\+(?=<)/g, '')
        .replace(/\\+(?=>)/g, '');

    const mapTagPattern = /<map\b[^>]*>([\s\S]*?)<\/map\s*>/gi;
    const narrativeTagPattern = /<narrative\b[^>]*>([\s\S]*?)<\/narrative\s*>/gi;

    const mapMatches = Array.from(normalizedText.matchAll(mapTagPattern));
    const narrativeMatches = Array.from(normalizedText.matchAll(narrativeTagPattern));

    let mapContent = mapMatches.length > 0 ? mapMatches[mapMatches.length - 1]?.[1] : null;
    let narrative = narrativeMatches.length > 0 ? String(narrativeMatches[narrativeMatches.length - 1]?.[1] || '').trim() : '';

    if (!mapContent) {
        const extracted = extractJsonFromContent(normalizedText);
        if (extracted && typeof extracted === 'object' && Array.isArray(extracted.claims)) {
            mapContent = JSON.stringify(extracted);
        }
    }
    if (!narrative) {
        narrative = normalizedText.replace(mapTagPattern, '').trim();
    }

    const parsedMap = extractJsonFromContent(mapContent);
    if (!parsedMap || typeof parsedMap !== 'object') {
        return { success: false, errors: [{ field: 'response', issue: 'No valid JSON found in response' }] };
    }

    const rawClaims = Array.isArray(parsedMap.claims) ? parsedMap.claims : [];
    const rawEdges = Array.isArray(parsedMap.edges) ? parsedMap.edges : [];

    if (rawClaims.length === 0) {
        return { success: false, errors: [{ field: 'claims', issue: 'Missing or empty claims array' }] };
    }

    const claimIds = new Set<string>();
    const claims: Claim[] = [];

    for (let i = 0; i < rawClaims.length; i++) {
        const c = rawClaims[i];
        const ctx = `claims[${i}]`;

        if (!c || typeof c !== 'object') continue;

        const id = String(c.id || '').trim();
        const label = String(c.label || '').trim();
        const text = String(c.text || '').trim();

        if (!id) errors.push({ field: `${ctx}.id`, issue: 'Missing id' });
        else claimIds.add(id);

        let supporters = c.supporters;
        if (!Array.isArray(supporters) || supporters.some(s => typeof s !== 'number')) {
            supporters = [];
        }

        claims.push({
            id,
            label,
            text,
            supporters,
            stance: 'NEUTRAL',
            sourceStatementIds: []
        } as any);
    }

    const edges: Edge[] = [];

    for (let i = 0; i < rawEdges.length; i++) {
        const e = rawEdges[i];
        if (!e || typeof e !== 'object') continue;

        const from = String(e.from || '').trim();
        const to = String(e.to || '').trim();
        const rawType = String(e.type || '').trim().toLowerCase();

        if (!from || !to || !claimIds.has(from) || !claimIds.has(to)) {
            warnings.push(`edges[${i}] has invalid from/to references; dropped`);
            continue;
        }

        let type: Edge['type'] = 'supports';
        if (/^(conflicts?)$/.test(rawType)) type = 'conflicts';
        else if (rawType.includes('trade')) type = 'tradeoff';
        else if (rawType.includes('prerequisite')) type = 'prerequisite';

        edges.push({ from, to, type });
    }

    if (errors.length > 0) {
        return { success: false, errors, warnings: warnings.length > 0 ? warnings : undefined };
    }

    return {
        success: true,
        output: { claims, edges },
        narrative,
        warnings: warnings.length > 0 ? warnings : undefined,
    };
}

// ============================================================================ 
// MAPPER ARTIFACT UTILITY
// ============================================================================ 

export function createEmptyMapperArtifact(): MapperArtifact {
    return {
        claims: [],
        edges: [],

        query: "",
        turn: 0,
        timestamp: new Date().toISOString(),
        model_count: 0,
        narrative: ""
    };
}