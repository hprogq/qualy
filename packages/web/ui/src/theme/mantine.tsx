'use client'

import type { ReactNode } from 'react'
import { MotionConfig } from 'motion/react'
import {
  ActionIcon,
  Button,
  Checkbox,
  Divider,
  Input,
  MantineProvider,
  Radio,
  createTheme,
  defaultVariantColorsResolver,
  rem,
  type CSSVariablesResolver,
  type VariantColorsResolver,
} from '@mantine/core'

// The bridge between the Qualy theme and the widget library. The product's
// --q-* tokens (styles/tokens.css) stay the single palette source: this file
// only teaches Mantine to read them, it never introduces colors of its own.
// Scheme choice also stays outside - the caller passes the resolved scheme
// and Mantine is forced to follow it, so there is no second persisted theme
// state anywhere.

const mix = (color: string, opacity: number) =>
  `color-mix(in oklch, ${color} ${opacity}%, transparent)`

// Adapters in components/ ask for colors through these q-prefixed variant
// names; anything else falls through to Mantine's own resolver. All values
// are var() references, so light/dark flips with the --q-* tokens and needs
// no per-scheme logic here.
const variantColors: VariantColorsResolver = (input) => {
  const border = (value: string) => `${rem(1)} solid ${value}`
  switch (input.variant) {
    case 'q-primary':
      return {
        background: 'var(--q-primary)',
        hover: mix('var(--q-primary)', 80),
        color: 'var(--q-primary-foreground)',
        border: border('transparent'),
      }
    case 'q-outline':
      return {
        background: mix('var(--q-input)', 30),
        hover: mix('var(--q-input)', 50),
        color: 'var(--q-foreground)',
        border: border('var(--q-border)'),
      }
    case 'q-secondary':
      return {
        background: 'var(--q-surface-muted)',
        hover: 'color-mix(in oklch, var(--q-surface-muted), var(--q-foreground) 5%)',
        color: 'var(--q-foreground)',
        border: border('transparent'),
      }
    case 'q-ghost':
      return {
        background: 'transparent',
        hover: 'var(--q-surface-muted)',
        color: 'var(--q-foreground)',
        border: border('transparent'),
      }
    case 'q-destructive':
      return {
        background: mix('var(--q-danger)', 10),
        hover: mix('var(--q-danger)', 20),
        color: 'var(--q-danger)',
        border: border('transparent'),
      }
    case 'q-link':
      return {
        background: 'transparent',
        hover: 'transparent',
        color: 'var(--q-primary)',
        border: 'none',
      }
    default:
      return defaultVariantColorsResolver(input)
  }
}

// The product control rhythm in pixels: a 36px default control lines up with
// 36px fields, and the browser contract tests assert exactly these heights.
const buttonSizes: Record<string, { height: string; paddingX: string; fz: string }> = {
  'q-default': { height: rem(36), paddingX: rem(12), fz: rem(14) },
  'q-sm': { height: rem(32), paddingX: rem(12), fz: rem(14) },
  'q-xs': { height: rem(24), paddingX: rem(10), fz: rem(12) },
  'q-lg': { height: rem(40), paddingX: rem(16), fz: rem(14) },
}

const iconSizes: Record<string, string> = {
  'q-icon': rem(36),
  'q-icon-sm': rem(32),
  'q-icon-xs': rem(24),
  'q-icon-lg': rem(40),
}

