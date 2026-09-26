import {
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import {
  UNSAFE_createBrowserHistory as createBrowserHistory,
  UNSAFE_createMemoryHistory as createMemoryHistory,
  unstable_HistoryRouter as HistoryRouter,
  type InitialEntry,
  type Path,
} from 'react-router'
import { ConfirmDialog } from '@qualy/ui/admin'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { createLeaveGate, leavesThePage, type LeaveGate } from './leave-gate.ts'
import { sharedContext } from './shared-context.ts'

// The router the application runs under, with a gate on its history (see
// leave-gate.ts), and the question it asks when a page with unsaved changes
// is being left.
//
// `unstable_HistoryRouter` and the `UNSAFE_` history factories are
// react-router's own declarative router pieces with the history handed in
// rather than made inside: BrowserRouter and MemoryRouter are exactly these,
// with the history created in a ref (lib/dom/lib.js, lib/components.js).
// Their names say they may move between versions, so an upgrade of
// react-router re-runs the leave-guard suites before anything else.

const Gate = sharedContext<LeaveGate | null>('leave-gate', null)

/** the application's router, over the browser's own history */
export function GuardedBrowserRouter({ children }: { children: ReactNode }) {
  const [gate] = useState(() => createLeaveGate(createBrowserHistory({ v5Compat: true })))
  return (
    <HistoryRouter history={gate.history}>
      <LeaveQuestion gate={gate}>{children}</LeaveQuestion>
    </HistoryRouter>
  )
}

/** the same router over a history kept in memory, for a screen rendered on its own */
export function GuardedMemoryRouter({
  initialEntries,
  initialIndex,
  children,
}: {
  initialEntries?: InitialEntry[]
  initialIndex?: number
  children: ReactNode
}) {
  const [gate] = useState(() =>
    createLeaveGate(
      createMemoryHistory({
        ...(initialEntries === undefined ? {} : { initialEntries }),
        ...(initialIndex === undefined ? {} : { initialIndex }),
        v5Compat: true,
      }),
    ),
  )
  return (
    <HistoryRouter history={gate.history}>
      <LeaveQuestion gate={gate}>{children}</LeaveQuestion>
    </HistoryRouter>
  )
}

function LeaveQuestion({ gate, children }: { gate: LeaveGate; children: ReactNode }) {
  const { format } = useI18n()
  const held = useSyncExternalStore(gate.subscribe, gate.held, gate.held)
  // Saving holds the question open until the save answers. The dialog closes
  // itself on any answer pressed, which would put the question away - and
  // the move with it - before the save had said whether it may go ahead.
  const [saving, setSaving] = useState(false)
  const savingNow = useRef(false)
  const save = held?.guard.save
  const leave = () => gate.leave()
  return (
    <Gate.Provider value={gate}>
      {children}
      <ConfirmDialog
        open={held !== null || saving}
        title={format(commonMessages.leaveTitle)}
        description={format(commonMessages.leaveHint)}
        cancelLabel={format(commonMessages.leaveStay)}
        pending={saving}
        {...(save === undefined
          ? {
              // nothing to keep the changes with: going is going without them
              confirmLabel: format(commonMessages.leaveDiscard),
              tone: 'destructive' as const,
              onConfirm: leave,
            }
          : {
              confirmLabel: format(commonMessages.leaveSave),
              otherLabel: format(commonMessages.leaveDiscard),
              onOther: leave,
              onConfirm: () => {
                const going = held
                if (going === null) return
                savingNow.current = true
                setSaving(true)
                void Promise.resolve()
                  .then(save)
                  .catch(() => false)
                  .then((saved) => {
                    savingNow.current = false
                    setSaving(false)
                    // a save that did not go through says why on the page
                    // itself; the reader is left there to read it
                    if (saved) gate.leave(going)
                    else gate.stay()
                  })
              },
            })}
        onCancel={() => {
          if (!savingNow.current) gate.stay()
        }}
      />
    </Gate.Provider>
  )
}

export interface LeaveGuardOptions {
  /** whether leaving now would lose something */
  readonly when: boolean
  /**
   * Saves what would be lost, resolving true once it is safe to go. Offered
   * as "save and leave" beside "discard"; without it the only way to keep
   * the changes is to stay.
   */
  readonly onSave?: () => Promise<boolean> | boolean
  /**
   * Which moves count as leaving. By default a move to another path: a page
   * that keeps which record is open in the query string moves inside itself
   * without leaving, and handles that itself.
   */
  readonly blocks?: (from: Path, to: Path) => boolean
}

/**
 * Asks before the page is left while `when` holds - in the application, as a
 * question with a way to save; out of it (a reload, a closed tab), as the
 * browser's own. Returns `bypass`, for a move the page decides on itself
 * after saving, before `when` has had a render to turn false.
 */
export function useLeaveGuard({ when, onSave, blocks }: LeaveGuardOptions): {
  readonly bypass: (move: () => void) => void
} {
  const gate = useContext(Gate)
  // the latest words, read when the question is asked rather than when the
  // guard was stood, so a page re-rendering does not stand it again
  const latest = useRef({ onSave, blocks })
  useLayoutEffect(() => {
    latest.current = { onSave, blocks }
  })
  const saves = onSave !== undefined
  useEffect(() => {
    if (!when || gate === null) return
    return gate.guard({
      blocks: (from, to) => (latest.current.blocks ?? leavesThePage)(from, to),
      ...(saves ? { save: () => latest.current.onSave?.() ?? true } : {}),
    })
  }, [when, gate, saves])
  useEffect(() => {
    if (!when) return
    const hold = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', hold)
    return () => window.removeEventListener('beforeunload', hold)
  }, [when])
  return useMemo(() => ({ bypass: gate?.bypass ?? runNow }), [gate])
}

const runNow = (move: () => void) => move()

/**
 * Makes a move no page is asked about. For the moves that are not the
 * reader leaving a page but the product changing under it - a new identity,
 * whose pages the old one's changes do not belong to.
 */
export function useUnguardedMove(): (move: () => void) => void {
  return useContext(Gate)?.bypass ?? runNow
}
