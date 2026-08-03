import { oc, type RouterContractClient } from '@orpc/contract'
import type { InferClientError } from '@orpc/client'
import type { DefinedApiError } from '@qualy/i18n-contract'
import { openapi } from '@orpc/openapi'
import { z } from 'zod'
import type { OrgErrorDataMap } from './errors.ts'

const codeSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'lowercase kebab-case')
  .max(63)
const nodeNameSchema = z.string().trim().min(1).max(255)
const typeNameSchema = z.string().trim().min(1).max(100)
const sortOrderSchema = z.number().int().min(0).max(32767)

export const orgNodeDto = z.object({
  id: z.string(),
  code: z.string().nullable(),
  name: z.string(),
  orgTypeId: z.string(),
  parentId: z.string().nullable(),
  depth: z.number().int(),
  sortOrder: z.number().int(),
})

// tree nodes additionally say what the caller may do with them, so the
// page can hide mutation controls it could never use: manageable covers
// single-node mutations, subtreeManageable is required for moves (they
// relocate every descendant)
export const orgTreeNodeDto = orgNodeDto.extend({
  manageable: z.boolean(),
  subtreeManageable: z.boolean(),
})

export const orgTypeDto = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  sortOrder: z.number().int(),
})

export const orgRuleDto = z.object({
  parentTypeId: z.string(),
  childTypeId: z.string(),
})

export type OrgNodeDto = z.infer<typeof orgNodeDto>
export type OrgTreeNodeDto = z.infer<typeof orgTreeNodeDto>
export type OrgTypeDto = z.infer<typeof orgTypeDto>
export type OrgRuleDto = z.infer<typeof orgRuleDto>

// http statuses for the domain codes ride along on server.contribute;
// AUTH_REQUIRED is shared with auth (same value merges)
export const orgErrorStatuses = {
  AUTH_REQUIRED: 401,
  ORG_TYPE_NOT_FOUND: 404,
  ORG_RULE_NOT_FOUND: 404,
  ORG_NODE_NOT_FOUND: 404,
  ORG_TYPE_CONFLICT: 409,
  ORG_RULE_CONFLICT: 409,
  ORG_NODE_CONFLICT: 409,
  ORG_TYPE_IN_USE: 409,
  ORG_RULE_IN_USE: 409,
  ORG_NODE_IN_USE: 409,
  ORG_NODE_IS_ROOT: 409,
  ORG_NODE_HAS_CHILDREN: 409,
  ORG_NODE_ASSIGNMENT_INCOMPATIBLE: 409,
  ORG_RULE_INVALID: 422,
  ORG_RULE_CYCLE: 422,
  ORG_NODE_RULE_VIOLATION: 422,
  ORG_NODE_INVALID_MOVE: 422,
} as const

// generic over the code so the literal key survives: a computed key from a
// non-generic parameter widens to string and erases the whole error union
const err = <Code extends keyof typeof orgErrorStatuses, Data extends z.ZodType | undefined>(
  code: Code,
  message: string,
  data?: Data,
) =>
  ({ [code]: { status: orgErrorStatuses[code], message, ...(data ? { data } : {}) } }) as unknown as {
    [K in Code]: { status: number; message: string } & (Data extends z.ZodType
      ? { data: Data }
      : Record<never, never>)
  }

// structured payloads the frontend turns into localized sentences. The
// domain declares the same shape in OrgErrorDataMap; the assertion below
// fails typecheck if the two ever drift apart.
export const assignmentIncompatibleData = z.object({
  assignmentCount: z.number().int().nonnegative(),
})

type AssertSameData<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never
const _dataMatchesDomain: AssertSameData<
  z.infer<typeof assignmentIncompatibleData>,
  OrgErrorDataMap['ORG_NODE_ASSIGNMENT_INCOMPATIBLE']
> = true
void _dataMatchesDomain

const nodeNotFound = err('ORG_NODE_NOT_FOUND', 'node not found')
const typeNotFound = err('ORG_TYPE_NOT_FOUND', 'org type not found')
const nodeConflict = err('ORG_NODE_CONFLICT', 'conflicting node name or code')
const ruleViolation = err('ORG_NODE_RULE_VIOLATION', 'type rules forbid this combination')

