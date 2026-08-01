import type { PoolClient } from 'pg'

// insert-if-absent bootstrap with drift verification: rows are looked up by
// stable codes and never modified, but an existing row whose structural
// fields disagree with the seed definition fails loudly instead of being
// silently accepted (a later seed entry would otherwise build on top of a
// corrupted hierarchy).

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

function drift(subject: string, field: string, expected: unknown, actual: unknown): never {
  throw new Error(
    `seed drift: ${subject} has unexpected ${field} (${actual} instead of ${expected})`,
  )
}

export interface SeedResult {
  tenants: number
  types: number
  rules: number
  nodes: number
}

export async function seed(client: PoolClient): Promise<SeedResult> {
  const created: SeedResult = { tenants: 0, types: 0, rules: 0, nodes: 0 }

  const tenantUpsert = await client.query(
    `insert into tenants (slug, name) values ($1, $2)
     on conflict (slug) do nothing`,
    [TENANT.slug, TENANT.name],
  )
  created.tenants += tenantUpsert.rowCount ?? 0
  const tenantRow = (
    await client.query(`select id, name from tenants where slug = $1`, [TENANT.slug])
  ).rows[0]
  if (tenantUpsert.rowCount === 0 && tenantRow.name !== TENANT.name) {
    drift(`tenant ${TENANT.slug}`, 'name', TENANT.name, tenantRow.name)
  }
  const tenantId: string = tenantRow.id

  const typeIds = new Map<string, string>()
  for (const type of ORG_TYPES) {
    const upsert = await client.query(
      `insert into org_types (tenant_id, code, name, sort_order) values ($1, $2, $3, $4)
       on conflict (tenant_id, code) do nothing`,
      [tenantId, type.code, type.name, type.sortOrder],
    )
    created.types += upsert.rowCount ?? 0
    const row = (
      await client.query(
        `select id, name, sort_order from org_types where tenant_id = $1 and code = $2`,
        [tenantId, type.code],
      )
    ).rows[0]
    if (upsert.rowCount === 0) {
      if (row.name !== type.name) drift(`org type ${type.code}`, 'name', type.name, row.name)
      if (row.sort_order !== type.sortOrder) {
        drift(`org type ${type.code}`, 'sort_order', type.sortOrder, row.sort_order)
      }
    }
    typeIds.set(type.code, row.id)
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
    const parent = node.parent ? nodes.get(node.parent) : undefined
    if (node.parent && !parent) throw new Error(`seed order broken: missing parent ${node.parent}`)
    const expectedDepth = parent ? parent.depth + 1 : 0

    const existing = (
      await client.query(
        `select id, parent_id, org_type_id, path, depth from org_nodes
         where tenant_id = $1 and code = $2`,
        [tenantId, node.code],
      )
    ).rows[0]
    if (existing) {
      const expectedPath = parent ? `${parent.path}.${label(existing.id)}` : label(existing.id)
      if (existing.parent_id !== (parent?.id ?? null)) {
        drift(`org node ${node.code}`, 'parent', parent?.id ?? null, existing.parent_id)
      }
      if (existing.org_type_id !== typeIds.get(node.type)) {
        drift(`org node ${node.code}`, 'org type', typeIds.get(node.type), existing.org_type_id)
      }
      if (existing.depth !== expectedDepth) {
        drift(`org node ${node.code}`, 'depth', expectedDepth, existing.depth)
      }
      if (existing.path !== expectedPath) {
        drift(`org node ${node.code}`, 'path', expectedPath, existing.path)
      }
      nodes.set(node.code, existing)
      continue
    }

    // two-step insert: the path label derives from the generated id
    const inserted = await client.query(
      `insert into org_nodes (tenant_id, parent_id, org_type_id, code, name, path, depth)
       values ($1, $2, $3, $4, $5, '', $6) returning id`,
      [tenantId, parent?.id ?? null, typeIds.get(node.type), node.code, node.name, expectedDepth],
    )
    const id: string = inserted.rows[0].id
    const path = parent ? `${parent.path}.${label(id)}` : label(id)
    await client.query(`update org_nodes set path = $1 where id = $2`, [path, id])
    nodes.set(node.code, { id, path, depth: expectedDepth })
    created.nodes += 1
  }

  return created
}
