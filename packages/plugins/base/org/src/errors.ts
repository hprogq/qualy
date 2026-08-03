// org domain errors: the service layer throws these, the router maps them
// onto typed contract errors. Never an ORPCError below the router.
export type OrgErrorCode =
  | 'ORG_FORBIDDEN'
  | 'ORG_TYPE_NOT_FOUND'
  | 'ORG_TYPE_CONFLICT'
  | 'ORG_TYPE_IN_USE'
  | 'ORG_RULE_NOT_FOUND'
  | 'ORG_RULE_CONFLICT'
  | 'ORG_RULE_INVALID'
  | 'ORG_RULE_CYCLE'
  | 'ORG_RULE_IN_USE'
  | 'ORG_NODE_NOT_FOUND'
  | 'ORG_NODE_CONFLICT'
  | 'ORG_NODE_RULE_VIOLATION'
  | 'ORG_NODE_INVALID_MOVE'
  | 'ORG_NODE_IS_ROOT'
  | 'ORG_NODE_HAS_CHILDREN'
  | 'ORG_NODE_IN_USE'
  | 'ORG_NODE_ASSIGNMENT_INCOMPATIBLE'

// data is the safe, structured payload the frontend formats into a
// localized sentence; the message is an english developer/protocol string
// (openapi docs, logs, non-browser clients), never the display text. Never
// put role codes, constraint names or raw sql detail into data.
export class OrgError<Data = undefined> extends Error {
  readonly data: Data

  constructor(code: OrgErrorCode, developerMessage: string, data?: Data)
  constructor(
    readonly code: OrgErrorCode,
    developerMessage: string,
    data?: Data,
  ) {
    super(developerMessage)
    this.name = 'OrgError'
    this.data = data as Data
  }
}

// postgres error unwrapping: drizzle wraps the DatabaseError as .cause
export function pgError(error: unknown): { code?: string; constraint?: string } | undefined {
  if (!error || typeof error !== 'object') return undefined
  const candidate = 'cause' in error && error.cause ? error.cause : error
  if (typeof candidate !== 'object' || !('code' in candidate)) return undefined
  return candidate as { code?: string; constraint?: string }
}

// unique violations and restrict-fk violations carry the constraint name;
// translating by name keeps the database as an honest backstop instead of a
// source of opaque 500s (the legacy system leaked 23503 as 500)
const constraintErrors: Record<string, [OrgErrorCode, string]> = {
  uq_org_nodes_tenant_parent_name: ['ORG_NODE_CONFLICT', 'sibling name already exists'],
  uq_org_nodes_tenant_root_name: ['ORG_NODE_CONFLICT', 'root name already exists'],
  uq_org_nodes_tenant_code: ['ORG_NODE_CONFLICT', 'node code already exists'],
  uq_org_nodes_tenant_single_root: ['ORG_NODE_CONFLICT', 'tenant already has a root'],
  uq_org_types_tenant_code: ['ORG_TYPE_CONFLICT', 'org type code already exists'],
  uq_org_types_tenant_name: ['ORG_TYPE_CONFLICT', 'org type name already exists'],
  pk_org_type_rules: ['ORG_RULE_CONFLICT', 'rule already exists'],
  fk_org_nodes_parent: ['ORG_NODE_HAS_CHILDREN', 'node still has children'],
  fk_users_primary_org_node: ['ORG_NODE_IN_USE', 'users are attached to this node'],
  fk_user_role_assignments_node: ['ORG_NODE_IN_USE', 'role assignments are anchored at this node'],
  fk_org_nodes_org_type: ['ORG_TYPE_IN_USE', 'nodes still use this org type'],
  fk_role_allowed_org_types_type: ['ORG_TYPE_IN_USE', 'roles still allow this org type'],
}

// rethrows database conflicts as domain errors, everything else untouched.
// Restrict foreign keys raise 23001 (row-level restrict_violation), not
// 23503, which only no-action keys produce (probed on pg18).
export function translateDbError(error: unknown): never {
  const pg = pgError(error)
  if (pg?.code === '23505' || pg?.code === '23503' || pg?.code === '23001') {
    const translated = pg.constraint ? constraintErrors[pg.constraint] : undefined
    if (translated) throw new OrgError(translated[0], translated[1])
  }
  throw error
}
