import { sql } from 'kysely'
import { Effect } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable, runSql } from '@qualy/plugin-database/testkit'
import { Assessment } from '../src/server/index.ts'
import { ok, one, run, seed, type Seeded } from './support/round.ts'

// Who may work on a round, as the page listing them reads it.
//
// A source that stopped granting anything stays on the page until somebody
// clears it (§32.48), so it has to say what it was: the role and the unit it
// came from, and why it grants nothing now. Before, a lapsed source was read
// from the live assignments alone and came back with no role at all - a
// provenance badge and a sentence repeating it, beside nothing.

let db: Awaited<ReturnType<typeof createTestContext>>

beforeAll(async () => {
  if (!postgresAvailable) return
  db = await createTestContext('staff-access', { migrations: 'apply' })
}, 120_000)

afterAll(async () => {
  await db?.dispose()
})

/** a round over the whole seeded tree, which takes on its reviewer and recorder */
const round = (f: Seeded) =>
  Effect.gen(function* () {
    const assessment = yield* Assessment
    return yield* assessment.createBatch(
      f.t,
      {
        name: 'Staffed',
        materialRange: { start: '2026-03-01', end: '2026-09-01' },
        import: { orgNodeIds: [f.root], userTypeIds: [f.studentType] },
      },
      f.principal(f.admin),
    )
  })

