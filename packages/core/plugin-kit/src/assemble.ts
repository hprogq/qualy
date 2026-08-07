import { Effect, Layer } from 'effect'
import type {
  AnyLayer,
  Contributed,
  ExtensionPhase,
  PluginDescriptor,
  ProvideExtension,
  ServiceFeature,
} from './index.ts'

// The phase assembler: from descriptors to the three layers a host serves
// from - prepare catalogs before any service, services on the prepared
// values, handlers above the complete graph.
//
// One claim per channel: two providers for one extension point is a broken
// assembly, refused with both plugins named - the same rule the CLI enforces
// for capability keys.
//
// Service order is decided by the declared keys where there are keys to
// declare: every `Plugin.service` is placed by its `requires` tags - real
// Context keys, so the runtime topology and the compile-time bound are one
// declaration. Opaque `Plugin.layer` features have no keys to sort by and
// keep their incoming order, below the keyed services; they are the escape
// hatch for infrastructure that deliberately unexports its keys, not the
// normal form.

export interface Assembled {
  /** prepare-phase catalogs: values every service layer may depend on */
  readonly prepared: AnyLayer
  /** every plugin's services, built on the prepared catalogs */
  readonly services: AnyLayer
  /** afterServices compilations (http handlers), built above the services */
  readonly above: AnyLayer
}

/**
 * The layer, rebuilt under the plugin's name.
 *
 * Log annotations are fiber-scoped and inherited by forked fibers, so
 * wrapping the BUILD is what makes a plugin's construction logs - and any
 * background fiber it forks while building - say which plugin is speaking,
 * instead of a bare fiber id. Memoization is preserved: the wrapper builds
 * through the same memo map.
 */
const owned = (plugin: string, layer: AnyLayer): AnyLayer =>
  Layer.fromBuild((memoMap, scope) =>
    Effect.annotateLogs(Layer.buildWithMemoMap(layer, memoMap, scope), { source: plugin }),
  )

