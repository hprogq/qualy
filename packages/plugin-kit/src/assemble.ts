import { Layer } from 'effect'
import type { AnyLayer, ExtensionPhase, PluginDescriptor, ProvideExtension } from './index.ts'

// The prototype assembler (docs/plugin-descriptor-plan.md, M1).
//
// It proves the phase order the audit proposed - prepare catalogs before any
// service, services in order, handlers above the complete graph - on real
// descriptors, without touching the generated composition the host still
// runs. What it deliberately does not yet do is tag topology: services here
// build in list order, and the `Plugin.service` requires-graph takes over in
// the cutover milestone.
//
// One claim per channel: two providers for one extension point is a broken
// assembly, refused with both plugins named - the same rule the CLI enforces
// for capability keys.

export interface Assembled {
  /** prepare-phase catalogs: values every service layer may depend on */
  readonly prepared: AnyLayer
  /** every plugin's services, built on the prepared catalogs */
  readonly services: AnyLayer
  /** afterServices compilations (http handlers), built above the services */
  readonly above: AnyLayer
}

export function assemble(descriptors: readonly PluginDescriptor[]): Assembled {
  const providers = new Map<string, { plugin: string; feature: ProvideExtension }>()
  const contributions = new Map<
    string,
    { plugin: string; value: unknown; phase: ExtensionPhase }[]
  >()
  const serviceLayers: AnyLayer[] = []

  for (const descriptor of descriptors) {
    for (const feature of descriptor.features) {
      switch (feature._tag) {
        case 'ProvideExtension': {
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
          const list = contributions.get(feature.point.id) ?? []
          list.push({ plugin: descriptor.id, value: feature.value, phase: feature.point.phase })
          contributions.set(feature.point.id, list)
          break
        }
        case 'Service':
        case 'Layer':
          serviceLayers.push(feature.layer)
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
      .map(({ feature }) =>
        feature.compile((contributions.get(feature.point.id) ?? []).map((entry) => entry.value)),
      )

  const merged = (layers: AnyLayer[]): AnyLayer =>
    layers.length === 0 ? Layer.empty : Layer.mergeAll(layers[0]!, ...layers.slice(1))

  const prepared = merged(compiled('prepare'))
  const services = serviceLayers
    .reduce<AnyLayer>((below, layer) => Layer.provideMerge(layer, below), Layer.empty)
    .pipe(Layer.provideMerge(prepared))
  const above = merged(compiled('afterServices'))

  return { prepared, services, above }
}
