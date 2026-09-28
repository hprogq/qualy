import { Effect } from 'effect'
import { sql, type RawBuilder } from 'kysely'
import { Assessment } from '@qualy/plugin-assessment/testkit'
import { runSql } from '@qualy/plugin-database/testkit'
import type { SeedOptions } from './options.ts'
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
//
// A count only says something about the account it is listed under: what
// staff did is counted by who did it, not batch-wide.

type Key = (typeof PERSONA_ACCOUNTS)[number]['key']

/**
 * What a situation needs beyond the seeder having written it: the selection
 * past its filing phase (appeals and re-examinations open only then), the
 * route change having been made rather than left for the demonstration, or
 * the run having gone on to the last of the six terms (QUALY_DEMO_TERMS
 * stops short of it).
 */
export type Needs = 'review-stage' | 'route-change' | 'last-term'

/** what the run being checked seeded: the flags it took, and how far it went */
export interface Seeded extends SeedOptions {
  /** whether it seeded the last of the six terms */
  readonly lastTerm: boolean
}

export interface Situation {
  readonly account: Key
  readonly label: string
  readonly count: number
  readonly needs?: Needs
}

const expected = (situation: Situation, seeded: Seeded) => {
  switch (situation.needs) {
    case undefined:
      return true
    case 'review-stage':
      return seeded.stage !== 'entry'
    case 'route-change':
      return seeded.stage !== 'entry' && !seeded.migrationBefore
    case 'last-term':
      return seeded.lastTerm
  }
}

/** sorts the counts into what failed and what this run's options left out */
export const judgeSituations = (situations: readonly Situation[], seeded: Seeded) => ({
  missing: situations.filter((one) => expected(one, seeded) && one.count === 0),
  notExpected: situations.filter((one) => !expected(one, seeded)),
})

const count = (query: RawBuilder<unknown>) =>
  Effect.map(runSql(query), (found) => (found as { rows: { n: number }[] }).rows[0]?.n ?? 0)

