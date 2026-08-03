// org domain errors: the service layer throws these, the router maps them
// onto typed contract errors. Never an ORPCError below the router.
//
// The data a code carries is declared once here and reused by the contract,
// so a code and its payload can never drift apart. ORG_FORBIDDEN is domain
// internal: the router turns it into the transport's FORBIDDEN.
export interface OrgErrorDataMap {
  ORG_FORBIDDEN: undefined
  ORG_TYPE_NOT_FOUND: undefined
  ORG_TYPE_CONFLICT: undefined
  ORG_TYPE_IN_USE: undefined
  ORG_RULE_NOT_FOUND: undefined
  ORG_RULE_CONFLICT: undefined
  ORG_RULE_INVALID: undefined
  ORG_RULE_CYCLE: undefined
  ORG_RULE_IN_USE: undefined
  ORG_NODE_NOT_FOUND: undefined
  ORG_NODE_CONFLICT: undefined
  ORG_NODE_RULE_VIOLATION: undefined
  ORG_NODE_INVALID_MOVE: undefined
  ORG_NODE_IS_ROOT: undefined
  ORG_NODE_HAS_CHILDREN: undefined
  ORG_NODE_IN_USE: undefined
  ORG_NODE_ASSIGNMENT_INCOMPATIBLE: { assignmentCount: number }
}

export type OrgErrorCode = keyof OrgErrorDataMap

// codes that carry no payload: the only ones a generic thrower (the
// constraint translator) may raise without supplying data
export type DatalessOrgErrorCode = {
  [Code in OrgErrorCode]: OrgErrorDataMap[Code] extends undefined ? Code : never
}[OrgErrorCode]

type DataArgs<Code extends OrgErrorCode> = OrgErrorDataMap[Code] extends undefined
  ? []
  : [data: OrgErrorDataMap[Code]]

// data is the safe, structured payload the frontend formats into a
// localized sentence; the message is an english developer/protocol string
// (openapi docs, logs, non-browser clients), never the display text. Never
// put role codes, constraint names or raw sql detail into data. The
// constructor demands exactly the data its code declares.
export class OrgError<Code extends OrgErrorCode = OrgErrorCode> extends Error {
  readonly data: OrgErrorDataMap[Code]

  constructor(
    readonly code: Code,
    developerMessage: string,
    ...args: DataArgs<Code>
  ) {
    super(developerMessage)
    this.name = 'OrgError'
    this.data = args[0] as OrgErrorDataMap[Code]
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
const constraintErrors: Record<string, [DatalessOrgErrorCode, string]> = {
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
