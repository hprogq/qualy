import * as stylex from '@stylexjs/stylex'

// The StyleX face of the Qualy semantic tokens. Every value points at the
// stable --q-* custom property defined in styles/tokens.css, so light/dark
// keeps flipping on the .dark root class and StyleX components never learn
// a second theming mechanism. Consumers import this group instead of
// hardcoding colors, radii or any widget library's variable names.
export const tokens = stylex.defineVars({
  background: 'var(--q-background)',
  foreground: 'var(--q-foreground)',
  surface: 'var(--q-surface)',
  surfaceMuted: 'var(--q-surface-muted)',
  surfaceElevated: 'var(--q-surface-elevated)',
  border: 'var(--q-border)',
  input: 'var(--q-input)',
  focusRing: 'var(--q-focus-ring)',
  primary: 'var(--q-primary)',
  primaryForeground: 'var(--q-primary-foreground)',
  danger: 'var(--q-danger)',
  mutedForeground: 'var(--q-muted-foreground)',
  radiusSm: 'var(--q-radius-sm)',
  radiusMd: 'var(--q-radius-md)',
  radiusLg: 'var(--q-radius-lg)',
})
