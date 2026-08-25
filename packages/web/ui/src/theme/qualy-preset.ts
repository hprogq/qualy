import { definePreset } from '@primeuix/themes'
import Aura from '@primeuix/themes/aura'

// Only the tokens that must agree across styling systems point at the --q-*
// custom properties; everything widget-specific stays on Aura's defaults
// (docs/ui-platform-migration.md forbids copying the whole preset). The
// custom properties already flip on the .dark root class, so a single value
// serves both color schemes; darkModeSelector still matters for the tokens
// Aura defines per scheme itself.
export const QualyPreset = definePreset(Aura, {
  primitive: {
    borderRadius: {
      sm: 'var(--q-radius-sm)',
      md: 'var(--q-radius-md)',
      lg: 'var(--q-radius-lg)',
    },
  },
  semantic: {
    primary: {
      color: 'var(--q-primary)',
      contrastColor: 'var(--q-primary-foreground)',
      // the same 90%/80% blends the current Tailwind buttons use for
      // hover:bg-primary/90 and active states
      hoverColor: 'color-mix(in oklab, var(--q-primary) 90%, transparent)',
      activeColor: 'color-mix(in oklab, var(--q-primary) 80%, transparent)',
    },
    focusRing: {
      color: 'var(--q-focus-ring)',
    },
  },
})
