import { z } from 'zod'
import { del, get, okOutput, patch, post, put } from '@qualy/api-contract'
import { orgErrors as e } from './errors.ts'

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

export const orgContract = {
  // without nodeId: the forest the caller's read grants make visible;
  // with nodeId: that node's authorized slice (a bare self grant sees the
  // node alone, a subtree grant the whole subtree)
  getTree: get('/org/tree')
    .input(z.object({ nodeId: z.uuid().optional() }))
    .errors(e.pick('ORG_NODE_NOT_FOUND'))
    .output(z.object({ roots: z.array(z.string()), nodes: z.array(orgTreeNodeDto) })),
  listTypes: get('/org/types').output(z.object({ types: z.array(orgTypeDto) })),
  createType: post('/org/types')
    .input(
      z.object({ code: codeSchema, name: typeNameSchema, sortOrder: sortOrderSchema.optional() }),
    )
    .errors(e.pick('ORG_TYPE_CONFLICT'))
    .output(z.object({ type: orgTypeDto })),
  updateType: patch('/org/types/{typeId}')
    .input(
      z.object({
        typeId: z.uuid(),
        name: typeNameSchema.optional(),
        sortOrder: sortOrderSchema.optional(),
      }),
    )
    .errors(e.pick('ORG_TYPE_NOT_FOUND', 'ORG_TYPE_CONFLICT'))
    .output(z.object({ type: orgTypeDto })),
  deleteType: del('/org/types/{typeId}')
    .input(z.object({ typeId: z.uuid() }))
    .errors(e.pick('ORG_TYPE_NOT_FOUND', 'ORG_TYPE_IN_USE'))
    .output(okOutput),
  listRules: get('/org/type-rules').output(z.object({ rules: z.array(orgRuleDto) })),
  // the pair identifies the rule, so it belongs in the path and the write is
  // idempotent: repeating it converges instead of conflicting
  putRule: put('/org/type-rules/{parentTypeId}/{childTypeId}')
    .input(z.object({ parentTypeId: z.uuid(), childTypeId: z.uuid() }))
    .errors(e.pick('ORG_TYPE_NOT_FOUND', 'ORG_RULE_INVALID', 'ORG_RULE_CYCLE'))
    .output(okOutput),
  deleteRule: del('/org/type-rules/{parentTypeId}/{childTypeId}')
    .input(z.object({ parentTypeId: z.uuid(), childTypeId: z.uuid() }))
    .errors(e.pick('ORG_RULE_NOT_FOUND', 'ORG_RULE_IN_USE'))
    .output(okOutput),
  getNode: get('/org/nodes/{nodeId}')
    .input(z.object({ nodeId: z.uuid() }))
    .errors(e.pick('ORG_NODE_NOT_FOUND'))
    .output(z.object({ node: orgTreeNodeDto })),
  createNode: post('/org/nodes')
    .input(
      z.object({
        parentId: z.uuid(),
        orgTypeId: z.uuid(),
        name: nodeNameSchema,
        code: codeSchema.optional(),
        sortOrder: sortOrderSchema.optional(),
      }),
    )
    .errors(
      e.pick(
        'ORG_NODE_NOT_FOUND',
        'ORG_TYPE_NOT_FOUND',
        'ORG_NODE_RULE_VIOLATION',
        'ORG_NODE_CONFLICT',
      ),
    )
    .output(z.object({ node: orgNodeDto })),
  updateNode: patch('/org/nodes/{nodeId}')
    .input(
      z.object({
        nodeId: z.uuid(),
        name: nodeNameSchema.optional(),
        sortOrder: sortOrderSchema.optional(),
      }),
    )
    .errors(e.pick('ORG_NODE_NOT_FOUND', 'ORG_NODE_CONFLICT'))
    .output(z.object({ node: orgNodeDto })),
  changeNodeType: put('/org/nodes/{nodeId}/type')
    .input(z.object({ nodeId: z.uuid(), orgTypeId: z.uuid() }))
    .errors(
      e.pick(
        'ORG_NODE_NOT_FOUND',
        'ORG_TYPE_NOT_FOUND',
        'ORG_NODE_RULE_VIOLATION',
        'ORG_NODE_ASSIGNMENT_INCOMPATIBLE',
      ),
    )
    .output(z.object({ node: orgNodeDto })),
  // where a node sits is a subresource that gets replaced, not an action:
  // the same shape a user transfer uses
  setNodePlacement: put('/org/nodes/{nodeId}/placement')
    .input(
      z.object({
        nodeId: z.uuid(),
        parentId: z.uuid(),
        sortOrder: sortOrderSchema.optional(),
      }),
    )
    .errors(
      e.pick(
        'ORG_NODE_NOT_FOUND',
        'ORG_NODE_IS_ROOT',
        'ORG_NODE_INVALID_MOVE',
        'ORG_NODE_RULE_VIOLATION',
        'ORG_NODE_CONFLICT',
      ),
    )
    .output(z.object({ node: orgNodeDto })),
  deleteNode: del('/org/nodes/{nodeId}')
    .input(z.object({ nodeId: z.uuid() }))
    .errors(
      e.pick('ORG_NODE_NOT_FOUND', 'ORG_NODE_IS_ROOT', 'ORG_NODE_HAS_CHILDREN', 'ORG_NODE_IN_USE'),
    )
    .output(okOutput),
}
