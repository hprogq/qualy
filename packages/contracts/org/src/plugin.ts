import { Context, Effect, Layer } from 'effect'
import { ExtensionPoint, Plugin, type PluginFeature } from '@qualy/plugin-kit'
import type { UiText } from '@qualy/i18n-contract'

// Who is using a unit, asked before it is deleted.
//
// Org sits under everything that points at a unit - people stand at one, a
// duty is held over one, a round is administered from one - and the
// dependency runs upward, so org can see none of those tables. What it could
// say when a delete was refused was therefore only that "something" still
// used the unit, which sent the reader looking through the whole product for
// a reference nothing would show them.
//
// So the question is turned round: whoever points at units says so here, and
// org asks every one of them before it offers a delete. A reporter answers
// with what a reader can act on - how many, a few by name, and the page
// where they can be dealt with - never with its own table names.

export interface NodeUsage {
  /** stable within the reporter: what kind of thing is holding the unit */
  readonly kind: string
  /** the kind in words: "People", "Role grants" */
  readonly label: UiText
  readonly count: number
  /**
   * Whether anything a reader can do makes this go away.
   *
   * People can be moved and a grant in force withdrawn. A withdrawn grant
   * kept as history, or a round that has been archived, cannot - and offering
   * a way to "deal with" them sends the reader to a page that refuses. Said
   * here so the screen can tell the two apart instead of finding out.
   */
  readonly clearable: boolean
  /** a few of them by name, so the reader knows what to look for; never the whole set */
  readonly examples: readonly string[]
  /** the page where these can be moved or withdrawn, when there is one */
  readonly target?: {
    readonly pageId: string
    readonly params?: Readonly<Record<string, string>>
    readonly search?: Readonly<Record<string, string>>
  }
}

export type NodeUsageReport = (
  tenantId: string,
  orgNodeId: string,
) => Effect.Effect<readonly NodeUsage[]>

/**
 * One plugin's answer. `bind` runs once while the catalog builds, taking what
 * it needs from the running graph; what it hands back asks for nothing.
 */
export interface NodeUsageReporter<R = never> {
  readonly id: string
  readonly bind: Effect.Effect<NodeUsageReport, never, R>
}

export const NodeUsageReporters = ExtensionPoint.make<NodeUsageReporter<any>>(
  '@qualy/org-contract/node-usage-reporters',
  { phase: 'runtime' },
)

/** every reporter's answer for one unit, in the order their plugins were assembled */
export class NodeUsageCatalog extends Context.Service<
  NodeUsageCatalog,
  { readonly usageOf: NodeUsageReport }
>()('@qualy/org-contract/NodeUsageCatalog') {}

export const OrgUsage = {
  /** declares what of this plugin's holds on to a unit */
  reporter: <R>(reporter: NodeUsageReporter<R>): PluginFeature =>
    Plugin.contribute(NodeUsageReporters, reporter as NodeUsageReporter<any>),

  /** org's interpretation: every reporter bound once, asked together */
  provider: Plugin.provideExtension(NodeUsageReporters, {
    compile: (contributions) =>
      Layer.effect(
        NodeUsageCatalog,
        Effect.gen(function* () {
          const bound: NodeUsageReport[] = []
          for (const contribution of contributions) bound.push(yield* contribution.value.bind)
          return NodeUsageCatalog.of({
            usageOf: (tenantId, orgNodeId) =>
              Effect.map(
                Effect.forEach(bound, (report) => report(tenantId, orgNodeId)),
                (answers) => answers.flat().filter((usage) => usage.count > 0),
              ),
          })
        }),
      ),
  }),
}
