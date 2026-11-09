import * as stylex from '@stylexjs/stylex'
import { useContext, useEffect, useState, type ReactNode } from 'react'
import { useLocation, useNavigation } from 'react-router'
import { state_loading } from '@qualy/web-i18n/messages'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { sharedContext } from '../shared-context.ts'

const REDUCE = '@media (prefers-reduced-motion: reduce)'
const FINISH_MS = 240
const styles = stylex.create({
  track: {
    position: 'fixed',
    insetInline: 0,
    insetBlockStart: 0,
    height: 2,
    zIndex: 150,
    pointerEvents: 'none',
  },
  fill: {
    display: 'block',
    width: '100%',
    height: '100%',
    backgroundColor: tokens.foreground,
    transformOrigin: 'left center',
    transform: 'scaleX(0)',
    transitionProperty: { default: 'transform', [REDUCE]: 'none' },
  },
  running: {
    transform: { default: 'scaleX(0.9)', [REDUCE]: 'scaleX(1)' },
    transitionDuration: '2800ms',
    transitionTimingFunction: 'cubic-bezier(0.12, 0.55, 0.28, 1)',
  },
  complete: {
    transform: 'scaleX(1)',
    transitionDuration: `${FINISH_MS}ms`,
    transitionTimingFunction: 'ease-out',
  },
})

type Phase = 'running' | 'complete'
const Progress = sharedContext<{ from: string; pathname: string; phase: Phase } | null>(
  'navigation-progress',
  null,
)

export function useNavigationProgress() {
  return useContext(Progress)
}

export function NavigationProgressScope({ children }: { children: ReactNode }) {
  const current = useLocation()
  const next = useNavigation().location
  const key = next?.pathname !== current.pathname ? next?.key : undefined
  const pathname = next?.pathname
  const from = current.pathname
  const [shown, setShown] = useState<{ key: string; from: string; pathname: string } | null>(null)
  useEffect(() => {
    if (key !== undefined && pathname !== undefined) {
      if (shown?.key === key) return
      const timer = setTimeout(() => setShown({ key, from, pathname }), 150)
      return () => clearTimeout(timer)
    }
    if (shown === null) return
    const timer = setTimeout(() => setShown(null), FINISH_MS)
    return () => clearTimeout(timer)
  }, [from, key, pathname, shown])

  // Estimated progress only. The browser has no total for the server work.
  // CSS completes from the currently painted position, never a fixed percent.
  const progress =
    shown === null
      ? null
      : shown.key === key
        ? { from: shown.from, pathname: shown.pathname, phase: 'running' as const }
        : key === undefined && shown.from !== current.pathname
          ? { from: shown.from, pathname: shown.pathname, phase: 'complete' as const }
          : null
  return (
    <Progress value={progress}>
      <div
        role={progress?.phase === 'running' ? 'progressbar' : undefined}
        aria-label={progress?.phase === 'running' ? state_loading() : undefined}
        {...stylex.props(styles.track)}
      >
        <span
          aria-hidden
          {...stylex.props(styles.fill, progress !== null && styles[progress.phase])}
        />
      </div>
      {children}
    </Progress>
  )
}
