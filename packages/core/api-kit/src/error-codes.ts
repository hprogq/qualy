import { SchemaAST, type Schema } from 'effect'
import { HttpApiEndpoint, type HttpApiGroup } from 'effect/http-api'
import {
  BadRequest,
  RequestOriginRefused,
  ApiRouteNotFound,
  ServiceUnavailable,
  ClientProtocolUnsupported,
  ClientAssemblyUnsupported,
  ClientReleaseUnsupported,
} from './schema.ts'

// rc.118 exports these helpers at runtime but strips @internal declarations
// from its .d.ts. Keep this version-specific assembly boundary in one place.
const astTools = SchemaAST as typeof SchemaAST & {
  collectSentinels(ast: SchemaAST.AST): readonly { key: PropertyKey; literal: unknown }[]
  getConstructorDescriptor(ast: SchemaAST.AST): { isConstructed: unknown } | undefined
}
const endpointTools = HttpApiEndpoint as typeof HttpApiEndpoint & {
  getErrorSchemas(endpoint: HttpApiEndpoint.Constraint): readonly Schema.Top[]
}

/** Validate the assembled protocol, independent of browser translations. */
export function validateErrorCodes(
  groups: readonly { readonly pluginId: string; readonly group: HttpApiGroup.Constraint }[],
): void {
  const claimed = new Map<string, { identity: unknown; owner: string }>()
  const check = (schema: Schema.Top, owner: string) => {
    const tag = astTools.collectSentinels(schema.ast).find((s) => s.key === '_tag')?.literal
    if (typeof tag !== 'string') return
    if (!/^[A-Z][A-Z0-9_]*$/.test(tag)) throw new Error(`${owner}: invalid API error code ${tag}`)
    // HttpApi response encodings copy the AST, while retaining the class's
    // constructor descriptor. The predicate identifies that declaration.
    const identity = astTools.getConstructorDescriptor(schema.ast)?.isConstructed ?? schema.ast
    const previous = claimed.get(tag)
    if (previous && previous.identity !== identity)
      throw new Error(`API error code ${tag} is declared by both ${previous.owner} and ${owner}`)
    claimed.set(tag, { identity, owner })
  }
  // Pipeline refusals are not endpoint declarations. Reserve their real
  // schema identities even when no contributed endpoint names them.
  for (const schema of [
    BadRequest,
    RequestOriginRefused,
    ApiRouteNotFound,
    ServiceUnavailable,
    ClientProtocolUnsupported,
    ClientAssemblyUnsupported,
    ClientReleaseUnsupported,
  ])
    check(schema, '@qualy/api-kit/pipeline')
  for (const { pluginId, group } of groups) {
    for (const endpoint of Object.values(group.endpoints)) {
      const owner = `${pluginId}/${group.identifier}/${endpoint.identifier}`
      for (const schema of endpointTools.getErrorSchemas(endpoint)) check(schema, owner)
    }
  }
}
