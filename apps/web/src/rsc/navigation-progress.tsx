'use client'
import * as stylex from '@stylexjs/stylex'
import { useLocation, useNavigation } from 'react-router'
import { state_loading } from '@qualy/web-i18n/messages'
import { tokens } from '@qualy/ui/theme/tokens.stylex'

const sweep = stylex.keyframes({
  from: { transform: 'translateX(-100%)' },
  to: { transform: 'translateX(400%)' },
})
const REDUCED_MOTION = '@media (prefers-reduced-motion: reduce)'
const appear = stylex.keyframes({ from: { opacity: 0 }, to: { opacity: 1 } })
const navigationStyles = stylex.create({
  track: {
    position: 'fixed',
    insetInline: 0,
    insetBlockStart: 0,
    height: 2,
    overflow: 'hidden',
    zIndex: 150,
    pointerEvents: 'none',
    opacity: 0,
    animationName: appear,
    animationDelay: '150ms',
    animationDuration: '100ms',
    animationFillMode: 'forwards',
  },
  bar: {
    width: { default: '25%', [REDUCED_MOTION]: '100%' },
    height: '100%',
    backgroundColor: tokens.primary,
    animationName: { default: sweep, [REDUCED_MOTION]: 'none' },
    animationDuration: '1s',
    animationTimingFunction: 'ease-in-out',
    animationIterationCount: 'infinite',
  },
})

export function NavigationProgress() {
  const navigation = useNavigation()
  const location = useLocation()
  if (navigation.location === undefined || navigation.location.pathname === location.pathname) {
    return null
  }
  return (
    <div role="progressbar" aria-label={state_loading()} {...stylex.props(navigationStyles.track)}>
      <div {...stylex.props(navigationStyles.bar)} />
    </div>
  )
}
