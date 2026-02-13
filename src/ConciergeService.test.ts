import { ConciergeService } from './ConciergeService/ConciergeService';
import { buildSemanticMapperPrompt, parseSemanticMapperOutput } from './ConciergeService/semanticMapper';

describe('ConciergeService', () => {
    it('should build prompt without capabilities or signal instructions', () => {
        const prompt = ConciergeService.buildConciergePrompt('Hello', {
            isFirstTurn: false
        });

        expect(prompt).not.toContain('## Capabilities');
        expect(prompt).not.toContain('## Signal Format');
        expect(prompt).not.toContain('<<<SINGULARITY_BATCH_REQUEST>>>');
    });

    it('should include active workflow if provided', () => {
        const prompt = ConciergeService.buildConciergePrompt('Hello', {
            isFirstTurn: false,
            activeWorkflow: {
                goal: 'Test Goal',
                steps: [{
                    id: '1',
                    title: 'Step 1',
                    description: 'Do it',
                    doneWhen: 'Done',
                    status: 'active'
                }],
                currentStepIndex: 0
            }
        });

        expect(prompt).toContain('## Active Workflow');
        expect(prompt).toContain('Step 1');
    });

    it('should accept missing determinants and edges', () => {
        const raw = JSON.stringify({
            claims: [
                {
                    id: 'c_0',
                    label: 'do thing',
                    text: 'Do the thing.',
                    supporters: [1],
                    role: 'anchor',
                    challenges: null,
                },
            ],
        });

        const result = parseSemanticMapperOutput(raw);
        expect(result.success).toBe(true);
        expect(Array.isArray(result.output?.edges) ? result.output?.edges.length : null).toBe(0);
        expect(Array.isArray(result.output?.conditionals) ? result.output?.conditionals.length : null).toBe(0);
    });

    it('should treat trailing text after <map> as narrative when no narrative tag exists', () => {
        const mapObj = {
            claims: [
                {
                    id: 'c_0',
                    label: 'do thing',
                    text: 'Do the thing.',
                    supporters: [1],
                    role: 'anchor',
                    challenges: null,
                },
            ],
            edges: [],
            conditionals: [],
        };
        const raw = `<map>${JSON.stringify(mapObj)}</map>\n\nThis is the narrative after the map.\nIt should be captured.`;

        const result = parseSemanticMapperOutput(raw);
        expect(result.success).toBe(true);
        expect(String(result.narrative || '')).toContain('This is the narrative after the map.');
        expect(String(result.narrative || '')).toContain('It should be captured.');
        expect(String(result.narrative || '')).not.toContain('"claims"');
    });

    it('should include non-tag text in narrative even when <narrative> exists', () => {
        const mapObj = {
            claims: [
                {
                    id: 'c_0',
                    label: 'do thing',
                    text: 'Do the thing.',
                    supporters: [1],
                    role: 'anchor',
                    challenges: null,
                },
            ],
            edges: [],
            conditionals: [],
        };

        const raw = `PREFACE LINE\n<map>${JSON.stringify(mapObj)}</map>\n<narrative>Inside narrative.</narrative>\nEPILOGUE LINE`;

        const result = parseSemanticMapperOutput(raw);
        expect(result.success).toBe(true);
        expect(String(result.narrative || '')).toContain('Inside narrative.');
        expect(String(result.narrative || '')).toContain('PREFACE LINE');
        expect(String(result.narrative || '')).toContain('EPILOGUE LINE');
        expect(String(result.narrative || '')).not.toContain('"claims"');
    });

    it('should accept intrinsic determinants without questions', () => {
        const raw = JSON.stringify({
            claims: [{
                id: 'c_0',
                label: 'do thing',
                text: 'Do the thing.',
                supporters: [1],
                role: 'anchor',
                challenges: null,
            }],
            determinants: [{
                type: 'intrinsic',
                fork: 'incompatible goals',
                hinge: 'The project has a single non-negotiable primary outcome',
                question: 'Which outcome is non-negotiable right now?',
                claims: ['c_0', 'c_1'],
            }],
        });

        const result = parseSemanticMapperOutput(raw);
        expect(result.success).toBe(true);
        expect(result.output?.edges?.length).toBe(1);
        const e0 = result.output?.edges?.[0];
        expect(e0?.type).toBe('conflicts');
        expect(((e0 as any)?.question ?? null)).toBe('Which outcome is non-negotiable right now?');
    });

    it('should accept intrinsic determinants with questions', () => {
        const raw = JSON.stringify({
            claims: [{
                id: 'c_0',
                label: 'optimize for speed',
                text: 'Prioritize execution speed.',
                supporters: [1],
                role: 'anchor',
                challenges: null,
            }, {
                id: 'c_1',
                label: 'optimize for flexibility',
                text: 'Prioritize flexibility.',
                supporters: [2],
                role: 'anchor',
                challenges: null,
            }],
            determinants: [{
                type: 'intrinsic',
                fork: 'Mutually exclusive optimization target',
                hinge: 'Deadlines are fixed and missing them is unacceptable',
                question: 'Which matters more: speed or flexibility?',
                claims: ['c_0', 'c_1'],
            }],
        });

        const result = parseSemanticMapperOutput(raw);
        expect(result.success).toBe(true);
        expect(result.output?.edges?.length).toBe(1);
        const e0 = result.output?.edges?.[0];
        expect(e0?.type).toBe('conflicts');
        if (e0 && e0.type === 'conflicts') {
            expect((e0 as any).question).toBe('Which matters more: speed or flexibility?');
        }
    });

    it('should accept intrinsic determinants with paths', () => {
        const raw = JSON.stringify({
            claims: [{
                id: 'c_0',
                label: 'optimize for speed',
                text: 'Prioritize execution speed.',
                supporters: [1],
                role: 'anchor',
                challenges: null,
            }, {
                id: 'c_1',
                label: 'optimize for quality',
                text: 'Prioritize correctness and quality.',
                supporters: [2],
                role: 'anchor',
                challenges: null,
            }],
            determinants: [{
                type: 'intrinsic',
                fork: 'Mutually exclusive optimization target',
                hinge: 'Deadlines are fixed and missing them is unacceptable',
                question: 'Are deadlines fixed and missing them unacceptable?',
                paths: {
                    c_0: 'Ship quickly even if imperfect',
                    c_1: 'Go slower to ensure correctness',
                },
            }],
        });

        const result = parseSemanticMapperOutput(raw);
        expect(result.success).toBe(true);
        expect(result.output?.edges?.length).toBe(1);
        const d0 = result.output?.determinants?.[0];
        expect(d0?.type).toBe('intrinsic');
        if (d0?.type === 'intrinsic') {
            expect(d0.paths).toBeTruthy();
        }
    });

    it('should accept extrinsic determinants with yes/no semantics', () => {
        const raw = JSON.stringify({
            claims: [{
                id: 'c_0',
                label: 'use existing stack',
                text: 'Build on what you already run in production.',
                supporters: [1],
                role: 'anchor',
                challenges: null,
            }],
            determinants: [{
                type: 'extrinsic',
                fork: 'Requires an existing system',
                hinge: 'There is a running production system today',
                question: 'Do you have a production system already running?',
                yes_means: 'The condition holds — these claims remain',
                no_means: 'The condition does not hold — these claims are pruned',
                claims: ['c_0'],
            }],
        });

        const result = parseSemanticMapperOutput(raw);
        expect(result.success).toBe(true);
        expect(result.output?.conditionals?.length).toBe(1);
        const d0 = result.output?.determinants?.[0];
        expect(d0?.type).toBe('extrinsic');
        if (d0?.type === 'extrinsic') {
            expect(d0.yes_means).toBe('The condition holds — these claims remain');
            expect(d0.no_means).toBe('The condition does not hold — these claims are pruned');
        }
    });

    it('should serialize shadow paragraphs without duplicating statement text', () => {
        const responses: any[] = [
            { modelIndex: 1, content: 'Alpha' },
            { modelIndex: 2, content: 'Beta' },
        ];

        const prompt = buildSemanticMapperPrompt('Q', responses as any);
        const match = prompt.match(/<responses>\s*([\s\S]*?)\s*<\/responses>/);
        expect(match).not.toBeNull();
        const block = String(match?.[1] || '');
        expect(block).toContain('[Model 1]');
        expect(block).toContain('[Model 2]');
        expect(block).toContain('Alpha');
        expect(block).toContain('Beta');

        expect(block.match(/\bAlpha\b/g)?.length).toBe(1);
        expect(block.match(/\bBeta\b/g)?.length).toBe(1);
    });
});
