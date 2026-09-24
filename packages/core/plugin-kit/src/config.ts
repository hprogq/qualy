import { Effect, Schema, SchemaAST, SchemaIssue } from 'effect'

// How a plugin reads its block of the product manifest.
//
// One function, and the whole of it is one option: unknown keys are REFUSED
// rather than ignored. That is a policy of this repository rather than a
// preference, and it is the kind that has to be applied everywhere to be worth
// anything - a manifest reading
//
//   '@qualy/plugin-rum-tencent':
//     config:
//       sampleRtae: 0.5
//
// is a deployment that believes it configured sampling and did not. Nothing
// fails, nothing warns, and the first person to find out is whoever wonders
// why the numbers look wrong months later.
//
// Every plugin that takes configuration was spelling the option itself, which
// meant the policy held by repetition: nine copies, and a tenth plugin one
// forgotten argument away from silently accepting typos. Here it is a
// property of the reader instead.
//
// Deliberately NOT a general strict-decode helper. Other decoders in this
// repository refuse excess keys for reasons of their own - a scoring envelope
// language, a ui collection contribution - and those are their owners'
// decisions to make and to change. What is centralised here is the manifest
// channel's policy, nothing wider.

/**
 * Decodes a plugin's manifest block, refusing keys the schema does not name.
 *
 * The error channel is the schema's own, so a plugin's config layer keeps
 * failing the way it already did: the process refuses to start, and the
 * message names the key.
 */
export const decodePluginConfig = <A, I, RD>(
  schema: Schema.Codec<A, I, RD>,
  block: unknown,
): Effect.Effect<A, Schema.SchemaError, RD> =>
  Effect.suspend(() => {
    const ast = schema.ast
    // `Schema.Struct({})` is TypeScript's `{}` upstream - any value but null
    // and undefined - so it never looks at keys, excess or not. A plugin that
    // takes no configuration spells exactly that, and would otherwise be the
    // one plugin in which every key is a typo that nobody is told about.
    if (
      SchemaAST.isObjects(ast) &&
      ast.propertySignatures.length === 0 &&
      ast.indexSignatures.length === 0
    ) {
      if (typeof block !== 'object' || block === null || Array.isArray(block)) {
        return Effect.fail(new Schema.SchemaError(new SchemaIssue.InvalidType(ast, block)))
      }
      const [key] = Reflect.ownKeys(block)
      if (key !== undefined) {
        return Effect.fail(
          new Schema.SchemaError(
            new SchemaIssue.Pointer([key], new SchemaIssue.UnexpectedKey(ast, undefined)),
          ),
        )
      }
    }
    return Schema.decodeUnknownEffect(schema)(block, { onExcessProperty: 'error' })
  })
