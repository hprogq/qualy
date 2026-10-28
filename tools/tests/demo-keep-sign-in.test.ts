import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createTestContext,
  postgresAvailable,
  type TestContext,
} from '@qualy/plugin-database/testkit'

// What `restore.sh --keep-sign-in` leaves behind, run against two databases
// at the current schema: one plays the deployment as it serves, the other the
// restored baseline. The staging copy restore.sh makes with COPY between
// the two is made here with the same rows; the SQL that applies it is the
// shipped file itself.

const ROOT = path.resolve(import.meta.dirname, '../..')
const KEEP = fs.readFileSync(path.join(ROOT, 'deploy/demo/keep-sign-in.sql'), 'utf8')
// psql sends the file statement by statement, so it opens its own
// transaction; sent here as one simple query, the statements are already one
// implicit transaction, and a failure leaves no transaction open on a pooled
// connection
const KEEP_AS_ONE = (() => {
  const body = KEEP.replace(/^begin;$/m, '').replace(/^commit;\s*$/m, '')
  if (body === KEEP || /^(begin|commit);$/m.test(body)) {
    throw new Error('keep-sign-in.sql no longer opens and closes one transaction')
  }
  return body
})()
const CARRIED = {
  auth_providers: 'select * from auth_providers',
  auth_provider_user_types: 'select * from auth_provider_user_types',
  secrets: "select * from secrets where owner_kind = 'auth-provider'",
  storage_attachments: `select * from storage_attachments where id::text in (
    select jsonb_path_query(icon, 'lax $.*.attachmentId') #>> '{}' from auth_providers)`,
} as const

const ids = {
  tenant: randomUUID(),
  student: randomUUID(),
  staff: randomUUID(),
  password: randomUUID(),
  retired: randomUUID(),
  cas: randomUUID(),
  github: randomUUID(),
  icon: randomUUID(),
  person: randomUUID(),
  newcomer: randomUUID(),
}

const sealed = (owner: string, key: string) => ({
  owner,
  key,
  ciphertext: `\\x${Buffer.from(`${owner}:${key}`).toString('hex')}`,
  nonce: `\\x${'01'.repeat(12)}`,
  tag: `\\x${'02'.repeat(16)}`,
})

/** what both databases share before they part ways: the tenant and its user types */
const common = async (db: TestContext) => {
  await db.query(`insert into tenants (id, slug, name) values ($1, 'demo', 'Demo')`, [ids.tenant])
  await db.query(
    `insert into user_types (id, tenant_id, code, name, placement_mode)
     values ($1, $3, 'student', 'Student', 'unrestricted'), ($2, $3, 'staff', 'Staff', 'unrestricted')`,
    [ids.student, ids.staff, ids.tenant],
  )
}

const provider = (
  db: TestContext,
  row: { id: string; code: string; type: string; name: string; system?: boolean } & Record<
    string,
    unknown
  >,
) =>
  db.query(
    `insert into auth_providers (id, tenant_id, code, type, name, is_system, sort_order, recommended, icon, audience_mode, config, prominence)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, case when $8 then 'primary' else 'secondary' end)`,
    [
      row.id,
      ids.tenant,
      row.code,
      row.type,
      row.name,
      row.system ?? false,
      row['sortOrder'] ?? 0,
      row['recommended'] ?? false,
      row['icon'] === undefined ? null : JSON.stringify(row['icon']),
      row['audience'] ?? 'unrestricted',
      JSON.stringify(row['config'] ?? {}),
    ],
  )

