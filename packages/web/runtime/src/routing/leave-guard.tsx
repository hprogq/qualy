import {
  useContext,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { useBlocker, useNavigate, type BlockerFunction, type Path } from 'react-router'
import { ConfirmDialog } from '@qualy/ui/admin'

import {
  createLeaveDecision,
  leavesThePage,
  type LeaveControls,
  type LeaveGuard,
} from './leave-gate.ts'
import { sharedContext } from '../shared-context.ts'
import * as commonMessages from '@qualy/web-i18n/messages'

const Gate = sharedContext<LeaveControls | null>('leave-gate', null)

/** React Router owns navigation and history for the server-rendered document. */
export function DataRouterLeaveGuard({ children }: { children: ReactNode }) {
  const [decision] = useState(createLeaveDecision)
  const navigate = useNavigate()
  const [binding, setBinding] = useState({ navigate, generation: 0 })
  if (binding.navigate !== navigate) {
    setBinding({ navigate, generation: binding.generation + 1 })
  }
  // RSC replaces its router facade when routes arrive. useBlocker changes
  // its key then, but also re-registers the old key before that state update.
  // Bind only the controller to the public navigation handle's lifetime;
  // the decision, dialog and editor remain mounted across route updates.
  return (
    <LeaveQuestion gate={decision.controls}>
      <NavigationBlocker key={binding.generation} decision={decision} />
      {children}
    </LeaveQuestion>
  )
}

function NavigationBlocker({ decision }: { decision: ReturnType<typeof createLeaveDecision> }) {
  const blocking = useRef<readonly LeaveGuard[]>([])
  const shouldBlock = useCallback<BlockerFunction>(
    ({ currentLocation, nextLocation }) => {
      const guards = decision.blockers(currentLocation, nextLocation)
      if (guards.length === 0) return false
      blocking.current = guards
      return true
    },
    [decision],
  )
  const blocker = useBlocker(shouldBlock)
  useLayoutEffect(() => {
    if (blocker.state === 'blocked') {
      decision.hold(blocking.current, blocker.location, blocker.proceed, blocker.reset)
    } else {
      decision.clear()
    }
  }, [blocker, decision])
  return null
}

function LeaveQuestion({ gate, children }: { gate: LeaveControls; children: ReactNode }) {
  const held = useSyncExternalStore(gate.subscribe, gate.held, gate.held)
  // Saving holds the question open until the save answers. The dialog closes
  // itself on any answer pressed, which would put the question away - and
  // the move with it - before the save had said whether it may go ahead.
  const [saving, setSaving] = useState(false)
  const savingNow = useRef(false)
  const save = held?.save
  const leave = () => gate.leave()
  return (
    <Gate.Provider value={gate}>
      {children}
      <ConfirmDialog
        open={held !== null || saving}
        title={commonMessages.leave_title()}
        description={commonMessages.leave_hint()}
        cancelLabel={commonMessages.leave_stay()}
        pending={saving}
        {...(save === undefined
          ? {
              // nothing to keep the changes with: going is going without them
              confirmLabel: commonMessages.leave_discard(),
              tone: 'destructive' as const,
              onConfirm: leave,
            }
          : {
              confirmLabel: commonMessages.leave_save(),
              otherLabel: commonMessages.leave_discard(),
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
                    else gate.stay(going)
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
  readonly bypass: <A>(move: () => A) => A
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

const runNow = <A,>(move: () => A): A => move()

/**
 * Makes a move no page is asked about. For the moves that are not the
 * reader leaving a page but the product changing under it - a new identity,
 * whose pages the old one's changes do not belong to.
 */
export function useUnguardedMove(): <A>(move: () => A) => A {
  return useContext(Gate)?.bypass ?? runNow
}
