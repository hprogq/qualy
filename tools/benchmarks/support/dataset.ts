import { spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { repoRoot } from '../../lib/manifest.ts'
import type { Db } from './pg.ts'
import { benchDir, cli } from './server.ts'
import { sessionCookieNames } from '../../../packages/plugins/base/auth/src/server/session-cookie.ts'

/**
 * A session as a browser would hold it: the token under the name the server
 * set. Which name that is depends on the entry the server was started as, so
 * a tool learns it from the sign-in response and sends that name back, for
 * the sessions it plants itself too.
 */
export interface SessionCookie {
  readonly name: string
  readonly token: string
}

/** the session cookie a sign-in set, under whichever name this entry uses */
export const sessionFromResponse = (response: Response): SessionCookie | undefined => {
  const cookie = new RegExp(`(${sessionCookieNames.join('|')})=([^;]+)`).exec(
    response.headers.get('set-cookie') ?? '',
  )
  return cookie ? { name: cookie[1]!, token: cookie[2]! } : undefined
}

// The dataset the benchmark reads: a fixed recipe, built through the real
// product paths wherever a path exists - formulas published through the
// authoring sandbox, questions bound and published over the api, the roster
// imported by the round's creation - and by hand only where no path exists
// at all: a hundred students with sessions and nobody's password, and
// thousands of determinations already in force. What stands is proven by
// the audit before a single number is taken.

export const RECIPE = 'formula-provisional-scoring-v1'
export const FORMULA = 'passthrough-decimal-v1'
export const STUDENTS = 100
export const CONTROL_ITEMS = 10
export const ADMIN_EMAIL = 'admin@benchmark.example'
export const ADMIN_PASSWORD = 'benchmark-admin-password'
const AMOUNT = '3'

/** the cheapest deterministic formula: one decimal in, the same decimal out */
export const PASSTHROUGH = `import { Schema, defineFormula } from '@qualy/formula'

export default defineFormula({
  input: Schema.input({
    value: Schema.decimal({ minimum: '0', maximum: '10', maxScale: 2, title: '分值' }),
  }),
  output: Schema.scoreAmount({ maxScale: 2 }),
  run: (input) => input.value,
})
`

export interface DatasetBatch {
  readonly id: string
  readonly items: number
  readonly kind: 'formula' | 'control'
}

export interface Dataset {
  readonly version: 1
  readonly recipe: string
  readonly formula: string
  readonly resolutionHash: string
  readonly students: number
  readonly cells: readonly number[]
  readonly control: boolean
  readonly tenantId: string
  readonly adminUserId: string
  readonly batches: Readonly<Record<string, DatasetBatch>>
  /** one session token per student, in student order */
  readonly sessions: readonly string[]
}

export const datasetFile = path.join(benchDir, 'dataset.json')

/** what a result page of `items` questions worth `AMOUNT` each totals to, as the server spells it */
export const expectedTotal = (items: number): string => (Number(AMOUNT) * items).toFixed(2)

export const cellName = (items: number, kind: DatasetBatch['kind']) =>
  kind === 'control' ? `benchmark-control-${items}` : `benchmark-${items}`

// --- the api, as a browser would use it -----------------------------------

export interface Api {
  readonly call: <T>(
    method: string,
    route: string,
    body?: unknown,
  ) => Promise<{ status: number; body: T; text: string }>
}

export const clientFor = (base: string, session: SessionCookie): Api => ({
  call: async (method, route, body) => {
    const response = await fetch(`${base}/api${route}`, {
      method,
      headers: {
        cookie: `${session.name}=${session.token}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const text = await response.text()
    let parsed: unknown = text
    try {
      parsed = JSON.parse(text)
    } catch {
      // a refusal may be plain text; the caller sees whatever came back
    }
    return { status: response.status, body: parsed as never, text }
  },
})

const must = <T>(
  answer: { status: number; body: T; text: string },
  what: string,
  accepted = 200,
): T => {
  if (answer.status !== accepted) {
    throw new Error(`${what}: status ${answer.status}\n${answer.text}`)
  }
  return answer.body
}

export const login = async (base: string): Promise<SessionCookie> => {
  const response = await fetch(`${base}/api/auth/local/local/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  })
  if (response.status !== 200) {
    throw new Error(`admin login failed: status ${response.status}\n${await response.text()}`)
  }
  const session = sessionFromResponse(response)
  if (!session) throw new Error('the login answered without a session cookie')
  return session
}

const sha256hex = (value: string) => createHash('sha256').update(value).digest('hex')

// --- what the api cannot do, done by hand --------------------------------

interface Tenant {
  readonly tenantId: string
  readonly rootNodeId: string
  readonly adminUserId: string
  readonly studentTypeId: string
}

const tenantOf = async (db: Db): Promise<Tenant> => {
  const [tenant] = await db.query<{ id: string }>(`select id from tenants where slug = 'default'`)
  if (!tenant) throw new Error('the seed left no default tenant')
  const [root] = await db.query<{ id: string }>(
    'select id from org_nodes where tenant_id = $1 and parent_id is null',
    [tenant.id],
  )
  if (!root) throw new Error('the seed left no root node')
  const [admin] = await db.query<{ user_id: string }>(
    `select id as user_id from users
     where tenant_id = $1 and email = $2 and deleted_at is null`,
    [tenant.id, ADMIN_EMAIL],
  )
  if (!admin) throw new Error('the seed left no administrator')
  await db.query(
    `insert into user_types (tenant_id, code, name, placement_mode)
     values ($1, 'benchmark-student', 'Benchmark student', 'unrestricted')
     on conflict do nothing`,
    [tenant.id],
  )
  const [type] = await db.query<{ id: string }>(
    `select id from user_types where tenant_id = $1 and code = 'benchmark-student'`,
    [tenant.id],
  )
  return {
    tenantId: tenant.id,
    rootNodeId: root.id,
    adminUserId: admin.user_id,
    studentTypeId: type!.id,
  }
}

const studentsOf = async (db: Db, tenant: Tenant): Promise<string[]> => {
  const existing = await db.query<{ id: string }>(
    `select id from users where tenant_id = $1 and user_type_id = $2 order by id`,
    [tenant.tenantId, tenant.studentTypeId],
  )
  if (existing.length >= STUDENTS) return existing.slice(0, STUDENTS).map((row) => row.id)
  const ids = existing.map((row) => row.id)
  for (let index = ids.length; index < STUDENTS; index += 1) {
    const [row] = await db.query<{ id: string }>(
      `insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
       values ($1, $2, $3, $4) returning id`,
      [
        tenant.tenantId,
        `Benchmark student ${String(index + 1).padStart(3, '0')}`,
        tenant.studentTypeId,
        tenant.rootNodeId,
      ],
    )
    ids.push(row!.id)
  }
  return ids
}

/** a session per student, minted by hand: nobody's password is involved */
export const sessionsFor = async (db: Db, tenantId: string, userIds: readonly string[]) => {
  const tokens: string[] = []
  for (const userId of userIds) {
    const token = randomBytes(24).toString('hex')
    // a session names the door it came in through; these came in through
    // the platform's password door, as far as anything reading them knows
    await db.query(
      `insert into sessions (tenant_id, user_id, auth_provider_id, token_hash, expires_at)
       select $1, $2, p.id, $3, now() + interval '7 days'
         from auth_providers p
        where p.tenant_id = $1 and p.type = 'local' and p.is_system and p.deleted_at is null`,
      [tenantId, userId, sha256hex(token)],
    )
    tokens.push(token)
  }
  return tokens
}

const sessionAlive = async (base: string, session: SessionCookie): Promise<boolean> =>
  (
    await fetch(`${base}/api/auth/session`, {
      headers: { cookie: `${session.name}=${session.token}` },
    })
  ).status === 200

// --- the product paths ---------------------------------------------------

const publishFormula = async (db: Db, api: Api, tenantId: string, name: string) => {
  const created = must(
    await api.call<{ function: { id: string; draftRevision: number } }>(
      'POST',
      '/assessment/formula-functions',
      { name },
    ),
    `create ${name}`,
  )
  const drafted = must(
    await api.call<{ function: { draftRevision: number } }>(
      'PATCH',
      `/assessment/formula-functions/${created.function.id}`,
      {
        expectedDraftRevision: created.function.draftRevision,
        name,
        draftSourceTs: PASSTHROUGH,
        draftTests: [{ name: 'passes through', input: { value: AMOUNT }, expected: AMOUNT }],
      },
    ),
    `draft ${name}`,
  )
  must(
    await api.call('POST', `/assessment/formula-functions/${created.function.id}/versions`, {
      expectedDraftRevision: drafted.function.draftRevision,
    }),
    `publish ${name}`,
  )
  // the version's identity is not in any answer: a plan is bound to it by id
  const [version] = await db.query<{ id: string }>(
    'select id from assessment_formula_versions where tenant_id = $1 and function_id = $2',
    [tenantId, created.function.id],
  )
  if (!version) throw new Error(`${name} published no version`)
  return version.id
}

const itemConfig = (kind: DatasetBatch['kind'], versionId: string | null) => ({
  entryChannels: ['administrative'],
  formConfig: {},
  scoringConfig:
    kind === 'control'
      ? {
          calculator: { ref: 'fixed@1', config: { value: `${AMOUNT}.00` } },
          aggregator: { ref: 'sum@1', config: {} },
        }
      : {
          version: 2,
          calculator: { ref: 'formula@1', config: { versionId } },
          aggregator: { ref: 'sum@1', config: {} },
          recognitions: [
            { handle: 'value', label: 'Value', refinement: null, defaultFromFieldId: null },
          ],
          bindings: { value: { kind: 'recognition', handle: 'value' } },
        },
  reviewPolicy: { mode: 'none' },
})

/**
 * Every student's determination on one question, already in force: the
 * administrative record's own write set, done as four statements over the
 * round's roster instead of one request per record. The values are the
 * canonical spelling the service would have stored.
 */
const standingDeterminations = async (
  db: Db,
  input: {
    tenantId: string
    batchId: string
    itemId: string
    itemRevisionId: string
    recognitionId: string | null
    adminUserId: string
  },
) => {
  const values = JSON.stringify(
    input.recognitionId === null ? {} : { [input.recognitionId]: AMOUNT },
  )
  await db.query(
    `insert into entries (tenant_id, batch_id, item_id, participant_id, source, status)
     select $1, $2, $3, id, 'record', 'draft' from batch_participants
     where tenant_id = $1 and batch_id = $2 and status = 'active'`,
    [input.tenantId, input.batchId, input.itemId],
  )
  await db.query(
    `insert into entry_revisions
       (tenant_id, entry_id, item_id, item_revision_id, revision_no, payload, actor_id, subject_id, source, note)
     select e.tenant_id, e.id, e.item_id, $2, 1, '{}'::jsonb, $3, bp.user_id, 'record', null
     from entries e
     join batch_participants bp on bp.tenant_id = e.tenant_id and bp.id = e.participant_id
     where e.item_id = $1 and e.status = 'draft'`,
    [input.itemId, input.itemRevisionId, input.adminUserId],
  )
  await db.query(
    `insert into entry_recognitions
       (tenant_id, batch_id, entry_id, entry_revision_id, item_id, item_revision_id, values, source, created_by)
     select e.tenant_id, e.batch_id, e.id, r.id, e.item_id, $2, $4::jsonb, 'record', $3
     from entries e
     join entry_revisions r on r.tenant_id = e.tenant_id and r.entry_id = e.id and r.revision_no = 1
     where e.item_id = $1 and e.status = 'draft'`,
    [input.itemId, input.itemRevisionId, input.adminUserId, values],
  )
  await db.query(
    `update entries e
     set status = 'approved', current_revision_id = r.id, current_recognition_id = rec.id, updated_at = now()
     from entry_revisions r, entry_recognitions rec
     where r.tenant_id = e.tenant_id and r.entry_id = e.id and r.revision_no = 1
       and rec.tenant_id = e.tenant_id and rec.entry_id = e.id
       and e.item_id = $1 and e.status = 'draft'`,
    [input.itemId],
  )
}

const buildBatch = async (
  db: Db,
  api: Api,
  tenant: Tenant,
  kind: DatasetBatch['kind'],
  items: number,
  log: (line: string) => void,
): Promise<{ batch: DatasetBatch; opensAt: number }> => {
  const name = cellName(items, kind)
  const versions: (string | null)[] = []
  for (let index = 1; index <= items; index += 1) {
    versions.push(
      kind === 'control'
        ? null
        : await publishFormula(db, api, tenant.tenantId, `${name}-${index}`),
    )
  }
  log(`${name}: ${kind === 'control' ? 'no formula' : `${items} version(s) published`}`)
  const created = must(
    await api.call<{ batch: { id: string } }>('POST', '/assessment/batches', {
      name,
      materialRange: { start: '2026-03-01', end: '2026-09-01' },
      // the round's creation imports the roster: this is where the students
      // become participants, and the only place they do
      import: { orgNodeIds: [tenant.rootNodeId], userTypeIds: [tenant.studentTypeId] },
    }),
    `create ${name}`,
  )
  const batchId = created.batch.id
  const participants = await db.query<{ id: string }>(
    `select id from batch_participants where tenant_id = $1 and batch_id = $2 and status = 'active'`,
    [tenant.tenantId, batchId],
  )
  if (participants.length !== STUDENTS) {
    throw new Error(
      `${name}: the import enrolled ${participants.length} participants, not ${STUDENTS}`,
    )
  }
  const phases = must(
    await api.call<{ phases: { id: string; phaseKey: string }[] }>(
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
    `${name} phases`,
  )
  const entryPhase = phases.phases.find((phase) => phase.phaseKey === 'entry')
  if (!entryPhase) throw new Error(`${name}: no entry phase`)
  const groups = must(
    await api.call<{ groups: { id: string }[] }>(
      'PUT',
      `/assessment/batches/${batchId}/score-groups`,
      {
        groups: [{ name: 'benchmark', parentGroupId: null, cap: null, floor: null }],
        expectedVersion: 1,
      },
    ),
    `${name} score groups`,
  )
  const groupId = groups.groups[0]!.id
  for (let index = 0; index < items; index += 1) {
    const item = must(
      await api.call<{ item: { id: string } }>('POST', `/assessment/batches/${batchId}/items`, {
        itemType: 'declaration',
        title: `${name} question ${index + 1}`,
        scoreGroupId: groupId,
        maxEntries: 1,
        config: itemConfig(kind, versions[index]!),
      }),
      `${name} question ${index + 1}`,
    )
    const activated = must(
      await api.call<{ item: { currentRevision: { id: string } | null } }>(
        'PUT',
        `/assessment/items/${item.item.id}/status`,
        { status: 'active' },
      ),
      `${name} question ${index + 1} activate`,
    )
    const revisionId = activated.item.currentRevision?.id
    if (!revisionId) throw new Error(`${name}: question ${index + 1} has no revision`)
    const contract = must(
      await api.call<{ contract: { fields: { id: string }[] } | null }>(
        'GET',
        `/assessment/items/${item.item.id}/recognition-contract`,
      ),
      `${name} question ${index + 1} contract`,
    )
    await standingDeterminations(db, {
      tenantId: tenant.tenantId,
      batchId,
      itemId: item.item.id,
      itemRevisionId: revisionId,
      recognitionId: contract.contract?.fields[0]?.id ?? null,
      adminUserId: tenant.adminUserId,
    })
  }
  log(`${name}: ${items} question(s) with ${STUDENTS} determination(s) each`)
  const opensAt = Date.now() + 3_000
  must(
    await api.call('PUT', `/assessment/batches/${batchId}/phases/${entryPhase.id}/schedule`, {
      plannedEntryAt: new Date(opensAt).toISOString(),
    }),
    `${name} schedule`,
  )
  return { batch: { id: batchId, items, kind }, opensAt }
}

// --- the audit, as the gate on what was built --------------------------------

export interface DatasetAudit {
  readonly exitCode: number | null
  readonly verdict: string
  readonly counts: Readonly<Record<string, number>>
  /** the deadlines crossed, told apart by the failure's own words */
  readonly timeouts: { readonly soft: number; readonly hard: number }
  /**
   * The dataset itself is sound: nothing refused, unreadable, unprepared or
   * broken, and the only executions that failed are the ones a deadline
   * ended. Anything else a formula did wrong is a defect of the dataset.
   */
  readonly sound: boolean
  readonly output: string
}

/**
 * The audit over the dataset, as the gate on what was built - and, at the
 * same time, the first number of the benchmark: it evaluates every standing
 * determination four at a time through the same sandbox, so a deadline it
 * crosses is the runtime's behaviour under load, recorded and reported by
 * phase, never a defect of the dataset. The goal remains a clean verdict;
 * until the deadlines are calibrated the timeouts are counted, not hidden.
 */
export const auditDataset = (databaseUrl: string, tenantId: string): DatasetAudit => {
  const { QUALY_MIGRATIONS: _migrations, ...inherited } = process.env
  const ran = spawnSync(
    process.execPath,
    [cli, 'assessment', 'audit-scoring', '--tenant', tenantId],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      env: { ...inherited, DATABASE_URL: databaseUrl, NODE_ENV: 'development' },
      timeout: 600_000,
    },
  )
  const output = `${ran.stdout}${ran.stderr}`
  const counts: Record<string, number> = {}
  for (const match of ran.stdout.matchAll(/([a-z][a-z ]+?): (\d+)(?=\s{2,}|$)/gm)) {
    counts[match[1]!.trim()] = Number(match[2])
  }
  const verdict = /verdict: (\S+)/.exec(ran.stdout)?.[1] ?? 'unknown'
  const timeouts = {
    soft: (ran.stdout.match(/evaluate execution: .*soft deadline/g) ?? []).length,
    hard: (ran.stdout.match(/evaluate execution: .*hard deadline/g) ?? []).length,
  }
  const sound =
    ran.status !== null &&
    verdict !== 'unknown' &&
    (counts['refused'] ?? 0) === 0 &&
    (counts['unreadable'] ?? 0) === 0 &&
    (counts['unprepared'] ?? 0) === 0 &&
    (counts['integrity failed'] ?? 0) === 0 &&
    (counts['invariant failed'] ?? 0) === 0 &&
    (counts['unavailable'] ?? 0) === 0 &&
    (counts['execution failed'] ?? 0) === timeouts.soft + timeouts.hard
  return { exitCode: ran.status, verdict, counts, timeouts, sound, output }
}

// --- the dataset, present or built ---------------------------------------------

const readDataset = (): Dataset | undefined => {
  if (!fs.existsSync(datasetFile)) return undefined
  return JSON.parse(fs.readFileSync(datasetFile, 'utf8')) as Dataset
}

const fingerprintHolds = (
  dataset: Dataset,
  expected: { resolutionHash: string; cells: readonly number[] },
): string | null => {
  if (dataset.version !== 1 || dataset.recipe !== RECIPE || dataset.formula !== FORMULA) {
    return 'another recipe'
  }
  if (dataset.resolutionHash !== expected.resolutionHash) return 'another assembly'
  if (dataset.students !== STUDENTS) return 'another roster size'
  if (expected.cells.some((cell) => !dataset.cells.includes(cell))) return 'missing cells'
  return null
}

/** the counts a reusable dataset has to show, per round, before it is trusted */
const countsHold = async (db: Db, dataset: Dataset): Promise<string | null> => {
  for (const [name, batch] of Object.entries(dataset.batches)) {
    const [found] = await db.query<{ n: string }>(
      'select count(*)::text as n from assessment_batches where id = $1 and name = $2',
      [batch.id, name],
    )
    if (found?.n !== '1') return `${name}: round missing`
    const [participants] = await db.query<{ n: string }>(
      `select count(*)::text as n from batch_participants where batch_id = $1 and status = 'active'`,
      [batch.id],
    )
    if (Number(participants?.n) !== STUDENTS) return `${name}: ${participants?.n} participants`
    const [items] = await db.query<{ n: string }>(
      `select count(*)::text as n from assessment_items where batch_id = $1 and status = 'active'`,
      [batch.id],
    )
    if (Number(items?.n) !== batch.items) return `${name}: ${items?.n} active questions`
    const [approved] = await db.query<{ n: string }>(
      `select count(*)::text as n from entries where batch_id = $1 and status = 'approved'`,
      [batch.id],
    )
    if (Number(approved?.n) !== batch.items * STUDENTS) return `${name}: ${approved?.n} approved`
  }
  return null
}

export const ensureDataset = async (options: {
  readonly db: Db
  readonly base: string
  readonly databaseUrl: string
  readonly resolutionHash: string
  readonly cells: readonly number[]
  readonly control: boolean
  /** 'seed' builds on a fresh database; 'verify' trusts only what the fingerprint and the counts confirm */
  readonly mode: 'seed' | 'verify'
  readonly log: (line: string) => void
  /** `cookieName` is the one the running entry reads; the planted sessions are sent under it */
}): Promise<{ dataset: Dataset; audit: DatasetAudit; cookieName: string }> => {
  const { db, base, log } = options
  if (options.mode === 'verify') {
    const existing = readDataset()
    if (existing === undefined) {
      throw new Error(`${datasetFile} is missing but the database exists; run with --reseed`)
    }
    const stale = fingerprintHolds(existing, options)
    if (stale !== null) throw new Error(`the dataset on disk is ${stale}; run with --reseed`)
    const counts = await countsHold(db, existing)
    if (counts !== null)
      throw new Error(`the database no longer matches the dataset (${counts}); run with --reseed`)
    let dataset = existing
    // the sign-in also says which cookie name this entry reads; the planted
    // student sessions are sent under the same one
    const signedIn = await login(base)
    if (!(await sessionAlive(base, { name: signedIn.name, token: existing.sessions[0]! }))) {
      log('sessions expired; minting new ones')
      const tenant = await tenantOf(db)
      const students = await studentsOf(db, tenant)
      dataset = { ...existing, sessions: await sessionsFor(db, tenant.tenantId, students) }
    }
    if (options.control && !dataset.batches[cellName(CONTROL_ITEMS, 'control')]) {
      const admin = clientFor(base, signedIn)
      const tenant = await tenantOf(db)
      const built = await buildBatch(db, admin, tenant, 'control', CONTROL_ITEMS, log)
      await delay(Math.max(0, built.opensAt - Date.now()) + 1_000)
      dataset = {
        ...dataset,
        control: true,
        batches: { ...dataset.batches, [cellName(CONTROL_ITEMS, 'control')]: built.batch },
      }
    }
    const audit = auditDataset(options.databaseUrl, dataset.tenantId)
    if (!audit.sound) throw new Error(`the dataset is not sound:\n${audit.output}`)
    fs.writeFileSync(datasetFile, `${JSON.stringify(dataset, null, 2)}\n`)
    log(`dataset present, audit ${audit.verdict}`)
    return { dataset, audit, cookieName: signedIn.name }
  }

  const signedIn = await login(base)
  const admin = clientFor(base, signedIn)
  const tenant = await tenantOf(db)
  const students = await studentsOf(db, tenant)
  const sessions = await sessionsFor(db, tenant.tenantId, students)
  const batches: Record<string, DatasetBatch> = {}
  let opensAt = 0
  for (const items of options.cells) {
    const built = await buildBatch(db, admin, tenant, 'formula', items, log)
    batches[cellName(items, 'formula')] = built.batch
    opensAt = Math.max(opensAt, built.opensAt)
  }
  if (options.control) {
    const built = await buildBatch(db, admin, tenant, 'control', CONTROL_ITEMS, log)
    batches[cellName(CONTROL_ITEMS, 'control')] = built.batch
    opensAt = Math.max(opensAt, built.opensAt)
  }
  await delay(Math.max(0, opensAt - Date.now()) + 1_000)
  // the first student's page, once per round: the numbers the benchmark
  // will read are the numbers the product shows
  for (const [name, batch] of Object.entries(batches)) {
    const page = await clientFor(base, {
      name: signedIn.name,
      token: sessions[0]!,
    }).call<{ total: string; lines: unknown[] }>('GET', `/assessment/batches/${batch.id}/me/result`)
    if (
      page.status !== 200 ||
      page.body.total !== expectedTotal(batch.items) ||
      page.body.lines.length !== batch.items
    ) {
      throw new Error(
        `${name}: the first result page is not as expected (status ${page.status}): ${page.text}`,
      )
    }
  }
  const audit = auditDataset(options.databaseUrl, tenant.tenantId)
  if (!audit.sound) throw new Error(`the dataset is not sound:\n${audit.output}`)
  const dataset: Dataset = {
    version: 1,
    recipe: RECIPE,
    formula: FORMULA,
    resolutionHash: options.resolutionHash,
    students: STUDENTS,
    cells: [...options.cells],
    control: options.control,
    tenantId: tenant.tenantId,
    adminUserId: tenant.adminUserId,
    batches,
    sessions,
  }
  fs.mkdirSync(benchDir, { recursive: true })
  fs.writeFileSync(datasetFile, `${JSON.stringify(dataset, null, 2)}\n`)
  log(`dataset built, audit ${audit.verdict}`)
  return { dataset, audit, cookieName: signedIn.name }
}
