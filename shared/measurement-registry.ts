export type Consumer =
  | 'routing'
  | 'presentation'
  | 'trace'
  | 'synthesis'
  | 'evaluationPolicy'
  | 'claimSuppression'
  | 'synthesisConclusion'
  | 'userVisiblePriority'
  | 'legacyCompatibility'
  | 'debug';

export type MeasurementStatus =
  | 'active'
  | 'legacy'
  | 'deprecated'
  | 'quarantined'
  | 'pendingAudit';

type MeasurementRule = {
  key: string;
  status: MeasurementStatus;
  allowedConsumers: Consumer[];
  forbiddenConsumers: Consumer[];
  note?: string;
};

export type MeasurementViolationReason = 'unregistered' | 'forbidden' | 'unlicensed';

export type MeasurementViolation = {
  key: string;
  consumer: Consumer;
  reason: MeasurementViolationReason;
  message: string;
  context?: string;
  status?: MeasurementStatus;
  note?: string;
};

export type MeasurementGuardMode = 'throw' | 'collect';

export type MeasurementGuardOptions = {
  mode?: MeasurementGuardMode;
  context?: string;
  collector?: MeasurementViolation[];
};

const DEBUG_TRACE: Consumer[] = ['debug', 'trace'];
const DEBUG_TRACE_LEGACY_COMPATIBILITY: Consumer[] = ['debug', 'trace', 'legacyCompatibility'];
const DEBUG_TRACE_PRESENTATION: Consumer[] = ['debug', 'trace', 'presentation'];
const STEERING_CONSUMERS: Consumer[] = [
  'routing',
  'synthesis',
  'evaluationPolicy',
  'claimSuppression',
  'synthesisConclusion',
];
const POLICY_CONSUMERS: Consumer[] = [...STEERING_CONSUMERS, 'presentation', 'userVisiblePriority'];

function measurementRule(
  key: string,
  status: MeasurementStatus,
  allowedConsumers: Consumer[],
  forbiddenConsumers: Consumer[],
  note: string
): MeasurementRule {
  return {
    key,
    status,
    allowedConsumers: [...allowedConsumers],
    forbiddenConsumers: [...forbiddenConsumers],
    note,
  };
}

const deprecatedPolicyOutput = (key: string): MeasurementRule =>
  measurementRule(
    key,
    'deprecated',
    DEBUG_TRACE_LEGACY_COMPATIBILITY,
    POLICY_CONSUMERS,
    'Old landscape identity. Consumer-policy output only, not a measurement.'
  );

const deprecatedVisibleMetric = (key: string, note: string): MeasurementRule =>
  measurementRule(key, 'deprecated', DEBUG_TRACE_PRESENTATION, STEERING_CONSUMERS, note);

const legacyVisibleMetric = (key: string, note: string): MeasurementRule =>
  measurementRule(key, 'legacy', DEBUG_TRACE_PRESENTATION, STEERING_CONSUMERS, note);

const quarantinedMetric = (key: string, note: string): MeasurementRule =>
  measurementRule(key, 'quarantined', DEBUG_TRACE, POLICY_CONSUMERS, note);

