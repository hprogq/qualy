import { useEffect, useRef } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import * as stylex from '@stylexjs/stylex'
import { useI18n } from '@qualy/web-i18n'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { VisuallyHidden } from '@qualy/ui/visually-hidden'
import type { CaptchaGate } from './gate.ts'
import { captchaMessages as m } from './i18n.ts'

// Where a challenge lives on the page.
//
// Rendered by the caller wherever an interactive challenge would belong -
// in a form, the line above the button that sent it - and rendered always,
// because the provider works in its container from the first moment. Until
// the provider says the person has to act, the container takes no room: a
// silent challenge adds nothing to the page, and the caller's own button
// says it is checking. When it does need the person, the container opens
// where it stands, or - for a caller with no place for it - over the page.
//
// The container never moves. A provider's widget can be an iframe, and an
// iframe moved in the document starts over, so the overlay is the same
// element restyled rather than a dialog it is carried into.

const EASE = [0.2, 0.8, 0.2, 1] as const

const styles = stylex.create({
  host: { display: 'flex', flexDirection: 'column', gap: 8 },
  inline: { overflow: 'hidden', width: '100%', minWidth: 0 },
  // the width of whatever it stands in: a provider that sizes itself to its
  // container lines up with the form around it
  region: { width: '100%', minWidth: 0 },
  // present in the document, and invisible, while nothing needs the person
  parked: {
    position: 'absolute',
    insetBlockStart: 0,
    insetInlineStart: 0,
    width: 1,
    height: 1,
    overflow: 'hidden',
    clipPath: 'inset(50%)',
  },
  veil: {
    position: 'fixed',
    inset: 0,
    zIndex: 200,
    backgroundColor: 'rgb(0 0 0 / 0.4)',
  },
  panel: {
    position: 'fixed',
    zIndex: 201,
    insetBlockStart: '50%',
    insetInlineStart: '50%',
    transform: 'translate(-50%, -50%)',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    minWidth: 320,
    maxWidth: 'calc(100vw - 32px)',
    padding: 20,
    borderRadius: 14,
    backgroundColor: tokens.background,
    boxShadow: '0 12px 40px rgb(0 0 0 / 0.2)',
  },
  title: { margin: 0, fontSize: 15, fontWeight: 600, color: tokens.foreground },
  failed: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 8,
    margin: 0,
    fontSize: 13,
    color: tokens.danger,
  },
  retry: {
    padding: 0,
    borderWidth: 0,
    backgroundColor: 'transparent',
    fontSize: 13,
    color: { default: tokens.foreground, ':hover': tokens.mutedForeground },
    textDecoration: 'underline',
    cursor: 'pointer',
  },
})

/** the first thing in the challenge a person could operate */
const FOCUSABLE = 'iframe, button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])'

export function CaptchaChallenge({ gate }: { gate: CaptchaGate }) {
  const { format } = useI18n()
  const still = useReducedMotion() === true
  const interacting = gate.state === 'interaction'
  const busy = gate.state === 'loading-provider' || gate.state === 'working'
  const overlay = gate.placement === 'modal'

  // focus goes into the challenge once, when it starts needing the person,
  // and back to where it was when it stops; a silent one never touches it
  const returnTo = useRef<Element | null>(null)
  useEffect(() => {
    if (!interacting) return
    returnTo.current = document.activeElement
    gate.containerRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus()
    return () => {
      if (overlay && returnTo.current instanceof HTMLElement) returnTo.current.focus()
    }
  }, [interacting, overlay, gate.containerRef])

  const container = <div ref={gate.containerRef} {...stylex.props(styles.region)} />

  return (
    <div
      data-testid="captcha-challenge"
      data-state={gate.state}
      data-placement={gate.placement}
      data-recovery={gate.recovery}
      {...stylex.props(styles.host)}
    >
      {/* the caller's button shows the work; this says it to a screen reader */}
      <VisuallyHidden>
        <span aria-live="polite">{busy ? format(m.working) : ''}</span>
      </VisuallyHidden>
      {overlay ? (
        <>
          {interacting && <div aria-hidden {...stylex.props(styles.veil)} />}
          <div
            {...(interacting
              ? { role: 'dialog', 'aria-modal': true, 'aria-label': format(m.dialogTitle) }
              : {})}
            {...stylex.props(interacting ? styles.panel : styles.parked)}
          >
            {interacting && <p {...stylex.props(styles.title)}>{format(m.dialogTitle)}</p>}
            {container}
          </div>
        </>
      ) : (
        <motion.div
          {...stylex.props(styles.inline)}
          initial={false}
          animate={interacting ? { height: 'auto', opacity: 1 } : { height: 0, opacity: 0 }}
          transition={{ duration: still ? 0 : 0.2, ease: EASE }}
        >
          {container}
        </motion.div>
      )}
      {gate.state === 'failed' && (
        <p role="alert" {...stylex.props(styles.failed)}>
          {format(m.failed)}
          <button type="button" {...stylex.props(styles.retry)} onClick={gate.recover}>
            {format(m.retry)}
          </button>
        </p>
      )}
    </div>
  )
}
