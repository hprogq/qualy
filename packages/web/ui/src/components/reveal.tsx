import type { ReactNode } from 'react'
import { motion } from 'motion/react'

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
