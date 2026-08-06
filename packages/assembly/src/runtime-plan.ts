import path from 'node:path'
import { CycleError, topoSort } from './graph.ts'
import { writeAtomic } from './lock.ts'
import { capabilityModules } from './modules.ts'
import type { Resolution } from './resolve.ts'

// What the host loads, derived from the manifest.
//
// The runtime reads a TypeScript module rather than a list of specifiers to
// resolve, because a static import is worth more than a resolved string: a
// missing package fails the build rather than the boot, a bundler can see what
// is reachable, and the composed layer is typechecked before anything runs.

export interface RuntimeLayer {
  id: string
  specifier: string
  dependsOn: readonly string[]
  /** the manifest block this plugin's `config` export turns into a service */
  config?: unknown
}

/**
 * The plugins that ship an Effect runtime.
 *
 * A plugin says so with `qualy.runtime.entry` in its package.json, naming one
 * of its own subpath exports. Declaring it there rather than in code is what
 * lets resolution stay a file-reading operation: the assembly decides what an
 * application contains without importing any of it.
 *
 * `qualy.runtime.dependsOn` names the plugins whose services this one's layer
 * needs while it is being built. It is separate from the database graph
 * because it answers a different question, and it exists because merging
 * layers does not wire them together.
 */
export const runtimeLayers = (resolution: Resolution): RuntimeLayer[] =>
  resolution.runtimePlugins.flatMap((id) => {
    const runtime = resolution.resolver.readMetadata(id).runtime
    if (!runtime?.entry) return []
    return [
      {
        id,
        // '.' means the package root: the plugin IS its entry, which is the
        // convention; a subpath entry stays expressible for the ones whose
        // root belongs to something else
        specifier: runtime.entry === '.' ? id : `${id}/${runtime.entry.replace(/^\.\//, '')}`,
        dependsOn: runtime.dependsOn,
        // Only when the plugin said it takes one. A manifest block for a
        // plugin that reads none is a setting nothing consumes, which is the
        // failure this repository refuses everywhere else: resolution rejects
        // it rather than writing it into a call nobody makes.
        ...(runtime.config ? { config: resolution.manifest.plugins.get(id)?.config ?? {} } : {}),
      },
    ]
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

const identifier = (id: string) =>
  id
    .replace(/^@[^/]+\//, '')
    .replace(/[^a-zA-Z0-9]+(.)/g, (_match, next: string) => next.toUpperCase())

/**
 * From the generated module to the manifest, as a relative specifier.
 *
 * The module has to be able to anchor a path without knowing the working
 * directory, and only the caller knows where the module goes - so the caller
 * says, and this stays a pure function of the resolution and that path.
 */
const manifestRelative = (resolution: Resolution, modulePath: string): string => {
  const relative = path.relative(path.dirname(modulePath), path.dirname(resolution.manifest.source))
  const normalized = relative === '' ? '.' : relative.split(path.sep).join('/')
  return normalized.startsWith('.') ? `${normalized}/` : `./${normalized}/`
}

/**
 * From the runtime module to a generated one beside it.
 *
 * Both paths are relative to the manifest, and the module imports its
 * neighbour by relative specifier - which has to keep its extension, because
 * the compiler resolves these the way node does.
 */
const moduleSpecifier = (from: string, to: string): string => {
  const relative = path.relative(path.dirname(from), to).split(path.sep).join('/')
  return relative.startsWith('.') ? relative : `./${relative}`
}

const configExpression = (layers: readonly RuntimeLayer[]): string =>
  layers.length === 1
    ? callConfig(layers[0]!)
    : `Layer.mergeAll(\n${layers.map((layer) => `  ${callConfig(layer)},`).join('\n')}\n)`

const callConfig = (layer: RuntimeLayer): string =>
  `${identifier(layer.id)}Config(${JSON.stringify(layer.config)}, { manifestDir })`

const mergeExpression = (level: readonly RuntimeLayer[]): string =>
  level.length === 1
    ? identifier(level[0]!.id)
    : `Layer.mergeAll(${level.map((layer) => identifier(layer.id)).join(', ')})`

/**
 * The generated composition root.
 *
 * A list of imports and one composed layer, deliberately nothing else:
 * anything conditional belongs in resolution, which has already run by the
 * time this file exists.
 *
 * Levels are provided rather than merged because merging does not wire.
 * Each level is given to the ones above it with `provideMerge`, which both
 * satisfies their needs and keeps the service available to the application.
 */
export function renderRuntimeModule(resolution: Resolution, modulePath: string): string {
  const layers = runtimeLayers(resolution)
  const configured = layers.filter((layer) => layer.config !== undefined)
  // What the capabilities generated, when it carries a service. The core does
  // not know what any of them is: it imports the name the capability gave and
  // merges it, so a capability that is not in this assembly takes its service
  // with it rather than leaving a tag nothing provides.
  const derived = capabilityModules(resolution).flatMap((module) =>
    module.layerExport === undefined
      ? []
      : [{ specifier: moduleSpecifier(modulePath, module.path), name: module.layerExport }],
  )
  const imports = layers.map((layer) =>
    layer.config === undefined
      ? `import { layer as ${identifier(layer.id)} } from '${layer.specifier}'`
      : `import { layer as ${identifier(layer.id)}, config as ${identifier(layer.id)}Config } from '${layer.specifier}'`,
  )
  const levels = runtimeLevels(layers)
  const composed = () => {
    // written top down: the most dependent level first, then everything it
    // stands on, in the order it needs them
    const [top, ...rest] = [...levels].reverse()
    if (rest.length === 0) return mergeExpression(top!)
    return [
      `${mergeExpression(top!)}.pipe(`,
      ...rest.map((level) => `  Layer.provideMerge(${mergeExpression(level)}),`),
      ')',
    ].join('\n')
  }
  return [
    `// Generated by Qualy from ${path.basename(resolution.manifest.source)}. Run 'pnpm gen' to regenerate.`,
    '// Do not edit this file by hand, it will be overwritten.',
    "import { Layer } from 'effect'",
    ...imports,
    ...derived.map((entry) => `import { ${entry.name} } from '${entry.specifier}'`),
    ...(configured.length > 0
      ? [
          "import { fileURLToPath } from 'node:url'",
          '',
          '/** where the manifest is, so a plugin can resolve its own relative paths */',
          `const manifestDir = fileURLToPath(new URL('${manifestRelative(resolution, modulePath)}', import.meta.url))`,
        ]
      : []),
    '',
    '/** every plugin in this assembly that ships an Effect runtime */',
    layers.length > 0
      ? `export const pluginLayers = ${composed()}`
      : 'export const pluginLayers = Layer.empty',
    '',
    ...(derived.length > 0
      ? [
          '/** every service a capability in this assembly generated */',
          derived.length === 1
            ? `export const capabilityLayers = ${derived[0]!.name}`
            : `export const capabilityLayers = Layer.mergeAll(${derived.map((entry) => entry.name).join(', ')})`,
          '',
        ]
      : []),
    ...(configured.length > 0
      ? [
          '/**',
          ' * What each plugin was configured with, from the manifest.',
          ' *',
          ' * A literal rather than a lookup: the block is checked against the',
          ' * parameter type the plugin declared, so a manifest that says something',
          ' * the plugin cannot read fails the build instead of at boot.',
          ' */',
          `export const pluginConfig = ${configExpression(configured)}`,
          '',
        ]
      : []),
  ].join('\n')
}

export const writeRuntimeModule = (file: string, resolution: Resolution): boolean =>
  writeAtomic(file, renderRuntimeModule(resolution, file))
