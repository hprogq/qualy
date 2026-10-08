import { Effect } from 'effect'
import { sql } from 'kysely'
import { Assessment } from '@qualy/plugin-assessment/testkit'
import { FormulaTemplateLibrary } from '@qualy/plugin-assessment-formula/testkit'
import { runSql } from '@qualy/plugin-database/testkit'
import { principalOf } from './seed/context.ts'
import { PERSONA_ACCOUNTS } from './seed/personas.ts'
import { TERM_PLANS } from './seed/term.ts'
import { SECONDARY_BATCHES } from './seed/secondary.ts'
import { termsToSeed } from './options.ts'

interface QueueHistory {
  readonly revision_count: number
  readonly origin: string
  readonly answered: boolean
  readonly escalated: boolean
}

interface ClaimIdentity {
  readonly batch_id: string
  readonly participant_id: string
  readonly item_id: string
  readonly status: string
  readonly activity: string | null
  readonly name: string | null
  readonly title: string | null
  readonly kind: string | null
  readonly term: string | null
  readonly duplicate_revoked: boolean
}

/** Publication channels do not make a new article; research output kinds distinguish achievements. */
export const duplicateClaimSummary = (claims: readonly ClaimIdentity[]) => {
  const groups = new Map<string, { total: number; ordinary: number }>()
  for (const claim of claims) {
    if (claim.status === 'voided' || claim.status === 'abandoned') continue
    const activity = claim.activity ?? claim.name ?? claim.title
    if (activity === null) continue
    const kind = claim.activity === null && claim.name === null ? claim.kind : null
    const key = JSON.stringify([
      claim.batch_id,
      claim.participant_id,
      claim.item_id,
      activity,
      claim.term ?? '',
      kind,
    ])
    const group = groups.get(key) ?? { total: 0, ordinary: 0 }
    group.total++
    if (claim.status !== 'rejected' || !claim.duplicate_revoked) group.ordinary++
    groups.set(key, group)
  }
  const duplicates = [...groups.values()].filter((group) => group.total > 1)
  return {
    unexpected: duplicates.filter((group) => group.ordinary > 1).length,
    explicitlyRejected: duplicates.filter((group) => group.ordinary <= 1).length,
  }
}

/** Inspect current claims only: revisions and shared proof templates are not additional events. */
export const checkDuplicateClaims = (tenantId: string) =>
  Effect.map(
    runSql<ClaimIdentity>(sql`
      select e.batch_id,e.participant_id,e.item_id,e.status,
        er.payload->>'activity' activity,er.payload->>'name' name,
        er.payload->>'title' title,er.payload->>'kind' kind,er.payload->>'term' term,
        exists(select 1 from entry_events ev where ev.tenant_id=e.tenant_id and ev.entry_id=e.id
          and ev.kind='approval-revoked' and ev.reason like '%重复%') duplicate_revoked
      from entries e join entry_revisions er on er.tenant_id=e.tenant_id and er.id=e.current_revision_id
      where e.tenant_id=${tenantId} and e.source='self' and e.status not in ('voided','abandoned')`),
    (result) => duplicateClaimSummary(result.rows),
  )

/** A visible history category, not merely a different database status. */
export const historyKind = (row: QueueHistory) => {
  if (row.origin === 'appeal' || row.origin === 'reopen' || row.origin === 'reroute')
    return row.origin
  if (row.answered) return 'supplement-answered'
  if (row.revision_count >= 3) return 'multiple-rounds'
  if (row.revision_count >= 2) return 'revised'
  if (row.escalated) return 'escalated'
  return 'initial'
}

const historiesOf = (ids: readonly string[]) =>
  Effect.map(
    runSql<QueueHistory>(sql`select ri.origin,
      (select count(distinct previous.revision_id)::int from review_instances previous
       where previous.tenant_id=ri.tenant_id and previous.entry_id=ri.entry_id
         and previous.round_no<=ri.round_no) revision_count,
      exists(select 1 from review_supplement_requests r where r.review_instance_id=ri.id and r.status='answered') answered,
      exists(select 1 from review_events re where re.review_instance_id=ri.id and re.kind='escalated') escalated
      from review_instances ri where ri.id=any(${ids}::uuid[])`),
    (result) => result.rows,
  )

const historyCounts = (histories: readonly QueueHistory[]) => {
  const counts = new Map<string, number>()
  for (const row of histories) {
    const kind = historyKind(row)
    counts.set(kind, (counts.get(kind) ?? 0) + 1)
  }
  return [...counts].map(([kind, count]) => `${kind} ${count}`).join(', ')
}

