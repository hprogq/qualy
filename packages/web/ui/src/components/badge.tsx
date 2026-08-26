'use client'

import * as React from 'react'
import { Badge as MBadge } from '@mantine/core'

import { clsx } from 'clsx'

// The Qualy badge vocabulary; colors resolve from the --q-* tokens through
// the theme's variantColorResolver, never through vendor palette names.
type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline' | 'ghost' | 'link'

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
  labelClassName,
  variant,
  asChild = false,
  children,
  ...props
}: React.ComponentProps<'span'> & {
  variant?: BadgeVariant | null
  asChild?: boolean
  /** the widget wraps children in its own label span; this styles that span */
  labelClassName?: string
}) {
  const v = variant ?? 'default'
  const shared = {
    variant: variantOf[v],
    'data-slot': 'badge',
    'data-variant': v,
    ...(labelClassName === undefined ? {} : { classNames: { label: labelClassName } }),
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
        className={className}
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
    <MBadge component="span" {...shared} className={className} {...props}>
      {children}
    </MBadge>
  )
}

export { Badge }