/** the pages of a keyset listing, followed to its end */
const everyPage = <T, E, R>(
  page: (
    cursor: string | undefined,
  ) => Effect.Effect<{ items: readonly T[]; nextCursor: string | null }, E, R>,
) =>
  Effect.gen(function* () {
    const all: T[] = []
    let cursor: string | undefined
    for (;;) {
      const found = yield* page(cursor)
      all.push(...found.items)
      if (found.nextCursor === null) return all
      cursor = found.nextCursor
    }
  })

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
  const add = (account: Key, label: string, n: number, needs?: Needs) =>
    situations.push({ account, label, count: n, ...(needs === undefined ? {} : { needs }) })
  const student = idOf('student')
  const classLead = idOf('class-lead')
  const counsellor = idOf('counsellor')
  const lead = idOf('lead')
  if (tenantId === undefined || current === undefined || student === null) {
    add('student', 'the demonstration accounts and the running batch', 0)
    return situations
  }

  // the persona student's claims, in the archived terms and in the running batch
  const mine = (archived: boolean) => sql`
    select e.* from entries e
      join batch_participants p on p.tenant_id = e.tenant_id and p.id = e.participant_id
      join assessment_batches b on b.tenant_id = e.tenant_id and b.id = e.batch_id
     where p.user_id = ${student} and b.status ${archived ? sql`=` : sql`<>`} 'archived'`
  const history = mine(true)
  const running = mine(false)
  /** asks on these claims answered with the file they named */
  const answeredWithFile = (claims: RawBuilder<unknown>) => sql`
    select count(*)::int as n from (${claims}) e
      join review_instances ri on ri.tenant_id = e.tenant_id and ri.entry_id = e.id
      join review_supplement_requests r
        on r.tenant_id = ri.tenant_id and r.review_instance_id = ri.id
      join review_supplement_responses rr on rr.tenant_id = r.tenant_id and rr.request_id = r.id
     where r.status = 'answered'
       and exists (
         select 1 from review_supplement_attachments ra
          where ra.tenant_id = rr.tenant_id and ra.response_id = rr.id)`
  /** corrections made outside any round */
  const redetermined = (claims: RawBuilder<unknown>, kinds: readonly string[]) => sql`
    select count(*)::int as n from (${claims}) e
      join entry_events ee on ee.tenant_id = e.tenant_id and ee.entry_id = e.id
     where ee.kind = any(${kinds}::text[])`

  add(
    'student',
    'past: an ask for more material, answered with the file',
    yield* count(answeredWithFile(history)),
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
    'past: an ask for material inside an appeal or a re-examination',
    yield* count(sql`
      select count(*)::int as n from (${history}) e
        join review_instances ri on ri.tenant_id = e.tenant_id and ri.entry_id = e.id
        join review_supplement_requests r
          on r.tenant_id = ri.tenant_id and r.review_instance_id = ri.id
       where ri.origin in ('appeal', 'reopen') and r.status = 'answered'`),
  )
  add(
    'student',
    'past: re-examined by staff',
    yield* count(sql`
      select count(*)::int as n from (${history}) e
        join review_instances ri on ri.tenant_id = e.tenant_id and ri.entry_id = e.id
       where ri.origin = 'reopen' and ri.state = 'completed'`),
  )
  add(
    'student',
    'past: re-determined upwards',
    yield* count(redetermined(history, ['recognition-corrected'])),
  )
  add(
    'student',
    'past: approval revoked by re-determination',
    yield* count(redetermined(history, ['approval-revoked'])),
  )
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
  add(
    'student',
    'past: filed in a stage reopened for some questions',
    yield* count(sql`
      select count(*)::int as n from (${history}) e
        join phase_item_scopes s on s.tenant_id = e.tenant_id and s.item_id = e.item_id
        join batch_phases ph on ph.tenant_id = s.tenant_id and ph.id = s.phase_id
       where e.created_at >= ph.actual_entry_at
         and not exists (
           select 1 from batch_phases later
            where later.tenant_id = ph.tenant_id and later.batch_id = ph.batch_id
              and later.ordinal > ph.ordinal and later.actual_entry_at <= e.created_at)`),
    'last-term',
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
      when === 'running' ? 'route-change' : undefined,
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
    'review-stage',
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
  add('student', 'running: an ask answered with the file', yield* count(answeredWithFile(running)))
  add(
    'student',
    'running: a determination corrected outside any round',
    yield* count(
      redetermined(running, ['recognition-corrected', 'approval-revoked', 'rejection-overturned']),
    ),
  )
  add(
    'student',
    'running: class panel sitting',
    yield* count(sql`
      select count(*)::int as n from (${running}) e
        join review_panels rp
          on rp.tenant_id = e.tenant_id and rp.review_instance_id = e.current_review_instance_id
       where rp.state = 'open'`),
    'review-stage',
  )

  // what waits for each staff account, through the product's own inbox
  const inbox = (userId: string) =>
    Effect.map(
      everyPage((cursor) =>
        assessment.listReviewInbox(
          tenantId,
          { batchId: current, limit: '50', ...(cursor === undefined ? {} : { cursor }) },
          principalOf(tenantId, userId),
        ),
      ),
      (items) => items.map((item) => item.instanceId),
    )
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
      everyPage((cursor) =>
        assessment.listAwaitingSupplements(
          tenantId,
          { batchId: current, limit: '50', ...(cursor === undefined ? {} : { cursor }) },
          principalOf(tenantId, userId),
        ),
      ),
      (items) => items.filter((item) => item.status === 'open').length,
    )
  const acted = (userId: string, kinds: readonly string[]) =>
    count(sql`
      select count(*)::int as n from review_events re
        join review_instances ri on ri.tenant_id = re.tenant_id and ri.id = re.review_instance_id
        join entries e on e.tenant_id = ri.tenant_id and e.id = ri.entry_id
       where e.batch_id = ${current} and re.actor_id = ${userId}
         and re.kind = any(${kinds}::text[])`)
  const eventsBy = (userId: string, kinds: readonly string[]) =>
    count(sql`
      select count(*)::int as n from entry_events ee
        join entries e on e.tenant_id = ee.tenant_id and e.id = ee.entry_id
       where e.batch_id = ${current} and ee.actor_id = ${userId}
         and ee.kind = any(${kinds}::text[])`)

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
      'review-stage',
    )
    add('class-lead', 'running: back after an answered ask', yield* among(waiting, answered))
    add(
      'class-lead',
      'running: appeal at the class panel',
      yield* among(waiting, sql`ri.origin = 'appeal'`),
      'review-stage',
    )
    add(
      'class-lead',
      'running: rounds concluded',
      yield* acted(classLead, ['approved', 'rejected']),
    )
    // a student too, who files every term and applied for the selection
    const own = (archived: boolean) => sql`
      select count(*)::int as n from entries e
        join batch_participants p on p.tenant_id = e.tenant_id and p.id = e.participant_id
        join assessment_batches b on b.tenant_id = e.tenant_id and b.id = e.batch_id
       where p.user_id = ${classLead} and e.source = 'self'
         and b.status ${archived ? sql`=` : sql`<>`} 'archived'
         and e.status ${archived ? sql`= 'approved'` : sql`<> 'draft'`}`
    add('class-lead', 'past: claims of their own approved', yield* count(own(true)))
    add('class-lead', 'running: claims of their own sent in', yield* count(own(false)))
  }

  if (lead !== null) {
    const waiting = yield* inbox(lead)
    add('lead', 'running: waiting in the inbox', waiting.length)
    add(
      'lead',
      'running: appeal waiting',
      yield* among(waiting, sql`ri.origin = 'appeal'`),
      'review-stage',
    )
    add(
      'lead',
      'running: re-examination waiting',
      yield* among(waiting, sql`ri.origin = 'reopen'`),
      'review-stage',
    )
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
      'review-stage',
    )
    add('lead', 'running: own ask still out', yield* asksOutstanding(lead))
    // the rounds nobody is appointed to review, as the lead's alert panel reads them
    const alerts = yield* assessment.reviewAlerts(tenantId, current, principalOf(tenantId, lead))
    add(
      'lead',
      'running: rounds nobody can review, in the alerts',
      alerts.groups
        .filter((group) => group.reason === 'no-assignee')
        .reduce((sum, group) => sum + group.waiting, 0),
      'route-change',
    )
    add('lead', 'running: rounds concluded', yield* acted(lead, ['approved', 'rejected']))
    add(
      'lead',
      'running: determinations corrected outside any round',
      yield* eventsBy(lead, ['recognition-corrected', 'approval-revoked', 'rejection-overturned']),
    )
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
      yield* acted(counsellor, ['reopened']),
      'review-stage',
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
      yield* eventsBy(counsellor, ['voided-by-staff']),
    )
    // Whether the roster opens for this account at all: the persona student
    // stands on it, so reaching them is reaching the roster. Counsellors hold
    // the recording permission, which reads the accounts it covers
    // (docs/assessment-design.md §30, item 12, ruled 2026-09-28), and viewing
    // all claims, which opens the claims in them (ruled 2026-09-29).
    const standing = (
      (yield* runSql(sql`
        select p.id from batch_participants p
         where p.batch_id = ${current} and p.user_id = ${student}`)) as { rows: { id: string }[] }
    ).rows[0]
    const opened =
      standing === undefined
        ? null
        : yield* Effect.result(
            assessment.getParticipant(
              tenantId,
              current,
              standing.id,
              principalOf(tenantId, counsellor),
            ),
          )
    add(
      'counsellor',
      'running: opens a participant from the roster',
      opened?._tag === 'Success' ? 1 : 0,
    )
    const claims =
      standing === undefined || opened?._tag !== 'Success' || !opened.success.claims
        ? 0
        : (yield* assessment
            .listParticipantEntries(
              tenantId,
              current,
              standing.id,
              {},
              principalOf(tenantId, counsellor),
            )
            .pipe(Effect.orElseSucceed(() => ({ entries: [] })))).entries.length
    add('counsellor', "running: reads that participant's claims", claims)
  }

  return situations
})

