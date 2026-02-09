import { Claim, Edge, MapperArtifact, ParsedMapperOutput, GraphTopology, ConciergeDelta } from './contract';

/**
 * Shared Parsing Utilities
 * 
 * Single source of truth for parsing mapping responses and concierge outputs.
 * Cleaned up to support V3 Unified Output (<map>, <narrative>) and Concierge signals.
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
            c === '"' ||
            c === '\\' ||
            c === '/' ||
            c === 'b' ||
            c === 'f' ||
            c === 'n' ||
            c === 'r' ||
            c === 't' ||
            c === 'u';

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
                if (esc) {
                    esc = false;
                    continue;
                }
                if (ch === '\\') {
                    esc = true;
                    continue;
                }
                if (ch === quote) {
                    quote = null;
                }
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
                    if (a === '*' && b === '/') {
                        i++;
                        break;
                    }
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
                if (esc) {
                    esc = false;
                    continue;
                }
                if (ch === '\\') {
                    esc = true;
                    continue;
                }
                if (ch === quote) {
                    quote = null;
                }
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
                if (nextNonWs === '}' || nextNonWs === ']') {
                    continue;
                }
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
                if (esc) {
                    esc = false;
                    continue;
                }
                if (ch === '\\') {
                    esc = true;
                    continue;
                }
                if (ch === quote) {
                    quote = null;
                }
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
                if (/\s/.test(ch)) {
                    out += ch;
                    continue;
                }
                if (ch === '}') {
                    expectingKey = false;
                    out += ch;
                    continue;
                }
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

    const noComments = stripComments(input);
    const noTrailing = removeTrailingCommas(noComments);
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
                } catch {
                    return { ok: false, value: null };
                }
            }
        } catch {
            return { ok: false, value: null };
        }
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
                if (esc) {
                    esc = false;
                    continue;
                }
                if (ch === '\\') {
                    esc = true;
                    continue;
                }
                if (ch === quote) {
                    quote = null;
                }
                continue;
            }

            if (ch === '"' || ch === "'") {
                quote = ch as any;
                continue;
            }

            if (ch === '{') depth++;
            if (ch === '}') {
                depth--;
                if (depth === 0) {
                    return src.slice(startObj, i + 1);
                }
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
        try {
            return JSON.parse(jsonText.substring(firstBrace, lastBrace + 1));
        } catch { }
    }

    try {
        return JSON.parse(jsonText);
    } catch {
        return null;
    }
}

// ============================================================================ 
// MAPPER ARTIFACT PARSING
// ============================================================================ 

export function createEmptyMapperArtifact(): MapperArtifact {
    return {
        claims: [],
        edges: [],
        ghosts: [],
        query: "",
        turn: 0,
        timestamp: new Date().toISOString(),
        model_count: 0,
    };
}

export function extractAnchorPositions(narrative: string): Array<{ label: string; id: string; position: number }> {
    const anchors: Array<{ label: string; id: string; position: number }> = [];
    const pattern = /\*\*\[([^\]|]+)\|([^\]]+)\]\*\*|\[([^\]|]+)\|([^\]]+)\]/g;

    let match;
    while ((match = pattern.exec(narrative)) !== null) {
        const label = (match[1] ?? match[3] ?? '').trim();
        const id = (match[2] ?? match[4] ?? '').trim();
        if (!label || !id) continue;
        anchors.push({
            label,
            id,
            position: match.index
        });
    }
    return anchors;
}

/**
 * Parse Unified Mapper Output (V3)
 * Extracts content from <narrative> and <map> tags.
 */
