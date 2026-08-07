import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { isPluginDescriptor, Plugin, type PluginDescriptor } from '@qualy/plugin-kit'
import { UiSurfaceDeclarations } from '@qualy/plugin-ui-registry/plugin'
import { currentResolution, resolvePackageDir, resolvePluginModuleUrl } from '@qualy/assembly/host'
import { manifestPath } from '../lib/manifest.ts'

// Ui.react("./client/X.tsx") is a string, and TypeScript resolves modules
// only at real import sites - so on its own, a typo'd path or a module whose
// default export is not a component would surface at boot, or worse, when a
// user opens the page. This check runs inside `pnpm typecheck`: for every
// component reference on every active descriptor it builds the plugin's own
// client program - the client tsconfig, with DOM and jsx - plus one virtual
// assertion file, and lets the compiler answer.
//
// Pages assert `ComponentType<{}>`: the shell mounts them with no props, so
// a page component with required props is a page nobody can render. Layouts,
// slots and login methods receive props from their contracts and assert only
// that the default export is a component at all.

interface Reference {
  pluginId: string
  kind: 'page' | 'component'
  module: string
}

const collectReferences = (pluginId: string, descriptor: PluginDescriptor): Reference[] => {
  const refs: Reference[] = []
  for (const surfaces of Plugin.contributionsOf(descriptor, UiSurfaceDeclarations)) {
    for (const page of surfaces.pages ?? []) {
      refs.push({ pluginId, kind: 'page', module: page.component.module })
    }
    for (const layout of surfaces.layouts ?? []) {
      refs.push({ pluginId, kind: 'component', module: layout.component.module })
    }
    for (const slot of surfaces.slots ?? []) {
      refs.push({ pluginId, kind: 'component', module: slot.component.module })
    }
  }
  return refs
}

const collectDriverReferences = async (
  pluginId: string,
  descriptor: PluginDescriptor,
): Promise<Reference[]> => {
  const { LoginDriverDeclarations } = (await import(
    resolvePluginModuleUrl('@qualy/auth-contract/plugin', manifestPath())
  )) as typeof import('../../packages/contracts/auth/src/plugin.ts')
  return Plugin.contributionsOf(descriptor, LoginDriverDeclarations).flatMap((driver) =>
    driver.presentation.mode === 'component'
      ? [{ pluginId, kind: 'component' as const, module: driver.presentation.component.module }]
      : [],
  )
}

/** the diagnostics for one plugin's references, empty when they all hold */
function checkPlugin(packageDir: string, references: readonly Reference[]): string[] {
  const failures: string[] = []
  const checkable: (Reference & { file: string })[] = []
  for (const reference of references) {
    // relative to src/, where the descriptor that declared it lives
    const file = path.resolve(packageDir, 'src', reference.module)
    if (!file.startsWith(packageDir + path.sep)) {
      failures.push(`${reference.pluginId}: ${reference.module} escapes its package`)
      continue
    }
    if (!fs.existsSync(file)) {
      failures.push(`${reference.pluginId}: ${reference.module} does not exist`)
      continue
    }
    checkable.push({ ...reference, file })
  }
  if (checkable.length === 0) return failures

  const configPath = path.join(packageDir, 'src/client/tsconfig.json')
  if (!fs.existsSync(configPath)) {
    failures.push(
      `${checkable[0]!.pluginId}: declares client components but has no src/client/tsconfig.json`,
    )
    return failures
  }
  const config = ts.getParsedCommandLineOfConfigFile(configPath, undefined, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
      throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
    },
  })!

  // one virtual file asserts every reference; the compiler host serves it
  // from memory so nothing is written into the tree
  const virtualPath = path.join(packageDir, 'src/client/__qualy-component-check__.tsx')
  const lines = ["import type { ComponentType } from 'react'"]
  checkable.forEach((reference, index) => {
    const specifier = `./${path.relative(path.join(packageDir, 'src/client'), reference.file).split(path.sep).join('/')}`
    lines.push(`import component${index} from '${specifier}'`)
    lines.push(
      reference.kind === 'page'
        ? `const check${index}: ComponentType<{}> = component${index} // a page mounts with no props`
        : `const check${index}: ComponentType<never> = component${index}`,
    )
    lines.push(`void check${index}`)
  })
  const virtualSource = lines.join('\n')

  const host = ts.createCompilerHost(config.options)
  const readFile = host.readFile.bind(host)
  const fileExists = host.fileExists.bind(host)
  host.readFile = (file) => (path.resolve(file) === virtualPath ? virtualSource : readFile(file))
  host.fileExists = (file) => path.resolve(file) === virtualPath || fileExists(file)

  const program = ts.createProgram({
    rootNames: [...config.fileNames, virtualPath],
    options: { ...config.options, noEmit: true },
    host,
  })
  const virtualFile = program.getSourceFile(virtualPath)!
  const diagnostics = [
    ...program.getSyntacticDiagnostics(virtualFile),
    ...program.getSemanticDiagnostics(virtualFile),
  ]
  for (const diagnostic of diagnostics) {
    // the failing assertion's line points at the reference it checks
    const line =
      diagnostic.start === undefined
        ? undefined
        : virtualFile.getLineAndCharacterOfPosition(diagnostic.start).line
    const at =
      line === undefined ? undefined : /component(\d+)/.exec(virtualSource.split('\n')[line] ?? '')
    const reference = at ? checkable[Number(at[1])] : undefined
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n  ')
    failures.push(
      reference
        ? `${reference.pluginId}: ${reference.module} (${reference.kind}) - ${message}`
        : `component check: ${message}`,
    )
  }
  return failures
}

/** every broken component reference across the active assembly */
export async function checkClientComponents(): Promise<string[]> {
  const resolution = await currentResolution(manifestPath())
  const byPackage = new Map<string, Reference[]>()
  for (const id of resolution.runtimePlugins) {
    const descriptor = resolution.descriptors.get(id)
    if (!isPluginDescriptor(descriptor)) continue
    const references = [
      ...collectReferences(id, descriptor),
      ...(await collectDriverReferences(id, descriptor)),
    ]
    if (references.length === 0) continue
    const dir = resolvePackageDir(id, manifestPath())
    byPackage.set(dir, [...(byPackage.get(dir) ?? []), ...references])
  }
  const failures: string[] = []
  for (const [dir, references] of byPackage) {
    failures.push(...checkPlugin(dir, references))
  }
  return failures
}
