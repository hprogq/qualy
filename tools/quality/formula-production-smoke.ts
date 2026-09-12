import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { lockPathFor, readLock, readManifest } from '@qualy/assembly'
import { repoRoot } from '../lib/manifest.ts'
import {
  auditDataset,
  clientFor,
  PASSTHROUGH,
  sessionsFor,
  type Api,
} from '../benchmarks/support/dataset.ts'
import { databaseUrlFor, ensureDatabase, openDb } from '../benchmarks/support/pg.ts'
import {
  assertStagedAssets,
  cli,
  requireSandbox,
  startServer,
  type RunningServer,
} from '../benchmarks/support/server.ts'
import { sessionCookieNameFor } from '../../packages/plugins/base/auth/src/server/session-cookie.ts'

// The formula scoring chain, in production, end to end.
//
// The general production smoke proves the assembly boots, serves and stops.
// It never logs in, and it never asks a formula to score anything. This one
// does exactly that and nothing else: over the COMMITTED manifest and lock,
// on a database of its own, through the real production entry, it publishes
// a formula in the authoring sandbox, binds a question to that version,
// records one administrative determination through the product API, and
// reads the participant's result the runtime sandbox computed - then asks
// the audit to say the standing determination is clean, and asks the
// server to stop.
//
// A final-acceptance tool, run by hand: it needs PostgreSQL and both
// sandboxes. It is not a benchmark - one participant, one question, one
// determination - and it fabricates nothing the product can do itself. The
// single fixture is the participant's session: nobody sets a password for
// another person through the API, so the session row is written directly.
//
// Binding a new formula is the writer the rollout gates. Where the manifest
// keeps that writer off, this tool refuses up front and touches nothing:
// no database, no server, no sandbox.

const PORT = Number(process.env.FORMULA_SMOKE_PORT ?? '3196')
const DATABASE = 'qualy_formula_smoke'
const ADMIN_USERNAME = 'admin'
const ADMIN_PASSWORD = 'formula-smoke-admin-password'
const FORMULA_PLUGIN = '@qualy/plugin-assessment-formula'
const AMOUNT = '3'

const say = (line: string) => console.log(`smoke: ${line}`)

class SmokeFailure extends Error {
  readonly step: string
  readonly detail: string
  constructor(step: string, detail: string) {
    super(`${step}: ${detail}`)
    this.step = step
    this.detail = detail
  }
}

const must = <T>(
  answer: { status: number; body: T; text: string },
  what: string,
  accepted: readonly number[] = [200, 201],
): T => {
  if (!accepted.includes(answer.status)) {
    throw new SmokeFailure(what, `status ${answer.status}\n${answer.text}`)
  }
  return answer.body
}

const expectThat = (holds: boolean, step: string, detail: string): void => {
  if (!holds) throw new SmokeFailure(step, detail)
}

const runOrThrow = (
  what: string,
  file: string,
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
): void => {
  const ran = spawnSync(process.execPath, [file, ...argv], {
    cwd: repoRoot,
    encoding: 'utf8',
    env,
    timeout: 300_000,
  })
  if (ran.status !== 0) {
    throw new SmokeFailure(what, `exit ${ran.status}\n${ran.stdout}${ran.stderr}`)
  }
}

