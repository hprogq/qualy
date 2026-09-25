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

    // What those scores rest on, counted over every claim rather than
    // sampled: a claim standing on a concluded round says what that round
    // concluded, it stands on the newest of its determinations, and no
    // round is open over a claim that does not point at it. A baseline that
    // breaks any of these shows a visitor an appeal upheld on a claim that
    // never moved.
    const broken = (
      (yield* runSql(sql`
        select
          (select count(*)::int from entries e
            join review_instances ri
              on ri.tenant_id = e.tenant_id and ri.id = e.current_review_instance_id
            where ri.state = 'completed'
              and e.status <> 'voided'
              and ((ri.outcome = 'approved' and e.status <> 'approved')
                or (ri.outcome = 'rejected' and e.status not in ('rejected', 'draft'))))
            as verdicts,
          (select count(*)::int from entries e
            where exists (
              select 1 from entry_recognitions r
              where r.tenant_id = e.tenant_id and r.supersedes_id = e.current_recognition_id))
            as determinations,
          (select count(*)::int from review_instances ri
            join entries e on e.tenant_id = ri.tenant_id and e.id = ri.entry_id
            where ri.state in ('active', 'blocked', 'awaiting_supplement')
              and e.current_review_instance_id is distinct from ri.id)
            as orphans`)) as {
        rows: { verdicts: number; determinations: number; orphans: number }[]
      }
    ).rows[0]!
    console.log(
      `claims off their verdict ${broken.verdicts} · behind their determination ${broken.determinations} · open rounds nobody stands on ${broken.orphans}`,
    )
    if (broken.verdicts + broken.determinations + broken.orphans > 0) process.exitCode = 1
  }) as Effect.Effect<void, unknown, never>,
)