// The substrate's platform policy, and nothing else.
//
// Every field here is a decision that must hold for EVERY widget, present
// and future. Anything a single component decides - which transition a
// popover uses, how long a tooltip waits, what a pressed button looks like -
// belongs to that component's adapter, where a reader of the call site can
// find it. A default set here instead is styling at a distance: the adapter
// reads as though it configured nothing while this file quietly rules it.
export const qualyMantineTheme = createTheme({
  // --- accessibility ---
  // Mantine ships this off; a reader who asked the OS for less motion gets
  // it from every layer of this product, and this is the widget layer's
  // half of that contract (StyleX has its reduced-motion block, Motion has
  // MotionConfig in the provider below).
  respectReducedMotion: true,
  // rings for the keyboard, silence for the mouse - the stock behaviour,
  // pinned because it is a decision rather than an accident
  focusRing: 'auto',

  // --- interaction ---
  // No default press motion. The widget library answers a press by shifting
  // the control down a pixel, which in a toolbar of eight small buttons
  // reads as the row twitching; and the geometry says nothing the colour
  // does not. Pressed feedback is real and stays - each adapter states it
  // as a surface step, instant on the way in, unhurried on the way out.
  activeClassName: '',
  // anything that answers a click says so under the cursor, including the
  // native controls the platform leaves as an arrow
  cursorType: 'pointer',

  // --- product baseline ---
  fontFamily: "'Inter Variable', sans-serif",
  // The widget library moved `medium` to 600 in its ninth version, which on
  // a screen of badges, buttons and labels reads heavier than this product
  // speaks. 500 is the product's medium.
  fontWeights: {
    regular: '400',
    medium: '500',
    bold: '700',
  },
  defaultRadius: 'md',
  // The product pairs each semantic colour with its own foreground token,
  // so nothing is left for a luminance threshold to guess.
  autoContrast: false,
  variantColorResolver: variantColors,
  components: {
    Button: Button.extend({
      vars: (_theme, props) => {
        const size = buttonSizes[props.size as string]
        return {
          root:
            size === undefined
              ? {}
              : {
                  '--button-height': size.height,
                  '--button-padding-x': size.paddingX,
                  '--button-fz': size.fz,
                },
        }
      },
    }),
    ActionIcon: ActionIcon.extend({
      vars: (_theme, props) => {
        const size = iconSizes[props.size as string]
        return { root: size === undefined ? {} : { '--ai-size': size } }
      },
    }),
    // The size a person types at, decided in one place for the whole
    // input family.
    //
    // Text, textarea, select, date, time and number all render this one
    // widget, so `--input-fz` is the family's type. It is pointed at a
    // product token instead of a fixed value because that token answers a
    // media query - 14px with a mouse, 16px under a finger, where iOS
    // Safari zooms the page toward any focused control under 16px. Vars
    // are inline styles and cannot hold a media query themselves; the
    // token can, and one indirection keeps the whole family on it.
    //
    // The size stays `sm`: the geometry - a 36px field and its padding -
    // is the product's density and does not move with the type. And the
    // question is asked of the FAMILY, not of the element: the rule this
    // replaces asked whether a control was an `<input>`, so a date field,
    // being a button underneath, sat at 14px beside a 16px text field in
    // the same form on the same phone.
    Input: Input.extend({
      vars: () => ({ wrapper: { '--input-fz': 'var(--q-input-fz)' } }),
    }),
    Checkbox: Checkbox.extend({
      defaultProps: {
        color: 'var(--q-primary)',
        iconColor: 'var(--q-primary-foreground)',
        size: 'xs',
        radius: 'sm',
      },
    }),
    Radio: Radio.extend({
      defaultProps: {
        color: 'var(--q-primary)',
        iconColor: 'var(--q-primary-foreground)',
        size: 'xs',
      },
    }),
    Divider: Divider.extend({
      defaultProps: { color: 'var(--q-border)' },
    }),
  },
})

// Mantine reads a fixed set of semantic variables for text, surfaces and
// borders; each one is redirected at the product token so every widget and
// every future widget draws from the same palette. The two grey steps the
// stock controls use for borders and the skeleton shimmer are pointed at the
// product border grey - the stock values carry a blue cast the product's
// zero-chroma palette forbids.
const cssVariables: CSSVariablesResolver = () => ({
  variables: {
    '--mantine-color-body': 'var(--q-background)',
    '--mantine-color-text': 'var(--q-foreground)',
    '--mantine-color-placeholder': 'var(--q-muted-foreground)',
    '--mantine-color-dimmed': 'var(--q-muted-foreground)',
    '--mantine-color-error': 'var(--q-danger)',
    '--mantine-color-anchor': 'var(--q-primary)',
    '--mantine-color-default': 'var(--q-surface)',
    '--mantine-color-default-hover': 'var(--q-surface-muted)',
    '--mantine-color-default-color': 'var(--q-foreground)',
    '--mantine-color-default-border': 'var(--q-border)',
    '--mantine-primary-color-filled': 'var(--q-primary)',
    '--mantine-primary-color-contrast': 'var(--q-primary-foreground)',
    // disabled controls rest on the product greys too; the stock values
    // come from the tinted gray/dark ramps and read as a blue cast
    '--mantine-color-disabled': 'var(--q-surface-muted)',
    '--mantine-color-disabled-color': 'var(--q-muted-foreground)',
    '--mantine-color-disabled-border': 'var(--q-border)',
  },
  light: {
    '--mantine-color-gray-3': 'var(--q-border)',
    '--mantine-color-gray-4': 'var(--q-border)',
  },
  dark: {
    '--mantine-color-dark-4': 'var(--q-border)',
  },
})

/**
 * Mounts the widget library under the Qualy theme.
 *
 * `scheme` must be the resolved value from the product ThemeProvider
 * (`useTheme().resolved`); passing it as `forceColorScheme` makes Mantine a
 * follower with no color-scheme state, storage or listeners of its own.
 */
export function UiProvider({
  scheme,
  children,
}: {
  scheme: 'light' | 'dark'
  children: ReactNode
}) {
  return (
    // One reduced-motion contract over all three motion systems: the widget
    // library has respectReducedMotion, StyleX has its media block, and this
    // is Motion's half - `user` drops movement and keeps the fades, so a
    // screen still tells the reader that something changed.
    <MotionConfig reducedMotion="user">
      <MantineProvider
        theme={qualyMantineTheme}
        forceColorScheme={scheme}
        cssVariablesResolver={cssVariables}
      >
        {children}
      </MantineProvider>
    </MotionConfig>
  )
}