export function parseUnifiedMapperOutput(text: string): ParsedMapperOutput {
    if (!text) {
        return {
            claims: [],
            edges: [],
            ghosts: [],
            narrative: "",
            map: { claims: [], edges: [], ghosts: [] },
            anchors: [],
            topology: null,
            options: null,
            artifact: null
        };
    }

    const normalizedText = text
        .replace(/\\+(?=<)/g, '')
        .replace(/\\+(?=>)/g, '');

    type HeadingBlock = {
        kind: 'map' | 'narrative';
        headerStart: number;
        contentStart: number;
    };

    const headingBlocks: HeadingBlock[] = [];
    const headingRe = /^#{1,6}\s*THE\s*(MAP|NARRATIVE)\b.*$/gim;
    let hm: RegExpExecArray | null;
    while ((hm = headingRe.exec(normalizedText)) !== null) {
        const headerStart = typeof hm.index === 'number' ? hm.index : -1;
        if (headerStart < 0) continue;
        const headerLineEnd = normalizedText.indexOf('\n', headerStart);
        const contentStart = headerLineEnd === -1 ? normalizedText.length : headerLineEnd + 1;
        const kind = String(hm[1] || '').toLowerCase() === 'map' ? 'map' : 'narrative';
        headingBlocks.push({ kind, headerStart, contentStart });
    }

    headingBlocks.sort((a, b) => a.headerStart - b.headerStart);

    const getHeadingBlockContent = (kind: HeadingBlock['kind']): { content: string; start: number; end: number } | null => {
        const idx = [...headingBlocks].reverse().findIndex(b => b.kind === kind);
        if (idx === -1) return null;
        const blockIndex = headingBlocks.length - 1 - idx;
        const block = headingBlocks[blockIndex];
        const next = headingBlocks.find((b, i) => i > blockIndex && b.headerStart > block.headerStart);
        const end = next ? next.headerStart : normalizedText.length;
        const content = normalizedText.slice(block.contentStart, end).trim();
        return { content, start: block.headerStart, end };
    };

    const mapSection = getHeadingBlockContent('map');
    const narrativeSection = getHeadingBlockContent('narrative');

    // 1. Try V3 Extraction (<map> and <narrative>)
    const mapTagPattern = /<map\b[^>]*>([\s\S]*?)<\/map\s*>/gi;
    const narrativeTagPattern = /<narrative\b[^>]*>([\s\S]*?)<\/narrative\s*>/gi;
    const rawNarrativeTagPattern = /<raw_narrative\b[^>]*>([\s\S]*?)<\/raw_narrative\s*>/gi;

    const mapMatches = Array.from(normalizedText.matchAll(mapTagPattern));
    const narrativeMatches = Array.from(normalizedText.matchAll(narrativeTagPattern));
    const rawNarrativeMatches = Array.from(normalizedText.matchAll(rawNarrativeTagPattern));
    const narrativeMatch = narrativeMatches.length > 0 ? narrativeMatches[narrativeMatches.length - 1] : null;
    const rawNarrativeMatch = rawNarrativeMatches.length > 0 ? rawNarrativeMatches[rawNarrativeMatches.length - 1] : null;

    let map: any = { claims: [], edges: [], ghosts: [] };
    let foundV3Map = false;
    let narrativeFromHeading: string | null = narrativeSection?.content ? narrativeSection.content : null;

    // A. Explicit Tag Match
    if (mapMatches.length > 0) {
        for (let i = mapMatches.length - 1; i >= 0; i--) {
            const content = mapMatches[i]?.[1];
            if (!content) continue;
            const extracted = extractJsonFromContent(content);
            if (extracted && typeof extracted === 'object' && Array.isArray((extracted as any).claims) && Array.isArray((extracted as any).edges)) {
                map = extracted;
                foundV3Map = true;
                break;
            }
        }
    } else {
        const openIdx = normalizedText.search(/<map\b[^>]*>/i);
        if (openIdx !== -1) {
            const afterOpen = normalizedText.slice(openIdx);
            const tagEnd = afterOpen.indexOf('>');
            if (tagEnd !== -1) {
                const content = afterOpen.slice(tagEnd + 1);
                const extracted = extractJsonFromContent(content);
                if (extracted && typeof extracted === 'object' && Array.isArray((extracted as any).claims) && Array.isArray((extracted as any).edges)) {
                    map = extracted;
                    foundV3Map = true;
                }
            }
        }
    }

    if (!foundV3Map && mapSection?.content) {
        const extracted = extractJsonFromContent(mapSection.content);
        if (extracted && typeof extracted === 'object' && Array.isArray((extracted as any).claims) && Array.isArray((extracted as any).edges)) {
            map = extracted;
            foundV3Map = true;
        }
    }

    // B. Fallback: Look for V3 JSON structure anywhere if tags failed or missing
    if (!foundV3Map) {
        try {
            const extracted = extractJsonFromContent(normalizedText);
            // Check signature of V3 map
            if (extracted && Array.isArray(extracted.claims) && Array.isArray(extracted.edges)) {
                map = extracted;
                foundV3Map = true;
            }
        } catch { }
    }

    let narrative = "";
    const candidates: string[] = [];
    if (narrativeMatch && narrativeMatch[1]) candidates.push(String(narrativeMatch[1]).trim());
    if (rawNarrativeMatch && rawNarrativeMatch[1]) candidates.push(String(rawNarrativeMatch[1]).trim());
    if (narrativeFromHeading) {
        candidates.push(
            narrativeFromHeading
                .replace(/<narrative\b[^>]*>/i, '')
                .replace(/<\/narrative\s*>/i, '')
                .replace(/<raw_narrative\b[^>]*>/i, '')
                .replace(/<\/raw_narrative\s*>/i, '')
                .trim()
        );
    }
    candidates.sort((a, b) => b.length - a.length);
    narrative = candidates.find((c) => c && c.trim()) || "";

    if (!narrative) {
        // Fallback: if map is found but no narrative tag, assume rest is narrative
        narrative = normalizedText.replace(/<map\b[^>]*>[\s\S]*?<\/map\s*>/i, '').trim();
        if (mapSection) {
            narrative = (normalizedText.slice(0, mapSection.start) + normalizedText.slice(mapSection.end)).trim();
        }
    }

    const anchors = extractAnchorPositions(narrative);

    const normalizeClaimType = (t: any): Claim["type"] => {
        const v = String(t || "").toLowerCase();
        if (v === "factual" || v === "prescriptive" || v === "conditional" || v === "contested" || v === "speculative") {
            return v as Claim["type"];
        }
        return "speculative";
    };

    const normalizeClaimRole = (r: any): Claim["role"] => {
        const v = String(r || "").toLowerCase();
        if (v === "anchor" || v === "branch" || v === "challenger" || v === "supplement") {
            return v as Claim["role"];
        }
        return "branch";
    };

    const normalizedClaims: Claim[] = Array.isArray((map as any).claims)
        ? (map as any).claims
            .filter((c: any) => c && (c.id || c.label))
            .map((c: any): Claim => {
                const role = normalizeClaimRole(c.role);
                return {
                    id: String(c.id ?? ""),
                    label: String(c.label ?? ""),
                    text: String(c.text ?? ""),
                    supporters: Array.isArray(c.supporters) ? c.supporters.filter((s: any) => typeof s === "number") : [],
                    type: normalizeClaimType(c.type),
                    role,
                    challenges: role === "challenger" && typeof c.challenges === "string" ? c.challenges : null,
                    ...(typeof c.quote === "string" ? { quote: c.quote } : {}),
                    ...(typeof c.support_count === "number" ? { support_count: c.support_count } : {}),
                };
            })
            .filter((c: any) => c.id && c.label)
        : [];

    const normalizeEdgeType = (e: any): Edge["type"] => {
        const t = String(e?.type ?? "").toLowerCase();
        if (t === "supports" || t === "support") return "supports";
        if (t === "tradeoff") return "tradeoff";
        if (t === "conflicts") return "conflicts";
        if (t === "conflict") {
            const q = typeof e?.question === "string" ? e.question.trim() : "";
            return q ? "conflicts" : "tradeoff";
        }
        return "supports";
    };

    const normalizedEdges: Edge[] = Array.isArray((map as any).edges)
        ? (map as any).edges
            .filter((e: any) => e && (e.from || e.to))
            .map((e: any) => ({
                from: String(e.from ?? ""),
                to: String(e.to ?? ""),
                type: normalizeEdgeType(e),
            }))
            .filter((e: any) => e.from && e.to)
        : [];

    const normalizedGhosts: string[] | null =
        (map as any).ghosts == null
            ? null
            : Array.isArray((map as any).ghosts)
                ? (map as any).ghosts.map((g: any) => String(g)).filter((g: any) => g && g.trim())
                : [String((map as any).ghosts)].filter((g: any) => g && g.trim());

    // Auto-generate topology from map for compatibility
    let topology: GraphTopology | null = null;
    if (normalizedClaims.length > 0 || normalizedEdges.length > 0) {
        topology = {
            nodes: normalizedClaims.map((c: any) => ({
                id: c.id,
                label: c.label,
                theme: c.type,
                supporters: Array.isArray(c.supporters) ? c.supporters.filter((s: any) => typeof s === 'number') : [],
                support_count: (c.supporters?.length || 0)
            })),
            edges: normalizedEdges.map((e: any) => ({
                source: e.from,
                target: e.to,
                type: e.type,
                reason: e.type
            }))
        };
    }

    const artifact = {
        ...createEmptyMapperArtifact(),
        claims: normalizedClaims,
        edges: normalizedEdges,
        ghosts: normalizedGhosts,
        narrative,
        anchors
    };

    return {
        claims: normalizedClaims,
        edges: normalizedEdges,
        ghosts: normalizedGhosts,
        narrative,
        map: { claims: normalizedClaims, edges: normalizedEdges, ghosts: normalizedGhosts },
        anchors,
        topology,
        options: null,
        artifact
    };
}

