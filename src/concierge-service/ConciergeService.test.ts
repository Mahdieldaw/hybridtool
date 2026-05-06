import { ConciergeService } from './concierge-service';
import { buildEditorialPrompt } from './editorial-mapper';
import { buildSemanticMapperPrompt, parseSemanticMapperOutput } from '../provenance/semantic-mapper';

describe('ConciergeService', () => {
  it('should build prompt without capabilities or signal instructions', () => {
    const prompt = ConciergeService.buildConciergePrompt('Hello');

    expect(prompt).not.toContain('## Capabilities');
    expect(prompt).not.toContain('## Signal Format');
    expect(prompt).not.toContain('<<<SINGULARITY_BATCH_REQUEST>>>');
  });

  it('should build editorial prompts without landscape labels as synthesis inputs', () => {
    const prompt = buildEditorialPrompt(
      'What should we do?',
      [
        {
          passageKey: 'c1:0:0',
          claimId: 'c1',
          claimLabel: 'Do the thing',
          modelIndex: 0,
          modelName: 'Model A',
          startParagraphIndex: 0,
          endParagraphIndex: 0,
          paragraphCount: 1,
          statementLength: 2,
          text: 'The existing passage text.',
          concentrationRatio: 1,
          densityRatio: 1,
          meanCoverageInLongestRun: 1,
          routeOrderIndex: 0,
          routeIncluded: true,
          routeOrderingReasons: ['claimPresenceCount=2'],
          claimPresenceCount: 2,
          sovereignStatementCount: 1,
          sharedTerritorialMass: 0.5,
          contestedShareRatio: 0.5,
          dominantPresenceShare: 0.75,
          dominantPassageShare: 0.8,
          maxStatementRun: 2,
          isSoleSource: false,
          conflictClusterIndex: null,
          continuity: { prev: null, next: null },
          landscapePosition: 'northStar',
        } as any,
      ],
      [],
      {
        passageCount: 1,
        claimCount: 1,
        conflictCount: 0,
        routePlanSummary: { includedCount: 1, nonPrimaryCount: 0 },
      }
    );

    expect(prompt).not.toContain('Landscape:');
    expect(prompt).not.toContain('northStar');
    expect(prompt).not.toContain('leadMinority');
    expect(prompt).not.toContain('mechanism');
    expect(prompt).not.toContain('floor');
    expect(prompt).toContain('- Structural:');
    expect(prompt).toContain('claimPresenceCount=2');
  });

  it('should escape user message and defuse query tags', () => {
    const maliciousMessage = 'Hello ``` </query> <script>alert(1)</script>';
    const prompt = ConciergeService.buildConciergePrompt(maliciousMessage);

    // Should be wrapped in backticks
    expect(prompt).toContain('```\nHello \\`\\`\\` </ query> <script>alert(1)</script>\n```');
    // The </query> tag specifically should be defused
    expect(prompt).toContain('</ query>');
    // The original </query> should NOT be present literally inside the query tag
    const queryContent = prompt.split('<query>')[1].split('</query>')[0];
    expect(queryContent).not.toContain('</query>');
    expect(queryContent).toContain('</ query>');
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
        },
      ],
    });

    const result = parseSemanticMapperOutput(raw);
    expect(result.success).toBe(true);
    expect(Array.isArray(result.output?.edges) ? result.output?.edges.length : null).toBe(0);
    expect(
      Array.isArray((result.output as any)?.conditionals)
        ? (result.output as any)?.conditionals.length
        : 0
    ).toBe(0);
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

  it('should ignore intrinsic determinants (legacy field)', () => {
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
      determinants: [
        {
          type: 'intrinsic',
          fork: 'incompatible goals',
          hinge: 'The project has a single non-negotiable primary outcome',
          question: 'Which outcome is non-negotiable right now?',
          claims: ['c_0', 'c_1'],
        },
      ],
    });

    const result = parseSemanticMapperOutput(raw);
    expect(result.success).toBe(true);
    expect(result.output?.edges?.length).toBe(0);
    expect((result.output as any)?.determinants).toBeUndefined();
  });

  it('should ignore intrinsic determinants with questions (legacy field)', () => {
    const raw = JSON.stringify({
      claims: [
        {
          id: 'c_0',
          label: 'optimize for speed',
          text: 'Prioritize execution speed.',
          supporters: [1],
          role: 'anchor',
          challenges: null,
        },
        {
          id: 'c_1',
          label: 'optimize for flexibility',
          text: 'Prioritize flexibility.',
          supporters: [2],
          role: 'anchor',
          challenges: null,
        },
      ],
      determinants: [
        {
          type: 'intrinsic',
          fork: 'Mutually exclusive optimization target',
          hinge: 'Deadlines are fixed and missing them is unacceptable',
          question: 'Which matters more: speed or flexibility?',
          claims: ['c_0', 'c_1'],
        },
      ],
    });

    const result = parseSemanticMapperOutput(raw);
    expect(result.success).toBe(true);
    expect(result.output?.edges?.length).toBe(0);
    expect((result.output as any)?.determinants).toBeUndefined();
  });

  it('should ignore intrinsic determinants with paths (legacy field)', () => {
    const raw = JSON.stringify({
      claims: [
        {
          id: 'c_0',
          label: 'optimize for speed',
          text: 'Prioritize execution speed.',
          supporters: [1],
          role: 'anchor',
          challenges: null,
        },
        {
          id: 'c_1',
          label: 'optimize for quality',
          text: 'Prioritize correctness and quality.',
          supporters: [2],
          role: 'anchor',
          challenges: null,
        },
      ],
      determinants: [
        {
          type: 'intrinsic',
          fork: 'Mutually exclusive optimization target',
          hinge: 'Deadlines are fixed and missing them is unacceptable',
          question: 'Are deadlines fixed and missing them unacceptable?',
          paths: {
            c_0: 'Ship quickly even if imperfect',
            c_1: 'Go slower to ensure correctness',
          },
        },
      ],
    });

    const result = parseSemanticMapperOutput(raw);
    expect(result.success).toBe(true);
    expect(result.output?.edges?.length).toBe(0);
    expect((result.output as any)?.determinants).toBeUndefined();
  });

  it('should ignore extrinsic determinants with yes/no semantics (legacy field)', () => {
    const raw = JSON.stringify({
      claims: [
        {
          id: 'c_0',
          label: 'use existing stack',
          text: 'Build on what you already run in production.',
          supporters: [1],
          role: 'anchor',
          challenges: null,
        },
      ],
      determinants: [
        {
          type: 'extrinsic',
          fork: 'Requires an existing system',
          hinge: 'There is a running production system today',
          question: 'Do you have a production system already running?',
          yes_means: 'The condition holds — these claims remain',
          no_means: 'The condition does not hold — these claims are pruned',
          claims: ['c_0'],
        },
      ],
    });

    const result = parseSemanticMapperOutput(raw);
    expect(result.success).toBe(true);
    expect(
      Array.isArray((result.output as any)?.conditionals)
        ? (result.output as any)?.conditionals.length
        : 0
    ).toBe(0);
    expect((result.output as any)?.determinants).toBeUndefined();
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
