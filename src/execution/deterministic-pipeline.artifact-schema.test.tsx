import { assembleMapperArtifact } from './deterministic-pipeline';

describe('mapper artifact schema transition', () => {
  test('mapper artifacts carry the footprint ledger schema and rebuild policy', async () => {
    const artifact = await assembleMapperArtifact({
      derived: {},
      enrichedClaims: [],
      shadowStatements: [],
      shadowParagraphs: [],
    }) as any;

    expect(artifact.artifactSchemaVersion).toBe(2);
    expect(artifact.transitionPolicy).toEqual(
      expect.objectContaining({
        oldPersistedArtifacts: 'rebuild-or-guarded-ui-fallback',
        dbMigrationRequired: false,
      })
    );
    expect(artifact.measurementSchemas).toEqual(
      expect.objectContaining({
        claimFootprint: 'claim-footprint-ledger-v2',
        claimConcordance: 'diagnostic-foundational-v1',
      })
    );
  });
});