export function assemble(descriptors: readonly PluginDescriptor[]): Assembled {
  const providers = new Map<string, { plugin: string; feature: ProvideExtension }>()
  const contributions = new Map<
    string,
    { plugin: string; value: unknown; phase: ExtensionPhase }[]
  >()
  const opaqueLayers: AnyLayer[] = []
  const services: { plugin: string; feature: ServiceFeature }[] = []

  // Two features naming one point id had better mean the same channel. Points
  // are matched by string id across package instances, so a second definition
  // under the same id with a different phase or capability would
  // cross-connect two channels that merely share a name.
  const pointShapes = new Map<
    string,
    { plugin: string; phase: ExtensionPhase; capability: string | undefined }
  >()
  const claimPoint = (plugin: string, point: ProvideExtension['point']) => {
    const seen = pointShapes.get(point.id)
    if (!seen) {
      pointShapes.set(point.id, { plugin, phase: point.phase, capability: point.capability })
      return
    }
    if (seen.phase !== point.phase || seen.capability !== point.capability) {
      throw new Error(
        `extension point ${point.id} is declared with a different shape by ${seen.plugin} and ${plugin}: ` +
          `phase ${seen.phase} vs ${point.phase}, capability ${seen.capability ?? 'none'} vs ${point.capability ?? 'none'}`,
      )
    }
  }

  for (const descriptor of descriptors) {
    for (const feature of descriptor.features) {
      switch (feature._tag) {
        case 'ProvideExtension': {
          claimPoint(descriptor.id, feature.point)
          const previous = providers.get(feature.point.id)
          if (previous) {
            throw new Error(
              `extension point ${feature.point.id} is provided by both ${previous.plugin} and ${descriptor.id}`,
            )
          }
          providers.set(feature.point.id, { plugin: descriptor.id, feature })
          break
        }
        case 'Contribute': {
          claimPoint(descriptor.id, feature.point)
          const list = contributions.get(feature.point.id) ?? []
          list.push({ plugin: descriptor.id, value: feature.value, phase: feature.point.phase })
          contributions.set(feature.point.id, list)
          break
        }
        case 'Service':
          services.push({ plugin: descriptor.id, feature })
          break
        case 'Layer':
          opaqueLayers.push(owned(descriptor.id, feature.layer))
          break
        case 'Capability':
          // the CLI's channel: the provider module is imported when the
          // capability does work, never while a server boots
          break
      }
    }
  }

  // a contribution nobody interprets would vanish silently, which is the
  // exact failure the CLI's capability model already refuses - except for
  // external channels, whose interpreter is a different host by declaration
  for (const [pointId, list] of contributions) {
    if (list.every((entry) => entry.phase === 'external')) continue
    if (!providers.has(pointId)) {
      throw new Error(
        `${list.map((entry) => entry.plugin).join(', ')} contribute(s) to ${pointId}, which no selected plugin provides`,
      )
    }
  }

  const compiled = (phase: ExtensionPhase): AnyLayer[] =>
    [...providers.values()]
      .filter(({ feature }) => feature.point.phase === phase)
      .map(({ plugin, feature }) =>
        owned(
          plugin,
          feature.compile(
            (contributions.get(feature.point.id) ?? []).map((entry): Contributed<unknown> => ({
              pluginId: entry.plugin,
              value: entry.value,
            })),
          ),
        ),
      )

  const merged = (layers: AnyLayer[]): AnyLayer =>
    layers.length === 0 ? Layer.empty : Layer.mergeAll(layers[0]!, ...layers.slice(1))

  const prepared = merged(compiled('prepare'))
  const ordered = [
    ...opaqueLayers,
    ...sortServices(services).map((entry) => owned(entry.plugin, entry.feature.layer)),
  ]
  const serviceGraph = ordered
    .reduce<AnyLayer>((below, layer) => Layer.provideMerge(layer, below), Layer.empty)
    .pipe(Layer.provideMerge(prepared))
  const above = merged(compiled('afterServices'))

  return { prepared, services: serviceGraph, above }
}

/**
 * Keyed services in dependency order, from the declared tags.
 *
 * One key one provider; every `requires` entry must be provided by some
 * selected service. A key its owner keeps unexported cannot be named here in
 * the first place, and prepared values sit below every service already, so
 * `requires` speaks only about services ordering among themselves. Cycles are
 * refused by name; ties keep the incoming order.
 */
function sortServices(
  services: readonly { plugin: string; feature: ServiceFeature }[],
): { plugin: string; feature: ServiceFeature }[] {
  const byKey = new Map<string, { plugin: string; feature: ServiceFeature }>()
  for (const entry of services) {
    const id = entry.feature.key.key
    const previous = byKey.get(id)
    if (previous) {
      throw new Error(`service ${id} is provided by both ${previous.plugin} and ${entry.plugin}`)
    }
    byKey.set(id, entry)
  }
  for (const entry of services) {
    for (const required of entry.feature.requires) {
      if (!byKey.has(required.key)) {
        throw new Error(
          `${entry.plugin} requires service ${required.key}, which no selected plugin provides`,
        )
      }
    }
  }

  const sorted: { plugin: string; feature: ServiceFeature }[] = []
  const state = new Map<string, 'visiting' | 'done'>()
  const visit = (id: string, path: string[]) => {
    const at = state.get(id)
    if (at === 'done') return
    if (at === 'visiting') {
      const cycle = [...path.slice(path.indexOf(id)), id]
      throw new Error(`service dependency cycle: ${cycle.join(' -> ')}`)
    }
    state.set(id, 'visiting')
    const entry = byKey.get(id)!
    for (const required of entry.feature.requires) visit(required.key, [...path, id])
    state.set(id, 'done')
    sorted.push(entry)
  }
  for (const entry of services) visit(entry.feature.key.key, [])
  return sorted
}