/**
 * Robustly parse MapperArtifact from text.
 * Uses parseUnifiedMapperOutput logic primarily.
 */
export function parseMapperArtifact(text: string): MapperArtifact {
    if (!text) return createEmptyMapperArtifact();

    // 1. Try Unified Tagged Parser
    const unified = parseUnifiedMapperOutput(text);
    if (unified.artifact && unified.artifact.claims && unified.artifact.claims.length > 0) {
        return {
            ...unified.artifact,
            narrative: unified.narrative || unified.artifact.narrative,
            anchors: unified.anchors || unified.artifact.anchors
        };
    }

    // 2. Try raw JSON fallback (if the text IS just the JSON object)
    try {
        const extracted = extractJsonFromContent(text);
        if (extracted && Array.isArray(extracted.claims)) {
            return {
                ...createEmptyMapperArtifact(),
                ...extracted
            };
        }
    } catch { }

    return createEmptyMapperArtifact();
}


// ============================================================================ 
// CONCIERGE BATCH REQUEST PARSING
// ============================================================================ 

/**
 * Signal types for concierge-triggered batch requests
 */
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

/**
 * Parse concierge output to extract user-facing response and any batch request signals.
 * The signal is delimited by <<<SINGULARITY_BATCH_REQUEST>>> ... <<<END_BATCH_REQUEST>>> 
 */
