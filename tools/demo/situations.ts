import { Effect } from 'effect'
import { sql, type RawBuilder } from 'kysely'
import { Assessment } from '@qualy/plugin-assessment/testkit'
import { runSql } from '@qualy/plugin-database/testkit'
import { principalOf } from './seed/context.ts'
import { PERSONA_ACCOUNTS } from './seed/personas.ts'

// What each demonstration account opens onto, counted.
//
// The seeder writes the persona student's six terms out claim by claim
// (seed/episodes.ts) and sets the running selection up so the class lead,
// the counsellor and the assessment lead each have work in front of them
// (seed/selection.ts). This counts every one of those situations in the
// seeded database - the queues through the product's own inbox, the rest
// by reading the rows - and names the ones that came out empty. A baseline
// where any count is zero shows a visitor less than the scenario promises.

type Key = (typeof PERSONA_ACCOUNTS)[number]['key']

export interface Situation {
  readonly account: Key
  readonly label: string
  readonly count: number
}

const count = (query: RawBuilder<unknown>) =>
  Effect.map(runSql(query), (found) => (found as { rows: { n: number }[] }).rows[0]?.n ?? 0)

export const personaSituations = Effect.gen(function* () {
  const assessment = yield* Assessment
  const people = (
    (yield* runSql(sql`
      select u.id, u.email, u.tenant_id from users u
       where u.email = any(${PERSONA_ACCOUNTS.map((account) => account.email)}::text[])`)) as {
      rows: { id: string; email: string; tenant_id: string }[]
    }
  ).rows
  const idOf = (key: Key) => {
    const email = PERSONA_ACCOUNTS.find((account) => account.key === key)!.email
    return people.find((person) => person.email === email)?.id ?? null
  }
  const tenantId = people[0]?.tenant_id
  const current = (
    (yield* runSql(
      sql`select id from assessment_batches where status = 'active' order by created_at desc limit 1`,
    )) as { rows: { id: string }[] }
  ).rows[0]?.id
  const situations: Situation[] = []
  const add = (account: Key, label: string, n: number) =>
    situations.push({ account, label, count: n })
  const student = idOf('student')
  const classLead = idOf('class-lead')
  const counsellor = idOf('counsellor')
  const lead = idOf('lead')
  if (tenantId === undefined || current === undefined || student === null) {
    return { situations, missing: ['the demonstration accounts or the running batch'] }
  }

  // the persona student's claims, in the archived terms and in the running batch
  const mine = (archived: boolean) => sql`
    select e.* from entries e
      join batch_participants p on p.tenant_id = e.tenant_id and p.id = e.participant_id
      join assessment_batches b on b.tenant_id = e.tenant_id and b.id = e.batch_id
     where p.user_id = ${student} and b.status ${archived ? sql`=` : sql`<>`} 'archived'`
  const history = mine(true)
  const running = mine(false)

  add(
    'student',
    'past: an ask for more material, answered',
    yield* count(sql`
      select count(*)::int as n from (${history}) e
        join review_instances ri on ri.tenant_id = e.tenant_id and ri.entry_id = e.id
        join review_supplement_requests r
          on r.tenant_id = ri.tenant_id and r.review_instance_id = ri.id
       where r.status = 'answered'`),
  )
  add(
    'student',
    'past: refused, revised, filed again and approved',
    yield* count(sql`
      select count(*)::int as n from (${history}) e
       where e.status = 'approved'
         and exists (
           select 1 from review_instances refused
             join review_instances later
               on later.tenant_id = refused.tenant_id and later.entry_id = refused.entry_id
              and later.round_no > refused.round_no
            where refused.tenant_id = e.tenant_id and refused.entry_id = e.id
              and refused.origin = 'initial' and refused.outcome = 'rejected'
              and later.origin in ('initial', 'reroute') and later.outcome = 'approved')`),
  )
  add(
    'student',
    'past: three rounds or more',
    yield* count(sql`
      select count(*)::int as n from (${history}) e
       where (select count(*) from review_instances ri
               where ri.tenant_id = e.tenant_id and ri.entry_id = e.id) >= 3`),
  )
  add(
    'student',
    'past: judged by a panel',
    yield* count(sql`
      select count(*)::int as n from (${history}) e
        join review_instances ri on ri.tenant_id = e.tenant_id and ri.entry_id = e.id
        join review_panels rp on rp.tenant_id = ri.tenant_id and rp.review_instance_id = ri.id`),
  )
  const appeals = (outcome: 'approved' | 'rejected') => sql`
    select count(*)::int as n from (${history}) e
      join review_instances ri on ri.tenant_id = e.tenant_id and ri.entry_id = e.id
      join review_instances contested
        on contested.tenant_id = ri.tenant_id and contested.id = ri.appealed_instance_id
     where ri.origin = 'appeal' and ri.state = 'completed'
       and contested.outcome = 'rejected' and ri.outcome = ${outcome}`
  add('student', 'past: appeal against a refusal, granted', yield* count(appeals('approved')))
  add('student', 'past: appeal against a refusal, not granted', yield* count(appeals('rejected')))
  add(
    'student',
    'past: re-examined by staff',
    yield* count(sql`
      select count(*)::int as n from (${history}) e
        join review_instances ri on ri.tenant_id = e.tenant_id and ri.entry_id = e.id
       where ri.origin = 'reopen' and ri.state = 'completed'`),
  )
  for (const [kind, label] of [
    ['recognition-corrected', 'past: re-determined upwards'],
    ['approval-revoked', 'past: approval revoked by re-determination'],
  ] as const) {
    add(
      'student',
      label,
      yield* count(sql`
        select count(*)::int as n from (${history}) e
          join entry_events ee on ee.tenant_id = e.tenant_id and ee.entry_id = e.id
         where ee.kind = ${kind}`),
    )
  }
  add(
    'student',
    'past: recorded fact taken back',
    yield* count(sql`
      select count(*)::int as n from (${history}) e
       where e.source = 'record' and e.status = 'voided'`),
  )
  add(
    'student',
    'past: claim on a voided question',
    yield* count(sql`
      select count(*)::int as n from (${history}) e
        join assessment_items i on i.tenant_id = e.tenant_id and i.id = e.item_id
       where i.status = 'voided' and e.status = 'voided'`),
  )
  // what the student's own result pages say about the taken-back facts
  const archived = (
    (yield* runSql(
      sql`select id from assessment_batches where status = 'archived' order by created_at`,
    )) as { rows: { id: string }[] }
  ).rows
  let revokedLines = 0
  let voidedQuestionLines = 0
  for (const batch of archived) {
    const result = yield* Effect.result(
      assessment.getMyResult(tenantId, batch.id, principalOf(tenantId, student)),
    )
    if (result._tag === 'Failure') continue
    revokedLines += result.success.lines.filter(
      (line) => line.kind === 'excluded-evidence' && line.revoked === true,
    ).length
    voidedQuestionLines += result.success.lines.filter((line) => line.kind === 'item-voided').length
  }
  add('student', 'past: a revoked line on their own result', revokedLines)
  add('student', 'past: a voided question on their own result', voidedQuestionLines)
  for (const [claims, when] of [
    [history, 'past'],
    [running, 'running'],
  ] as const) {
    add(
      'student',
      `${when}: returned for revision by staff`,
      yield* count(sql`
        select count(*)::int as n from (${claims}) e
          join entry_events ee on ee.tenant_id = e.tenant_id and ee.entry_id = e.id
         where ee.kind = 'revision-required'`),
    )
    add(
      'student',
      `${when}: moved onto a changed route`,
      yield* count(sql`
        select count(*)::int as n from (${claims}) e
          join review_instances ri on ri.tenant_id = e.tenant_id and ri.entry_id = e.id
         where ri.origin = 'reroute'`),
    )
  }
  for (const status of ['approved', 'in_review', 'rejected', 'draft'] as const) {
    add(
      'student',
      `running: claims ${status}`,
      yield* count(sql`select count(*)::int as n from (${running}) e where e.status = ${status}`),
    )
  }
  add(
    'student',
    'running: appeal under way',
    yield* count(sql`
      select count(*)::int as n from (${running}) e
        join review_instances ri
          on ri.tenant_id = e.tenant_id and ri.id = e.current_review_instance_id
       where ri.origin = 'appeal' and ri.state <> 'completed'`),
  )
  add(
    'student',
    'running: ask for more material open',
    yield* count(sql`
      select count(*)::int as n from (${running}) e
        join review_supplement_requests r
          on r.tenant_id = e.tenant_id and r.review_instance_id = e.current_review_instance_id
       where r.status = 'open'`),
  )
  add(
    'student',
    'running: class panel sitting',
    yield* count(sql`
      select count(*)::int as n from (${running}) e
        join review_panels rp
          on rp.tenant_id = e.tenant_id and rp.review_instance_id = e.current_review_instance_id
       where rp.state = 'open'`),
  )

  // what waits for each staff account, through the product's own inbox
  const inbox = (userId: string) =>
    Effect.gen(function* () {
      const ids: string[] = []
      let cursor: string | undefined
      for (let page = 0; page < 20; page++) {
        const found = yield* assessment.listReviewInbox(
          tenantId,
          { batchId: current, limit: '50', ...(cursor === undefined ? {} : { cursor }) },
          principalOf(tenantId, userId),
        )
        ids.push(...found.items.map((item) => item.instanceId))
        if (found.nextCursor === null) break
        cursor = found.nextCursor
      }
      return ids
    })
  const among = (ids: readonly string[], predicate: RawBuilder<unknown>) =>
    ids.length === 0
      ? Effect.succeed(0)
      : count(sql`
          select count(*)::int as n from review_instances ri
           where ri.id = any(${ids}::uuid[]) and ${predicate}`)
  const answered = sql`exists (
    select 1 from review_supplement_requests r
     where r.tenant_id = ri.tenant_id and r.review_instance_id = ri.id and r.status = 'answered')`
  const asksOutstanding = (userId: string) =>
    Effect.map(
      assessment.listAwaitingSupplements(
        tenantId,
        { batchId: current, limit: '50' },
        principalOf(tenantId, userId),
      ),
      (found) => found.items.filter((item) => item.status === 'open').length,
    )
  const acted = (userId: string, kinds: readonly string[]) =>
    count(sql`
      select count(*)::int as n from review_events re
        join review_instances ri on ri.tenant_id = re.tenant_id and ri.id = re.review_instance_id
        join entries e on e.tenant_id = ri.tenant_id and e.id = ri.entry_id
       where e.batch_id = ${current} and re.actor_id = ${userId}
         and re.kind = any(${kinds}::text[])`)

  if (classLead !== null) {
    const waiting = yield* inbox(classLead)
    add('class-lead', 'running: waiting in the inbox', waiting.length)
    add(
      'class-lead',
      'running: panel with the other seat voted',
      yield* among(
        waiting,
        sql`exists (
          select 1 from review_panels rp
            join review_votes v on v.tenant_id = rp.tenant_id and v.panel_id = rp.id
           where rp.tenant_id = ri.tenant_id and rp.review_instance_id = ri.id
             and rp.state = 'open' and v.voter_user_id <> ${classLead})`,
      ),
    )
    add('class-lead', 'running: back after an answered ask', yield* among(waiting, answered))
    add(
      'class-lead',
      'running: appeal at the class panel',
      yield* among(waiting, sql`ri.origin = 'appeal'`),
    )
  }

  if (lead !== null) {
    const waiting = yield* inbox(lead)
    add('lead', 'running: waiting in the inbox', waiting.length)
    add('lead', 'running: appeal waiting', yield* among(waiting, sql`ri.origin = 'appeal'`))
    add('lead', 'running: re-examination waiting', yield* among(waiting, sql`ri.origin = 'reopen'`))
    add(
      'lead',
      'running: waiting after earlier rounds',
      yield* among(
        waiting,
        sql`(select count(*) from review_instances other
              where other.tenant_id = ri.tenant_id and other.entry_id = ri.entry_id) >= 2`,
      ),
    )
    add(
      'lead',
      'running: waiting after an answered ask',
      yield* among(
        waiting,
        sql`exists (
          select 1 from review_instances other
            join review_supplement_requests r
              on r.tenant_id = other.tenant_id and r.review_instance_id = other.id
           where other.tenant_id = ri.tenant_id and other.entry_id = ri.entry_id
             and r.status = 'answered')`,
      ),
    )
    add(
      'lead',
      'running: waiting after a split panel',
      yield* among(
        waiting,
        sql`exists (
          select 1 from review_panels rp
            join review_votes v on v.tenant_id = rp.tenant_id and v.panel_id = rp.id
           where rp.tenant_id = ri.tenant_id and rp.review_instance_id = ri.id
             and v.decision = 'reject')`,
      ),
    )
    add('lead', 'running: own ask still out', yield* asksOutstanding(lead))
    add('lead', 'running: rounds concluded', yield* acted(lead, ['approved', 'rejected']))
  }

  if (counsellor !== null) {
    const waiting = yield* inbox(counsellor)
    add('counsellor', 'running: waiting in the inbox', waiting.length)
    add('counsellor', 'running: back after an answered ask', yield* among(waiting, answered))
    add('counsellor', 'running: own ask still out', yield* asksOutstanding(counsellor))
    add('counsellor', 'running: refusals', yield* acted(counsellor, ['rejected']))
    add('counsellor', 'running: escalations', yield* acted(counsellor, ['escalated']))
    add(
      'counsellor',
      'running: re-examinations opened',
      yield* count(sql`
        select count(*)::int as n from review_instances ri
          join entries e on e.tenant_id = ri.tenant_id and e.id = ri.entry_id
         where e.batch_id = ${current} and ri.origin = 'reopen'`),
    )
    add(
      'counsellor',
      'running: facts recorded by hand',
      yield* count(sql`
        select count(*)::int as n from administrative_record_operations o
         where o.batch_id = ${current} and o.actor_id = ${counsellor}`),
    )
    add(
      'counsellor',
      'running: recorded facts taken back',
      yield* count(sql`
        select count(*)::int as n from entries e
         where e.batch_id = ${current} and e.source in ('record', 'import')
           and e.status = 'voided'`),
    )
    // whether the roster opens for this account at all: the persona student
    // stands on it, so reaching them is reaching the roster
    const standing = (
      (yield* runSql(sql`
        select p.id from batch_participants p
         where p.batch_id = ${current} and p.user_id = ${student}`)) as { rows: { id: string }[] }
    ).rows[0]
    const opened =
      standing === undefined
        ? false
        : (yield* Effect.result(
            assessment.getParticipant(
              tenantId,
              current,
              standing.id,
              principalOf(tenantId, counsellor),
            ),
          ))._tag === 'Success'
    add('counsellor', 'running: opens a participant from the roster', opened ? 1 : 0)
  }

  return {
    situations,
    missing: situations
      .filter((one) => one.count === 0)
      .map((one) => `${one.account}: ${one.label}`),
  }
})
