import path from 'node:path'
import {
  capabilityModules,
  lockFromResolution,
  writeAtomic,
  writeLock,
  type Resolution,
} from '@qualy/assembly'

// What a resolution owns on disk: the lock, and whatever the capabilities
// derive from it.
//
// Two commands write these now - `resolve`, and every `plugin` command that
// changes the selection - and they have to write the same set. The frozen
// gate compares the lock AND the derived modules, so a command that wrote
// only the lock would leave the next gated command failing with a drift error
// whose prescribed fix is `qualy resolve`, changing nothing.

/** short where short is readable, and absolute where it would climb out */
export const relativeToCwd = (file: string) => {
  const relative = path.relative(process.cwd(), file)
  return relative.startsWith('..') ? file : relative
}

/** writes them, and says which ones changed */
export function writeResolution(
  resolution: Resolution,
  options: { readonly lockPath: string; readonly manifestPath: string },
): string[] {
  const written = [
    writeLock(options.lockPath, lockFromResolution(resolution))
      ? `${relativeToCwd(options.lockPath)} written`
      : `${relativeToCwd(options.lockPath)} unchanged`,
  ]
  // capability-derived modules land relative to the manifest, like every
  // other generated artifact; QUALY_GEN_OUT redirects a test run's tree
  const out = process.env.QUALY_GEN_OUT ?? path.dirname(options.manifestPath)
  for (const module of capabilityModules(resolution)) {
    const file = path.resolve(out, module.path)
    if (writeAtomic(file, module.content)) written.push(`${relativeToCwd(file)} written`)
  }
  return written
}