export function parseConciergeOutput(rawResponse: string): ConciergeOutput {
    if (!rawResponse) {
        return { userResponse: '', signal: null };
    }

    // Look for the signal delimiter
    const signalMatch = rawResponse.match(
        /<<<SINGULARITY_BATCH_REQUEST>>>([\s\S]*?)<<<END_BATCH_REQUEST>>>/
    );

    if (!signalMatch) {
        return {
            userResponse: rawResponse.trim(),
            signal: null
        };
    }

    // Extract user-facing response (everything before the signal)
    const userResponse = rawResponse
        .substring(0, rawResponse.indexOf('<<<SINGULARITY_BATCH_REQUEST>>>'))
        .trim();

    // Parse the signal content
    const signalContent = signalMatch[1];
    const signal = parseSignalContent(signalContent);

    return {
        userResponse,
        signal
    };
}

/**
 * Parse the content inside the batch request delimiters
 */
function parseSignalContent(content: string): ConciergeSignal {
    if (!content) return null;

    // Extract TYPE
    const typeMatch = content.match(/TYPE:\s*(\w+)/i);
    const type = typeMatch?.[1]?.toUpperCase();

    // Extract PROMPT (everything after "PROMPT:")
    const promptMatch = content.match(/PROMPT:\s*([\s\S]*?)$/);
    const batchPrompt = promptMatch?.[1]?.trim() || '';

    if (!batchPrompt) {
        console.warn('[parsing-utils] Signal detected but no batch prompt found');
        return null;
    }

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

    console.warn(`[parsing-utils] Unknown signal type: ${type}`);
    return null;
}

