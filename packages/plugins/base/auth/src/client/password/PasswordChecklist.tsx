import { motion, useReducedMotion } from 'motion/react'
import * as stylex from '@stylexjs/stylex'
import { CheckIcon, CircleIcon } from 'lucide-react'
import { useI18n } from '@qualy/web-i18n'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { authMessages as m } from '../i18n.ts'
import { lengthOf, type CheckState, type PasswordChecks } from './checks.ts'

// What a new password is held to, as a list under the field: the same list
// on every form that sets a password. What it says comes from checks.ts.

const styles = stylex.create({
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: 5,
    margin: 0,
    padding: 0,
    listStyle: 'none',
  },
  rule: {
    display: 'flex',
    alignItems: 'center',
    gap: 7,
    fontSize: 13,
    color: tokens.mutedForeground,
    transitionProperty: 'color',
    transitionDuration: '200ms',
  },
  met: { color: tokens.foreground },
  bad: { color: tokens.danger },
  mark: { position: 'relative', display: 'inline-flex', flexShrink: 0, width: 14, height: 14 },
  tick: { position: 'absolute', inset: 0 },
  advice: { margin: 0, paddingInlineStart: 21, fontSize: 12.5, color: tokens.mutedForeground },
})

/** the checks as a list, each ticked when it holds and red once a save was refused on it */
export function PasswordChecklist({
  checks,
  password,
  min,
  refused,
}: {
  checks: PasswordChecks
  password: string
  min: number
  /** a save was pressed and refused: what does not hold now says so in red */
  refused: boolean
}) {
  const { format } = useI18n()
  const left = min - lengthOf(password)
  return (
    <ul data-testid="password-checklist" {...stylex.props(styles.list)}>
      <Rule check="length" state={checks.length} refused={refused}>
        {checks.length === 'met' || password === ''
          ? format(m.resetLength, { min })
          : format(m.resetLengthShort, { min, left: Math.max(left, 0) })}
      </Rule>
      <Rule check="impersonal" state={checks.impersonal} refused={refused}>
        {format(m.passwordImpersonal)}
      </Rule>
      <Rule check="unguessable" state={checks.unguessable} refused={refused}>
        {format(m.passwordUnguessable)}
      </Rule>
      {checks.unguessable === 'unmet' && password !== '' && (
        <li {...stylex.props(styles.advice)}>{format(m.passwordAdvice)}</li>
      )}
    </ul>
  )
}

function Rule({
  check,
  state,
  refused,
  children,
}: {
  check: string
  state: CheckState
  refused: boolean
  children: string
}) {
  const still = useReducedMotion() === true
  const met = state === 'met'
  const bad = refused && state === 'unmet'
  return (
    <li
      data-testid="password-rule"
      data-check={check}
      data-state={state}
      data-refused={bad}
      {...stylex.props(styles.rule, met && styles.met, bad && styles.bad)}
    >
      <span aria-hidden {...stylex.props(styles.mark)}>
        <CircleIcon size={14} strokeWidth={2} />
        <motion.span
          {...stylex.props(styles.tick)}
          initial={false}
          animate={met ? { scale: 1, opacity: 1 } : { scale: 0.4, opacity: 0 }}
          transition={still ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 16 }}
        >
          <CheckIcon size={14} strokeWidth={2.6} />
        </motion.span>
      </span>
      {children}
    </li>
  )
}
