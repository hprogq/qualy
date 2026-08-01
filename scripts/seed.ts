// idempotent bootstrap data: default tenant, org type chain and a sample
// hierarchy. Every lookup goes through stable codes, never fixed uuids;
// existing rows are left untouched so re-running is always safe.
import { Pool, type PoolClient } from 'pg'

try {
  process.loadEnvFile()
} catch {}

const url = process.env.DATABASE_URL ?? 'postgres://qualy:qualy@localhost:5432/qualy'

const TENANT = { slug: 'default', name: 'Qualy' }

const ORG_TYPES = [
  { code: 'university', name: '学校', sortOrder: 10 },
  { code: 'college', name: '学院', sortOrder: 20 },
  { code: 'major', name: '专业', sortOrder: 30 },
  { code: 'class', name: '班级', sortOrder: 40 },
]

const ORG_TYPE_RULES = [
  { parent: 'university', child: 'college' },
  { parent: 'college', child: 'major' },
  { parent: 'major', child: 'class' },
]

// parent: null marks the root; the chain must satisfy the rules above
const ORG_NODES = [
  { code: 'qualy-university', name: 'Qualy 大学', type: 'university', parent: null },
  { code: 'software-college', name: '软件学院', type: 'college', parent: 'qualy-university' },
  { code: 'computer-science', name: '计算机科学与技术', type: 'major', parent: 'software-college' },
  { code: 'class-1', name: '一班', type: 'class', parent: 'computer-science' },
]

const label = (id: string) => id.replaceAll('-', '')

async function seed(client: PoolClient) {
  const created = { tenants: 0, types: 0, rules: 0, nodes: 0 }

  const tenantUpsert = await client.query(
    `insert into tenants (slug, name) values ($1, $2)
     on conflict (slug) do nothing`,
    [TENANT.slug, TENANT.name],
  )
  created.tenants += tenantUpsert.rowCount ?? 0
  const tenantId: string = (
    await client.query(`select id from tenants where slug = $1`, [TENANT.slug])
  ).rows[0].id

  const typeIds = new Map<string, string>()
  for (const type of ORG_TYPES) {
    const upsert = await client.query(
      `insert into org_types (tenant_id, code, name, sort_order) values ($1, $2, $3, $4)
       on conflict (tenant_id, code) do nothing`,
      [tenantId, type.code, type.name, type.sortOrder],
    )
    created.types += upsert.rowCount ?? 0
    const row = await client.query(`select id from org_types where tenant_id = $1 and code = $2`, [
      tenantId,
      type.code,
    ])
    typeIds.set(type.code, row.rows[0].id)
  }

  for (const rule of ORG_TYPE_RULES) {
    const upsert = await client.query(
      `insert into org_type_rules (tenant_id, parent_type_id, child_type_id) values ($1, $2, $3)
       on conflict (tenant_id, parent_type_id, child_type_id) do nothing`,
      [tenantId, typeIds.get(rule.parent), typeIds.get(rule.child)],
    )
    created.rules += upsert.rowCount ?? 0
  }

  const nodes = new Map<string, { id: string; path: string; depth: number }>()
  for (const node of ORG_NODES) {
    const existing = await client.query(
      `select id, path, depth from org_nodes where tenant_id = $1 and code = $2`,
      [tenantId, node.code],
    )
    if (existing.rows[0]) {
      nodes.set(node.code, existing.rows[0])
      continue
    }
    const parent = node.parent ? nodes.get(node.parent) : undefined
    if (node.parent && !parent) throw new Error(`seed order broken: missing parent ${node.parent}`)
    // two-step insert: the path label derives from the generated id
    const inserted = await client.query(
      `insert into org_nodes (tenant_id, parent_id, org_type_id, code, name, path, depth)
       values ($1, $2, $3, $4, $5, '', $6) returning id`,
      [
        tenantId,
        parent?.id ?? null,
        typeIds.get(node.type),
        node.code,
        node.name,
        parent ? parent.depth + 1 : 0,
      ],
    )
    const id: string = inserted.rows[0].id
    const path = parent ? `${parent.path}.${label(id)}` : label(id)
    await client.query(`update org_nodes set path = $1 where id = $2`, [path, id])
    nodes.set(node.code, { id, path, depth: parent ? parent.depth + 1 : 0 })
    created.nodes += 1
  }

  return created
}

const pool = new Pool({ connectionString: url })
const client = await pool.connect()
try {
  await client.query('begin')
  const created = await seed(client)
  await client.query('commit')
  console.log(
    `seed complete: ${created.tenants} tenant(s), ${created.types} org type(s), ` +
      `${created.rules} rule(s), ${created.nodes} node(s) created`,
  )
} catch (error) {
  await client.query('rollback')
  throw error
} finally {
  client.release()
  await pool.end()
}
