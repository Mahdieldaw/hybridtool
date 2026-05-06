import { stripInlineMarkdown, structuredTruncate } from './text-prep';

describe('shared text prep', () => {
  test('strips inline markdown without treating snake_case as emphasis', () => {
    expect(stripInlineMarkdown('Use **bold** text, `code`, and snake_case ids.')).toBe(
      'Use bold text, code, and snake_case ids.'
    );
  });

  test('structured truncation keeps structural lines within the character budget', () => {
    const input = [
      'Opening context that should be kept at the head.',
      '- keep this requirement because it is structural',
      'Middle detail '.repeat(20),
      'Closing instruction that should survive at the tail.',
    ].join('\n');

    const output = structuredTruncate(input, 140);

    expect(output.length).toBeLessThanOrEqual(140);
    expect(output).toContain('- keep this requirement');
    expect(output).toContain('Opening context');
    expect(output).toContain('tail.');
  });
});
