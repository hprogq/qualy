// A look at what the seeded demo database scores, through the product's own
// scorer: per batch, the spread of totals and of each section over a sample
// of participants, so a run can be judged against the real cohort's (whose
// medians sat around 71 to 75). Then what each demonstration account opens
// onto (situations.ts): the run fails when any of it came out empty.
//
//   QUALY_DEMO_DATABASE_URL=… node tools/demo/check.ts [sample=80] [--stage=…] [--migration-state=before]
//
// The two flags are demo:seed's own: a run seeded with the selection still
// in its filing phase, or with the route change left for the demonstration,
// is checked without the situations those leave out.

import { Effect } from 'effect'
import { sql } from 'kysely'
import { Assessment } from '@qualy/plugin-assessment/testkit'
import { runSql } from '@qualy/plugin-database/testkit'
import { demoUrl } from './target.ts'
import { runOverDemo, runSeedingHooks } from './runtime.ts'
import { positionalOf, seedOptionsOf } from './options.ts'
import { principalOf } from './seed/context.ts'
import { judgeSituations, personaSituations } from './situations.ts'

const url = demoUrl()
const argv = process.argv.slice(2)
const options = seedOptionsOf(argv)
const sample = Number(positionalOf(argv)[0] ?? 80)

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
            as orphans,
          -- an ask is for a file, so a visitor who opens its answer sees
          -- what the answer talks about
          (select count(*)::int from review_supplement_requests r
            where not exists (
              select 1 from jsonb_array_elements(r.requirements) asked
               where asked->>'kind' = 'file'))
            as textonly,
          (select count(*)::int from review_supplement_requests r
            join review_supplement_responses rr
              on rr.tenant_id = r.tenant_id and rr.request_id = r.id
            where not exists (
              select 1 from review_supplement_attachments ra
               where ra.tenant_id = rr.tenant_id and ra.response_id = rr.id))
            as bare,
          -- and what comes back is not, byte for byte, a picture the claim
          -- was already filed with
          (select count(*)::int from review_supplement_requests r
            join review_instances ri on ri.tenant_id = r.tenant_id and ri.id = r.review_instance_id
            join entry_revisions er on er.tenant_id = ri.tenant_id and er.id = ri.revision_id
            join review_supplement_responses rr
              on rr.tenant_id = r.tenant_id and rr.request_id = r.id
            join review_supplement_attachments ra
              on ra.tenant_id = rr.tenant_id and ra.response_id = rr.id
            join storage_attachments answer
              on answer.tenant_id = ra.tenant_id and answer.id = ra.attachment_id
            where exists (
              select 1 from jsonb_array_elements_text(coalesce(er.payload->'proof', '[]'::jsonb)) filed(id)
                join storage_attachments original
                  on original.tenant_id = er.tenant_id and original.id = filed.id::uuid
               where original.integrity_value = answer.integrity_value))
            as repeated`)) as {
        rows: {
          verdicts: number
          determinations: number
          orphans: number
          textonly: number
          bare: number
          repeated: number
        }[]
      }
    ).rows[0]!
    console.log(
      `claims off their verdict ${broken.verdicts} · behind their determination ${broken.determinations} · open rounds nobody stands on ${broken.orphans}`,
    )
    console.log(
      `asks for no file ${broken.textonly} · answers without the file ${broken.bare} · answers repeating the filed picture ${broken.repeated}`,
    )
    if (
      broken.verdicts +
        broken.determinations +
        broken.orphans +
        broken.textonly +
        broken.bare +
        broken.repeated >
      0
    ) {
      process.exitCode = 1
    }

    // what each demonstration account opens onto
    const situations = yield* personaSituations
    const { missing, notExpected, pending } = judgeSituations(situations, options)
    console.log(
      `\nwhat the demonstration accounts open onto (selection at ${options.stage}${options.migrationBefore ? ', route change left for the demonstration' : ''}):`,
    )
    for (const one of situations) {
      const note = notExpected.includes(one)
        ? '  (not seeded at this stage)'
        : pending.includes(one)
          ? '  (awaiting a ruling, not required)'
          : ''
      console.log(
        `  ${one.account.padEnd(10)} ${String(one.count).padStart(4)}  ${one.label}${note}`,
      )
    }
    if (pending.length > 0) {
      console.log(
        '\nawaiting a ruling (docs/assessment-design.md §30, item 12: whether the recording permission reads the roster):',
      )
      for (const one of pending) console.log(`  ${one.account}: ${one.label} = ${one.count}`)
    }
    if (missing.length > 0) {
      console.log(
        `\nmissing:\n  ${missing.map((one) => `${one.account}: ${one.label}`).join('\n  ')}`,
      )
      process.exitCode = 1
    }
  }) as Effect.Effect<void, unknown, never>,
)
