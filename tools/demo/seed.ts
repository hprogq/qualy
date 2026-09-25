// The demonstration dataset, from an empty database to three years of
// history and a selection in progress.
//
//   pnpm demo:reset-db
//   QUALY_DEMO_DATABASE_URL=postgres://qualy:qualy@localhost:5434/qualy_demo pnpm demo:seed
//
// Everything goes through the product's own services (tools/demo/runtime.ts
// says how), at the moment the story says it happened (tools/demo/timeline.ts
// says how that is placed afterwards). Chance is seeded: the same run gives
// the same database.

import { Effect } from 'effect'
import { Pool } from 'pg'
import { seed as bootstrap } from '../fixtures/seed.ts'
import { demoUrl, describeTarget, requireEmpty } from './target.ts'
import { runOverDemo, runSeedingHooks } from './runtime.ts'
import { Timeline, rewrite } from './timeline.ts'
import { FORMULAS } from './formulas.ts'
import { SEED, Story, cst, makeRandom, principalOf } from './seed/context.ts'
import { buildWorld } from './seed/world.ts'
import { publishFormula } from './seed/formulas.ts'
import { TERM_PLANS, dayAt, runTerm } from './seed/term.ts'
import { betweenTerms, handOver, type Away } from './seed/movements.ts'
import type { Student } from './seed/world.ts'
import {
  arrangeSignInPage,
  choosePersonaStudent,
  PERSONA_PASSWORD_REQUIRED,
  demoAccountsEnv,
  openPersonaAccounts,
  personaPassword,
} from './seed/personas.ts'
import { runSelection, type SelectionStage } from './seed/selection.ts'
import { writeSignIns } from './seed/telemetry.ts'
import { sql } from 'kysely'
import { runSql } from '@qualy/plugin-database/testkit'

try {
  process.loadEnvFile()
} catch {}

const url = demoUrl()
// the one account that can change how everybody signs in: never a committed value
const adminPassword = process.env.QUALY_DEMO_ADMIN_PASSWORD
if (adminPassword === undefined || adminPassword.length < 15) {
  throw new Error(
    'QUALY_DEMO_ADMIN_PASSWORD must name the demo system administrator’s password (15 characters or more)',
  )
}
// the accounts the demonstration signs in as: not a committed value either
const accountsPassword = personaPassword()
if (accountsPassword === undefined) throw new Error(PERSONA_PASSWORD_REQUIRED)
const flag = (name: string) =>
  process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3)
const stage = (flag('stage') ?? 'review') as SelectionStage
if (!['entry', 'review', 'appeal'].includes(stage)) {
  throw new Error('--stage must be entry, review or appeal')
}
const migrationBefore = flag('migration-state') === 'before'
await requireEmpty(url)
console.log(`seeding ${describeTarget(url)}`)
const startedAt = Date.now()

const pool = new Pool({ connectionString: url })
const timeline = new Timeline(new Pool({ connectionString: url, max: 1 }))
await timeline.begin()

// the tenant, its root and its administrator: the bootstrap every
// deployment starts from, in the summer before the first term
const client = await pool.connect()
let tenantId = ''
let adminId = ''
try {
  await timeline.record(cst('2023-08-18T10:00:00'), async () => {
    await client.query('begin')
    // the school's own name, which the bootstrap keeps once a tenant has one
    await client.query(`insert into tenants (slug, name) values ($1, '示例大学')`, [
      process.env.QUALY_DEFAULT_TENANT || 'default',
    ])
    await bootstrap(client, {
      adminEmail: 'admin@demo.example.edu',
      adminPassword,
    })
    await client.query('commit')
  })
  tenantId = (await client.query<{ id: string }>('select id from tenants')).rows[0]!.id
  adminId = (
    await client.query<{ id: string }>(
      `select id from users where email = 'admin@demo.example.edu'`,
    )
  ).rows[0]!.id
} finally {
  client.release()
}

const random = makeRandom(SEED)
const admin = principalOf(tenantId, adminId)
const story = new Story(timeline, cst('2023-08-18T10:05:00'))

/** formulas written for the selection, a few weeks before it opens */
const LATER_FORMULAS = ['scaled']

const publishRemaining = (
  tenantId: string,
  author: ReturnType<typeof principalOf>,
  story: Story,
  versions: Map<string, string[]>,
  functions: Map<string, { functionId: string; draftRevision: number }>,
  now: number,
) =>
  Effect.gen(function* () {
    story.set(new Date(now - 25 * 86_400_000))
    for (const key of LATER_FORMULAS) {
      const published = yield* publishFormula(tenantId, key, author, story, 1)
      versions.set(key, [...published.versionIds])
      functions.set(key, {
        functionId: published.functionId,
        draftRevision: published.draftRevision,
      })
    }
    // a run cut short before the second term has not yet published the
    // competition formula's second version, which the selection uses
    const competition = functions.get('competition')!
    if ((versions.get('competition') ?? []).length < 2) {
      const next = yield* publishFormula(tenantId, 'competition', author, story, 2, {
        ...competition,
        published: 1,
      })
      versions.set('competition', [...versions.get('competition')!, ...next.versionIds])
    }
    return versions
  })