/**
 * Validate a batch prompt for quality
 */
export function validateBatchPrompt(prompt: string): { valid: boolean; issues: string[] } {
    const issues: string[] = [];

    if (!prompt) {
        issues.push('Prompt is empty');
        return { valid: false, issues };
    }

    // Check for expert role at start
    const startsWithRole = /^You are (a |an |the )/i.test(prompt.trim());
    if (!startsWithRole) {
        issues.push('Prompt should start with an expert role definition ("You are a...")');
    }

    // Check for specificity
    if (prompt.length < 200) {
        issues.push('Prompt seems too short—may lack necessary context');
    }

    // Check for generic role
    const genericRoles = [
        /You are an? (expert|assistant|helper|AI)/i,
        /You are an? (software engineer|developer|marketer)\.?\s/i, // Too generic if no qualifiers
    ];
    if (genericRoles.some(p => p.test(prompt))) {
        issues.push('Expert role may be too generic—add specific credentials and experience');
    }

    // Check for context section
    if (!/context|situation|background/i.test(prompt)) {
        issues.push('Prompt may be missing context section');
    }

    // Check for output specification
    if (!/provide|create|generate|output|deliverable/i.test(prompt)) {
        issues.push('Prompt may be missing clear output specification');
    }

    return {
        valid: issues.length === 0,
        issues
    };
}

// ============================================================================ 
// CONCIERGE HANDOFF PARSING (Phase 2: Conversational Evolution)
// ============================================================================ 

/**
 * Regex to match handoff blocks in concierge responses.
 */
const HANDOFF_REGEX = /--- ?HANDOFF ?---\r?\n?([\s\S]*?)--- ?\/HANDOFF ?---/i;

/**
 * Regex for COMMIT signal (unique marker to avoid false positives)
 */
const COMMIT_MARKER_REGEX = />>>COMMIT:\s*(.+)$/m;

/**
 * Placeholders to reject - model echoing instructions verbatim
 */
const BLOCKED_COMMIT_PLACEHOLDERS = [
    '[decision summary]',
    '[what was decided and what user wants to do next]',
    '[only if user commits to a plan or requests execution guidance — summarize decision and intent]',
    '[only if user commits to a plan or requests execution guidance - summarize decision and intent]',
];

export interface ParsedHandoffResponse {
    /** Response to show the user (handoff block stripped) */
    userFacing: string;
    /** Parsed handoff data or null if no handoff block found */
    handoff: ConciergeDelta | null;
}

/**
 * Parse concierge response to extract and strip handoff block.
 */
export function parseHandoffResponse(raw: string): ParsedHandoffResponse {
    if (!raw || typeof raw !== 'string') {
        return { userFacing: raw || '', handoff: null };
    }

    const match = raw.match(HANDOFF_REGEX);

    if (!match) {
        return { userFacing: raw.trim(), handoff: null };
    }

    // Strip the handoff block from user-facing response
    const userFacing = raw.replace(HANDOFF_REGEX, '').trim();

    // Parse the handoff block content
    const handoff = parseHandoffBlock(match[1]);

    return { userFacing, handoff };
}

