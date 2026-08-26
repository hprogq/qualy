'use client'

import * as React from 'react'
import * as stylex from '@stylexjs/stylex'
import { ActionIcon as MActionIcon, Button as MButton } from '@mantine/core'

import { clsx } from 'clsx'

// The Qualy button. The public surface is the product vocabulary - semantic
// variants, the 36/32/24/40 size rhythm, asChild polymorphism - and none of
// the widget library's own variant or color names leak through it. Colors
// resolve in the theme's variantColorResolver, sizes in its vars resolvers
// (theme/mantine.tsx), both from the --q-* tokens.

// What a press looks like.
//
// The widget library's own answer - shift the control down a pixel - is off
// for the whole product (theme/mantine.tsx): in a toolbar of eight small
// buttons it reads as the row twitching, and the geometry says nothing the
// surface does not.
//
// What replaces it is a film of the button's OWN ink laid over its own
// ground, as an inset shadow: painted above the background and below the
// label, so the words stay crisp. Being made of `currentColor`, it lightens
// a solid dark button and darkens a pale one without being told which it is
// - and, more importantly, it is right for a ground this adapter never chose.
// A first attempt darkened towards each variant's palette colour, which
// turned the review screen's green and red confirm buttons grey the moment
// they were pressed: their ground comes from the caller, not from the
// variant. A relative step has no such assumption to get wrong.
//
// It arrives INSTANTLY - a finger down has to be answered now, or the
// control feels sticky - and leaves unhurriedly, so releasing does not snap.
const press = stylex.create({
  base: {
    transitionProperty: 'background-color, border-color, color, box-shadow',
    transitionDuration: {
      default: '90ms',
      ':active': '0ms',
    },
    transitionTimingFunction: 'ease-out',
  },
  surface: {
    boxShadow: {
      default: null,
      ':active': 'inset 0 0 0 999px color-mix(in oklab, currentColor 8%, transparent)',
    },
  },
  // A control that cannot be pressed is a faded version of ITSELF, never a
  // grey stand-in: the colour is how a reader picks the reject key out of a
  // footer at a glance, and taking it away makes them read the labels again.
  off: {
    opacity: 0.55,
  },
  // Hover is an offer. A key with nothing to offer must not answer the
  // pointer with colour - but it still has to say what it is, so it keeps
  // its pointer events: `pointer-events: none` would take the cursor and
  // the tooltip that explains a refusal along with the hover.
  refused: {
    cursor: 'not-allowed',
  },
  // a link has no ground to film over; it answers with its own ink
  ink: {
    color: {
      default: null,
      ':active': 'color-mix(in oklch, var(--q-primary), var(--q-foreground) 25%)',
    },
  },
})

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

/**
 * A control that answers nothing should look like it answers nothing.
 *
 * A refused key stays a real button - it has to, so it can still say why it
 * is refused - which means the widget's own hover rule fires on it and
 * lights it up as though it were on offer. The widget states that colour
 * through one variable per component, so pointing it back at the resting
 * colour ends the hover without knowing which variant is underneath.
 */
const noHover = {
  '--button-hover': 'var(--button-bg)',
  '--ai-hover': 'var(--ai-bg)',
} as React.CSSProperties

function Button({
  variant,
  size,
  asChild = false,
  className,
  children,
  disabled,
  style,
  ...props
}: ButtonProps) {
  const v = variant ?? 'default'
  const s = size ?? 'default'
  const iconSize = iconSizeOf[s]
  // an icon button is a square: the widget library models that as its own
  // component with one size variable driving both dimensions
  const Comp = iconSize === undefined ? MButton : MActionIcon
  const mantineSize = iconSize ?? sizeOf[s] ?? 'q-default'

  // a control that cannot be pressed does not answer a press: the seat is
  // simply not taken, rather than taken and then argued out of by a selector
  // Blocked is not the same as disabled here. A key the workbench refuses is
  // marked with aria-disabled and stays a real button, because it still has
  // to say WHY it is refused when pointed at - so CSS still sees a pressable
  // control, and the press film has to stand down on its own.
  const off = disabled === true || props['aria-disabled'] === true
  const pressed = stylex.props(
    press.base,
    !off && (v === 'link' ? press.ink : press.surface),
    off && press.refused,
    disabled === true && press.off,
  ).className
  const shared = {
    variant: variantOf[v],
    size: mantineSize,
    'data-slot': 'button',
    'data-variant': v,
    'data-size': s,
    ...(disabled === undefined ? {} : { disabled }),
    style: off ? { ...noHover, ...style } : style,
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
        className={clsx(pressed, className)}
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
    <Comp {...shared} className={clsx(pressed, className)} {...props}>
      {children}
    </Comp>
  )
}

export { Button }