const secret = (db: TestContext, kind: string, value: ReturnType<typeof sealed>) =>
  db.query(
    `insert into secrets (tenant_id, owner_kind, owner_id, key, ciphertext, nonce, auth_tag)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [ids.tenant, kind, value.owner, value.key, value.ciphertext, value.nonce, value.tag],
  )

/** someone who has left, so needs no organization, still bound to a way in */
const person = async (db: TestContext, user: string, providerId: string) => {
  await db.query(
    `insert into users (id, tenant_id, display_name, enabled, deleted_at) values ($1, $2, 'Someone', false, now())`,
    [user, ids.tenant],
  )
  await db.query(
    `insert into user_auth_bindings (tenant_id, user_id, auth_provider_id) values ($1, $2, $3)`,
    [ids.tenant, user, providerId],
  )
}

/** the baseline as generated: one password entrance, recommended, and one later retired */
const seedBaseline = async (db: TestContext) => {
  await common(db)
  await provider(db, {
    id: ids.password,
    code: 'local',
    type: 'local',
    name: 'Password',
    system: true,
    recommended: true,
  })
  await provider(db, { id: ids.retired, code: 'old-sso', type: 'oidc', name: 'Old SSO' })
  await person(db, ids.person, ids.password)
  await secret(db, 'mail-relay', sealed(randomUUID(), 'password'))
}

/** the deployment as configured since: renamed and reordered, three doors, one image */
const seedLive = async (db: TestContext) => {
  await common(db)
  // the newly recommended door first: copied in this order, the baseline's
  // recommendation would still stand when it arrives
  await provider(db, {
    id: ids.cas,
    code: 'campus',
    type: 'cas',
    name: 'Campus',
    recommended: true,
    icon: {
      kind: 'image',
      onLight: { kind: 'svg', markup: '<svg/>', version: 'v1' },
      onDark: null,
    },
    audience: 'allow-list',
    config: { server: 'https://cas.example.test' },
  })
  await provider(db, {
    id: ids.password,
    code: 'local',
    type: 'local',
    name: 'Email',
    system: true,
    sortOrder: 1,
    audience: 'allow-list',
  })
  await provider(db, {
    id: ids.github,
    code: 'github',
    type: 'github',
    name: 'GitHub',
    sortOrder: 2,
    icon: { kind: 'image', onLight: { kind: 'upload', attachmentId: ids.icon }, onDark: null },
  })
  await db.query(
    `insert into auth_provider_user_types (tenant_id, auth_provider_id, user_type_id)
     values ($1, $2, $3), ($1, $4, $3), ($1, $4, $5)`,
    [ids.tenant, ids.password, ids.staff, ids.cas, ids.student],
  )
  await secret(db, 'auth-provider', sealed(ids.github, 'clientSecret'))
  await secret(db, 'auth-provider', sealed(ids.cas, 'serviceKey'))
  // not a way in: stays where it is
  await secret(db, 'mail-relay', sealed(randomUUID(), 'password'))
  await db.query(
    `insert into storage_attachments (id, tenant_id, owner_user_id, backend, filename, declared_mime, size,
       integrity_algorithm, integrity_value, storage_key, status, bound_at)
     values ($1, $2, $3, 'local', 'github.png', 'image/png', 4, 'sha256', 'x', $4, 'bound', now())`,
    [ids.icon, ids.tenant, randomUUID(), `attachments/${ids.tenant}/${ids.icon}`],
  )
  // done through a door, not part of it: none of this carries over
  await person(db, ids.newcomer, ids.cas)
}

/** what restore.sh does with COPY: the live rows, into qualy_keep_* tables on the restored side */
const stage = async (live: TestContext, restored: TestContext) => {
  for (const [table, query] of Object.entries(CARRIED)) {
    await restored.query(`create table qualy_keep_${table} (like ${table})`)
    const { rows } = await live.row<{ rows: unknown }>(
      `select coalesce(json_agg(t), '[]') as rows from (${query}) t`,
    )
    await restored.query(
      `insert into qualy_keep_${table} select * from json_populate_recordset(null::qualy_keep_${table}, $1)`,
      [JSON.stringify(rows)],
    )
  }
}

const rowsOf = async (db: TestContext, query: string) =>
  (
    await db.row<{ rows: Record<string, unknown>[] }>(
      `select coalesce(json_agg(t order by t.id), '[]') as rows from (${query}) t`,
    )
  ).rows

describe.runIf(postgresAvailable)(
  'keeping the sign-in configuration over a restored baseline',
  () => {
    let liveContext: Awaited<ReturnType<typeof createTestContext>>
    let restoredContext: Awaited<ReturnType<typeof createTestContext>>

    beforeAll(async () => {
      liveContext = await createTestContext('demo-keep-live', { migrations: 'apply' })
      restoredContext = await createTestContext('demo-keep-restored', { migrations: 'apply' })
      await seedLive(liveContext)
      await seedBaseline(restoredContext)
    }, 120_000)

    afterAll(async () => {
      await liveContext?.dispose()
      await restoredContext?.dispose()
    })

    it('refuses a configuration that does not fit, and leaves the baseline as it was', async () => {
      const live = liveContext
      const restored = restoredContext
      const outsider = randomUUID()
      await live.query(
        `insert into user_types (id, tenant_id, code, name, placement_mode) values ($1, $2, 'visitor', 'Visitor', 'unrestricted')`,
        [outsider, ids.tenant],
      )
      await live.query(
        `insert into auth_provider_user_types (tenant_id, auth_provider_id, user_type_id) values ($1, $2, $3)`,
        [ids.tenant, ids.cas, outsider],
      )
      const before = await rowsOf(restored, 'select * from auth_providers')
      await stage(live, restored)
      await expect(restored.query(KEEP_AS_ONE)).rejects.toThrow(/user_type/)
      expect(await rowsOf(restored, 'select * from auth_providers')).toEqual(before)
      for (const table of Object.keys(CARRIED)) {
        await restored.query(`drop table qualy_keep_${table}`)
      }
      await live.query('delete from auth_provider_user_types where user_type_id = $1', [outsider])
      await live.query('delete from user_types where id = $1', [outsider])
    })

    it('carries every entrance, its audience, secrets and stored image, and nothing done through them', async () => {
      const live = liveContext
      const restored = restoredContext
      await stage(live, restored)
      await restored.query(KEEP_AS_ONE)

      const kept = (table: keyof typeof CARRIED) => rowsOf(restored, CARRIED[table])
      const served = (table: keyof typeof CARRIED) => rowsOf(live, CARRIED[table])
      const entrances = await rowsOf(
        restored,
        `select * from auth_providers where id in ('${ids.password}', '${ids.cas}', '${ids.github}')`,
      )
      expect(entrances).toEqual(await rowsOf(live, 'select * from auth_providers'))
      expect(await kept('auth_provider_user_types')).toEqual(
        await served('auth_provider_user_types'),
      )
      expect(await kept('secrets')).toEqual(await served('secrets'))
      expect(await kept('storage_attachments')).toEqual(await served('storage_attachments'))

      // one recommendation, the deployment's; the entrance it no longer has is retired, not deleted
      expect(
        (await restored.query('select id from auth_providers where recommended')).rows.map(
          (r) => r.id,
        ),
      ).toEqual([ids.cas])
      const retired = await restored.row<{ enabled: boolean; deleted_at: unknown }>(
        'select enabled, deleted_at from auth_providers where id = $1',
        [ids.retired],
      )
      expect(retired.enabled).toBe(false)
      expect(retired.deleted_at).not.toBeNull()

      // the baseline's people and bindings stay; the deployment's newcomer does not arrive
      const users = (await restored.query('select id from users order by id')).rows.map((r) => r.id)
      expect(users).toEqual([ids.person])
      const bindings = (
        await restored.query('select user_id, auth_provider_id from user_auth_bindings')
      ).rows
      expect(bindings).toEqual([{ user_id: ids.person, auth_provider_id: ids.password }])
      // a secret that opens no door is the baseline's own
      expect(
        Number(
          (
            await restored.row<{ count: unknown }>(
              "select count(*) from secrets where owner_kind = 'mail-relay'",
            )
          ).count,
        ),
      ).toBe(1)

      const staging = await restored.query(
        "select table_name from information_schema.tables where table_name like 'qualy_keep_%'",
      )
      expect(staging.rows).toEqual([])
    })
  },
)