const loginAs = async (base: string, identifier: string, password: string): Promise<string> => {
  const response = await fetch(`${base}/api/auth/local/local/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier, password }),
  })
  if (response.status !== 200) {
    throw new SmokeFailure('login', `status ${response.status}\n${await response.text()}`)
  }
  // the production entry names its cookie with the `__Host-` prefix
  const cookie = new RegExp(`${sessionCookieNameFor(true)}=([^;]+)`).exec(
    response.headers.get('set-cookie') ?? '',
  )
  if (!cookie) throw new SmokeFailure('login', 'the login answered without a session cookie')
  return cookie[1]!
}

/** what the manifest says about the writer, read before anything else is touched */
const authoringEnabled = (manifest: string): boolean => {
  const entry = readManifest(manifest).plugins.get(FORMULA_PLUGIN)
  return (entry?.config as { authoring?: boolean } | undefined)?.authoring === true
}

const chain = async (base: string, databaseUrl: string): Promise<{ tenantId: string }> => {
  // --- who is acting, and where -------------------------------------------
  const admin: Api = clientFor(base, await loginAs(base, ADMIN_USERNAME, ADMIN_PASSWORD))
  const session = must(
    await admin.call<{ user: { id: string; tenant: { id: string } } }>('GET', '/auth/session'),
    'admin session',
  )
  const tenantId = session.user.tenant.id
  // the writer is on: the assembly projects the formula calculator to a
  // principal who may manage a round, which is what the chooser is built from
  const manifest = must(
    await admin.call<{ collections: Record<string, { ref?: string }[]> }>('GET', '/app/manifest'),
    'manifest',
  )
  const calculators = manifest.collections['assessment/calculator-authoring-options'] ?? []
  expectThat(
    calculators.some((option) => option.ref === 'formula@1'),
    'manifest',
    `the calculator chooser offers ${JSON.stringify(calculators.map((option) => option.ref))}; formula@1 is not among them`,
  )
  say('the assembly offers the formula calculator')
  const tree = must(await admin.call<{ roots: string[] }>('GET', '/org/tree'), 'org tree')
  const rootNodeId = tree.roots[0]
  expectThat(rootNodeId !== undefined, 'org tree', 'the organisation has no root')
  say(`tenant ${tenantId}, root ${rootNodeId}`)

  // --- one participant, through the product ---------------------------------
  const studentType = must(
    await admin.call<{ id: string }>('POST', '/iam/user-types', {
      name: 'Smoke student',
      code: 'smoke-student',
      placementPolicy: { mode: 'unrestricted' },
    }),
    'student type',
  )
  const student = must(
    await admin.call<{ id: string }>('POST', '/iam/users', {
      displayName: 'Smoke Student',
      userTypeId: studentType.id,
      primaryOrgNodeId: rootNodeId,
    }),
    'student user',
  )
  // the one fixture: a session, since nobody sets another person's password
  const db = await openDb(databaseUrl)
  let studentToken: string
  try {
    ;[studentToken] = (await sessionsFor(db, tenantId, [student.id])) as [string]
  } finally {
    await db.end()
  }
  const participant: Api = clientFor(base, studentToken)
  must(await participant.call('GET', '/auth/session'), 'student session')
  say(`student ${student.id} signed in`)

  // --- the formula, published in the authoring sandbox ----------------------
  const created = must(
    await admin.call<{ function: { id: string; draftRevision: number } }>(
      'POST',
      '/assessment/formula-functions',
      { name: 'production smoke passthrough' },
    ),
    'create formula function',
  )
  const drafted = must(
    await admin.call<{ function: { draftRevision: number } }>(
      'PATCH',
      `/assessment/formula-functions/${created.function.id}`,
      {
        expectedDraftRevision: created.function.draftRevision,
        name: 'production smoke passthrough',
        draftSourceTs: PASSTHROUGH,
        draftTests: [{ name: 'passes through', input: { value: AMOUNT }, expected: AMOUNT }],
      },
    ),
    'draft formula',
  )
  must(
    await admin.call('POST', `/assessment/formula-functions/${created.function.id}/versions`, {
      expectedDraftRevision: drafted.function.draftRevision,
    }),
    'publish formula version',
  )
  say(`formula ${created.function.id} published`)

  // --- the round, with its roster -------------------------------------------
  const batch = must(
    await admin.call<{ batch: { id: string } }>('POST', '/assessment/batches', {
      name: 'formula production smoke',
      materialRange: { start: '2026-03-01', end: '2026-09-01' },
      import: { orgNodeIds: [rootNodeId], userTypeIds: [studentType.id] },
    }),
    'create batch',
  )
  const batchId = batch.batch.id
  const roster = must(
    await admin.call<{ items: { id: string; userId: string }[] }>(
      'GET',
      `/assessment/batches/${batchId}/participants`,
    ),
    'participants',
  )
  const enrolled = roster.items.find((one) => one.userId === student.id)
  expectThat(
    roster.items.length === 1 && enrolled !== undefined,
    'participants',
    `the import enrolled ${roster.items.length} participant(s); expected the one student`,
  )
  const phases = must(
    await admin.call<{ phases: { id: string; phaseKey: string }[] }>(
      'PUT',
      `/assessment/batches/${batchId}/phases`,
      {
        phases: [
          {
            phaseKey: 'entry',
            displayName: 'entry',
            permissionProfile: ['assessment.entry.record'],
          },
          { phaseKey: 'archive', displayName: 'archive' },
        ],
      },
    ),
    'phases',
  )
  const entryPhase = phases.phases.find((phase) => phase.phaseKey === 'entry')
  expectThat(entryPhase !== undefined, 'phases', 'no entry phase')
  const groups = must(
    await admin.call<{ groups: { id: string }[] }>(
      'PUT',
      `/assessment/batches/${batchId}/score-groups`,
      {
        groups: [{ name: 'smoke', parentGroupId: null, cap: null, floor: null }],
        expectedVersion: 1,
      },
    ),
    'score groups',
  )

  // --- the version, as the binding catalog offers it ------------------------
  const offered = must(
    await admin.call<{ items: { versionId: string; functionId: string }[] }>(
      'GET',
      `/assessment/batches/${batchId}/formula-binding-options`,
    ),
    'binding options',
  )
  const version = offered.items.find((one) => one.functionId === created.function.id)
  expectThat(
    version !== undefined,
    'binding options',
    `the catalog offers ${offered.items.length} version(s), none of the published function`,
  )
  say(`binding catalog offers version ${version!.versionId}`)

  // --- the question, bound to exactly that version --------------------------
  const item = must(
    await admin.call<{ item: { id: string } }>('POST', `/assessment/batches/${batchId}/items`, {
      itemType: 'declaration',
      title: 'smoke question',
      scoreGroupId: groups.groups[0]!.id,
      maxEntries: 1,
      config: {
        entrySource: 'administrative',
        formConfig: {},
        scoringConfig: {
          version: 2,
          calculator: { ref: 'formula@1', config: { versionId: version!.versionId } },
          aggregator: { ref: 'sum@1', config: {} },
          recognitions: [
            { handle: 'value', label: 'Value', refinement: null, defaultFromFieldId: null },
          ],
          bindings: { value: { kind: 'recognition', handle: 'value' } },
        },
        reviewPolicy: { mode: 'none' },
      },
    }),
    'create item',
  )
  const itemId = item.item.id
  const activated = must(
    await admin.call<{ item: { currentRevision: { id: string } | null } }>(
      'PUT',
      `/assessment/items/${itemId}/status`,
      { status: 'active' },
    ),
    'activate item',
  )
  const revisionId = activated.item.currentRevision?.id
  expectThat(revisionId !== undefined, 'activate item', 'the active item has no revision')
  const contract = must(
    await admin.call<{ contract: { itemRevisionId: string; fields: { id: string }[] } | null }>(
      'GET',
      `/assessment/items/${itemId}/recognition-contract`,
    ),
    'recognition contract',
  )
  const recognitionId = contract.contract?.fields[0]?.id
  expectThat(
    recognitionId !== undefined && contract.contract?.itemRevisionId === revisionId,
    'recognition contract',
    'the contract names no recognition for the active revision',
  )
  const opensAt = Date.now() + 3_000
  must(
    await admin.call('PUT', `/assessment/batches/${batchId}/phases/${entryPhase!.id}/schedule`, {
      plannedEntryAt: new Date(opensAt).toISOString(),
    }),
    'schedule entry phase',
  )
  say(`question ${itemId} active; entry opens in 3s`)
  await delay(Math.max(0, opensAt - Date.now()) + 500)

  // --- one determination, through the record the staff use -----------------
  const recorded = must(
    await admin.call<{ entry: { status: string; currentRevision: unknown } }>(
      'POST',
      '/assessment/entries',
      {
        itemId,
        participantId: enrolled!.id,
        expectedItemRevisionId: revisionId,
        payload: {},
        note: 'production smoke',
        recognition: { values: { [recognitionId!]: AMOUNT } },
      },
    ),
    'administrative record',
  )
  expectThat(
    recorded.entry.status === 'approved' && recorded.entry.currentRevision !== null,
    'administrative record',
    `the record stands as ${recorded.entry.status}, not approved`,
  )
  say('determination recorded and approved')

  // --- the result, as the participant reads it ------------------------------
  const result = must(
    await participant.call<{
      mode: string
      total: string
      lines: { kind: string; provenance?: { calculatorRef?: string } }[]
    }>('GET', `/assessment/batches/${batchId}/me/result`),
    'result page',
  )
  const expectedTotal = `${AMOUNT}.00`
  expectThat(
    result.mode === 'provisional' && result.total === expectedTotal,
    'result page',
    `total ${JSON.stringify(result.total)} in mode ${result.mode}; expected ${expectedTotal} provisional`,
  )
  expectThat(
    result.lines.length === 1 &&
      result.lines[0]!.kind === 'entry' &&
      result.lines[0]!.provenance?.calculatorRef === 'formula@1',
    'result page',
    `lines ${JSON.stringify(result.lines)}; expected one entry line scored by formula@1`,
  )
  say(`result ${result.total} from one formula@1 line`)
  return { tenantId }
}

const main = async (): Promise<void> => {
  const manifest = path.join(repoRoot, 'qualy.yml')
  if (!authoringEnabled(manifest)) {
    say(
      `formula authoring is disabled in qualy.yml (${FORMULA_PLUGIN} authoring: false); this smoke binds a new formula and runs after that writer is enabled`,
    )
    process.exit(2)
  }
  requireSandbox()
  const lock = readLock(lockPathFor(manifest))
  if (lock === undefined)
    throw new Error('no qualy.lock.json beside the manifest; run `pnpm qualy resolve`')
  const resolutionHash = lock.resolutionHash
  assertStagedAssets(resolutionHash)
  say(`committed assembly ${resolutionHash}`)

  const databaseUrl = databaseUrlFor(DATABASE)
  await ensureDatabase(databaseUrl, true)
  runOrThrow('deploy', cli, ['deploy'], { ...process.env, DATABASE_URL: databaseUrl })
  runOrThrow('seed', path.join(repoRoot, 'tools/fixtures/seed-cli.ts'), [], {
    ...process.env,
    DATABASE_URL: databaseUrl,
    QUALY_ADMIN_USERNAME: ADMIN_USERNAME,
    QUALY_ADMIN_PASSWORD: ADMIN_PASSWORD,
  })
  say(`database ${DATABASE} deployed and seeded`)

  const server: RunningServer = startServer({
    port: PORT,
    manifest,
    databaseUrl,
    otlpEndpoint: null,
    level: 'info',
  })
  const bail = (failure: SmokeFailure): never => {
    console.error(`smoke FAILED at ${failure.step}: ${failure.detail}`)
    console.error('--- last server lines')
    for (const line of server.lines.slice(-20)) console.error(line.raw)
    server.kill()
    process.exit(1)
  }
  try {
    const ready = await server.ready()
    say(`server pid ${server.pid} listening after ${ready.listeningMs ?? '?'}ms`)
    const { tenantId } = await chain(server.base, databaseUrl)

    const audit = auditDataset(databaseUrl, tenantId)
    expectThat(
      audit.sound &&
        audit.exitCode === 0 &&
        audit.verdict === 'clean' &&
        audit.timeouts.soft === 0 &&
        audit.timeouts.hard === 0,
      'audit',
      `verdict ${audit.verdict}, exit ${audit.exitCode}, timeouts soft ${audit.timeouts.soft} hard ${audit.timeouts.hard}\n${audit.output}`,
    )
    say('audit-scoring clean')

    const stopped = await server.stop()
    expectThat(
      stopped.exitCode === 0 && !stopped.timedOut && stopped.stillReleasing === null,
      'shutdown',
      `exit ${stopped.exitCode}${stopped.timedOut ? ', timed out' : ''}${stopped.stillReleasing === null ? '' : `, still releasing ${stopped.stillReleasing}`}`,
    )
    say(`shutdown clean in ${stopped.shutdownMs}ms`)
    console.log('formula production smoke: PASS')
  } catch (error) {
    if (error instanceof SmokeFailure) bail(error)
    bail(
      new SmokeFailure(
        'unexpected',
        error instanceof Error ? (error.stack ?? error.message) : String(error),
      ),
    )
  }
}

await main()