describe.runIf(postgresAvailable)('the staff of a round', () => {
  it('names the role and unit of every source, and says why a lapsed one grants nothing', async () => {
    const exit = await run(
      db.url,
      Effect.gen(function* () {
        const f = yield* seed('staff-lapses')
        const assessment = yield* Assessment
        // a third member of staff whose role is later switched off: the
        // assignment stands, but it is not one a round can take any more
        const tutorRole = one<{ id: string }>(
          yield* runSql(sql`
            insert into roles (tenant_id, code, name, kind, status, anchor_mode)
            values (${f.t}, 'tutor', 'Tutor', 'org', 'active', 'allow-list') returning id`),
        ).id
        yield* runSql(sql`
          insert into role_permissions (tenant_id, role_id, permission_id)
          select ${f.t}, ${tutorRole}, p.id from permissions p
          where p.code = 'assessment.ranking.view'`)
        const tutor = one<{ id: string }>(
          yield* runSql(sql`
            insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
            values (${f.t}, 'Tutor', ${f.studentType}, ${f.classA}) returning id`),
        ).id
        yield* runSql(sql`
          insert into role_grants (tenant_id, user_id, role_id, org_node_id, coverage)
          values (${f.t}, ${tutor}, ${tutorRole}, ${f.classA}, 'self')`)
        const batch = yield* round(f)
        const before = yield* assessment.listAccess(f.t, batch.id, {}, f.principal(f.admin))

        // the organization withdraws one, lets another run out, and switches
        // the third one's role off
        yield* runSql(sql`update role_grants set revoked_at = now() where id = ${f.recordGrant}`)
        yield* runSql(sql`
          update role_grants set valid_until = now() - interval '1 minute'
          where tenant_id = ${f.t} and user_id = ${f.reviewer}`)
        yield* runSql(sql`update roles set status = 'disabled' where id = ${tutorRole}`)
        const after = yield* assessment.listAccess(f.t, batch.id, {}, f.principal(f.admin))
        const plan = yield* assessment.previewAccessSync(f.t, batch.id, {}, f.principal(f.admin))
        return { f, tutor, before, after, plan }
      }),
    )
    const { f, tutor, before, after, plan } = ok(exit)
    const sourceOf = (
      access: typeof after,
      userId: string,
    ): (typeof after)['staff'][number]['sources'][number] | undefined =>
      access.staff.find((row) => row.userId === userId)?.sources[0]
    const said = (access: typeof after, userId: string) => {
      const source = sourceOf(access, userId)
      return (
        source && {
          roleName: source.roleName,
          orgNodeName: source.orgNodeName,
          active: source.active,
          lapse: source.lapse,
        }
      )
    }

    // standing, each source says where it came from and nothing is wrong
    expect(said(before, f.recorder)).toEqual({
      roleName: 'Recorder',
      orgNodeName: 'College A',
      active: true,
      lapse: null,
    })
    expect(said(before, f.reviewer)).toMatchObject({ roleName: 'Class reviewer', lapse: null })

    // lapsed, each still says what it was, and why it grants nothing
    expect(said(after, f.recorder)).toEqual({
      roleName: 'Recorder',
      orgNodeName: 'College A',
      active: false,
      lapse: 'revoked',
    })
    expect(said(after, f.reviewer)).toEqual({
      roleName: 'Class reviewer',
      orgNodeName: 'Class A1',
      active: false,
      lapse: 'expired',
    })
    expect(said(after, tutor)).toEqual({
      roleName: 'Tutor',
      orgNodeName: 'Class A1',
      active: false,
      lapse: 'inapplicable',
    })
    // and the role it named is the one recorded, not a blank
    expect(sourceOf(after, f.recorder)?.roleId).toBe(sourceOf(before, f.recorder)?.roleId)

    // the changes to review say the same of a withdrawal
    const lapsed = plan.items.filter((change) => change.kind === 'lapsed')
    expect(
      lapsed
        .map((change) => ({ role: change.roleName, unit: change.orgNodeName }))
        .sort((a, b) => a.role.localeCompare(b.role)),
    ).toEqual([
      { role: 'Class reviewer', unit: 'Class A1' },
      { role: 'Recorder', unit: 'College A' },
      { role: 'Tutor', unit: 'Class A1' },
    ])
  })

  // A round's staff is a roster somebody walks around in: they ask who may
  // review here, whose authority has lapsed, where a capability was turned
  // off - and want to be told how many there are. Before, the list took
  // nothing but a cursor and the page counted only its own rows.
  it('narrows the staff by name, role, capability and standing, and counts them', async () => {
    const exit = await run(
      db.url,
      Effect.gen(function* () {
        const f = yield* seed('staff-filters')
        const assessment = yield* Assessment
        yield* runSql(sql`update users set business_no = 'T2026' where id = ${f.reviewer}`)
        const batch = yield* round(f)
        const as = f.principal(f.admin)
        const list = (query: Parameters<typeof assessment.listAccess>[2]) =>
          assessment.listAccess(f.t, batch.id, query, as)
        const everyone = yield* list({})
        const firstPage = yield* list({ page: 1, limit: 2 })
        const secondPage = yield* list({ page: 2, limit: 2 })
        const byName = yield* list({ q: 'recor' })
        const byNumber = yield* list({ q: 't2026' })
        const byRole = yield* list({ roleId: f.reviewRole })
        const byPermission = yield* list({ permission: 'assessment.review.process' })

        // the organization withdraws one appointment, and the round turns
        // one capability off for somebody else
        yield* runSql(sql`update role_grants set revoked_at = now() where id = ${f.recordGrant}`)
        yield* assessment.setAccessDeny(
          f.t,
          batch.id,
          { userId: f.reviewer, permission: 'assessment.review.process', denied: true },
          as,
        )
        const afterwards = yield* list({})
        const active = yield* list({ standing: 'active' })
        const lapsed = yield* list({ standing: 'lapsed' })
        const withheld = yield* list({ standing: 'withheld' })
        return {
          f,
          everyone,
          firstPage,
          secondPage,
          byName,
          byNumber,
          byRole,
          byPermission,
          afterwards,
          active,
          lapsed,
          withheld,
        }
      }),
    )
    const r = ok(exit)
    const ids = (page: { staff: readonly { userId: string }[] }) =>
      page.staff.map((row) => row.userId)

    // three people work the round; the total is all of them, not the page
    expect(r.everyone.total).toBe(3)
    expect(r.firstPage).toMatchObject({ total: 3, page: 1, pageSize: 2 })
    expect(r.firstPage.staff).toHaveLength(2)
    expect(r.secondPage).toMatchObject({ total: 3, page: 2 })
    expect([...ids(r.firstPage), ...ids(r.secondPage)].sort()).toEqual(
      [r.f.admin, r.f.reviewer, r.f.recorder].sort(),
    )
    // the roles to narrow by are every role held here, whatever is chosen
    expect(r.byRole.roles.map((role) => [role.name, role.count])).toEqual([
      ['Admin', 1],
      ['Class reviewer', 1],
      ['Recorder', 1],
    ])

    expect(ids(r.byName)).toEqual([r.f.recorder])
    expect(ids(r.byNumber)).toEqual([r.f.reviewer])
    expect(ids(r.byRole)).toEqual([r.f.reviewer])
    expect(ids(r.byPermission)).toContain(r.f.reviewer)
    expect(ids(r.byPermission)).not.toContain(r.f.recorder)

    // whoever can still do something here comes first, by name, and those
    // left with nothing - withdrawn, or all turned off - sink below them
    expect(ids(r.afterwards)).toEqual([r.f.admin, r.f.recorder, r.f.reviewer])
    expect(ids(r.active)).toEqual([r.f.admin])
    expect(ids(r.lapsed)).toEqual([r.f.recorder])
    expect(ids(r.withheld)).toEqual([r.f.reviewer])
    expect(r.withheld.total).toBe(1)
  })

  // A college's administrator runs a round of that college, and a
  // school-wide supervisor works on it from the root. The administrator is
  // told the supervisor's role and that it is held somewhere they do not
  // manage - not the name of that unit, which every other screen of this
  // plugin keeps from them as well.
  it('names only the units the reader manages', async () => {
    const exit = await run(
      db.url,
      Effect.gen(function* () {
        const f = yield* seed('staff-unit-reach')
        const assessment = yield* Assessment
        const collegeA = one<{ id: string }>(
          yield* runSql(sql`
            select id from org_nodes where tenant_id = ${f.t} and name = 'College A'`),
        ).id
        // somebody who reviews for the whole school, appointed at its root
        const supervisorRole = one<{ id: string }>(
          yield* runSql(sql`
            insert into roles (tenant_id, code, name, kind, status, anchor_mode)
            values (${f.t}, 'supervisor', 'Supervisor', 'org', 'active', 'allow-list')
            returning id`),
        ).id
        yield* runSql(sql`
          insert into role_permissions (tenant_id, role_id, permission_id)
          select ${f.t}, ${supervisorRole}, p.id from permissions p
          where p.code = 'assessment.review.process'`)
        const supervisor = one<{ id: string }>(
          yield* runSql(sql`
            insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
            values (${f.t}, 'Supervisor', ${f.studentType}, ${f.root}) returning id`),
        ).id
        yield* runSql(sql`
          insert into role_grants (tenant_id, user_id, role_id, org_node_id, coverage)
          values (${f.t}, ${supervisor}, ${supervisorRole}, ${f.root}, 'subtree')`)
        // and the college's own administrator, who manages rounds there only
        const manager = one<{ id: string }>(
          yield* runSql(sql`
            insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
            values (${f.t}, 'Manager', ${f.studentType}, ${collegeA}) returning id`),
        ).id
        const managerRole = one<{ id: string }>(
          yield* runSql(sql`
            insert into roles (tenant_id, code, name, kind, status, anchor_mode)
            values (${f.t}, 'college-admin', 'College admin', 'org', 'active', 'allow-list')
            returning id`),
        ).id
        yield* runSql(sql`
          insert into role_permissions (tenant_id, role_id, permission_id)
          select ${f.t}, ${managerRole}, p.id from permissions p
          where p.code = 'assessment.batch.manage'`)
        yield* runSql(sql`
          insert into role_grants (tenant_id, user_id, role_id, org_node_id, coverage)
          values (${f.t}, ${manager}, ${managerRole}, ${collegeA}, 'subtree')`)

        const batch = yield* assessment.createBatch(
          f.t,
          {
            name: 'College A round',
            materialRange: { start: '2026-03-01', end: '2026-09-01' },
            import: { orgNodeIds: [collegeA], userTypeIds: [f.studentType] },
          },
          f.principal(f.admin),
        )
        // the supervisor is withdrawn and re-appointed after the round
        // began: a lapsed source and a new one, both at the root
        yield* runSql(sql`
          update role_grants set revoked_at = now()
          where tenant_id = ${f.t} and user_id = ${supervisor}`)
        yield* runSql(sql`
          insert into role_grants (tenant_id, user_id, role_id, org_node_id, coverage)
          values (${f.t}, ${supervisor}, ${supervisorRole}, ${f.root}, 'subtree')`)
        const college = f.principal(manager)
        const school = f.principal(f.admin)
        return {
          f,
          supervisor,
          collegeA,
          byCollege: yield* assessment.listAccess(f.t, batch.id, {}, college),
          bySchool: yield* assessment.listAccess(f.t, batch.id, {}, school),
          changesByCollege: yield* assessment.previewAccessSync(f.t, batch.id, {}, college),
          changesBySchool: yield* assessment.previewAccessSync(f.t, batch.id, {}, school),
        }
      }),
    )
    const r = ok(exit)
    const whereOf = (access: typeof r.byCollege, userId: string) =>
      access.staff
        .find((row) => row.userId === userId)
        ?.sources.map((source) => [source.orgNodeId, source.orgNodeName])

    // the supervisor's unit is identified to both, named only to the school
    expect(whereOf(r.byCollege, r.supervisor)).toEqual([[r.f.root, null]])
    expect(whereOf(r.bySchool, r.supervisor)).toEqual([[r.f.root, 'Root']])
    // a unit the college administrator manages is named to them as ever
    expect(whereOf(r.byCollege, r.f.recorder)).toEqual([[r.collegeA, 'College A']])
    // the same in the changes waiting to be taken on
    const supervisorChanges = (page: typeof r.changesByCollege) =>
      page.items
        .filter((change) => change.userId === r.supervisor)
        .map((change) => [change.kind, change.orgNodeId, change.orgNodeName])
        .sort((left, right) => String(left[0]).localeCompare(String(right[0])))
    expect(supervisorChanges(r.changesByCollege)).toEqual([
      ['lapsed', r.f.root, null],
      ['new', r.f.root, null],
    ])
    expect(supervisorChanges(r.changesBySchool)).toEqual([
      ['lapsed', r.f.root, 'Root'],
      ['new', r.f.root, 'Root'],
    ])
  })

  it('names the unit of an assignment the round has not taken on yet', async () => {
    const exit = await run(
      db.url,
      Effect.gen(function* () {
        const f = yield* seed('staff-new-unit')
        const assessment = yield* Assessment
        const batch = yield* round(f)
        // the organization appoints somebody after the round began
        const tutorRole = one<{ id: string }>(
          yield* runSql(sql`
            insert into roles (tenant_id, code, name, kind, status, anchor_mode)
            values (${f.t}, 'tutor', 'Tutor', 'org', 'active', 'allow-list') returning id`),
        ).id
        yield* runSql(sql`
          insert into role_permissions (tenant_id, role_id, permission_id)
          select ${f.t}, ${tutorRole}, p.id from permissions p
          where p.code = 'assessment.review.process'`)
        yield* runSql(sql`
          insert into role_grants (tenant_id, user_id, role_id, org_node_id, coverage)
          values (${f.t}, ${f.s2}, ${tutorRole}, ${f.classA}, 'self')`)
        return yield* assessment.previewAccessSync(f.t, batch.id, {}, f.principal(f.admin))
      }),
    )
    const fresh = ok(exit).items.filter((change) => change.kind === 'new')
    expect(fresh.map((change) => [change.roleName, change.orgNodeName])).toEqual([
      ['Tutor', 'Class A1'],
    ])
  })
})