/** Checks each active main batch separately so one rich batch cannot hide another empty one. */
export const checkDemoCoverage = Effect.gen(function* () {
  const assessment = yield* Assessment
  const templates = yield* FormulaTemplateLibrary
  const problems: string[] = []
  const check = (ok: boolean, label: string) => {
    console.log(`  ${ok ? 'PASS' : 'FAIL'} ${label}`)
    if (!ok) problems.push(label)
  }
  const people = (
    (yield* runSql(sql`select u.id, u.tenant_id, u.email, u.primary_org_node_id,
    ut.code as type_code from users u join user_types ut on ut.id = u.user_type_id
    where u.email = any(${['admin@qualy.hprogq.com', ...PERSONA_ACCOUNTS.map((a) => a.email)]}::text[])`)) as {
      rows: {
        id: string
        tenant_id: string
        email: string
        primary_org_node_id: string | null
        type_code: string
      }[]
    }
  ).rows
  const admin = people.find((person) => person.email === 'admin@qualy.hprogq.com')
  check(people.length === 5, 'all five private presenter accounts exist')
  if (admin === undefined) return problems
  const t = admin.tenant_id
  const duplicates = yield* checkDuplicateClaims(t)
  check(
    duplicates.unexpected === 0,
    `no unexpected same-person same-item same-event same-term duplicates (${duplicates.unexpected}); explicitly rejected duplicates ${duplicates.explicitlyRejected}`,
  )
  const shared = yield* templates.listTemplates(t, {
    userId: admin.id,
    nodeId: admin.primary_org_node_id,
  })
  check(
    shared.items.some((item) => item.authorUserId !== admin.id),
    'administrator can open formulas shared by another author',
  )
  const exposed = (
    (yield* runSql(sql`select count(*)::int n from auth_providers ap
    where ap.tenant_id = ${t} and ap.enabled and ap.deleted_at is null
      and (ap.audience_mode = 'unrestricted' or exists (
        select 1 from auth_provider_user_types au join user_types ut on ut.id = au.user_type_id
        where au.auth_provider_id = ap.id and ut.code = 'student'))`)) as { rows: { n: number }[] }
  ).rows[0]!.n
  check(exposed === 0, 'ordinary students are excluded from every enabled login provider')
  for (const key of ['student', 'class-lead'] as const) {
    const person = people.find(
      (one) => one.email === PERSONA_ACCOUNTS.find((one) => one.key === key)!.email,
    )
    check(person?.type_code === 'demo-student', `${key} has the demonstration student type`)
  }
  const batches = (
    (yield* runSql(
      sql`select id, name, status from assessment_batches where tenant_id = ${t}`,
    )) as {
      rows: { id: string; name: string; status: string }[]
    }
  ).rows
  const expectedTerms = termsToSeed(process.env.QUALY_DEMO_TERMS, TERM_PLANS).map((one) => one.plan)
  for (const plan of [...expectedTerms, ...SECONDARY_BATCHES]) {
    const batch = batches.find((one) => one.name === plan.name)
    check(batch !== undefined, `${plan.name}: batch exists`)
    if (batch === undefined) continue
    const active = 'active' in plan ? plan.active : plan.term === '25-26-2'
    check(
      batch.status === (active ? 'active' : 'archived'),
      `${plan.name}: ${active ? 'active' : 'archived'}`,
    )
  }
  check(
    batches.some(
      (batch) =>
        batch.name === '2027 届软件学院推荐免试研究生综合评价' && batch.status === 'active',
    ),
    'selection remains active',
  )
  const mainActive = batches.filter(
    (batch) =>
      batch.status === 'active' && !SECONDARY_BATCHES.some((plan) => plan.name === batch.name),
  )
  for (const batch of mainActive) {
    for (const key of ['student', 'class-lead'] as const) {
      const person = people.find(
        (one) => one.email === PERSONA_ACCOUNTS.find((one) => one.key === key)!.email,
      )!
      const counts = (
        (yield* runSql(sql`select
        count(*) filter(where e.status='draft')::int drafts,
        count(*) filter(where e.status='approved')::int approved,
        count(*) filter(where ri.state in ('active','awaiting_supplement') or e.status='needs_revision')::int unfinished
        from entries e join batch_participants bp on bp.id=e.participant_id
        left join review_instances ri on ri.id=e.current_review_instance_id
        where e.batch_id=${batch.id} and bp.user_id=${person.id} and e.source='self'`)) as {
          rows: { drafts: number; approved: number; unfinished: number }[]
        }
      ).rows[0]!
      check(
        counts.approved > 0 && counts.unfinished > 0,
        `${batch.name}: ${key} has concluded and unfinished submissions`,
      )
    }
    for (const key of ['class-lead', 'counsellor', 'lead'] as const) {
      if (key === 'lead' && batch.name === TERM_PLANS.at(-1)!.name) continue
      const person = people.find(
        (one) => one.email === PERSONA_ACCOUNTS.find((one) => one.key === key)!.email,
      )!
      const inbox = yield* assessment.listReviewInbox(
        t,
        { batchId: batch.id, limit: '10', view: 'time' },
        principalOf(t, person.id),
      )
      check(inbox.items.length > 0, `${batch.name}: ${key} review queue is populated`)
      const ids = inbox.items.map((item) => item.instanceId)
      if (key === 'counsellor' && ids.length > 0) {
        const histories = yield* historiesOf(ids)
        const kinds = new Set(histories.map(historyKind))
        console.log(`    time view first ten: ${historyCounts(histories)}`)
        check(
          kinds.size >= 4,
          `${batch.name}: counsellor time view first ten have at least four history patterns`,
        )
        const byItem = yield* assessment.listReviewInbox(
          t,
          { batchId: batch.id, limit: '10', view: 'item' },
          principalOf(t, person.id),
        )
        const visibleHistories = yield* historiesOf(byItem.items.map((item) => item.instanceId))
        console.log(
          `    default item view (${byItem.items[0]?.itemTitle ?? 'empty'}): ${historyCounts(visibleHistories)}`,
        )
        const supplements = yield* assessment.listAwaitingSupplements(
          t,
          { batchId: batch.id, limit: '10' },
          principalOf(t, person.id),
        )
        console.log(
          `    material requests: awaiting response ${supplements.total - supplements.answered}, answered ${supplements.answered}`,
        )
        check(
          supplements.total > supplements.answered,
          `${batch.name}: counsellor has material requests awaiting a response`,
        )
        check(
          supplements.answered > 0,
          `${batch.name}: counsellor can review answered material requests`,
        )
      }
    }
  }
  return problems
})