export const MEASUREMENT_REGISTRY: Record<string, MeasurementRule> = {
  MAJ: measurementRule(
    'MAJ',
    'deprecated',
    DEBUG_TRACE,
    POLICY_CONSUMERS,
    'Deleted majority-paragraph measurement. Use the decomposable footprint atom ledger instead.'
  ),

  northStar: deprecatedPolicyOutput('northStar'),
  eastStar: deprecatedPolicyOutput('eastStar'),
  leadMinority: deprecatedPolicyOutput('leadMinority'),
  mechanism: deprecatedPolicyOutput('mechanism'),
  floor: deprecatedPolicyOutput('floor'),
  landscapePosition: deprecatedPolicyOutput('landscapePosition'),

  meanCoverage: deprecatedVisibleMetric(
    'meanCoverage',
    'Deleted scalar coverage summary. Prefer decomposable passage records or the footprint atom ledger.'
  ),
  meanCoverageInLongestRun: legacyVisibleMetric(
    'meanCoverageInLongestRun',
    'Legacy scalar passage summary. Do not use as synthesis or routing authority.'
  ),
  concentrationRatio: deprecatedVisibleMetric(
    'concentrationRatio',
    'Deleted model-treatment metric. Do not use as routing or synthesis authority.'
  ),
  densityRatio: deprecatedVisibleMetric(
    'densityRatio',
    'Deleted density metric. Do not use as routing or synthesis authority.'
  ),
  contestedDominance: deprecatedVisibleMetric(
    'contestedDominance',
    'Deleted 51%-style contested metric. Use contestedShareRatio after registry registration.'
  ),

  claimNoveltyRatio: quarantinedMetric(
    'claimNoveltyRatio',
    'Novelty layer is undefined and quarantined.'
  ),
  corpusNoveltyRatio: quarantinedMetric(
    'corpusNoveltyRatio',
    'Novelty layer is undefined and quarantined.'
  ),
  novelParagraphCount: quarantinedMetric(
    'novelParagraphCount',
    'Novelty layer is undefined and quarantined.'
  ),
  majorityGateSnapshot: quarantinedMetric(
    'majorityGateSnapshot',
    'Novelty-gate diagnostic is quarantined with the novelty layer.'
  ),

  crossPoolProximity: measurementRule(
    'crossPoolProximity',
    'pendingAudit',
    DEBUG_TRACE_PRESENTATION,
    STEERING_CONSUMERS,
    'Conflict formula direction is pending audit; similarity currently masquerades as separation.'
  ),
  validatedConflict: measurementRule(
    'validatedConflict',
    'pendingAudit',
    DEBUG_TRACE_PRESENTATION,
    STEERING_CONSUMERS,
    'Hybrid mapper-conditioned conflict check. Formula direction is still pending.'
  ),

  supportRatio: legacyVisibleMetric(
    'supportRatio',
    'L2 mapper-conditioned graph/support signal. Observable, not steering authority.'
  ),
  regionMembership: legacyVisibleMetric(
    'regionMembership',
    'Geometry context only. Region fields must not steer routing or synthesis.'
  ),
  corpusMode: legacyVisibleMetric(
    'corpusMode',
    'Corpus geometry context only. Do not use directly as a routing key.'
  ),
  peripheralNodeIds: legacyVisibleMetric(
    'peripheralNodeIds',
    'Corpus geometry context only. Do not filter routing/provenance with this field.'
  ),
  peripheralRatio: legacyVisibleMetric(
    'peripheralRatio',
    'Corpus geometry context only. Do not use directly as a routing key.'
  ),
  largestBasinRatio: legacyVisibleMetric(
    'largestBasinRatio',
    'Corpus geometry context only. Do not use directly as a routing key.'
  ),
  'claim.structuralFingerprint.diagnostics.flags.compactSovereign': measurementRule(
    'claim.structuralFingerprint.diagnostics.flags.compactSovereign',
    'active',
    DEBUG_TRACE_PRESENTATION,
    STEERING_CONSUMERS,
    'Diagnostic flag only. Must not steer routing, evaluation, suppression, or synthesis conclusions.'
  ),
  'claim.structuralFingerprint.diagnostics.flags.broadShared': measurementRule(
    'claim.structuralFingerprint.diagnostics.flags.broadShared',
    'active',
    DEBUG_TRACE_PRESENTATION,
    STEERING_CONSUMERS,
    'Diagnostic flag only. Must not steer routing, evaluation, suppression, or synthesis conclusions.'
  ),
  'claim.structuralFingerprint.diagnostics.flags.modelConcentrated': measurementRule(
    'claim.structuralFingerprint.diagnostics.flags.modelConcentrated',
    'active',
    DEBUG_TRACE_PRESENTATION,
    STEERING_CONSUMERS,
    'Diagnostic flag only. Must not steer routing, evaluation, suppression, or synthesis conclusions.'
  ),
  'claim.structuralFingerprint.diagnostics.flags.crossModelSustained': measurementRule(
    'claim.structuralFingerprint.diagnostics.flags.crossModelSustained',
    'active',
    DEBUG_TRACE_PRESENTATION,
    STEERING_CONSUMERS,
    'Diagnostic flag only. Must not steer routing, evaluation, suppression, or synthesis conclusions.'
  ),
  'claim.structuralFingerprint.diagnostics.flags.fragmented': measurementRule(
    'claim.structuralFingerprint.diagnostics.flags.fragmented',
    'active',
    DEBUG_TRACE_PRESENTATION,
    STEERING_CONSUMERS,
    'Diagnostic flag only. Must not steer routing, evaluation, suppression, or synthesis conclusions.'
  ),
  'claim.structuralFingerprint.diagnostics.flags.boundaryCrossing': measurementRule(
    'claim.structuralFingerprint.diagnostics.flags.boundaryCrossing',
    'active',
    DEBUG_TRACE_PRESENTATION,
    STEERING_CONSUMERS,
    'Diagnostic flag only. Must not steer routing, evaluation, suppression, or synthesis conclusions.'
  ),
  'claim.structuralFingerprint.diagnostics.flags.assignmentAmbiguous': measurementRule(
    'claim.structuralFingerprint.diagnostics.flags.assignmentAmbiguous',
    'active',
    DEBUG_TRACE_PRESENTATION,
    STEERING_CONSUMERS,
    'Diagnostic flag only. Must not steer routing, evaluation, suppression, or synthesis conclusions.'
  ),
};

