import { Effect } from 'effect'
import { sql } from 'kysely'
import { Iam } from '@qualy/plugin-auth/server'
import { runSql } from '@qualy/plugin-database/testkit'
import type { Story } from './context.ts'
import type { Student, World } from './world.ts'

// The people the demonstration signs in as.
//
// Their password is given at seeding time, like the administrator's, and is
// never committed: a deployment of this baseline decides for itself whether
// anybody but its owner may sign in as them. One that offers them on its
// sign-in page names them in QUALY_DEMO_ACCOUNTS, which also freezes them
// against a visitor changing them; the seeder prints that value.
//
// The system administrator is not among them: that account can change how
// everybody signs in, and its password comes from the environment only.

export const PERSONA_ACCOUNTS = [
  { key: 'student', label: '学生', email: 'student@demo.qualy.example' },
  { key: 'class-lead', label: '班级综测负责人', email: 'class-lead@demo.qualy.example' },
  { key: 'counsellor', label: '辅导员', email: 'counsellor@demo.qualy.example' },
  { key: 'lead', label: '综测负责人', email: 'assessment-lead@demo.qualy.example' },
] as const

export const PERSONA_PASSWORD_REQUIRED =
  'QUALY_DEMO_PERSONA_PASSWORD must name the password the demonstration accounts share (15 characters or more)'

/** the password the four accounts share, or undefined when the environment names none */
export const personaPassword = (): string | undefined => {
  const value = process.env.QUALY_DEMO_PERSONA_PASSWORD
  return value === undefined || value.length < 15 ? undefined : value
}

/** what a deployment that offers the accounts puts in QUALY_DEMO_ACCOUNTS */
export const demoAccountsEnv = (password: string) =>
  JSON.stringify(PERSONA_ACCOUNTS.map(({ label, email }) => ({ label, email, password })))

/**
 * The two students the demonstration signs in as, chosen from the cohort
 * before anybody holds an office. The student it follows is near the top in
 * grades and busy. The class lead is a classmate of theirs among the best
 * three in the class, the busiest of them: somebody who files every term and
 * whose grades carry an application for the selection.
 */
export const choosePersonaStudents = (
  students: readonly Student[],
): { student: Student; classLead: Student } => {
  const student = students
    .filter((one) => one.classKey.startsWith('2023-'))
    .sort((a, b) => b.standing - a.standing)
    .slice(0, 30)
    .sort((a, b) => b.activity - a.activity)[0]!
  const classLead = students
    .filter((one) => one.classKey === student.classKey && one.id !== student.id)
    .sort((a, b) => b.standing - a.standing)
    .slice(0, 3)
    .sort((a, b) => b.activity - a.activity)[0]!
  return { student, classLead }
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
export const openPersonaAccounts = (world: World, story: Story, password: string) =>
  Effect.gen(function* () {
    const iam = yield* Iam
    const provider = (
      (yield* runSql(sql`select id from auth_providers where code = 'local'`)) as {
        rows: { id: string }[]
      }
    ).rows[0]!.id
    const people: Record<(typeof PERSONA_ACCOUNTS)[number]['key'], string> = {
      student: world.cast.student.id,
      'class-lead': world.cast.classLead.id,
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
        iam.users.putBinding(world.tenantId, userId, provider, { secret: password }, world.admin),
      )
      world.personas.add(userId)
    }
    return people
  })