export const orgContract = {
  // without nodeId: the forest the caller's read grants make visible;
  // with nodeId: exactly that subtree (requires read at the node)
  getTree: oc
    .meta(openapi({ method: 'GET', path: '/org/tree' }))
    .input(z.object({ nodeId: z.uuid().optional() }))
    .errors(nodeNotFound)
    .output(z.object({ roots: z.array(z.string()), nodes: z.array(orgTreeNodeDto) })),
  listTypes: oc
    .meta(openapi({ method: 'GET', path: '/org/types' }))
    .output(z.object({ types: z.array(orgTypeDto) })),
  createType: oc
    .meta(openapi({ method: 'POST', path: '/org/types' }))
    .input(z.object({ code: codeSchema, name: typeNameSchema, sortOrder: sortOrderSchema.optional() }))
    .errors(err('ORG_TYPE_CONFLICT', 'org type code or name already exists'))
    .output(z.object({ type: orgTypeDto })),
  updateType: oc
    .meta(openapi({ method: 'PATCH', path: '/org/types/{typeId}' }))
    .input(
      z.object({
        typeId: z.uuid(),
        name: typeNameSchema.optional(),
        sortOrder: sortOrderSchema.optional(),
      }),
    )
    .errors({ ...typeNotFound, ...err('ORG_TYPE_CONFLICT', 'org type name already exists') })
    .output(z.object({ type: orgTypeDto })),
  deleteType: oc
    .meta(openapi({ method: 'DELETE', path: '/org/types/{typeId}' }))
    .input(z.object({ typeId: z.uuid() }))
    .errors({ ...typeNotFound, ...err('ORG_TYPE_IN_USE', 'org type is still referenced') })
    .output(z.object({ ok: z.boolean() })),
  listRules: oc
    .meta(openapi({ method: 'GET', path: '/org/type-rules' }))
    .output(z.object({ rules: z.array(orgRuleDto) })),
  createRule: oc
    .meta(openapi({ method: 'POST', path: '/org/type-rules' }))
    .input(z.object({ parentTypeId: z.uuid(), childTypeId: z.uuid() }))
    .errors({
      ...typeNotFound,
      ...err('ORG_RULE_CONFLICT', 'rule already exists'),
      ...err('ORG_RULE_INVALID', 'invalid rule'),
      ...err('ORG_RULE_CYCLE', 'rule would create a cycle'),
    })
    .output(z.object({ ok: z.boolean() })),
  deleteRule: oc
    .meta(openapi({ method: 'DELETE', path: '/org/type-rules/{parentTypeId}/{childTypeId}' }))
    .input(z.object({ parentTypeId: z.uuid(), childTypeId: z.uuid() }))
    .errors({
      ...err('ORG_RULE_NOT_FOUND', 'rule not found'),
      ...err('ORG_RULE_IN_USE', 'existing nodes depend on this rule'),
    })
    .output(z.object({ ok: z.boolean() })),
  createNode: oc
    .meta(openapi({ method: 'POST', path: '/org/nodes' }))
    .input(
      z.object({
        parentId: z.uuid(),
        orgTypeId: z.uuid(),
        name: nodeNameSchema,
        code: codeSchema.optional(),
        sortOrder: sortOrderSchema.optional(),
      }),
    )
    .errors({ ...nodeNotFound, ...typeNotFound, ...ruleViolation, ...nodeConflict })
    .output(z.object({ node: orgNodeDto })),
  updateNode: oc
    .meta(openapi({ method: 'PATCH', path: '/org/nodes/{nodeId}' }))
    .input(
      z.object({
        nodeId: z.uuid(),
        name: nodeNameSchema.optional(),
        sortOrder: sortOrderSchema.optional(),
      }),
    )
    .errors({ ...nodeNotFound, ...nodeConflict })
    .output(z.object({ node: orgNodeDto })),
  changeNodeType: oc
    .meta(openapi({ method: 'PUT', path: '/org/nodes/{nodeId}/type' }))
    .input(z.object({ nodeId: z.uuid(), orgTypeId: z.uuid() }))
    .errors({
      ...nodeNotFound,
      ...typeNotFound,
      ...ruleViolation,
      ...err(
        'ORG_NODE_ASSIGNMENT_INCOMPATIBLE',
        'role assignments reject the requested organization type',
        assignmentIncompatibleData,
      ),
    })
    .output(z.object({ node: orgNodeDto })),
  moveNode: oc
    .meta(openapi({ method: 'POST', path: '/org/nodes/{nodeId}/move' }))
    .input(
      z.object({
        nodeId: z.uuid(),
        newParentId: z.uuid(),
        newSortOrder: sortOrderSchema.optional(),
      }),
    )
    .errors({
      ...nodeNotFound,
      ...err('ORG_NODE_IS_ROOT', 'the root cannot be moved'),
      ...err('ORG_NODE_INVALID_MOVE', 'invalid move'),
      ...ruleViolation,
      ...nodeConflict,
    })
    .output(z.object({ node: orgNodeDto })),
  deleteNode: oc
    .meta(openapi({ method: 'DELETE', path: '/org/nodes/{nodeId}' }))
    .input(z.object({ nodeId: z.uuid() }))
    .errors({
      ...nodeNotFound,
      ...err('ORG_NODE_IS_ROOT', 'the root cannot be deleted'),
      ...err('ORG_NODE_HAS_CHILDREN', 'only leaf nodes can be deleted'),
      ...err('ORG_NODE_IN_USE', 'users or assignments still reference this node'),
    })
    .output(z.object({ ok: z.boolean() })),
}

// the defined-error union of this contract, the single source the client's
// message registry is checked against (probed: beta.21 exposes the union
// through RouterContractClient + InferClientError, mixed with a bare Error
// that the distributive helpers filter out)
export type OrgContractError = DefinedApiError<
  InferClientError<RouterContractClient<typeof orgContract>>
>
