import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { isPluginDescriptor, Plugin, type PluginDescriptor } from '@qualy/plugin-kit'
import { UiSurfaceDeclarations } from '@qualy/plugin-ui-registry/plugin'
import { currentResolution, resolvePackageDir, resolvePluginModuleUrl } from '@qualy/assembly/host'
import { manifestPath } from '../lib/manifest.ts'

// Ui.react("./client/X.tsx") is a string, and TypeScript resolves modules
// only at real import sites - so on its own, a typo'd path or a module whose
// default export is not a component would surface at boot, or worse, when a
// user opens the page. This check runs inside `pnpm typecheck`: for every
// component reference on every active descriptor it writes one assertion file
// into the plugin's own client directory - the client tsconfig, with DOM and
// jsx, already covers it - runs the compiler over that project, and reads back
// only the diagnostics that landed on the assertion file.
//
// The compiler is the `tsc` binary rather than a compiler API: TypeScript 7 is
// a native executable and no longer ships the JS `createProgram` surface the
// in-memory version of this check used.
//
// Pages assert `ComponentType<{}>`: the shell mounts them with no props, so
// a page component with required props is a page nobody can render. Layouts,
// slots and login methods receive props from their contracts and assert only
// that the default export is a component at all.

/** transient, and named so a stray copy is obviously not source */
const ASSERTION_FILE = '__qualy-component-check__.tsx'
const TSC = path.resolve('node_modules/.bin/tsc')

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

  const clientDir = path.join(packageDir, 'src/client')
  if (!fs.existsSync(path.join(clientDir, 'tsconfig.json'))) {
    failures.push(
      `${checkable[0]!.pluginId}: declares client components but has no src/client/tsconfig.json`,
    )
    return failures
  }

  const lines = ["import type { ComponentType } from 'react'"]
  checkable.forEach((reference, index) => {
    const specifier = `./${path.relative(clientDir, reference.file).split(path.sep).join('/')}`
    lines.push(`import component${index} from '${specifier}'`)
    lines.push(
      reference.kind === 'page'
        ? `const check${index}: ComponentType<{}> = component${index} // a page mounts with no props`
        : `const check${index}: ComponentType<never> = component${index}`,
    )
    lines.push(`void check${index}`)
  })
  const source = lines.join('\n')

  const assertions = path.join(clientDir, ASSERTION_FILE)
  fs.writeFileSync(assertions, `${source}\n`)
  let output: string
  try {
    execFileSync(TSC, ['-p', clientDir, '--noEmit', '--pretty', 'false'], {
      encoding: 'utf8',
      stdio: 'pipe',
    })
    output = ''
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string }
    output = `${failure.stdout ?? ''}${failure.stderr ?? ''}`
  } finally {
    fs.rmSync(assertions, { force: true })
  }

  // the project's own errors are reported by its own typecheck pass; only what
  // landed on the assertion file says anything about a component reference
  const relative = path.relative(process.cwd(), assertions)
  for (const line of output.split('\n')) {
    if (!line.startsWith(`${relative}(`) && !line.startsWith(`${assertions}(`)) continue
    const at = /\((\d+),\d+\): [a-z]+ [A-Z]+\d+: (.*)$/.exec(line)
    if (at === null) continue
    // the failing assertion's line names the reference it checks
    const named = /component(\d+)/.exec(source.split('\n')[Number(at[1]) - 1] ?? '')
    const reference = named ? checkable[Number(named[1])] : undefined
    failures.push(
      reference
        ? `${reference.pluginId}: ${reference.module} (${reference.kind}) - ${at[2]}`
        : `component check: ${at[2]}`,
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
