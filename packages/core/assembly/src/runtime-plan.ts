import { CycleError, topoSort } from './graph.ts'
import type { Resolution } from './resolve.ts'

// What the host loads, as a plan the boot-time assembler walks.
//
// This used to render a TypeScript module of static imports; the host now
// imports descriptors at boot, so what remains here is the part that was
// always the point: which plugins ship a runtime, what each was configured
// with, and an order that satisfies the declared dependencies.

export interface RuntimeLayer {
  id: string
  specifier: string
  dependsOn: readonly string[]
  /** the manifest block this plugin's config channel turns into a service */
  config?: unknown
}

/**
 * Every active plugin, as the assembler walks it.
 *
 * The metadata is the descriptor's own - a plugin IS its default export, so
 * being in the manifest is what makes it a runtime layer. `dependsOn` names
 * the plugins whose services its layers need while being built, separate
 * from the database graph because it answers a different question; the
 * config block travels exactly when the descriptor carries a channel for it,
 * which resolution has already validated.
 */
export const runtimeLayers = (resolution: Resolution): RuntimeLayer[] =>
  resolution.runtimePlugins.map((id) => {
    const descriptor = resolution.descriptors.get(id)!
    return {
      id,
      specifier: id,
      dependsOn: descriptor.dependsOn,
      ...(descriptor.config ? { config: resolution.manifest.plugins.get(id)?.config ?? {} } : {}),
    }
  })

/**
 * The layers grouped so that every group depends only on earlier ones.
 *
 * `Layer.mergeAll` builds its members in parallel and does not satisfy
 * dependencies between them, so a flat merge of plugins that need each other
 * leaves those needs unsatisfied. Grouping by depth lets the module provide
 * each group to the ones above it.
 */
export function runtimeLevels(layers: readonly RuntimeLayer[]): RuntimeLayer[][] {
  const byId = new Map(layers.map((layer) => [layer.id, layer]))
  const edges = new Map(layers.map((layer) => [layer.id, layer.dependsOn]))

  for (const layer of layers) {
    for (const dependency of layer.dependsOn) {
      if (byId.has(dependency)) continue
      // the alternative is an unsatisfied requirement surfacing as a type
      // error in generated code, which says nothing about which plugin is
      // missing from the manifest
      throw new Error(
        `${layer.id} declares a runtime dependency on ${dependency}, which this assembly does not contain or which ships no runtime entry`,
      )
    }
  }

  let ordered: string[]
  try {
    ordered = topoSort(
      layers.map((layer) => layer.id),
      edges,
    ).order
  } catch (error) {
    if (!(error instanceof CycleError)) throw error
    throw new Error(
      `runtime dependency cycle: ${error.cycle.join(' -> ')}. Static layers cannot express a cycle, so one of these has to stop needing the other at construction time`,
    )
  }

  const depth = new Map<string, number>()
  for (const id of ordered) {
    const own = byId.get(id)!.dependsOn.filter((dependency) => byId.has(dependency))
    depth.set(id, own.length === 0 ? 0 : Math.max(...own.map((d) => depth.get(d)! + 1)))
  }

  const levels: RuntimeLayer[][] = []
  for (const id of ordered) {
    const level = depth.get(id)!
    ;(levels[level] ??= []).push(byId.get(id)!)
  }
  return levels.map((level) => [...level].sort((a, b) => a.id.localeCompare(b.id)))
}
