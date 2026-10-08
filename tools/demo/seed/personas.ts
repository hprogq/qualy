import { Effect } from 'effect'
import { Iam } from '@qualy/plugin-auth/server'
import type { Story } from './context.ts'
import type { Student, World } from './world.ts'
import { demoEmail } from './school.ts'

// The people the demonstration signs in as.
//
// Their password is given at seeding time, like the administrator's, and is
// never committed or printed. The presenter keeps the credentials locally;
// the public sign-in page does not advertise these accounts.
//
// The system administrator is not among them: that account can change how
// everybody signs in, and its password comes from the environment only.

export const PERSONA_ACCOUNTS = [
  { key: 'student', label: '学生', email: demoEmail('student') },
  { key: 'class-lead', label: '班级综测负责人', email: demoEmail('class-lead') },
  { key: 'counsellor', label: '辅导员', email: demoEmail('counsellor') },
  { key: 'lead', label: '综测负责人', email: demoEmail('lead') },
] as const

export const PERSONA_PASSWORD_REQUIRED =
  'QUALY_DEMO_PERSONA_PASSWORD must name the password the demonstration accounts share (15 characters or more)'

/** the password the four accounts share, or undefined when the environment names none */
export const personaPassword = (): string | undefined => {
  const value = process.env.QUALY_DEMO_PERSONA_PASSWORD
  return value === undefined || value.length < 15 ? undefined : value
}

/** Ordinary students are participants without being admitted by any login entrance. */
export const personaAudience = (userTypes: World['userTypes'], systemType: string) => ({
  mode: 'allow-list' as const,
  userTypeIds: [systemType, userTypes.demoStudent, userTypes.faculty],
})

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
    const providers = yield* iam.providers.list(world.tenantId)
    const systemType = (yield* iam.userTypes.list(world.tenantId)).find((type) => type.isSystem)!.id
    const audience = personaAudience(world.userTypes, systemType)
    for (const provider of providers) {
      yield* story.step(
        iam.providers.setAudience(
          world.tenantId,
          provider.id,
          audience,
          provider.version,
          world.admin,
        ),
      )
    }
    const provider = (yield* iam.providers.list(world.tenantId)).find(
      (one) => one.code === 'local',
    )!
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
    const provider = (yield* iam.providers.list(world.tenantId)).find(
      (one) => one.code === 'local',
    )!.id
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
