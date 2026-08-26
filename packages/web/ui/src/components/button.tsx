'use client'

import * as React from 'react'
import { ActionIcon as MActionIcon, Button as MButton } from '@mantine/core'

import { clsx } from 'clsx'

// The Qualy button. The public surface is the product vocabulary - semantic
// variants, the 36/32/24/40 size rhythm, asChild polymorphism - and none of
// the widget library's own variant or color names leak through it. Colors
// resolve in the theme's variantColorResolver, sizes in its vars resolvers
// (theme/mantine.tsx), both from the --q-* tokens.

type ButtonVariant = 'default' | 'outline' | 'secondary' | 'ghost' | 'destructive' | 'link'
type ButtonSize = 'default' | 'xs' | 'sm' | 'lg' | 'icon' | 'icon-xs' | 'icon-sm' | 'icon-lg'

const variantOf: Record<ButtonVariant, string> = {
  default: 'q-primary',
  outline: 'q-outline',
  secondary: 'q-secondary',
  ghost: 'q-ghost',
  destructive: 'q-destructive',
  link: 'q-link',
}

const iconSizeOf: Partial<Record<ButtonSize, string>> = {
  icon: 'q-icon',
  'icon-xs': 'q-icon-xs',
  'icon-sm': 'q-icon-sm',
  'icon-lg': 'q-icon-lg',
}

const sizeOf: Partial<Record<ButtonSize, string>> = {
  default: 'q-default',
  xs: 'q-xs',
  sm: 'q-sm',
  lg: 'q-lg',
}

export interface ButtonProps extends React.ComponentProps<'button'> {
  variant?: ButtonVariant | null
  size?: ButtonSize | null
  /** render as the single child element, keeping the button's look */
  asChild?: boolean
}

function Button({ variant, size, asChild = false, className, children, ...props }: ButtonProps) {
  const v = variant ?? 'default'
  const s = size ?? 'default'
  const iconSize = iconSizeOf[s]
  // an icon button is a square: the widget library models that as its own
  // component with one size variable driving both dimensions
  const Comp = iconSize === undefined ? MButton : MActionIcon
  const mantineSize = iconSize ?? sizeOf[s] ?? 'q-default'

  const shared = {
    variant: variantOf[v],
    size: mantineSize,
    'data-slot': 'button',
    'data-variant': v,
    'data-size': s,
  }

  if (asChild) {
    // polymorphism through the library's own renderRoot channel: the button
    // renders AS its only child, the child keeps its own props (href, to,
    // handlers) and receives the computed button props on top
    const child = React.Children.only(children) as React.ReactElement<Record<string, unknown>>
    const { children: grandchildren, className: childClassName } = child.props
    return (
      <Comp
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
      </Comp>
    )
  }

  // the native button defaults to type="button" inside the library already;
  // an explicit type="submit" passes through untouched
  return (
    <Comp {...shared} className={className} {...props}>
      {children}
    </Comp>
  )
}

export { Button }