function parseCommitField(text: string): string | null {
    const match = text.match(COMMIT_MARKER_REGEX);
    if (!match?.[1]) return null;

    const commitText = match[1].trim();
    const lowerText = commitText.toLowerCase();

    // 1. Block exact template placeholders
    if (BLOCKED_COMMIT_PLACEHOLDERS.some(p => lowerText === p.toLowerCase())) {
        return null;
    }

    // 2. Block short bracketed content (≤3 words) — likely placeholder
    if (/^\[[^\]]+\]$/.test(commitText)) {
        const inner = commitText.slice(1, -1).trim();
        const wordCount = inner.split(/\s+/).length;
        if (wordCount <= 3) {
            return null;
        }
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

    if (!text || typeof text !== 'string') {
        return delta;
    }

    // Parse COMMIT field separately
    delta.commit = parseCommitField(text);

    // Parse other fields
    for (const line of text.split('\n')) {
        // Skip lines that are COMMIT (already handled)
        if (line.trim().startsWith('>>>COMMIT:')) continue;

        const colonIndex = line.indexOf(':');
        if (colonIndex === -1) continue;

        const key = line.slice(0, colonIndex).trim().toLowerCase();
        const value = line.slice(colonIndex + 1).trim();

        // Skip empty values or explicit "none"
        if (!value || value.toLowerCase() === 'none') continue;

        // Parse semicolon-separated items, trim whitespace, filter empty
        const items = value
            .split(';')
            .map(s => s.trim())
            .filter(s => s.length > 0);

        // Map to appropriate bucket
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
    if (!handoff || !hasHandoffContent(handoff)) {
        return null;
    }

    const lines = ['[Conversation context since last analysis:]'];
    const constraints = handoff.constraints ?? [];
    const eliminated = handoff.eliminated ?? [];
    const preferences = handoff.preferences ?? [];
    const context = handoff.context ?? [];

    if (constraints.length > 0) {
        lines.push(`Constraints: ${constraints.join('; ')}`);
    }
    if (eliminated.length > 0) {
        lines.push(`Ruled out: ${eliminated.join('; ')}`);
    }
    if (preferences.length > 0) {
        lines.push(`Preferences: ${preferences.join('; ')}`);
    }
    if (context.length > 0) {
        lines.push(`Situation: ${context.join('; ')}`);
    }

    return lines.join('\n');
}

export function formatHandoffEcho(handoff: ConciergeDelta | null | undefined): string {
    if (!handoff) return '';
    const commit = handoff.commit ?? null;
    if (!hasHandoffContent(handoff)) {
        return '';
    }

    const lines: string[] = ['Your current handoff (update if needed):'];
    lines.push('');
    lines.push('---HANDOFF---');

    const constraints = handoff.constraints ?? [];
    const eliminated = handoff.eliminated ?? [];
    const preferences = handoff.preferences ?? [];
    const context = handoff.context ?? [];


    if (constraints.length > 0) {
        lines.push(`constraints: ${constraints.join('; ')}`);
    }
    if (eliminated.length > 0) {
        lines.push(`eliminated: ${eliminated.join('; ')}`);
    }
    if (preferences.length > 0) {
        lines.push(`preferences: ${preferences.join('; ')}`);
    }
    if (context.length > 0) {
        lines.push(`context: ${context.join('; ')}`);
    }
    if (commit) {
        lines.push(`>>>COMMIT: ${commit}`);
    }
    lines.push('---/HANDOFF---');

    return lines.join('\n');
}

// ============================================================================ 
// SEMANTIC MAPPER OUTPUT PARSING (V4)
// ============================================================================ 

export interface SemanticMapperParseError {
    field: string;
    issue: string;
    context?: string;
}

export interface SemanticMapperParseResult {
    success: boolean;
    output?: any; // Will be typed as SemanticMapperOutput in the caller
    narrative?: string;
    errors?: SemanticMapperParseError[];
    warnings?: string[];
}

/**
 * Robustly parse Semantic Mapper JSON output.
 * Extracts JSON from markdown fences or raw text and validates the structure.
 */
export function parseSemanticMapperOutput(
    rawResponse: string
): SemanticMapperParseResult {
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
        const extracted = extractJsonFromContent(normalizedText);
        parsedMap = extracted || null;
    }

    if (!parsedMap || typeof parsedMap !== 'object') {
        return {
            success: false,
            errors: [{ field: 'response', issue: 'No valid <map> JSON found in response' }],
        };
    }

    const claims = Array.isArray((parsedMap as any).claims) ? (parsedMap as any).claims : null;
    const determinants = Array.isArray((parsedMap as any).determinants)
        ? (parsedMap as any).determinants
        : null;
    const edges = Array.isArray((parsedMap as any).edges) ? (parsedMap as any).edges : null;
    const conditionals = Array.isArray((parsedMap as any).conditionals)
        ? (parsedMap as any).conditionals
        : [];

    if (!claims) {
        errors.push({ field: 'claims', issue: 'Missing or invalid claims array' });
        return { success: false, errors };
    }
    if (!determinants && !edges) {
        warnings.push('No determinants or edges present; proceeding with empty relationships');
    }

    const narrativeFromMap = typeof (parsedMap as any).narrative === 'string' ? String((parsedMap as any).narrative) : '';
    const narrative = String((narrativeContent || narrativeFromMap || '')).trim();

    const claimIds = new Set<string>();
    for (let i = 0; i < claims.length; i++) {
        const c = claims[i];
        const ctx = `claims[${i}]`;

        if (!c || typeof c !== 'object') {
            errors.push({ field: ctx, issue: 'Claim must be an object' });
            continue;
        }

        const id = String((c as any).id || '').trim();
        const label = String((c as any).label || '').trim();
        const text = String((c as any).text || '').trim();

        if (!id) errors.push({ field: `${ctx}.id`, issue: 'Missing id' });
        if (!label) errors.push({ field: `${ctx}.label`, issue: 'Missing label' });
        if (!text) errors.push({ field: `${ctx}.text`, issue: 'Missing text' });

        if (id) {
            if (claimIds.has(id)) errors.push({ field: `${ctx}.id`, issue: `Duplicate id: ${id}` });
            claimIds.add(id);
        }

        const supporters = (c as any).supporters;
        if (!Array.isArray(supporters) || supporters.some((s: any) => typeof s !== 'number')) {
            (c as any).supporters = [];
            warnings.push(`${ctx}.supporters is invalid; defaulting to []`);
        }
    }

    let finalEdges = edges || [];
    let finalConditionals = conditionals || [];
    let normalizedDeterminants: any[] = [];

    if (determinants) {
        const derivedEdges: any[] = [];
        const derivedConditionals: any[] = [];

        for (let i = 0; i < determinants.length; i++) {
            const d = determinants[i];
            const ctx = `determinants[${i}]`;

            if (!d || typeof d !== 'object') {
                errors.push({ field: ctx, issue: 'Determinant must be an object' });
                continue;
            }

            const type = String((d as any).type || '').trim();
            const fork = String(((d as any).fork ?? '') || '').trim();
            const hinge = String(((d as any).hinge ?? '') || '').trim();
            const question = String(((d as any).question ?? '') || '').trim();
            const rawClaims = Array.isArray((d as any).claims) ? (d as any).claims : [];
            const paths = (d as any).paths && typeof (d as any).paths === 'object' && !Array.isArray((d as any).paths) ? (d as any).paths : null;
            const pathClaimIds = paths ? Object.keys(paths).map((k) => String(k || '').trim()).filter(Boolean) : [];
            const detClaimIds = (pathClaimIds.length > 0 ? pathClaimIds : rawClaims.map((c: any) => String(c || '').trim()).filter(Boolean));
            const yesMeans = String(((d as any).yes_means ?? '') || '').trim();
            const noMeans = String(((d as any).no_means ?? '') || '').trim();

            if (type !== 'intrinsic' && type !== 'extrinsic') {
                warnings.push(`${ctx}.type is invalid; skipping`);
                continue;
            }
            if (!question) {
                warnings.push(`${ctx}.question is empty; skipping`);
                continue;
            }
            if (detClaimIds.length === 0) {
                warnings.push(`${ctx}.claims is empty; skipping`);
                continue;
            }

            if (!fork) warnings.push(`${ctx}.fork is empty`);
            if (!hinge) warnings.push(`${ctx}.hinge is empty`);

            const normalized: any = {
                type,
                fork,
                hinge,
                question,
                claims: detClaimIds,
            };
            if (paths) normalized.paths = paths;
            if (type === 'extrinsic') {
                if (yesMeans) normalized.yes_means = yesMeans;
                if (noMeans) normalized.no_means = noMeans;
            }
            normalizedDeterminants.push(normalized);

            if (type === 'intrinsic') {
                if (detClaimIds.length < 2) {
                    warnings.push(`${ctx}.claims has <2 items; no conflict edges derived`);
                    continue;
                }
                for (let a = 0; a < detClaimIds.length; a++) {
                    for (let b = a + 1; b < detClaimIds.length; b++) {
                        derivedEdges.push({
                            from: detClaimIds[a],
                            to: detClaimIds[b],
                            type: 'conflict',
                            question,
                        });
                    }
                }
            }

            if (type === 'extrinsic') {
                const id = String((d as any).id || `det_ext_${i + 1}`).trim();
                derivedConditionals.push({
                    id,
                    question,
                    affectedClaims: detClaimIds,
                });
            }
        }

        finalEdges = [...finalEdges, ...derivedEdges];
        finalConditionals = [...finalConditionals, ...derivedConditionals];
    }

    const sanitizedEdges: any[] = [];
    for (let i = 0; i < finalEdges.length; i++) {
        const e = finalEdges[i];
        const ctx = `edges[${i}]`;
        if (!e || typeof e !== 'object') {
            warnings.push(`${ctx} is not an object; dropped`);
            continue;
        }

        const from = String((e as any).from || '').trim();
        const to = String((e as any).to || '').trim();
        const type = String((e as any).type || '').trim();
        const q = typeof (e as any).question === 'string' ? String((e as any).question).trim() : '';

        if (!from || !to) {
            warnings.push(`${ctx} missing from/to; dropped`);
            continue;
        }

        if (type === 'conflict' || type === 'conflicts') {
            sanitizedEdges.push({ from, to, type: 'conflict', ...(q ? { question: q } : { question: null }) });
            continue;
        }

        if (type === 'tradeoff') {
            sanitizedEdges.push({ from, to, type: 'conflict', question: null });
            continue;
        }

        if (type === 'supports') {
            warnings.push(`${ctx}.type is "supports"; dropped (supports are derived later)`);
            continue;
        }

        warnings.push(`${ctx}.type is unsupported ("${type}"); dropped`);
    }
    finalEdges = sanitizedEdges;

    const sanitizedConditionals: any[] = [];
    for (let i = 0; i < finalConditionals.length; i++) {
        const c = finalConditionals[i];
        const ctx = `conditionals[${i}]`;
        if (!c || typeof c !== 'object') {
            warnings.push(`${ctx} is not an object; dropped`);
            continue;
        }

        const id = String((c as any).id || '').trim();
        const question = String((c as any).question || '').trim();
        const affectedClaims = Array.isArray((c as any).affectedClaims)
            ? (c as any).affectedClaims.map((x: any) => String(x || '').trim()).filter(Boolean)
            : [];

        if (!id || !question || affectedClaims.length === 0) {
            warnings.push(`${ctx} is missing id/question/affectedClaims; dropped`);
            continue;
        }

        sanitizedConditionals.push({ id, question, affectedClaims });
    }
    finalConditionals = sanitizedConditionals;

    if (errors.length === 0) {
        for (const id of claimIds) {
            if (!/^c_/i.test(id) && !/^claim_/i.test(id)) {
                warnings.push(`Non-standard claim id: ${id}`);
                break;
            }
        }
    }

    if (errors.length > 0) {
        return {
            success: false,
            errors,
            warnings: warnings.length > 0 ? warnings : undefined,
        };
    }

    return {
        success: true,
        output: {
            claims,
            ...(normalizedDeterminants.length > 0 ? { determinants: normalizedDeterminants } : {}),
            edges: finalEdges,
            conditionals: finalConditionals,
        },
        narrative,
        warnings: warnings.length > 0 ? warnings : undefined,
    };
}
