import type { Path } from 'react-router'

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

export interface LeaveControls {
  /** stands a guard at the gate until the returned function takes it away */
  readonly guard: (guard: LeaveGuard) => () => void
  /** makes a move no guard is asked about: one the page itself decided on */
  readonly bypass: <A>(move: () => A) => A
  /** the move waiting for an answer, if one is */
  readonly held: () => HeldLeave | null
  readonly subscribe: (listener: () => void) => () => void
  /** the reader stays: the held move is dropped */
  readonly stay: (move?: HeldLeave) => void
  /**
   * The reader goes: the held move is made. Named, for an answer that took
   * a while - a save - by which time the question may have been put away.
   */
  readonly leave: (move?: HeldLeave) => void
}

/** one held move, however many questions it has been asked under */
interface Move {
  readonly replay: () => void
  readonly cancel?: () => void
  readonly guards: Set<LeaveGuard>
}

/** Guard registration and the question used by the Data Router blocker. */
export function createLeaveDecision() {
  const guards = new Set<LeaveGuard>()
  const watchers = new Set<() => void>()
  // the move behind each question put, so an answer given to an earlier
  // form of the question still makes it
  const moves = new WeakMap<HeldLeave, Move>()
  let held: HeldLeave | null = null
  let active: Move | undefined
  let passing = 0

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
    if (held === null) return
    held = null
    notify()
  }
  const clear = () => {
    active = undefined
    drop()
  }
  const hold = (
    blocking: readonly LeaveGuard[],
    to: Path,
    replay: () => void,
    cancel?: () => void,
  ) => {
    active = {
      replay,
      ...(cancel === undefined ? {} : { cancel }),
      guards: new Set(blocking),
    }
    ask(active, to)
  }
  const blockers = (from: Path, to: Path): LeaveGuard[] => {
    if (passing > 0) return []
    return [...guards].filter((guard) => guard.blocks(from, to))
  }
  const bypass = <A>(move: () => A): A => {
    passing += 1
    try {
      return move()
    } finally {
      passing -= 1
    }
  }
  const controls: LeaveControls = {
    guard(guard) {
      guards.add(guard)
      return () => {
        guards.delete(guard)
        const question = held
        const move = question === null ? undefined : moves.get(question)
        if (question === null || move === undefined || !move.guards.delete(guard)) return
        // A save may remove the last guard before its answer calls leave.
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
    stay(question) {
      if (question !== undefined && moves.get(question) !== active) return
      const cancel = active?.cancel
      clear()
      cancel?.()
    },
    leave(question) {
      const going = question ?? held
      const move = going === null ? undefined : moves.get(going)
      if (move === undefined || move !== active) return
      clear()
      move.replay()
    },
  }
  return { controls, hold, clear, blockers, bypassing: () => passing > 0 }
}

/** Query-only changes stay in the same page. */
export const leavesThePage = (from: Path, to: Path): boolean => from.pathname !== to.pathname
