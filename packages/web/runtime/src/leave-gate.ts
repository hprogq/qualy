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
//
// More than one guard may stand at once - two editors on one screen - and a
// move is held while any of them would lose something by it. The question
// is then asked once for all of them: saving saves every one, in turn, and
// is only offered when every one can.

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
  readonly to: Path
  /**
   * Saves what every guard holding the move would lose, one after another,
   * true once all of them are safe; absent when any of them cannot save, as
   * going without some of the changes is then the only way to go.
   */
  readonly save?: () => Promise<boolean>
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

/**
 * How long a step through history the page took itself is waited for.
 * The browser answers a step with the pop within a frame or two; a step
 * past either end of the history is never answered at all, and must not
 * leave the next step the reader takes waved through unasked.
 */
const WAVE_MS = 1000

/** one held move, however many questions it has been asked under */
interface Move {
  readonly replay: () => void
  readonly guards: Set<LeaveGuard>
  answered: boolean
}

export function createLeaveGate(base: History): LeaveGate {
  const guards = new Set<LeaveGuard>()
  const watchers = new Set<() => void>()
  // the move behind each question put, so an answer given to an earlier
  // form of the question still makes it
  const moves = new WeakMap<HeldLeave, Move>()
  let held: HeldLeave | null = null
  // where the router is, which after a held pop is not where the base is
  let shown: Path = base.location
  // moves the page made itself, while they are being made
  let passing = 0
  // the pop that undoes a held one, on its way back, and the moves the page
  // made meanwhile: made once it lands, from the entry the page is really on
  let undoing: { readonly landed: () => void; readonly after: (() => void)[] } | null = null
  // a pop nobody is asked about, on its way: a held one taken again, or one
  // the page made itself past the guards - by how far, and until when
  let waved: { readonly delta: number; readonly until: number } | null = null

  const notify = () => {
    for (const watcher of watchers) watcher()
  }
  const ask = (move: Move, to: Path) => {
    const savers = [...move.guards].flatMap((guard) =>
      guard.save === undefined ? [] : [guard.save],
    )
    const question: HeldLeave = {
      to,
      ...(savers.length === move.guards.size
        ? {
            save: async () => {
              // one after another, stopping at the first that does not go
              // through: what saved stays saved, and the reader stays with
              // the one that could not
              for (const save of savers) if (!(await save())) return false
              return true
            },
          }
        : {}),
    }
    moves.set(question, move)
    held = question
    notify()
  }
  const drop = () => {
    held = null
    notify()
  }
  const hold = (blocking: readonly LeaveGuard[], to: Path, replay: () => void) =>
    ask({ replay, guards: new Set(blocking), answered: false }, to)
  const blockers = (to: Path): LeaveGuard[] => {
    if (passing > 0) return []
    return [...guards].filter((guard) => guard.blocks(shown, to))
  }
  const bypass = (move: () => void) => {
    passing += 1
    try {
      move()
    } finally {
      passing -= 1
    }
  }
  const wave = (delta: number) => {
    waved = { delta, until: performance.now() + WAVE_MS }
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
      // The browser is still stepping back to the page's own entry: written
      // now, the move would land on the entry being undone.
      if (undoing !== null) {
        const bypassed = passing > 0
        undoing.after.push(() =>
          bypassed ? bypass(() => guarded(move)(to, state)) : guarded(move)(to, state),
        )
        return
      }
      const target = pathOf(to)
      const blocking = blockers(target)
      if (blocking.length === 0) {
        base[move](to, state)
        return
      }
      hold(blocking, target, () => base[move](to, state))
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
      if (passing > 0) wave(delta)
      base.go(delta)
    },
    listen(listener: Listener) {
      return base.listen((update) => {
        // Only a pop is a step through history, so only a pop can be the
        // undo landing or the step the page took itself. Anything else is a
        // move of its own and always reaches the router.
        if (update.action === 'POP') {
          if (undoing !== null) {
            const { landed, after } = undoing
            undoing = null
            landed()
            for (const move of after) move()
            return
          }
          const expected = waved
          waved = null
          const through =
            expected !== null &&
            expected.delta === update.delta &&
            performance.now() <= expected.until
          // A pop with no known distance came from outside the router - an
          // address typed over, an entry pushed by hand - and cannot be
          // undone by stepping back; it goes through, as the router's own
          // blocker lets it.
          if (!through && update.delta !== null) {
            const blocking = blockers(update.location)
            if (blocking.length > 0) {
              const delta = update.delta
              const back = new Promise<void>((resolve) => {
                undoing = { landed: resolve, after: [] }
              })
              base.go(-delta)
              hold(blocking, update.location, () => {
                void back.then(() => {
                  wave(delta)
                  base.go(delta)
                })
              })
              return
            }
          }
        }
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
        const question = held
        const move = question === null ? undefined : moves.get(question)
        if (question === null || move === undefined || !move.guards.delete(guard)) return
        // nothing is left to protect: the question is no longer asked; the
        // rest of what the move would lose is still asked about
        if (move.guards.size === 0) drop()
        else ask(move, question.to)
      }
    },
    bypass,
    held: () => held,
    subscribe(watcher) {
      watchers.add(watcher)
      return () => watchers.delete(watcher)
    },
    stay() {
      const move = held === null ? undefined : moves.get(held)
      if (move !== undefined) move.answered = true
      drop()
    },
    leave(question) {
      const going = question ?? held
      const move = going === null ? undefined : moves.get(going)
      // made once: a second answer to the same question moves nothing
      if (move === undefined || move.answered) return
      move.answered = true
      if (held !== null && moves.get(held) === move) drop()
      move.replay()
    },
  }
}

/** whether two places are different pages rather than one page in another state */
export const leavesThePage = (from: Path, to: Path): boolean => from.pathname !== to.pathname
