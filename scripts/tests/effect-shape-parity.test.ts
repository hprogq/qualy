import { Effect, Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { OpenApi } from 'effect/unstable/httpapi'
import { QUALY_API_PREFIX } from '@qualy/api-kit'
import { trimmedName } from '@qualy/api-kit/schema'
import { qualyApi } from '@qualy/api'
// read from the plugins rather than from the generated client: that file
// tracks whichever plugins are enabled, and another test disables one
import { authContract, identityContract } from '../../packages/plugins/base/auth/src/contract.ts'
import { authLocalContract } from '../../packages/plugins/base/auth-local/src/contract.ts'
import { accessContract } from '../../packages/plugins/base/rbac/src/contract.ts'
import { orgContract } from '../../packages/plugins/base/org/src/contract.ts'
import { appContract } from '../../packages/plugins/infra/ui-registry/src/contract.ts'
import { pingContract } from '../../packages/plugins/demo/ping/src/contract.ts'

// The two runtimes have to agree about shapes, not only about paths.
//
// The route table froze method and path, and nothing compared what travels
// through them. A whole audit's worth of defects lived in that gap: payload
// checks dropped so a 400 became a 500 at the database, a success field added
// that leaked ancestor ids, a required-nullable field silently omitted. None
// of those change a path, and none of them fail a build.
//
// This compares the oRPC contract, which is the specification, against the
// Effect document for every endpoint that exists on both sides. It is
// deliberately structural rather than exact: zod and Effect describe the same
// constraint with the same JSON Schema keyword, so keyword presence is
// comparable even where the phrasing is not.

const contracts = {
  ...authContract,
  ...identityContract,
  ...authLocalContract,
  ...accessContract,
  ...orgContract,
  ...appContract,
  ...pingContract,
} as Record<string, unknown>

type Meta = {
  '~orpc'?: {
    meta?: { '~openapi'?: { method: string; path: string } }
    // arrays: oRPC keeps the whole chain, and the last entry is the effective
    // one. Reading a singular `inputSchema` silently found undefined, so this
    // test passed while comparing nothing at all.
    inputSchemas?: z.ZodType[]
    outputSchemas?: z.ZodType[]
  }
}

/** the oRPC side, keyed the way the Effect document keys its paths */
const specification = () => {
  const out = new Map<string, { input?: z.ZodType; output?: z.ZodType }>()
  for (const procedure of Object.values(contracts)) {
    const orpc = (procedure as Meta)['~orpc']
    const openapi = orpc?.meta?.['~openapi']
    if (!openapi) continue
    out.set(`${openapi.method} ${openapi.path}`, {
      input: orpc?.inputSchemas?.at(-1),
      output: orpc?.outputSchemas?.at(-1),
    })
  }
  return out
}

interface Operation {
  requestBody?: { content?: Record<string, { schema?: JsonSchema }> }
  parameters?: { name: string; in: string; schema?: JsonSchema }[]
  responses?: Record<string, { content?: Record<string, { schema?: JsonSchema }> }>
}

interface JsonSchema {
  type?: string
  properties?: Record<string, JsonSchema>
  required?: string[]
  items?: JsonSchema
  anyOf?: JsonSchema[]
  oneOf?: JsonSchema[]
  allOf?: JsonSchema[]
  $ref?: string
  [keyword: string]: unknown
}

const document = OpenApi.fromApi(qualyApi) as {
  components?: { schemas?: Record<string, JsonSchema> }
  paths: Record<string, Record<string, Operation>>
}

/** follows a $ref so a named model compares the same as an inline one */
const resolve = (schema: JsonSchema | undefined): JsonSchema | undefined => {
  if (!schema) return undefined
  const ref = schema.$ref
  if (typeof ref !== 'string') return schema
  const name = ref.split('/').pop()!
  return document.components?.schemas?.[name]
}

/** unwraps the single-arm unions both generators emit for optional fields */
const flatten = (schema: JsonSchema | undefined): JsonSchema | undefined => {
  const resolved = resolve(schema)
  if (!resolved) return undefined
  // allOf is how a struct carrying a whole-object filter is written, and the
  // properties live in one of its arms rather than at the top
  if (resolved.allOf) {
    const merged: JsonSchema = { ...resolved }
    for (const arm of resolved.allOf.map(resolve)) Object.assign(merged, arm)
    delete merged.allOf
    return merged
  }
  const arms = resolved.anyOf ?? resolved.oneOf
  if (!arms) return resolved
  const meaningful = arms.map(resolve).filter((arm) => arm && arm.type !== 'null')
  // recursive: optional(NullOr(x)) nests two unions, and stopping at the first
  // left the check on x invisible
  return meaningful.length === 1 ? flatten(meaningful[0]) : resolved
}

/**
 * The constraint keywords a schema carries, as `field:keyword` pairs.
 *
 * Only the value-restricting ones. Their absence is what turns a refusal at
 * the boundary into a database error nobody declared.
 */
const KEYWORDS = ['maxLength', 'minLength', 'maximum', 'minimum'] as const

/** pattern and format both say "this string has a shape"; which one is styling */
const shaped = (schema: JsonSchema) =>
  schema.pattern !== undefined || schema.format !== undefined

const constraintsOf = (schema: JsonSchema | undefined, prefix = ''): Set<string> => {
  const found = new Set<string>()
  const target = flatten(schema)
  if (!target) return found
  for (const [name, property] of Object.entries(target.properties ?? {})) {
    const value = flatten(property)
    if (!value) continue
    const unwrapped = value.type === 'array' ? (flatten(value.items) ?? value) : value
    // a bound can sit one level down again, since a checked number writes its
    // range as an allOf inside the arm the optional union chose
    const inner = flatten(unwrapped) ?? unwrapped
    for (const keyword of KEYWORDS) {
      if (inner[keyword] !== undefined) found.add(`${prefix}${name}:${keyword}`)
    }
    if (shaped(inner)) found.add(`${prefix}${name}:shape`)
  }
  return found
}

const propertiesOf = (schema: JsonSchema | undefined): Set<string> =>
  new Set(Object.keys(flatten(schema)?.properties ?? {}))

/**
 * The request body of one Effect operation.
 *
 * Bodies only. A path or search parameter is a string on the wire and the two
 * runtimes model that differently on purpose - oRPC coerces into a typed input
 * object, the Effect side takes the string and converts in the handler - so
 * comparing their keywords reports a difference that is not a defect. Those
 * are covered by the id check and by the handlers' own tests.
 */
const effectInput = (operation: Operation): JsonSchema =>
  flatten(Object.values(operation.requestBody?.content ?? {})[0]?.schema) ?? {
    type: 'object',
    properties: {},
  }

const effectSuccess = (operation: Operation): JsonSchema | undefined => {
  const ok = operation.responses?.['200'] ?? operation.responses?.['204']
  return flatten(Object.values(ok?.content ?? {})[0]?.schema)
}

const zodJson = (schema: z.ZodType | undefined): JsonSchema | undefined => {
  if (!schema) return undefined
  return z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as JsonSchema
}

/** every route both runtimes serve, paired */
const pairs = () => {
  const spec = specification()
  const out: { route: string; operation: Operation; input?: z.ZodType; output?: z.ZodType }[] = []
  for (const [path, methods] of Object.entries(document.paths)) {
    const relative = path.startsWith(QUALY_API_PREFIX) ? path.slice(QUALY_API_PREFIX.length) : path
    // the two documents write path parameters differently
    const contractPath = relative.replaceAll(/:([A-Za-z0-9_]+)/g, '{$1}')
    for (const [method, operation] of Object.entries(methods)) {
      const route = `${method.toUpperCase()} ${contractPath}`
      const match = spec.get(route)
      if (!match) continue
      out.push({ route, operation, input: match.input, output: match.output })
    }
  }
  return out
}

describe('the Effect api routes it pairs', () => {
  it('paired every route it is supposed to compare, with schemas on both sides', () => {
    // Both halves matter. A route that pairs but carries no schema compares
    // nothing, which is how the first version of this test passed while
    // reading a field oRPC does not have.
    const paired = pairs()
    expect(paired.length).toBeGreaterThanOrEqual(50)
    expect(paired.filter((entry) => !entry.output).map((entry) => entry.route)).toEqual([])
  })
})

/**
 * Body fields whose Effect schema trims before measuring.
 *
 * Listed rather than detected: a transform is invisible in the emitted input
 * schema, so the alternative is skipping every unconstrained string, which
 * would silence the class this test exists for.
 */
const trimmed = new Set([
  'PATCH /iam/roles/{roleId} name',
  'PATCH /iam/user-types/{userTypeId} name',
  'PATCH /iam/users/{userId} displayName',
  'PATCH /iam/users/{userId} businessNo',
  'PATCH /org/nodes/{nodeId} name',
  'PATCH /org/types/{typeId} name',
  'POST /iam/roles name',
  'POST /iam/user-types name',
  'POST /iam/users displayName',
  'POST /iam/users businessNo',
  'POST /org/nodes name',
  'POST /org/types name',
])

describe('the primitives every payload is built from', () => {
  it.each([
    ['too long', 'x'.repeat(30), true],
    ['whitespace only', '   ', true],
    ['padded and short', '  ok  ', false],
  ])('trimmedName refuses %s', async (_label, value, refused) => {
    const result = await Effect.runPromise(
      Effect.result(Schema.decodeUnknownEffect(trimmedName(10))(value)),
    )
    expect(result._tag === 'Failure').toBe(refused)
  })
})

describe('the Effect api against the oRPC contract, shape by shape', () => {
  it('keeps every value constraint the contract declares', () => {
    // A dropped maxLength or pattern is not a relaxation, it is a moved
    // failure: the database becomes the only check, and a check violation is
    // not a translatable sqlstate, so a 400 arrives as a 500.
    const missing: string[] = []
    for (const { route, operation, input } of pairs()) {
      const body = effectInput(operation)
      if (Object.keys(body.properties ?? {}).length === 0) continue
      const declared = constraintsOf(zodJson(input))
      const served = constraintsOf(body)
      // only the fields this operation actually takes in its body
      const fields = new Set(Object.keys(body.properties ?? {}))
      for (const constraint of declared) {
        const field = constraint.split(':')[0]!
        if (!fields.has(field)) continue
        // A trimmed name is a decode transform, and its checks apply to the
        // trimmed result, so the INPUT schema cannot carry them: the bound is
        // "trim, then measure", which no input keyword expresses. Ordering
        // matters, since bounding before the trim would refuse a padded value
        // the contract accepts and normalizes. The behaviour is asserted
        // directly in the primitives test instead.
        if (trimmed.has(`${route} ${field}`)) continue
        if (!served.has(constraint)) missing.push(`${route} ${constraint}`)
      }
    }
    expect(missing.sort()).toEqual([])
  })

  it('answers with exactly the fields the contract declares', () => {
    // An extra field is the direction that leaks: the org node DTO grew an
    // ltree path, which is every ancestor's id, on an endpoint whose whole
    // point is refusing to say those nodes exist.
    const drift: string[] = []
    for (const { route, operation, output } of pairs()) {
      const declared = propertiesOf(zodJson(output))
      const served = propertiesOf(effectSuccess(operation))
      if (declared.size === 0) continue
      for (const field of served) if (!declared.has(field)) drift.push(`${route} extra ${field}`)
      for (const field of declared) if (!served.has(field)) drift.push(`${route} missing ${field}`)
    }
    expect(drift.sort()).toEqual([])
  })
})
