import { parsePath, type HistoryRouterProps, type Path, type To } from 'react-router'

// The one place every move inside the application passes: the history the
// router reads and writes.
//
// A page with unsaved changes has to be asked before it is left, however the
// reader leaves it - a rail entry, a link in the text, a button that
// navigates, the browser's own back. Every one of those ends in this
// history's push, replace or pop, so a guard stood here sees them all
// without any of them knowing it exists; a guard in each link would miss
// the one nobody thought of.
//
// Pushes and replaces are simply not passed on while held. A pop has already
// happened by the time anybody hears of it - the browser moved first - so it
// is undone at once, and the router, which was never told, never moves; if
// the reader then chooses to go, the same step is taken again. This is what
// react-router's own blocker does for a data router (lib/router/router.js,
// the history listener in `initialize`), done here for the declarative
// router this product uses.

type History = HistoryRouterProps['history']
type Listener = Parameters<History['listen']>[0]

/** a page's say in whether a move would lose something */
export interface LeaveGuard {
  /** whether moving from `from` to `to` leaves what is guarded */
  readonly blocks: (from: Path, to: Path) => boolean
  /** saves what would be lost; true once leaving is safe */
  readonly save?: () => Promise<boolean> | boolean
}

/** a move that is waiting for the reader's answer */
export interface HeldLeave {
  readonly guard: LeaveGuard
  readonly to: Path
}

export interface LeaveGate {
  /** the history to hand the router */
  readonly history: History
  /** stands a guard at the gate until the returned function takes it away */
  readonly guard: (guard: LeaveGuard) => () => void
  /** makes a move no guard is asked about: one the page itself decided on */
  readonly bypass: (move: () => void) => void
  /** the move waiting for an answer, if one is */
  readonly held: () => HeldLeave | null
  readonly subscribe: (listener: () => void) => () => void
  /** the reader stays: the held move is dropped */
  readonly stay: () => void
  /**
   * The reader goes: the held move is made. Named, for an answer that took
   * a while - a save - by which time the question may have been put away.
   */
  readonly leave: (move?: HeldLeave) => void
}

export function createLeaveGate(base: History): LeaveGate {
  const guards = new Set<LeaveGuard>()
  const watchers = new Set<() => void>()
  // how to make each held move once the reader says go
  const replays = new WeakMap<HeldLeave, () => void>()
  let held: HeldLeave | null = null
  // where the router is, which after a held pop is not where the base is
  let shown: Path = base.location
  // moves the page made itself, while they are being made
  let passing = 0
  // the pop that undoes a held one, on its way back
  let undoing: (() => void) | null = null
  // a pop nobody is asked about: a held one taken again, or one the page
  // made itself past the guards
  let waved = false

  const notify = () => {
    for (const watcher of watchers) watcher()
  }
  const hold = (next: HeldLeave | null, replay?: () => void) => {
    if (next !== null && replay !== undefined) replays.set(next, replay)
    held = next
    notify()
  }
  const blocker = (to: Path): LeaveGuard | undefined => {
    if (passing > 0) return undefined
    for (const guard of guards) if (guard.blocks(shown, to)) return guard
    return undefined
  }
  const pathOf = (to: To): Path => {
    const path = typeof to === 'string' ? parsePath(to) : to
    return {
      pathname: path.pathname ?? shown.pathname,
      search: path.search ?? '',
      hash: path.hash ?? '',
    }
  }
  const guarded =
    (move: 'push' | 'replace') =>
    (to: To, state?: unknown): void => {
      const target = pathOf(to)
      const guard = blocker(target)
      if (guard === undefined) {
        base[move](to, state)
        return
      }
      hold({ guard, to: target }, () => base[move](to, state))
    }

  const history: History = {
    get action() {
      return base.action
    },
    get location() {
      return base.location
    },
    createHref: (to) => base.createHref(to),
    createURL: (to) => base.createURL(to),
    encodeLocation: (to) => base.encodeLocation(to),
    push: guarded('push'),
    replace: guarded('replace'),
    go(delta) {
      // a step through history the page itself takes lands later, as a
      // pop; it is waved through when it does
      if (passing > 0) waved = true
      base.go(delta)
    },
    listen(listener: Listener) {
      return base.listen((update) => {
        if (undoing !== null) {
          const landed = undoing
          undoing = null
          landed()
          return
        }
        // A pop with no known distance came from outside the router - an
        // address typed over, an entry pushed by hand - and cannot be
        // undone by stepping back; it goes through, as the router's own
        // blocker lets it.
        if (update.action === 'POP' && !waved && update.delta !== null) {
          const guard = blocker(update.location)
          if (guard !== undefined) {
            const delta = update.delta
            const back = new Promise<void>((resolve) => {
              undoing = resolve
            })
            base.go(-delta)
            hold({ guard, to: update.location }, () => {
              void back.then(() => {
                waved = true
                base.go(delta)
              })
            })
            return
          }
        }
        if (update.action === 'POP') waved = false
        shown = update.location
        listener(update)
      })
    },
  }

  return {
    history,
    guard(guard) {
      guards.add(guard)
      return () => {
        guards.delete(guard)
        // nothing is left to protect: the question is no longer asked
        if (held?.guard === guard) hold(null)
      }
    },
    bypass(move) {
      passing += 1
      try {
        move()
      } finally {
        passing -= 1
      }
    },
    held: () => held,
    subscribe(watcher) {
      watchers.add(watcher)
      return () => watchers.delete(watcher)
    },
    stay: () => hold(null),
    leave(move) {
      const going = move ?? held
      if (going === null) return
      if (held === going) hold(null)
      // made once: a second answer to the same question moves nothing
      const replay = replays.get(going)
      replays.delete(going)
      replay?.()
    },
  }
}

/** whether two places are different pages rather than one page in another state */
export const leavesThePage = (from: Path, to: Path): boolean => from.pathname !== to.pathname
