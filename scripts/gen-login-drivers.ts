import fs from 'node:fs'
import path from 'node:path'
import { writeGenerated } from './lib/codegen.ts'
import { readEntries } from './lib/read-entries.ts'
import { resolvePackageDir, resolvePluginModuleUrl } from './lib/packages.ts'

// The login drivers, pulled instead of pushed, for the same reason the
// permission catalog is.
//
// A driver used to register itself into the core from its own constructor. A
// static graph cannot express that: the core would have to be built after
// every driver to be complete, and before them to answer their calls.
//
// The active set, deliberately: a disabled driver must stop offering a way in.

const drivers: string[] = []
const imports: string[] = []
const claimed = new Map<string, string>()

for (const entry of (await readEntries({ all: false })).filter((e) =>
  e.name.startsWith('@qualy/'),
)) {
  const packageDir = resolvePackageDir(entry.name)
  const pkg = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8')) as {
    exports?: Record<string, unknown>
    qualy?: { loginDriver?: { entry?: string } }
  }
  const declared = pkg.qualy?.loginDriver?.entry
  if (!declared) continue
  const exported = pkg.exports?.['./login-driver']
  if (typeof exported !== 'string' || path.normalize(exported) !== path.normalize(declared)) {
    throw new Error(
      `${entry.name}: qualy.loginDriver.entry and exports["./login-driver"] must point at the same file`,
    )
  }
  const owner = entry.name.split('/').pop()!.replace(/^plugin-/, '')
  const alias = `${owner.replace(/[^a-zA-Z0-9]+(.)/g, (_m, c: string) => c.toUpperCase())}Driver`

  // A provider type claimed twice has no owner, and a login would be proved by
  // whichever driver registered last. The runtime registry throws on this
  // today; catching it here moves the failure to whoever assembles the
  // release, before anything is deployed.
  const module = (await import(resolvePluginModuleUrl(`${entry.name}/login-driver`))) as {
    driver?: { type?: string }
  }
  const type = module.driver?.type
  if (typeof type !== 'string' || type.length === 0) {
    throw new Error(`${entry.name}/login-driver must export a driver with a type`)
  }
  const previous = claimed.get(type)
  if (previous) throw new Error(`duplicate login driver type ${type}: ${previous} and ${owner}`)
  claimed.set(type, owner)

  imports.push(`import { driver as ${alias} } from '${entry.name}/login-driver'`)
  drivers.push(`  ${alias},`)
}

writeGenerated(
  'packages/app/login-drivers.gen.ts',
  [
    "import type { LoginDriver } from '@qualy/auth-contract/login'",
    ...imports,
    '',
    '/** every login driver this assembly serves */',
    drivers.length > 0
      ? `export const loginDrivers: readonly LoginDriver[] = [\n${drivers.join('\n')}\n]`
      : 'export const loginDrivers: readonly LoginDriver[] = []',
  ].join('\n'),
)

export {}
