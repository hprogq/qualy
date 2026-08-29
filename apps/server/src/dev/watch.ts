import path from 'node:path'
import chokidar, { type FSWatcher } from 'chokidar'
import type { DevServiceSpec } from '@qualy/plugin-kit/dev'
import type { PluginRoot } from './protocol.ts'

// What a saved file means (docs/runtime-redesign.md §20, §21).
//
// Not an import graph. Working out which running process actually depends on
// a file means resolving every module in the repository on every save, and
// the answer would still be wrong the moment somebody adds an import. So the
// rule is the directory convention this repository already keeps, read
// conservatively: anything a rule does not recognise costs a full session
// rather than being ignored.
//
// Being wrong in the cautious direction is cheap and being wrong in the other
// direction is not. A save misread as "browser only" leaves a backend running
// code that no longer exists on disk, and nothing says so; a save misread as
// structural costs a few seconds. The supervisor also checks the answer after
// the fact: a candidate reports its own topology, and the host promotes a
// backend-only reload to a session if that topology turns out to have moved.

/** what a batch of saved files asks for, in the order they override */
export type Action = 'backend' | { readonly service: string } | 'session'

const rank = (action: Action): number => (action === 'session' ? 2 : 1)

const same = (a: Action, b: Action): boolean =>
  typeof a === 'object' || typeof b === 'object'
    ? typeof a === 'object' && typeof b === 'object' && a.service === b.service
    : a === b

/** the higher of two demands: a session subsumes everything smaller */
export const merge = (a: Action | null, b: Action | null): Action | null => {
  if (a === null) return b
  if (b === null) return a
  if (rank(b) > rank(a)) return b
  if (rank(a) > rank(b)) return a
  // Same rank and not the same demand. A backend replacement and a service
  // replacement do not subsume one another, and neither does one service
  // replace another, so there is no answer here that keeps both - and this
  // type has no way to say "both". It escalates, which is the cautious
  // direction this file's header asks for.
  //
  // It used to return `a`, and that silently dropped whichever demand arrived
  // second. Measured: `merge({service}, 'backend')` returned the service and
  // threw the backend away, which is the expensive direction exactly - a
  // backend left serving code that is no longer on disk, with nothing said.
  return same(a, b) ? a : 'session'
}

export interface WatchPlan {
  /** the assembly's own inputs, watched whether or not they exist yet */
  readonly bootstrap: readonly string[]
  readonly roots: readonly PluginRoot[]
  readonly services: readonly DevServiceSpec[]
  readonly repoRoot: string
}

const inside = (file: string, dir: string) => file === dir || file.startsWith(`${dir}${path.sep}`)

/**
 * What the watcher never descends into.
 *
 * A predicate, not a glob. Chokidar dropped glob support in 4, and a glob
 * passed to `ignored` there is taken as a literal path - which silently
 * ignores nothing, so the watcher walks into every package's `node_modules`
 * and opens a file handle per directory until the process cannot fork a
 * child any more. It did: the first save after startup failed with EMFILE,
 * and what it looked like was the supervisor failing to spawn a backend.
 */
const NEVER_WATCHED = new Set([
  'node_modules',
  '.git',
  'dist',
  'client-dist',
  '.qualy',
  '__screenshots__',
  '__snapshots__',
  'coverage',
])

const ignored = (file: string): boolean =>
  file.endsWith('.log') || file.split(path.sep).some((part) => NEVER_WATCHED.has(part))

/**
 * What a saved file asks the supervisor to do, or nothing.
 *
 * Nothing means the browser's own dev server has it: its module graph is its
 * business, and a page's source is exactly what hot reload exists for.
 */