const program = Effect.gen(function* () {
  yield* story.step(runSeedingHooks)

  // the school takes the system on in February 2024, ahead of the first
  // assessment it runs in it
  story.set(cst('2024-02-19T09:30:00'))
  const world = yield* buildWorld({ tenantId, admin, story, random })
  console.log(`world: ${world.students.length} students, ${world.classes.size} classes`)
  yield* arrangeSignInPage(world, story)
  // the student a visitor signs in as stays in the cohort from start to end
  const personaStudent = choosePersonaStudent(world)
  world.personas.add(personaStudent.id)

  // the assessment lead writes the formulas the first term needs
  story.set(cst('2024-02-22T15:00:00'))
  const author = principalOf(tenantId, world.staff.manager.id)
  const versions = new Map<string, string[]>()
  const functions = new Map<string, { functionId: string; draftRevision: number }>()
  for (const spec of FORMULAS) {
    if (LATER_FORMULAS.includes(spec.key)) continue
    const published = yield* publishFormula(tenantId, spec.key, author, story, 1)
    versions.set(spec.key, [...published.versionIds])
    functions.set(spec.key, {
      functionId: published.functionId,
      draftRevision: published.draftRevision,
    })
  }

  const away: Away[] = []
  let leaving: Student[] = []
  // QUALY_DEMO_TERMS stops after that many terms, for working on the scenario
  const terms = TERM_PLANS.slice(0, Number(process.env.QUALY_DEMO_TERMS ?? TERM_PLANS.length))
  for (const [index, plan] of terms.entries()) {
    const started = Date.now()
    if (index > 0) {
      // the summer or the winter between two assessments
      story.set(dayAt(plan.day, -20, '10:00'))
      yield* betweenTerms({ world, index, away, leaving, random, story })
    }
    if (plan.term === '23-24-2') {
      // the new rules make team places step down by 0.1
      story.set(dayAt(plan.day, -9, '16:00'))
      const competition = functions.get('competition')!
      const next = yield* publishFormula(tenantId, 'competition', author, story, 2, {
        ...competition,
        published: 1,
      })
      versions.set('competition', [...versions.get('competition')!, ...next.versionIds])
    }
    if (plan.term === '24-25-1' || plan.term === '25-26-1') {
      story.set(dayAt(plan.day, -12, '14:00'))
      yield* handOver(world, random, story, away)
    }
    const eligible = world.students.filter(
      (student) =>
        student.classKey.startsWith('2023-') &&
        !away.some((one) => one.student.id === student.id) &&
        ![...world.classLeads.values()].flat().includes(student.id) &&
        !world.majorLeads.includes(student.id) &&
        !world.personas.has(student.id),
    )
    const onLeave = [...eligible].sort((a, b) => a.activity - b.activity).slice(0, plan.onLeave)
    const outcome = yield* runTerm({ world, plan, versions, story, random, onLeave })
    leaving = onLeave
    console.log(
      `${plan.term}: ${outcome.participants.size} participants, ${[...outcome.counts.entries()]
        .map(([label, n]) => `${label} ${n}`)
        .join(', ')} (${Math.round((Date.now() - started) / 1000)}s)`,
    )
  }

  // the demonstration accounts open, a few weeks before the selection
  story.set(new Date(startedAt - 27 * 86_400_000))
  yield* openPersonaAccounts(world, personaStudent, story, accountsPassword)

  const history = (
    (yield* runSql(
      sql`select id from assessment_batches where status = 'archived' order by created_at`,
    )) as { rows: { id: string }[] }
  ).rows.map((row) => row.id)
  const selection = yield* runSelection({
    world,
    versions: yield* publishRemaining(tenantId, author, story, versions, functions, startedAt),
    story,
    random,
    history,
    options: { stage, migrationBefore },
    now: new Date(startedAt),
  })
  console.log(
    `selection (${stage}${migrationBefore ? ', route change left for the demo' : ''}): ${selection.applicants.length} applicants, ${[
      ...selection.counts.entries(),
    ]
      .map(([label, n]) => `${label} ${n}`)
      .join(', ')}`,
  )
})

await runOverDemo(url, program as Effect.Effect<void, unknown, never>)
const moved = await rewrite(pool, timeline)
const signIns = await writeSignIns(pool)
console.log(`${signIns} sign-ins written`)
console.log(
  `\nonly on a deployment that offers these accounts on its sign-in page:\nQUALY_DEMO_ACCOUNTS='${demoAccountsEnv(accountsPassword)}'`,
)
await pool.end()
console.log(
  `done in ${Math.round((Date.now() - startedAt) / 1000)}s: ${timeline.windows.length} steps, ${moved} timestamps placed in the story`,
)