const defaultCollectedViolations: MeasurementViolation[] = [];

function parseGuardOptions(
  contextOrOptions?: string | MeasurementGuardOptions
): Required<Pick<MeasurementGuardOptions, 'mode'>> &
  Pick<MeasurementGuardOptions, 'context' | 'collector'> {
  if (typeof contextOrOptions === 'string') {
    return { mode: 'throw', context: contextOrOptions };
  }
  return {
    mode: contextOrOptions?.mode ?? 'throw',
    context: contextOrOptions?.context,
    collector: contextOrOptions?.collector,
  };
}

function buildViolation(
  key: string,
  consumer: Consumer,
  reason: MeasurementViolationReason,
  message: string,
  context?: string,
  rule?: MeasurementRule
): MeasurementViolation {
  return {
    key,
    consumer,
    reason,
    message,
    ...(context ? { context } : {}),
    ...(rule ? { status: rule.status } : {}),
    ...(rule?.note ? { note: rule.note } : {}),
  };
}

function checkMeasurementConsumer(
  key: string,
  consumer: Consumer,
  context?: string
): MeasurementViolation | null {
  const rule = MEASUREMENT_REGISTRY[key];
  const where = context ? ` at ${context}` : '';

  if (!rule) {
    return buildViolation(
      key,
      consumer,
      'unregistered',
      `Unregistered measurement consumed: ${key} by ${consumer}${where}`,
      context
    );
  }

  if (rule.forbiddenConsumers.includes(consumer)) {
    const note = rule.note ? ` ${rule.note}` : '';
    return buildViolation(
      key,
      consumer,
      'forbidden',
      `Forbidden measurement consumption: ${key} cannot be used by ${consumer}${where}.${note}`,
      context,
      rule
    );
  }

  if (!rule.allowedConsumers.includes(consumer)) {
    const note = rule.note ? ` ${rule.note}` : '';
    return buildViolation(
      key,
      consumer,
      'unlicensed',
      `Unlicensed measurement consumption: ${key} is not allowed for ${consumer}${where}.${note}`,
      context,
      rule
    );
  }

  return null;
}

export function assertMeasurementConsumer(
  key: string,
  consumer: Consumer,
  contextOrOptions?: string | MeasurementGuardOptions
): void {
  const options = parseGuardOptions(contextOrOptions);
  const violation = checkMeasurementConsumer(key, consumer, options.context);
  if (!violation) return;

  if (options.mode === 'collect') {
    (options.collector ?? defaultCollectedViolations).push(violation);
    return;
  }

  throw new Error(violation.message);
}

export function collectMeasurementViolation(
  key: string,
  consumer: Consumer,
  context?: string,
  collector: MeasurementViolation[] = defaultCollectedViolations
): MeasurementViolation | null {
  const violation = checkMeasurementConsumer(key, consumer, context);
  if (violation) collector.push(violation);
  return violation;
}

export function getCollectedMeasurementViolations(): MeasurementViolation[] {
  return [...defaultCollectedViolations];
}

export function clearCollectedMeasurementViolations(): void {
  defaultCollectedViolations.length = 0;
}
