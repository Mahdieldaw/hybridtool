// ===========================================================================
// SHADOW MAPPER V2 - TEST & USAGE EXAMPLES
// ===========================================================================

import { extractShadowStatements } from './index';

// ===========================================================================
// TEST DATA
// ===========================================================================

const TEST_RESPONSES = [
  {
    modelIndex: 0,
    content: `First, validate your inputs before processing. This prevents downstream errors.

Don't skip validation even if you're in a hurry. The risk of data corruption is too high.

After validation completes, you can safely process the data. Use a schema validator like Zod or Joi.`,
  },
  {
    modelIndex: 1,
    content: `Input validation should happen at the API boundary. This ensures consistency across your application.

If you're using TypeScript, enable strict mode. It catches type errors at compile time rather than runtime.

However, runtime validation is still necessary since TypeScript types are erased. You might want to use a library that generates validators from types.`,
  },
  {
    modelIndex: 2,
    content: `Schema validation is critical for security. Never trust user input.

Before implementing validation, consider your data model. What are the invariants that must hold?

Once you've defined your schema, validation becomes straightforward. Libraries like Yup make this easier.`,
  },
];

// ===========================================================================
// BASIC EXTRACTION TEST
// ===========================================================================

console.log('===========================================================');
console.log('TEST 1: Basic Shadow Extraction');
console.log('===========================================================\n');

const shadowResult = extractShadowStatements(TEST_RESPONSES);

console.log('Extraction Results:');
console.log(`  Total statements: ${shadowResult.meta.totalStatements}`);
console.log(`  Processing time: ${shadowResult.meta.processingTimeMs.toFixed(2)}ms`);
console.log(`  Candidates processed: ${shadowResult.meta.candidatesProcessed}`);
console.log(`  Candidates excluded: ${shadowResult.meta.candidatesExcluded}`);
console.log();

console.log('By Stance:');
for (const [stance, count] of Object.entries(shadowResult.meta.byStance)) {
  if (count > 0) {
    console.log(`  ${stance}: ${count}`);
  }
}
console.log();

console.log('By Signal:');
console.log(`  Sequence: ${shadowResult.meta.bySignal.sequence}`);
console.log(`  Tension: ${shadowResult.meta.bySignal.tension}`);
console.log(`  Conditional: ${shadowResult.meta.bySignal.conditional}`);
console.log();

// ===========================================================================
// STATEMENT INSPECTION
// ===========================================================================

console.log('===========================================================');
console.log('TEST 2: Statement Inspection');
console.log('===========================================================\n');

console.log('First 5 statements:\n');
for (const stmt of shadowResult.statements.slice(0, 5)) {
  const signals: string[] = [];
  if (stmt.signals.sequence) signals.push('SEQ');
  if (stmt.signals.tension) signals.push('TENS');
  if (stmt.signals.conditional) signals.push('COND');

  const signalStr = signals.length > 0 ? ` [${signals.join(',')}]` : '';

  console.log(
    `[${stmt.id}] (model_${stmt.modelIndex}, ${stmt.stance}, conf=${stmt.confidence.toFixed(2)}${signalStr})`
  );
  console.log(`  "${stmt.text}"`);
  console.log();
}

// ===========================================================================
// FILTERING TESTS
// ===========================================================================

console.log('✓ Phase 1 Shadow Mapper tests complete!');
