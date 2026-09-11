import { Effect } from 'effect'
import { CliRefused, type RuntimeCliContext } from '@qualy/plugin-kit/cli'
import {
  auditScoringState,
  exitCodeOf,
  type ScoringAuditFailure,
  type ScoringAuditReport,
} from '../scoring/audit.ts'

// `qualy assessment audit-scoring [--tenant <id>] [--batch <id>]`
//
// Loaded when invoked and never before. The audit itself is the scoring
// module's; this is the words on the two streams and the exit code: every
// failure named on its own line - the calculator's reason, never the
// determination - then the tally, then the verdict. Anything but a clean
// verdict ends the process with the verdict's own code, because the one
// thing this command exists to gate is a deployment that opens the writer.

const option = (args: readonly string[], name: string): string | undefined => {
  const at = args.indexOf(`--${name}`)
  return at >= 0 ? args[at + 1] : undefined
}

const where = (failure: ScoringAuditFailure): string =>
  `${failure.tenantId}/${failure.batchId}/${failure.itemId}${
    failure.derived ? ' (derived)' : failure.entryId === undefined ? '' : `/${failure.entryId}`
  }`

const line = (failure: ScoringAuditFailure): string =>
  `${where(failure)}  ${failure.stage} ${failure.kind}: ${failure.reason}`

const summary = (report: ScoringAuditReport): string =>
  [
    'scoring audit',
    `  items: ${report.items}   plans: ${report.plans}   recognitions: ${report.recognitions}   derived grants: ${report.derivedGrants}`,
    `  accepted: ${report.accepted}   refused: ${report.refused}   execution failed: ${report.executionFailed}   unavailable: ${report.unavailable}`,
    `  integrity failed: ${report.integrityFailed}   invariant failed: ${report.invariantFailed}   unreadable: ${report.unreadable}   unprepared: ${report.unprepared}`,
    `  verdict: ${report.verdict}`,
    '  (no boot hook ran; migrations were not applied)',
    ...(report.unavailable > 0
      ? [
          '  some arithmetic was out of reach, so this audit proves nothing about what it could not run: check that the sandbox runtime is up (`pnpm sandbox:up`) and run again',
        ]
      : []),
  ].join('\n')

export const run = (context: RuntimeCliContext) =>
  Effect.gen(function* () {
    const tenantId = option(context.args, 'tenant')
    const batchId = option(context.args, 'batch')
    const report = yield* auditScoringState({
      ...(tenantId === undefined ? {} : { tenantId }),
      ...(batchId === undefined ? {} : { batchId }),
    })
    yield* Effect.sync(() => {
      for (const failure of report.failures) console.log(line(failure))
      console.log(summary(report))
    })
    const code = exitCodeOf(report.verdict)
    if (code !== 0) {
      return yield* Effect.fail(new CliRefused(`scoring audit: ${report.verdict}`, code))
    }
  })
