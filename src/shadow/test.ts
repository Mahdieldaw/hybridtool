// ═══════════════════════════════════════════════════════════════════════════
// SHADOW MAPPER V2 - TEST & USAGE EXAMPLES
// ═══════════════════════════════════════════════════════════════════════════

import {
    extractShadowStatements,
    computeShadowDelta,
    extractReferencedIds,
    formatAuditSummary,
    getTopUnreferenced,
    filterByStance,
    filterBySignals,
} from './index';

// ═══════════════════════════════════════════════════════════════════════════
// TEST DATA
// ═══════════════════════════════════════════════════════════════════════════

const TEST_RESPONSES = [
    {
        modelIndex: 0,
        content: `First, validate your inputs before processing. This prevents downstream errors.

Don't skip validation even if you're in a hurry. The risk of data corruption is too high.

After validation completes, you can safely process the data. Use a schema validator like Zod or Joi.`
    },
    {
        modelIndex: 1,
        content: `Input validation should happen at the API boundary. This ensures consistency across your application.

If you're using TypeScript, enable strict mode. It catches type errors at compile time rather than runtime.

However, runtime validation is still necessary since TypeScript types are erased. You might want to use a library that generates validators from types.`
    },
    {
        modelIndex: 2,
        content: `Schema validation is critical for security. Never trust user input.

Before implementing validation, consider your data model. What are the invariants that must hold?

Once you've defined your schema, validation becomes straightforward. Libraries like Yup make this easier.`
    },
];

// ═══════════════════════════════════════════════════════════════════════════
// BASIC EXTRACTION TEST
// ═══════════════════════════════════════════════════════════════════════════

console.log('═══════════════════════════════════════════════════════════');
console.log('TEST 1: Basic Shadow Extraction');
console.log('═══════════════════════════════════════════════════════════\n');

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

// ═══════════════════════════════════════════════════════════════════════════
// STATEMENT INSPECTION
// ═══════════════════════════════════════════════════════════════════════════

console.log('═══════════════════════════════════════════════════════════');
console.log('TEST 2: Statement Inspection');
console.log('═══════════════════════════════════════════════════════════\n');

console.log('First 5 statements:\n');
for (const stmt of shadowResult.statements.slice(0, 5)) {
    const signals: string[] = [];
    if (stmt.signals.sequence) signals.push('SEQ');
    if (stmt.signals.tension) signals.push('TENS');
    if (stmt.signals.conditional) signals.push('COND');
    
    const signalStr = signals.length > 0 ? ` [${signals.join(',')}]` : '';
    
    console.log(`[${stmt.id}] (model_${stmt.modelIndex}, ${stmt.stance}, conf=${stmt.confidence.toFixed(2)}${signalStr})`);
    console.log(`  "${stmt.text}"`);
    console.log();
}

// ═══════════════════════════════════════════════════════════════════════════
// FILTERING TESTS
// ═══════════════════════════════════════════════════════════════════════════

console.log('═══════════════════════════════════════════════════════════');
console.log('TEST 3: Filtering');
console.log('═══════════════════════════════════════════════════════════\n');

const prescriptiveStmts = filterByStance(shadowResult.statements, 'prescriptive');
console.log(`Prescriptive statements: ${prescriptiveStmts.length}`);
for (const stmt of prescriptiveStmts.slice(0, 3)) {
    console.log(`  - "${stmt.text}"`);
}
console.log();

const cautionaryStmts = filterByStance(shadowResult.statements, 'cautionary');
console.log(`Cautionary statements: ${cautionaryStmts.length}`);
for (const stmt of cautionaryStmts.slice(0, 3)) {
    console.log(`  - "${stmt.text}"`);
}
console.log();

const sequenceStmts = filterBySignals(shadowResult.statements, { sequence: true });
console.log(`Statements with sequence signal: ${sequenceStmts.length}`);
for (const stmt of sequenceStmts.slice(0, 3)) {
    console.log(`  - "${stmt.text}"`);
}
console.log();

// ═══════════════════════════════════════════════════════════════════════════
// SHADOW DELTA TEST
// ═══════════════════════════════════════════════════════════════════════════

console.log('═══════════════════════════════════════════════════════════');
console.log('TEST 4: Shadow Delta (Simulated)');
console.log('═══════════════════════════════════════════════════════════\n');

// Simulate semantic mapper using some statements
const usedStatementIds = new Set([
    shadowResult.statements[0]?.id,
    shadowResult.statements[1]?.id,
    shadowResult.statements[2]?.id,
    shadowResult.statements[5]?.id,
].filter(Boolean));

console.log(`Simulating semantic mapper using ${usedStatementIds.size} statements`);
console.log();

const delta = computeShadowDelta(
    shadowResult,
    usedStatementIds,
    'How do I validate inputs in my application?'
);

console.log(formatAuditSummary(delta));
console.log();

const topUnreferenced = getTopUnreferenced(delta, 5);
console.log(`Top ${topUnreferenced.length} unreferenced statements (by adjusted score):\n`);

for (const u of topUnreferenced) {
    const signals: string[] = [];
    if (u.statement.signals.sequence) signals.push('SEQ');
    if (u.statement.signals.tension) signals.push('TENS');
    if (u.statement.signals.conditional) signals.push('COND');
    
    const signalStr = signals.length > 0 ? ` [${signals.join(',')}]` : '';
    
    console.log(`[${u.statement.id}] Score: ${u.adjustedScore.toFixed(2)} (${u.statement.stance}${signalStr})`);
    console.log(`  Query relevance: ${(u.queryRelevance * 100).toFixed(0)}%`);
    console.log(`  Signal weight: ${u.signalWeight}`);
    console.log(`  "${u.statement.text}"`);
    console.log();
}

// ═══════════════════════════════════════════════════════════════════════════
// INTEGRATION EXAMPLE
// ═══════════════════════════════════════════════════════════════════════════

console.log('═══════════════════════════════════════════════════════════');
console.log('TEST 5: Integration Pattern');
console.log('═══════════════════════════════════════════════════════════\n');

console.log('Example pipeline flow:');
console.log('1. Extract shadow statements');
console.log('2. Pass to semantic mapper (LLM)');
console.log('3. Semantic mapper references statement IDs in claims');
console.log('4. Compute shadow delta to find unreferenced statements');
console.log('5. Surface high-signal unreferenced to concierge');
console.log();

// Simulated semantic mapper output
const mockSemanticOutput = {
    claims: [
        {
            id: 'claim_1',
            label: 'validate inputs at API boundary',
            sourceStatementIds: [shadowResult.statements[0]?.id, shadowResult.statements[1]?.id].filter(Boolean),
        },
        {
            id: 'claim_2',
            label: 'use schema validation libraries',
            sourceStatementIds: [shadowResult.statements[2]?.id].filter(Boolean),
        },
    ],
};

const referencedIds = extractReferencedIds(mockSemanticOutput.claims);
console.log(`Semantic mapper used ${referencedIds.size} shadow statements across ${mockSemanticOutput.claims.length} claims`);
console.log();

const finalDelta = computeShadowDelta(shadowResult, referencedIds, 'How do I validate inputs?');
console.log(`Unreferenced: ${finalDelta.audit.unreferencedCount} statements`);
console.log(`High-signal unreferenced: ${finalDelta.audit.highSignalUnreferencedCount} statements`);
console.log();

console.log('✓ Phase 1 Shadow Mapper tests complete!');