export const classify = (file: string, plan: WatchPlan): Action | 'restart-host' | null => {
  const posix = file.split(path.sep).join('/')
  if (plan.bootstrap.includes(file)) return 'session'

  // the supervisor's own code: it cannot replace itself, and pretending to
  // would leave the person wondering why their change did nothing
  if (posix.includes('/apps/server/src/dev/')) return 'restart-host'
  if (posix.includes('/apps/server/src/')) return 'backend'
  if (posix.includes('/db/migrations/')) return 'backend'

  // the browser application and the packages only it imports
  if (posix.includes('/packages/web/')) return null
  if (posix.endsWith('/apps/web/vite.config.ts')) {
    const web = plan.services.find((service) => service.id === 'web')
    return web === undefined ? 'session' : { service: web.key }
  }
  if (posix.includes('/apps/web/')) return null

  // the kernel and the contracts every side reads: low frequency, and a
  // change to either can move what the browser and the server agree on
  if (posix.includes('/packages/core/') || posix.includes('/packages/contracts/')) return 'session'
  if (posix.includes('/packages/build/')) return 'session'

  const owner = plan.roots.find((root) => inside(file, root.root))
  if (owner === undefined) return null
  const within = file
    .slice(owner.root.length + 1)
    .split(path.sep)
    .join('/')
  if (within === 'package.json') return 'session'
  if (!within.startsWith('src/')) return null
  if (within.startsWith('src/client/')) return null
  if (within.startsWith('src/dev/')) {
    const service = plan.services.find((one) => one.pluginId === owner.id)
    return service === undefined ? 'session' : { service: service.key }
  }
  if (within.startsWith('src/server/')) return 'backend'
  // the descriptor itself, and anything shared between the halves: either can
  // move what services exist or what the browser is built from
  return 'session'
}

/**
 * Everything worth watching, including files that do not exist yet.
 *
 * A manifest path named in `.env` but not yet created is exactly the case
 * that has to be watched: the candidate fails, the old world keeps serving,
 * and the moment somebody creates the file it should be tried again.
 */
export const watchTargets = (plan: WatchPlan): readonly string[] => [
  ...plan.bootstrap,
  // a plugin's sources and the manifest that declares it; its tests and its
  // build output are not inputs to anything running
  ...plan.roots
    .filter((root) => root.linked)
    .flatMap((root) => [path.join(root.root, 'src'), path.join(root.root, 'package.json')]),
  path.join(plan.repoRoot, 'apps/server/src'),
  path.join(plan.repoRoot, 'packages/core'),
  path.join(plan.repoRoot, 'packages/contracts'),
  path.join(plan.repoRoot, 'packages/build'),
  path.join(plan.repoRoot, 'db/migrations'),
  path.join(plan.repoRoot, 'apps/web/vite.config.ts'),
]

/**
 * One batched answer per burst of saves.
 *
 * Editors write more than once for one save - a temp file, a rename, a
 * truncate and a write - and a formatter on save turns one keystroke into a
 * second burst. Each would otherwise start staging a candidate that the next
 * one immediately supersedes, which is work nobody asked for and log noise
 * that hides the run that mattered.
 */
export const watch = (
  plan: WatchPlan,
  onBatch: (action: Action | 'restart-host', files: readonly string[]) => void,
  onError: (message: string) => void = () => {},
): FSWatcher => {
  const watcher = chokidar.watch([...watchTargets(plan)], { ignored, ignoreInitial: true })
  // An EventEmitter that emits `error` with nobody listening throws, and this
  // one has real reasons to: a watched directory removed under it, a platform
  // descriptor limit, a permission change. Without this, any of them ends the
  // whole development session with a raw stack from a file watcher.
  watcher.on('error', (error: unknown) =>
    onError(`watching files failed: ${error instanceof Error ? error.message : String(error)}`),
  )
  let pending: Action | 'restart-host' | null = null
  let files: string[] = []
  let timer: NodeJS.Timeout | null = null
  const saw = (file: string) => {
    const asked = classify(path.resolve(file), plan)
    if (asked === null) return
    files.push(file)
    pending =
      pending === 'restart-host' || asked === 'restart-host'
        ? 'restart-host'
        : merge(pending, asked)
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => {
      const action = pending
      const batch = files
      pending = null
      files = []
      timer = null
      if (action !== null) onBatch(action, batch)
    }, 150)
  }
  for (const event of ['add', 'change', 'unlink', 'addDir', 'unlinkDir'] as const) {
    watcher.on(event, (file: string) => saw(file))
  }
  return watcher
}
