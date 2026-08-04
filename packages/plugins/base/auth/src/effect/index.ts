import { sql, type SQL } from 'drizzle-orm'
import { Context, Effect, Layer } from 'effect'
import { Placement } from '@qualy/auth-contract'
import { Database } from '@qualy/plugin-database/effect'
import { strandedByQuery, usersBlockingOrgTypeQuery } from '../iam/queries.ts'
import { Authenticated, layer as sessionLayer } from './session.ts'

// auth as an Effect layer.
//
// It provides two tags from one construction. `Placement` is the port org
// holds: one question, no database types crossing it, because the connection
// travels in the fiber and there is nothing left to pass. `Iam` is auth's own
// surface, which its handlers use and no peer does.
//
// Like rbac, this reads org's tables by raw SQL and never holds the org
// service. Keeping it that way is what keeps the service graph acyclic.

const rows = <Row extends Record<string, unknown>>(result: unknown) =>
  (result as { rows: readonly Row[] }).rows

/**
 * The whole-tenant placement scan.
 *
 * Exposed for the invariant tests and for a migration that needs to know
 * whether it is about to leave anyone standing illegally. It asks the same
 * predicate every individual write is decided by, of every row at once.
 */
export class Iam extends Context.Service<
  Iam,
  {
    readonly placementViolations: (tenantId: string) => Effect.Effect<number>
  }
>()('@qualy/plugin-auth/Iam') {}

export const make = Effect.fn('Auth.make')(function* () {
  const database = yield* Database

  const countStranded = (query: SQL) =>
    database.execute(query).pipe(
      Effect.orDie,
      Effect.map((result) => Number(rows<{ count: number }>(result)[0]?.count ?? 0)),
    )

  return {
    placement: {
      // org asks before it retypes a node: the people standing there do not
      // move, so the node changing under them strands them exactly as a
      // transfer would. Called inside org's locked transaction, it joins that
      // transaction and therefore sees the retype that has not committed yet.
      usersBlockingOrgType: (tenantId: string, orgNodeId: string, orgTypeId: string) =>
        countStranded(usersBlockingOrgTypeQuery(tenantId, orgNodeId, orgTypeId)),
    },
    iam: {
      // the same predicate every individual write is decided by, asked of
      // every row at once. Written through strandedByQuery rather than spelled
      // out again, because a second copy is how the rule starts answering two
      // different things.
      placementViolations: (tenantId: string) =>
        countStranded(strandedByQuery(sql`u.tenant_id = ${tenantId}`, sql`n.org_type_id`)),
    },
  }
})

/**
 * What this plugin contributes.
 *
 * One construction provides both tags, so the port org holds and the surface
 * auth's own handlers use come from the same state rather than two.
 */
const tags: Layer.Layer<Placement | Iam, never, Database> = Layer.effectContext(
  Effect.gen(function* () {
    const { placement, iam } = yield* make()
    return Context.empty().pipe(Context.add(Placement, placement), Context.add(Iam, iam))
  }),
)

/**
 * What this plugin contributes.
 *
 * The session middleware ships with it because auth owns sessions, and any
 * plugin's endpoint may declare it. Merging it alongside is safe here for the
 * reason the ui authorizer is: it is a required service, so an endpoint that
 * declares the middleware cannot be composed into an assembly that does not
 * provide it. The requirement reaches the entry point and fails the build.
 */
export const layer: Layer.Layer<Placement | Iam | Authenticated, never, Database> =
  Layer.merge(tags, sessionLayer)
