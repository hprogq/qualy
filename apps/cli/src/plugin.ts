import fs from 'node:fs'
import { editManifest, lockPathFor, readLock, resolveAssembly } from '@qualy/assembly'
import { resolvePackageDir } from '@qualy/assembly/host'
import { openFileSet, relativeToCwd, writeResolution } from './resolution.ts'

// Managing the selection: what this deployment runs, and what it keeps.
//
// The four verbs are the whole product surface of the plugin system. They are
// the lifecycle's own, not a plugin's: `qualy plugin add` has to work on an
// assembly that contains nothing yet, and on one whose lock is out of date -
// it is the command that makes the lock current, so it cannot be behind the
// gate that demands a current one.
//
// Nothing here knows a plugin name, a scope or a directory layout. A package
// is found the way any dependency is found, through the workspace the
// manifest names, and what it is is read off its own descriptor. Adding a
// plugin from outside this repository is therefore the same command as adding
// one from inside it, and neither writes a line of this application's source.
//
// Two properties the tests hold:
//
//   Nothing is half-applied. The manifest, the lock and every module a
//   capability derives are one file set: they are written together and, if
//   anything at all refuses - the package is not installed, its descriptor
//   calls itself something else, two plugins claim one capability, a write
//   fails on the disk - every one of them goes back to the bytes it had. A
//   refused command leaves a tree that still resolves.
//
//   Nothing is dropped. `disable` and `remove` take a plugin off the runtime
//   and out of the selection; neither touches a table. A capability that has
//   something of the plugin's says so at resolve time, and the plugin stays in
//   the lock as `detached` so the next generation still accounts for it.
//   Deleting data is a separate, destructive verb that does not exist yet.

const VERBS = ['add', 'enable', 'disable', 'remove'] as const
type Verb = (typeof VERBS)[number]

export const PLUGIN_USAGE = [
  '  pnpm qualy plugin add <package>',
  '  pnpm qualy plugin enable <package>',
  '  pnpm qualy plugin disable <package>',
  '  pnpm qualy plugin remove <package>',
].join('\n')

const isVerb = (value: string | undefined): value is Verb => VERBS.includes(value as Verb)

/**
 * Every command here changes the assembly, and the browser half of a
 * deployment is built from the active assembly rather than from a superset -
 * so the artifact a running deployment serves is now out of date.
 */
const REBUILD = 'the web release is built from the active assembly; deploy a rebuilt one'

export async function runPluginCommand(
  argv: readonly string[],
  options: { readonly manifestPath: string },
): Promise<void> {
  const [verb, id] = argv
  if (!isVerb(verb) || !id) {
    throw new Error(`usage:\n${PLUGIN_USAGE}`)
  }
  const { manifestPath } = options
  const lockPath = lockPathFor(manifestPath)
  const edit = editManifest(fs.readFileSync(manifestPath, 'utf8'), manifestPath)

  if (verb === 'add') {
    if (edit.has(id)) {
      throw new Error(
        `${id} is already in ${relativeToCwd(manifestPath)}` +
          (edit.isEnabled(id) ? '' : `, disabled; \`qualy plugin enable ${id}\` turns it back on`),
      )
    }
    // asked before anything is written, because "not installed" is the common
    // mistake and deserves an answer that names the package manager rather
    // than a resolution failure from inside the assembly
    try {
      resolvePackageDir(id, manifestPath)
    } catch (error) {
      throw new Error(
        `${id} is not installed where this manifest's plugins resolve from; install it there first`,
        { cause: error },
      )
    }
    edit.add(id)
  } else if (verb === 'remove') {
    if (!edit.has(id)) throw new Error(`${id} is not in ${relativeToCwd(manifestPath)}`)
    edit.remove(id)
  } else {
    const enabled = verb === 'enable'
    if (!edit.has(id)) {
      throw new Error(
        `${id} is not in ${relativeToCwd(manifestPath)}; \`qualy plugin add ${id}\` puts it there`,
      )
    }
    if (edit.isEnabled(id) === enabled) {
      console.log(`${id} is already ${enabled ? 'enabled' : 'disabled'}; nothing to do`)
      return
    }
    edit.setEnabled(id, enabled)
  }

  // read before the manifest moves under it: the lock this resolution builds
  // on is the one that was there when the command started
  const previousLock = readLock(lockPath)
  const files = openFileSet()
  let resolution
  let said: string[]
  try {
    files.write(manifestPath, edit.toString())
    resolution = await resolveAssembly({ manifestPath, previousLock })
    said = writeResolution(resolution, { lockPath, manifestPath, files })
  } catch (error) {
    // the selection this command proposed cannot be written whole, so it was
    // never a selection: put every file back rather than leave a tree whose
    // manifest, lock and derived modules disagree
    files.rollback()
    throw new Error(
      `${verb} ${id} refused, ${relativeToCwd(manifestPath)} unchanged: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    )
  }

  console.log(`${relativeToCwd(manifestPath)} written`)
  for (const line of said) console.log(line)

  if (verb === 'remove') {
    const kept = resolution.plugins.get(id)
    console.log(
      kept === undefined
        ? `${id} left the assembly; its package is still installed, and nothing of it was deleted`
        : `${id} is ${kept.state}, kept by ${(kept.retainedBy ?? []).join(', ')}; its data is untouched`,
    )
  } else {
    const state = resolution.plugins.get(id)?.state ?? 'unknown'
    console.log(`${id} is ${state}`)
  }
  console.log(REBUILD)
}
