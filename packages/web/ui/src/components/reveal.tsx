import type { ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'

// The entrance a screen makes: a short fade and lift, once, on mount.
// Deliberately subtle - page content should arrive, not perform.
export function Reveal({
  className,
  delay = 0,
  children,
}: {
  className?: string
  delay?: number
  children: ReactNode
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, delay, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  )
}

// A pane whose content is replaced in place: the new content fades up as the
// old leaves, so a change that happened somewhere else on screen is visibly
// the cause. Give it a `key` that changes with the content.
export function Swap({
  swapKey,
  className,
  children,
}: {
  swapKey: string
  className?: string
  children: ReactNode
}) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={swapKey}
        className={className}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.16, ease: 'easeOut' }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  )
}
