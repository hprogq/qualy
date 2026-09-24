import { Effect } from 'effect'
import { Org } from '@qualy/plugin-org/server'
import { Iam } from '@qualy/plugin-auth/server'
import { Access } from '@qualy/plugin-rbac/server'
import { Rbac } from '@qualy/rbac-contract/effect'
import { UserProvisioning } from '@qualy/auth-contract/provisioning'
import { transaction } from '@qualy/plugin-database/server'
import library from '../library.json' with { type: 'json' }
import { principalOf, type Random, type Story } from './context.ts'
import { classNameOf, MAJORS, type MajorKey, type Student, type World } from './world.ts'

// What happens to a cohort between two terms, in the numbers the real one
// had: some leave (a leave of absence, a withdrawal), some come back, a few
// older students rejoin after their own leave, three change major once, and
// one drops back a year. Each is an ordinary act in the product - a person
// disabled, enabled, moved - and the next batch's roster simply follows,
// while every earlier batch keeps the place each person had then.

export interface Away {
  readonly student: Student
  /** the term index they left after */
  readonly since: number
}

const protectedIds = (world: World) =>
  new Set([...world.classLeads.values()].flat().concat(world.majorLeads, [...world.personas]))

const versionOf = (world: World, userId: string) =>
  Effect.gen(function* () {
    const iam = yield* Iam
    const row = (yield* iam.users.get(world.admin, userId)) as { version: number }
    return row.version
  })

export const disable = (world: World, student: Student, story: Story) =>
  Effect.gen(function* () {
    const iam = yield* Iam
    const version = yield* versionOf(world, student.id)
    yield* story.step(
      iam.users.setStatus(
        world.tenantId,
        student.id,
        { status: 'disabled', expectedVersion: version },
        world.admin,
      ),
    )
  })

const enable = (world: World, student: Student, story: Story) =>
  Effect.gen(function* () {
    const iam = yield* Iam
    const version = yield* versionOf(world, student.id)
    yield* story.step(
      iam.users.setStatus(
        world.tenantId,
        student.id,
        { status: 'active', expectedVersion: version },
        world.admin,
      ),
    )
  })

const move = (world: World, student: Student, classKey: string, story: Story) =>
  Effect.gen(function* () {
    const iam = yield* Iam
    const unit = world.classes.get(classKey)!
    const version = yield* versionOf(world, student.id)
    yield* story.step(
      iam.users.setPlacement(world.tenantId, student.id, unit.nodeId, version, world.admin),
    )
    student.classKey = classKey
    student.major = unit.major
  })

/** a new student joining an existing class */
const join = (world: World, cohort: string, major: MajorKey, random: Random, story: Story) =>
  Effect.gen(function* () {
    const provisioning = yield* UserProvisioning
    const classes = [...world.classes.values()].filter(
      (unit) => unit.major === major && unit.key.startsWith('2023-'),
    )
    const unit = random.pick(classes)
    const name = world.nextName()
    // seats from 60 up are free in every class, and never handed out twice
    const taken = new Set(world.students.map((student) => student.number))
    let seat = 60
    let number = ''
    do {
      number = `${cohort.slice(2)}099${String(unit.no).padStart(2, '0')}${String(seat++)}`
    } while (taken.has(number))
    const created = yield* story.step(
      transaction(
        provisioning.createUsers(
          world.tenantId,
          [
            {
              displayName: name,
              businessNo: number,
              userTypeId: world.userTypes.student,
              primaryOrgNodeId: unit.nodeId,
            },
          ],
          world.admin,
        ),
      ),
    )
    const student: Student = {
      id: created[0]!.id,
      name,
      number,
      classKey: unit.key,
      major,
      activity: random.next() ** 1.6,
      standing: random.next() * 0.7,
    }
    world.students.push(student)
    return student
  })

/**
 * The changes between term `index - 1` and term `index`, applied at `when`.
 * `leaving` are the people who took leave during the previous term; they
 * are among those who go.
 */
