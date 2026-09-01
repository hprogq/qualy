/**
 * The test-assembly surface of this plugin, for suites in downstream
 * plugins that must drive a REAL assessment service - creating items,
 * auditing stored plans, reading frozen arithmetic - without this package
 * widening its production API. Explicit re-exports only, and never a
 * production import: the repository's testkit gate holds that line.
 */

export { Assessment, serviceLayer, type PhaseSpecInput } from './server/index.ts'
export { auditStoredPlans } from './scoring/backfill.ts'
export { frozenCalculatorOf, readScoringPlan } from './scoring/plan.ts'
export { builtinAggregators, builtinCalculators, scaledAmount } from './scoring/builtins.ts'
export { scoringRuntimeProvider } from './scoring/runtime-provider.ts'
export { scoringAuthoringPolicyProvider } from './scoring/authoring-policy-provider.ts'
