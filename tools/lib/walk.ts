import fs from 'node:fs'
import path from 'node:path'

// Every gate that reads the repository walks it the same way, and each of them
// used to carry its own copy of the rules. They drifted, and one difference
// cost a red run twice: another suite writes a scratch fixture into
// `apps/server/.effect-diagnostics-*` and removes it again, and a walk that
// listed the directory before the removal and read the file after it failed
// with ENOENT in a gate that had nothing to do with it.
//
// So the rule lives once: a source tree has no dot directories and no
// node_modules, and anything under them is somebody else's.

/** every file under dir, minus what is never source */
export function walkFiles(dir: string, skip: readonly string[] = []): string[] {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      const ignored =
        entry.name === 'node_modules' || entry.name.startsWith('.') || skip.includes(entry.name)
      return ignored ? [] : walkFiles(full, skip)
    }
    return [full]
  })
}

/** the same walk, kept to the extensions a typescript source has */
export const walkSources = (dir: string, skip: readonly string[] = []): string[] =>
  walkFiles(dir, skip).filter((file) => /\.tsx?$/.test(file))
