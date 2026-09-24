// A look at what the seeded demo database scores, through the product's own
// scorer: per batch, the spread of totals and of each section over a sample
// of participants, so a run can be judged against the real cohort's (whose
// medians sat around 71 to 75).
//
//   QUALY_DEMO_DATABASE_URL=… node tools/demo/check.ts [sample=80]

import { Effect } from 'effect'
import { sql } from 'kysely'
import { Assessment } from '@qualy/plugin-assessment/testkit'
import { runSql } from '@qualy/plugin-database/testkit'
import { demoUrl } from './target.ts'
import { runOverDemo, runSeedingHooks } from './runtime.ts'
import { principalOf } from './seed/context.ts'

const url = demoUrl()
const sample = Number(process.argv[2] ?? 80)

const quantile = (sorted: readonly number[], q: number) =>
  sorted.length === 0 ? NaN : sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!

await runOverDemo(
  url,
  Effect.gen(function* () {
    yield* runSeedingHooks
    const assessment = yield* Assessment
    const lead = (
      (yield* runSql(sql`
        select u.id, u.tenant_id from users u
        join role_grants g on g.user_id = u.id
        join roles r on r.id = g.role_id and r.code = 'assessment-manager'
        limit 1`)) as { rows: { id: string; tenant_id: string }[] }
    ).rows[0]!
    const as = principalOf(lead.tenant_id, lead.id)
    const batches = (
      (yield* runSql(sql`select id, name, status from assessment_batches order by created_at`)) as {
        rows: { id: string; name: string; status: string }[]
      }
    ).rows
    for (const batch of batches) {
      const people = (
        (yield* runSql(sql`
          select id from batch_participants where batch_id = ${batch.id} and status = 'active'
          order by id`)) as { rows: { id: string }[] }
      ).rows
      const step = Math.max(1, Math.floor(people.length / sample))
      const totals: number[] = []
      const sections = new Map<string, number[]>()
      for (let i = 0; i < people.length; i += step) {
        const result = yield* assessment.getParticipantResult(
          lead.tenant_id,
          batch.id,
          people[i]!.id,
          as,
        )
        totals.push(Number(result.total))
        for (const group of result.groups.filter((one) => one.depth === 1)) {
          const list = sections.get(group.name) ?? []
          list.push(Number(group.final))
          sections.set(group.name, list)
        }
      }
      totals.sort((a, b) => a - b)
      const spread = (values: number[]) => {
        const sorted = [...values].sort((a, b) => a - b)
        return `p10 ${quantile(sorted, 0.1).toFixed(2)} · median ${quantile(sorted, 0.5).toFixed(2)} · p90 ${quantile(sorted, 0.9).toFixed(2)}`
      }
      console.log(
        `${batch.name} [${batch.status}] ${people.length} people, sampled ${totals.length}`,
      )
      console.log(`  total     ${spread(totals)}`)
      for (const [name, values] of sections) console.log(`  ${name.padEnd(8)} ${spread(values)}`)
    }
  }) as Effect.Effect<void, unknown, never>,
)
