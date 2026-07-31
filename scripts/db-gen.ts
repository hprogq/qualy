import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { buildAssembly, type Assembly } from './lib/assembly.ts'
import { writeAssemblyArtifacts } from './lib/assembly.ts'
import {
  collectFragments,
  readBehaviorLock,
  validateAgainstLock,
  type Fragment,
} from './lib/behavior.ts'
import { scanDestructive } from './drop-guard.ts'

// the single orchestration entry for everything that changes the migration
// lineage: assembly artifacts, pre-structure behavior fragments, the Kit
// structural diff, post-structure fragments, drop-guard, lock updates.
// Running the segments by hand is not supported.

const migrationsDir = 'db/migrations'
const lockDir = 'generated/.db-gen.lock'

function readArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function listMigrations(): Set<string> {
  if (!fs.existsSync(migrationsDir)) return new Set()
  return new Set(fs.readdirSync(migrationsDir))
}

function runKit(args: string[]): string | undefined {
  const before = listMigrations()
  execSync(`./node_modules/.bin/drizzle-kit ${args.join(' ')}`, { stdio: 'pipe' })
  const after = listMigrations()
  const created = [...after].filter((folder) => !before.has(folder))
  if (created.length > 1) throw new Error(`kit created ${created.length} folders in one invocation`)
  return created[0]
}

// kit folder names carry second-resolution timestamps; keep invocations in
// distinct seconds so lexicographic order stays chronological
function waitTick(): void {
  execSync('sleep 1.1')
}

function compileFragment(fragment: Fragment, assembly: Assembly): string {
  const short = fragment.plugin.replace('@qualy/plugin-', '')
  waitTick()
  const folder = runKit(['generate', '--custom', '--name', `behavior_${short}_${fragment.seq}`])
  if (!folder) throw new Error(`kit did not create a migration for fragment ${fragment.key}`)
  const header = [
    `-- plugin: ${fragment.plugin}`,
    `-- plugin-version: ${fragment.pluginVersion}`,
    `-- source: ${fragment.rel}`,
    `-- source-sha256: ${fragment.sha256}`,
    `-- assembly-sha256: ${assembly.assemblySha256}`,
  ]
  if (fragment.phase === 'manual') {
    header.push('-- manual-review: pending, complete this migration by hand before committing')
  }
  fs.writeFileSync(
    path.join(migrationsDir, folder, 'migration.sql'),
    header.join('\n') + '\n\n' + fragment.sql.trimEnd() + '\n',
  )
  console.log(`compiled ${fragment.key} -> ${folder}`)
  return folder
}

const structuralName = readArg('--name')

fs.mkdirSync(path.dirname(lockDir), { recursive: true })
try {
  fs.mkdirSync(lockDir)
} catch {
  throw new Error('another db:gen run holds the lock; remove generated/.db-gen.lock if it is stale')
}

const created: string[] = []
try {
  const assembly = buildAssembly()
  writeAssemblyArtifacts(assembly, { initEmpty: process.argv.includes('--init-empty') })

  const behaviorLock = readBehaviorLock()
  const fresh = validateAgainstLock(collectFragments(assembly.resolved), behaviorLock)

  for (const fragment of fresh.filter((candidate) => candidate.phase === 'pre-structure')) {
    behaviorLock.fragments[fragment.key] = {
      sha256: fragment.sha256,
      migration: compileFragment(fragment, assembly),
    }
    created.push(behaviorLock.fragments[fragment.key]!.migration)
  }

  waitTick()
  const structural = runKit(['generate', ...(structuralName ? ['--name', structuralName] : [])])
  if (structural) {
    if (!structuralName) {
      fs.rmSync(path.join(migrationsDir, structural), { recursive: true, force: true })
      throw new Error('structural changes detected; migrations must be named, re-run: pnpm db:gen --name <name>')
    }
    const file = path.join(migrationsDir, structural, 'migration.sql')
    fs.writeFileSync(file, `-- assembly-sha256: ${assembly.assemblySha256}\n` + fs.readFileSync(file, 'utf8'))
    created.push(structural)
    console.log(`structural migration ${structural}`)
  }

  for (const fragment of fresh.filter((candidate) => candidate.phase !== 'pre-structure')) {
    behaviorLock.fragments[fragment.key] = {
      sha256: fragment.sha256,
      migration: compileFragment(fragment, assembly),
    }
    created.push(behaviorLock.fragments[fragment.key]!.migration)
  }

  const hits = scanDestructive(created.map((folder) => path.join(migrationsDir, folder, 'migration.sql')))
  if (hits.length > 0 && process.env.ALLOW_DESTRUCTIVE !== '1') {
    for (const folder of created) {
      fs.rmSync(path.join(migrationsDir, folder), { recursive: true, force: true })
    }
    throw new Error(`destructive statements detected, generation rolled back:\n  ${hits.join('\n  ')}`)
  }

  const { writeBehaviorLock } = await import('./lib/behavior.ts')
  writeBehaviorLock(behaviorLock)

  const manual = fresh.filter((fragment) => fragment.phase === 'manual')
  for (const fragment of manual) {
    console.warn(`manual fragment ${fragment.key}: review and complete its migration before committing`)
  }
  if (created.length === 0) console.log('db:gen: no changes')
} catch (error) {
  process.exitCode = 1
  console.error(error instanceof Error ? error.message : error)
} finally {
  fs.rmdirSync(lockDir)
}
