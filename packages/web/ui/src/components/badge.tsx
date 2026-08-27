'use client'

import * as React from 'react'
import * as stylex from '@stylexjs/stylex'
import { Badge as MBadge } from '@mantine/core'

import { clsx } from 'clsx'
import { seatOf } from '../lib/xstyle.ts'

// The Qualy badge vocabulary; colors resolve from the --q-* tokens through
// the theme's variantColorResolver, never through vendor palette names.
type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline' | 'ghost' | 'link'

const styles = stylex.create({
  // the product voice: a badge is a quiet label, not a shouting pill. The
  // weight itself is the theme's `fontWeights.medium`, stated once there.
  root: {
    textTransform: 'none',
  },
  // A badge's content is a row: a status dot, an icon, the word, side by
  // side. The widget's label is a plain block, and the DOM baseline makes
  // svg block-level, which put each of them on its own line.
  label: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.25rem',
  },
})

const variantOf: Record<BadgeVariant, string> = {
  default: 'q-primary',
  secondary: 'q-secondary',
  destructive: 'q-destructive',
  outline: 'q-outline',
  ghost: 'q-ghost',
  link: 'q-link',
}

function Badge({
  className,
  style,
  labelXstyle,
  variant,
  asChild = false,
  children,
  ...props
}: React.ComponentProps<'span'> & {
  variant?: BadgeVariant | null
  asChild?: boolean
  /** the widget wraps children in its own label span; this styles that span */
  labelXstyle?: stylex.StyleXStyles
}) {
  const v = variant ?? 'default'
  const seat = seatOf(stylex.props(styles.root), className, style)
  const shared = {
    variant: variantOf[v],
    'data-slot': 'badge',
    'data-variant': v,
    // one composition for the label, so a caller sizing or spacing it wins
    // property by property instead of racing this class by name
    classNames: { label: stylex.props(styles.label, labelXstyle).className },
  }

  if (asChild) {
    // same renderRoot polymorphism as the button: the badge renders AS its
    // only child, which keeps its own props and gains the badge's
    const child = React.Children.only(children) as React.ReactElement<Record<string, unknown>>
    const { children: grandchildren, className: childClassName } = child.props
    return (
      <MBadge
        component="span"
        {...shared}
        {...seat}
        {...props}
        renderRoot={(rootProps) =>
          React.cloneElement(child, {
            ...rootProps,
            className: clsx(rootProps.className as string, childClassName as string | undefined),
          })
        }
      >
        {grandchildren as React.ReactNode}
      </MBadge>
    )
  }

  return (
    <MBadge component="span" {...shared} {...seat} {...props}>
      {children}
    </MBadge>
  )
}

export { Badge }
