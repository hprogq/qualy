import fs from 'node:fs'
import path from 'node:path'
import {
  capabilityModules,
  lockFromResolution,
  renderLock,
  writeAtomic,
  type Resolution,
} from '@qualy/assembly'

// What a resolution owns on disk: the manifest that selected it, the lock,
// and whatever the capabilities derive.
//
// Two commands write these - `resolve`, and every `plugin` command that
// changes the selection - and they have to write the same set. The frozen
// gate compares the lock AND the derived modules, so a command that wrote
// only the lock would leave the next gated command failing with a drift error
// whose prescribed fix is `qualy resolve`, changing nothing.
//
// Which is also why they are written as a SET. `writeAtomic` makes one file's
// write all-or-nothing; it says nothing about four of them. A command that
// wrote the manifest, wrote the lock and then failed on the second derived
// module used to leave a tree carrying a new selection, a new lock and half
// the modules of each - the exact state the frozen gate exists to catch, with
// no command able to fix it, because every one of them is gated on it.

/** short where short is readable, and absolute where it would climb out */
export const relativeToCwd = (file: string) => {
  const relative = path.relative(process.cwd(), file)
  return relative.startsWith('..') ? file : relative
}

/**
 * Files written together, or not at all.
 *
 * An undo log rather than a two-phase commit: each write remembers the bytes
 * it replaced (or that there were none), and `rollback` puts them back newest
 * first. A rollback leaves behind any directory a write had to create, which
 * is the one thing it does not undo - an empty directory is not a state any
 * reader of these files can tell from its absence.
 */
export interface FileSet {
  /** write one file now, remembering what was there; false when it already said this */
  write(file: string, content: string): boolean
  /** put every file this set wrote back the way it found it */
  rollback(): void
  /** the files it actually changed, in the order it changed them */
  readonly written: readonly string[]
}

export function openFileSet(): FileSet {
  const undo: { file: string; before: string | undefined }[] = []
  const written: string[] = []
  return {
    get written() {
      return written
    },
    write(file, content) {
      const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : undefined
      if (before === content) return false
      // recorded BEFORE the write: a write that throws half way through is
      // the case this exists for, and an undo entry added afterwards would
      // be the one entry missing exactly then
      undo.push({ file, before })
      writeAtomic(file, content)
      written.push(file)
      return true
    },
    rollback() {
      for (const entry of [...undo].reverse()) {
        if (entry.before === undefined) fs.rmSync(entry.file, { force: true })
        else writeAtomic(entry.file, entry.before)
      }
      undo.length = 0
      written.length = 0
    },
  }
}

/** every file this resolution owns, with the content it should have */
export function resolutionFiles(
  resolution: Resolution,
  options: { readonly lockPath: string; readonly manifestPath: string },
): { file: string; content: string }[] {
  // capability-derived modules land relative to the manifest, like every
  // other generated artifact; QUALY_GEN_OUT redirects a test run's tree
  const out = process.env.QUALY_GEN_OUT ?? path.dirname(options.manifestPath)
  return [
    { file: options.lockPath, content: renderLock(lockFromResolution(resolution)) },
    ...capabilityModules(resolution).map((module) => ({
      file: path.resolve(out, module.path),
      content: module.content,
    })),
  ]
}

/** writes them into the given set, and says which ones changed */
export function writeResolution(
  resolution: Resolution,
  options: { readonly lockPath: string; readonly manifestPath: string; readonly files: FileSet },
): string[] {
  const said: string[] = []
  for (const { file, content } of resolutionFiles(resolution, options)) {
    const changed = options.files.write(file, content)
    // the lock is named either way: "unchanged" is the answer a caller of
    // `resolve` came for, and a derived module nobody touched is noise
    if (changed) said.push(`${relativeToCwd(file)} written`)
    else if (file === options.lockPath) said.push(`${relativeToCwd(file)} unchanged`)
  }
  return said
}
