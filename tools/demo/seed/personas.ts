import { Effect } from 'effect'
import { sql } from 'kysely'
import { Iam } from '@qualy/plugin-auth/server'
import { runSql } from '@qualy/plugin-database/testkit'
import type { Story } from './context.ts'
import type { Student, World } from './world.ts'

// The people a visitor signs in as.
//
// Their passwords are no secret - the sign-in page of a demonstration
// deployment prints them - which is why they may live in this file. The
// deployment names the same accounts in QUALY_DEMO_ACCOUNTS, and that is
// what freezes them against a visitor changing them.
//
// The system administrator is not among them: that account can change how
// everybody signs in, and its password comes from the environment only.

export const PERSONA_ACCOUNTS = [
  {
    key: 'student',
    label: '学生',
    email: 'student@demo.qualy.example',
    password: 'quiet-harbor-lantern-2027',
  },
  {
    key: 'class-lead',
    label: '班级综测负责人',
    email: 'class-lead@demo.qualy.example',
    password: 'amber-meadow-compass-2027',
  },
  {
    key: 'counsellor',
    label: '辅导员',
    email: 'counsellor@demo.qualy.example',
    password: 'silver-orchard-bridge-2027',
  },
  {
    key: 'lead',
    label: '综测负责人',
    email: 'assessment-lead@demo.qualy.example',
    password: 'cobalt-river-lighthouse-2027',
  },
] as const

/** what a demonstration deployment puts in QUALY_DEMO_ACCOUNTS */
export const demoAccountsEnv = () =>
  JSON.stringify(PERSONA_ACCOUNTS.map(({ label, email, password }) => ({ label, email, password })))

/** the student the demonstration follows: near the top in grades, busy, and in a 2023 class */
export const choosePersonaStudent = (world: World): Student => {
  const leading = new Set([...world.classLeads.values()].flat().concat(world.majorLeads))
  const candidates = world.students
    .filter((student) => student.classKey.startsWith('2023-') && !leading.has(student.id))
    .sort((a, b) => b.standing - a.standing)
    .slice(0, 30)
  return candidates.sort((a, b) => b.activity - a.activity)[0]!
}

/**
 * The administrator names the one way in the school uses and puts it on the
 * sign-in page in full, rather than behind the row of other methods.
 */
export const arrangeSignInPage = (world: World, story: Story) =>
  Effect.gen(function* () {
    const iam = yield* Iam
    const provider = (
      (yield* runSql(sql`select id, version from auth_providers where code = 'local'`)) as {
        rows: { id: string; version: number }[]
      }
    ).rows[0]!
    yield* story.step(
      iam.providers.update(
        world.tenantId,
        provider.id,
        { expectedVersion: provider.version, name: '邮箱密码' },
        world.admin,
      ),
    )
    yield* story.step(
      iam.providers.reorder(world.tenantId, { primary: [provider.id], secondary: [] }, world.admin),
    )
  })

/** gives each persona an address and a password, through the product */
export const openPersonaAccounts = (world: World, student: Student, story: Story) =>
  Effect.gen(function* () {
    const iam = yield* Iam
    const provider = (
      (yield* runSql(sql`select id from auth_providers where code = 'local'`)) as {
        rows: { id: string }[]
      }
    ).rows[0]!.id
    const people: Record<(typeof PERSONA_ACCOUNTS)[number]['key'], string> = {
      student: student.id,
      'class-lead': world.classLeads.get(student.classKey)![0]!,
      counsellor: world.staff.counsellors[0]!.id,
      lead: world.staff.manager.id,
    }
    for (const account of PERSONA_ACCOUNTS) {
      const userId = people[account.key]
      const row = (yield* iam.users.get(world.admin, userId)) as { version: number }
      yield* story.step(
        iam.users.update(
          world.tenantId,
          userId,
          { email: account.email },
          row.version,
          world.admin,
        ),
      )
      yield* story.step(
        iam.users.putBinding(
          world.tenantId,
          userId,
          provider,
          { secret: account.password },
          world.admin,
        ),
      )
      world.personas.add(userId)
    }
    return people
  })