export const betweenTerms = (input: {
  world: World
  index: number
  away: Away[]
  leaving: readonly Student[]
  random: Random
  story: Story
}) =>
  Effect.gen(function* () {
    const { world, index, away, random, story } = input
    const movement = library.movements[index - 1]!
    const keep = protectedIds(world)
    const active = () =>
      world.students.filter(
        (student) =>
          student.classKey.startsWith('2023-') &&
          !away.some((one) => one.student.id === student.id),
      )

    // leaving: first those whose leave began last term, then others
    const leavers: Student[] = [...input.leaving]
    const pool = active()
      .filter((student) => !keep.has(student.id) && !leavers.includes(student))
      .sort((a, b) => a.activity - b.activity)
    while (leavers.length < movement.left && pool.length > 0) {
      leavers.push(pool.splice(random.int(0, Math.min(pool.length - 1, 120)), 1)[0]!)
    }
    for (const student of leavers) {
      yield* disable(world, student, story)
      away.push({ student, since: index - 1 })
    }

    // joining: 2023 numbers are people back from leave; older ones rejoin the cohort
    for (const [cohort, count] of Object.entries(movement.joinedByCohort)) {
      for (let i = 0; i < count; i++) {
        if (cohort === '2023') {
          const back = away.findIndex((one) => one.since < index - 1)
          if (back >= 0) {
            const [returning] = away.splice(back, 1)
            yield* enable(world, returning!.student, story)
            continue
          }
        }
        yield* join(world, cohort, random.pick(['se', 'is', 'cs', 'ne'] as const), random, story)
      }
    }

    // a change of major takes a student to a class of the new major
    const candidates = active().filter((student) => !keep.has(student.id) && student.major !== 'cs')
    for (let i = 0; i < movement.majorChanged; i++) {
      const student = candidates.splice(random.int(0, candidates.length - 1), 1)[0]!
      const target = random.pick(
        [...world.classes.values()].filter(
          (unit) => unit.major === (i === 2 ? 'se' : 'cs') && unit.key.startsWith('2023-'),
        ),
      )
      yield* move(world, student, target.key, story)
    }

    // dropping back a year: a class of the next cohort, which exists for them
    for (let i = 0; i < movement.cohortChanged; i++) {
      const student = active().find((one) => !keep.has(one.id) && one.major === 'se')!
      const unit = yield* cohortClass(world, '2025', 'se', 5, story)
      yield* move(world, student, unit, story)
    }
  })

/** a class of a later cohort, with the grade and major above it, made on first use */
const cohortClass = (world: World, cohort: string, major: MajorKey, no: number, story: Story) =>
  Effect.gen(function* () {
    const key = `${cohort}-${no}`
    if (world.classes.has(key)) return key
    const org = yield* Org
    const grade = yield* story.step(
      org.createNode(
        world.tenantId,
        { parentId: world.college, orgTypeId: world.types.grade, name: `${cohort}级` },
        world.admin,
      ),
    )
    const majorNode = yield* story.step(
      org.createNode(
        world.tenantId,
        {
          parentId: grade.id,
          orgTypeId: world.types.major,
          name: MAJORS.find((m) => m.key === major)!.name,
        },
        world.admin,
      ),
    )
    const name = classNameOf(cohort, no, major)
    const unit = yield* story.step(
      org.createNode(
        world.tenantId,
        { parentId: majorNode.id, orgTypeId: world.types.class, name },
        world.admin,
      ),
    )
    world.classes.set(key, { key, no, major, name, nodeId: unit.id })
    return key
  })

/**
 * A new pair of class leads in every class: the committee elected at the
 * start of a year. The old grants are revoked, the new ones granted, and a
 * review inbox moves from one person to the next with nothing migrated.
 */
export const handOver = (world: World, random: Random, story: Story, away: readonly Away[]) =>
  Effect.gen(function* () {
    const access = yield* Access
    const rbac = yield* Rbac
    for (const [classKey, leads] of world.classLeads) {
      if (!classKey.startsWith('2023-')) continue
      for (const lead of leads) {
        const grant = world.grants.get(`${lead}:${world.roles.classLead}`)
        if (grant === undefined) continue
        yield* story.step(
          rbac.revokeAssignment({
            tenantId: world.tenantId,
            assignmentId: grant,
            actorId: world.admin.userId,
          }),
          3,
        )
        world.grants.delete(`${lead}:${world.roles.classLead}`)
      }
      const inClass = world.students.filter(
        (student) =>
          student.classKey === classKey &&
          !world.majorLeads.includes(student.id) &&
          !away.some((one) => one.student.id === student.id),
      )
      const next: string[] = []
      while (next.length < 2 && inClass.length > 0) {
        next.push(inClass.splice(random.int(0, inClass.length - 1), 1)[0]!.id)
      }
      for (const lead of next) {
        const made = yield* story.step(
          access.grants.grant(
            world.tenantId,
            {
              userId: lead,
              roleId: world.roles.classLead,
              target: {
                kind: 'org-node',
                orgNodeId: world.classes.get(classKey)!.nodeId,
                coverage: 'self',
              },
            },
            world.admin,
          ),
          3,
        )
        world.grants.set(`${lead}:${world.roles.classLead}`, made)
      }
      world.classLeads.set(classKey, next)
    }
  })

export const principalOfStudent = (world: World, student: Student) =>
  principalOf(world.tenantId, student.id)