/** one of the two students a visitor signs in as, in one batch */
export interface Standing {
  readonly account: 'student' | 'class-lead'
  readonly batch: string
  /** the claims they filed themselves and sent in */
  readonly claims: number
  /** their total as their own result page gives it, or null when it could not be read */
  readonly total: string | null
}

const STUDENT_ACCOUNTS = ['student', 'class-lead'] as const

/**
 * What the two students a visitor signs in as show, batch by batch: on the
 * roster of every batch, with claims of their own and a total above nothing,
 * and never the same total as each other.
 */
export const judgeStandings = (
  batches: readonly string[],
  standings: readonly Standing[],
): string[] => {
  const problems: string[] = []
  for (const batch of batches) {
    const here = standings.filter((one) => one.batch === batch)
    for (const account of STUDENT_ACCOUNTS) {
      const one = here.find((standing) => standing.account === account)
      if (one === undefined) {
        problems.push(`${account}: not on the roster of ${batch}`)
        continue
      }
      if (one.claims === 0) problems.push(`${account}: nothing of their own in ${batch}`)
      if (one.total === null) problems.push(`${account}: no result to read in ${batch}`)
      else if (Number(one.total) === 0) problems.push(`${account}: a total of 0 in ${batch}`)
    }
    const totals = here.flatMap((one) => (one.total === null ? [] : [one.total]))
    if (totals.length === 2 && totals[0] === totals[1]) {
      problems.push(`both at ${totals[0]} in ${batch}`)
    }
  }
  return problems
}

/** the two students' standings in every batch, oldest batch first */
export const personaStandings = Effect.gen(function* () {
  const assessment = yield* Assessment
  const batches = (
    (yield* runSql(sql`select id, name from assessment_batches order by created_at`)) as {
      rows: { id: string; name: string }[]
    }
  ).rows
  const people = (
    (yield* runSql(sql`
      select u.id, u.email, u.tenant_id from users u
       where u.email = any(${PERSONA_ACCOUNTS.map((account) => account.email)}::text[])`)) as {
      rows: { id: string; email: string; tenant_id: string }[]
    }
  ).rows
  const standings: Standing[] = []
  for (const batch of batches) {
    for (const account of STUDENT_ACCOUNTS) {
      const email = PERSONA_ACCOUNTS.find((one) => one.key === account)!.email
      const person = people.find((one) => one.email === email)
      if (person === undefined) continue
      const participant = (
        (yield* runSql(sql`
          select p.id from batch_participants p
           where p.batch_id = ${batch.id} and p.user_id = ${person.id} and p.status = 'active'`)) as {
          rows: { id: string }[]
        }
      ).rows[0]
      if (participant === undefined) continue
      const claims = yield* count(sql`
        select count(*)::int as n from entries e
         where e.participant_id = ${participant.id}
           and e.source = 'self' and e.status <> 'draft'`)
      const result = yield* Effect.result(
        assessment.getMyResult(
          person.tenant_id,
          batch.id,
          principalOf(person.tenant_id, person.id),
        ),
      )
      standings.push({
        account,
        batch: batch.name,
        claims,
        total: result._tag === 'Success' ? result.success.total : null,
      })
    }
  }
  return { batches: batches.map((batch) => batch.name), standings }
})
