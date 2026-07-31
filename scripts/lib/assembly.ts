import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { writeGenerated } from './codegen.ts'
import { loadInstalled, type ResolvedPlugin } from './installed.ts'

export interface AssemblyPlugin {
  id: string
  version: string
  schemaEntry: string
  schemaHash: string
  behaviorHash: string | null
  dependsOn: string[]
}

export interface Assembly {
  assemblySha256: string
  plugins: AssemblyPlugin[]
  schemaEntries: string[]
  resolved: ResolvedPlugin[]
}

function sha256(input: string | Buffer): string {
  return crypto.createHash('sha256').update(input).digest('hex')
}

// deterministic content hash of a directory: sorted relative paths, each
// mixed in as "<path>\0<bytes>\0"
export function hashDir(dir: string): string {
  if (!fs.existsSync(dir)) return sha256('')
  const files: string[] = []
  const walk = (current: string) => {
    for (const child of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(current, child.name)
      if (child.isDirectory()) walk(full)
      else files.push(full)
    }
  }
  walk(dir)
  const hash = crypto.createHash('sha256')
  for (const file of files) {
    hash.update(path.relative(dir, file))
    hash.update('\0')
    hash.update(fs.readFileSync(file))
    hash.update('\0')
  }
  return hash.digest('hex')
}

export function buildAssembly(): Assembly {
  const resolved = loadInstalled()
  const repoRoot = fs.realpathSync(process.cwd())
  const plugins = resolved
    .filter((plugin) => plugin.database)
    .map((plugin) => ({
      id: plugin.id,
      version: plugin.packageVersion,
      schemaEntry: path
        .relative(repoRoot, plugin.database!.schemaEntryFile)
        .split(path.sep)
        .join('/'),
      schemaHash: hashDir(path.dirname(plugin.database!.schemaEntryFile)),
      behaviorHash: plugin.database!.behaviorDirPath
        ? hashDir(plugin.database!.behaviorDirPath)
        : null,
      dependsOn: plugin.dependsOn,
    }))
  return {
    assemblySha256: sha256(JSON.stringify(plugins)),
    plugins,
    schemaEntries: plugins.map((plugin) => plugin.schemaEntry),
    resolved,
  }
}

export function writeAssemblyArtifacts(
  assembly: Assembly,
  options: { initEmpty?: boolean } = {},
): void {
  if (assembly.plugins.length === 0 && !options.initEmpty) {
    throw new Error(
      'the installed set contributes no database schema; pass --init-empty if this is intentional',
    )
  }
  const body = [
    'export const schemaEntries: string[] = [',
    ...assembly.schemaEntries.map((entry) => `  '${entry}',`),
    ']',
  ].join('\n')
  writeGenerated('generated/db/assembly.gen.ts', body, { source: 'installed.lock.json' })
  writeAssemblyLock(assembly)
}

export function writeAssemblyLock(assembly: Assembly): void {
  const file = 'assembly.lock.json'
  const content =
    JSON.stringify(
      {
        assemblySha256: assembly.assemblySha256,
        plugins: assembly.plugins,
      },
      null,
      2,
    ) + '\n'
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === content) {
    console.log(`${file} unchanged, skipped`)
    return
  }
  fs.writeFileSync(file, content)
  console.log(`${file} written`)
}
