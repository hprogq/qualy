import type { Plugin } from 'vite'

// Two things about the shape of a build that nothing sees until production:
// chunks that import one another, and what the first screen has to download.
// Both are read off the chunk graph before anything ships.
//
// A RING. An ESM graph tolerates a ring of modules: each module's bindings
// exist before any of them runs. A ring of CHUNKS is not the same thing. A
// chunk is many modules laid end to end, and its top-level `var`s are
// assigned only as the chunk runs - so when two chunks import each other,
// whichever the browser reaches first runs second, and it reads the other's
// bindings before they hold anything. Which one is reached first depends on
// which request answered first, which depends on what the browser already
// had in its cache. v0.1.0-rc.2 and rc.3 shipped two such rings; one
// visitor's browser reached the assessment contract after the chunk holding
// its error schemas, and every page after sign-in failed with "can't access
// property "ast", e is undefined" while a fresh browser worked.
//
// THE FIRST SCREEN is everything the entry imports statically, because the
// browser fetches all of it before the shell runs. The same builds carried
// the formula editor's whole library there - 2.7 MB that only an editing
// page uses, on every visitor's first load, including the sign-in page -
// because a dozen one-kilobyte modules the shell needs had been pooled into
// the editor's chunk. A ceiling on that weight is how such a pooling fails
// the build instead of every visitor's first load.

/** every set of chunks that reach one another through static imports */
export const chunkRings = (imports: ReadonlyMap<string, readonly string[]>): string[][] => {
  // Tarjan's strongly connected components; a component of two or more
  // chunks is a ring
  let next = 0
  const index = new Map<string, number>()
  const lowest = new Map<string, number>()
  const stack: string[] = []
  const onStack = new Set<string>()
  const rings: string[][] = []
  const visit = (chunk: string) => {
    index.set(chunk, next)
    lowest.set(chunk, next)
    next += 1
    stack.push(chunk)
    onStack.add(chunk)
    for (const target of imports.get(chunk) ?? []) {
      // an import of something that is not a chunk of this bundle is external
      if (!imports.has(target)) continue
      if (!index.has(target)) {
        visit(target)
        lowest.set(chunk, Math.min(lowest.get(chunk)!, lowest.get(target)!))
      } else if (onStack.has(target)) {
        lowest.set(chunk, Math.min(lowest.get(chunk)!, index.get(target)!))
      }
    }
    if (lowest.get(chunk) !== index.get(chunk)) return
    const component: string[] = []
    let member: string
    do {
      member = stack.pop()!
      onStack.delete(member)
      component.push(member)
    } while (member !== chunk)
    if (component.length > 1) rings.push(component.sort())
  }
  for (const chunk of [...imports.keys()].sort()) if (!index.has(chunk)) visit(chunk)
  return rings
}

/** the chunks these reach through static imports, themselves included */
export const staticClosure = (
  imports: ReadonlyMap<string, readonly string[]>,
  roots: readonly string[],
): Set<string> => {
  const reached = new Set<string>()
  const visit = (chunk: string) => {
    if (reached.has(chunk) || !imports.has(chunk)) return
    reached.add(chunk)
    for (const target of imports.get(chunk)!) visit(target)
  }
  for (const root of roots) visit(root)
  return reached
}

/** a module id as a reader of the error can find it: repository-relative, no loader prefix */
const readable = (id: string, root: string): string =>
  id.replace(/^\0/, '').replace(root.endsWith('/') ? root : `${root}/`, '')

const kib = (bytes: number) => `${(bytes / 1024).toFixed(0)} KiB`

/**
 * The vite plugin that fails a build whose chunks import one another, or
 * whose first screen weighs more than `bootBudget` bytes before compression.
 */
export const qualyChunkGraph = (options: { root: string; bootBudget: number }): Plugin => ({
  name: 'qualy-chunk-graph',
  apply: 'build',
  // after vite's own plugins have finished writing the chunks
  enforce: 'post',
  generateBundle(_options, bundle) {
    const imports = new Map<string, readonly string[]>()
    const modules = new Map<string, readonly string[]>()
    const bytes = new Map<string, number>()
    const entries: string[] = []
    for (const output of Object.values(bundle)) {
      if (output.type !== 'chunk') continue
      imports.set(output.fileName, output.imports)
      modules.set(output.fileName, Object.keys(output.modules))
      bytes.set(output.fileName, Buffer.byteLength(output.code))
      if (output.isEntry) entries.push(output.fileName)
    }
    // Named by the modules in them: the file names are content hashes, and
    // what someone fixing this needs is which of their modules ended up where.
    const contents = (chunk: string) => {
      const ids = modules.get(chunk) ?? []
      const own = ids
        .filter((id) => !id.includes('/node_modules/'))
        .map((id) => readable(id, options.root))
      const packages = new Set(
        ids
          .filter((id) => id.includes('/node_modules/'))
          .map((id) => /.*\/node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(id)![1]!),
      )
      const named = [...own.slice(0, 5), ...[...packages].slice(0, 3)]
      const more = own.length + packages.size - named.length
      return named.join(', ') + (more > 0 ? `, and ${String(more)} more` : '')
    }
    const refusals: string[] = []

    const rings = chunkRings(imports)
    if (rings.length > 0) {
      refusals.push(
        `${String(rings.length)} set(s) of chunks import one another, so the order they run in depends on the network:\n` +
          rings
            .map(
              (ring, at) =>
                `  ring ${String(at + 1)}:\n` +
                ring.map((chunk) => `    ${chunk}: ${contents(chunk)}`).join('\n'),
            )
            .join('\n'),
      )
    }

    const boot = [...staticClosure(imports, entries)].sort((a, b) => bytes.get(b)! - bytes.get(a)!)
    const weight = boot.reduce((sum, chunk) => sum + bytes.get(chunk)!, 0)
    if (weight > options.bootBudget) {
      refusals.push(
        `the first screen imports ${kib(weight)} before compression, over its ${kib(options.bootBudget)} budget; the heaviest:\n` +
          boot
            .slice(0, 5)
            .map((chunk) => `    ${chunk} (${kib(bytes.get(chunk)!)}): ${contents(chunk)}`)
            .join('\n'),
      )
    }

    if (refusals.length > 0) {
      this.error(
        `${refusals.join('\n')}\n  Change how apps/web/vite.config.ts pools modules; the reasons are in packages/build/web/src/chunk-graph.ts.`,
      )
    }
  },
})
