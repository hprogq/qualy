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
      // the product's 3px translucent ring, worn by every Prime widget
      width: '3px',
      color: 'color-mix(in oklab, var(--q-focus-ring) 50%, transparent)',
    },
    // every form widget reads these: the product's tinted field surface,
    // its border, and the focus border that matches the ring
    formField: {
      background: 'color-mix(in oklab, var(--q-input) 30%, transparent)',
      borderColor: 'var(--q-input)',
      hoverBorderColor: 'var(--q-input)',
      focusBorderColor: 'var(--q-focus-ring)',
      invalidBorderColor: 'var(--q-danger)',
      color: 'var(--q-foreground)',
      placeholderColor: 'var(--q-muted-foreground)',
      paddingX: '0.75rem',
    },
  },
  components: {
    // The Qualy button geometry and palette over Prime's button machinery.
    // Colors ride the severity/variant classes the adapter picks; geometry
    // the tokens cannot say (exact heights, the xs tier, svg sizing) lives
    // in the component css below, keyed on the same data attributes the old
    // Tailwind implementation exposed.
    button: {
      root: {
        borderRadius: 'calc(var(--q-radius-lg) * 2.6)',
        gap: '0.375rem',
        paddingX: '0.75rem',
        fontSize: '0.875rem',
        iconOnlyWidth: '2.25rem',
        sm: { fontSize: '0.875rem', paddingX: '0.75rem', iconOnlyWidth: '2rem' },
        lg: { fontSize: '0.875rem', paddingX: '1rem', iconOnlyWidth: '2.5rem' },
        secondary: {
          background: 'var(--q-surface-muted)',
          hoverBackground: 'color-mix(in oklch, var(--q-surface-muted), var(--q-foreground) 5%)',
          activeBackground: 'color-mix(in oklch, var(--q-surface-muted), var(--q-foreground) 8%)',
          borderColor: 'transparent',
          hoverBorderColor: 'transparent',
          activeBorderColor: 'transparent',
          color: 'light-dark(oklch(0.205 0 0), oklch(0.985 0 0))',
          hoverColor: 'light-dark(oklch(0.205 0 0), oklch(0.985 0 0))',
          activeColor: 'light-dark(oklch(0.205 0 0), oklch(0.985 0 0))',
        },
      },
      outlined: {
        secondary: {
          borderColor: 'var(--q-border)',
          color: 'var(--q-foreground)',
          hoverBackground: 'color-mix(in oklab, var(--q-input) 50%, transparent)',
          activeBackground: 'color-mix(in oklab, var(--q-input) 65%, transparent)',
        },
      },
      text: {
        secondary: {
          color: 'var(--q-foreground)',
          hoverBackground: 'var(--q-surface-muted)',
          activeBackground: 'color-mix(in oklch, var(--q-surface-muted), var(--q-foreground) 5%)',
        },
        danger: {
          color: 'var(--q-danger)',
          hoverBackground: 'color-mix(in oklab, var(--q-danger) 20%, transparent)',
          activeBackground: 'color-mix(in oklab, var(--q-danger) 25%, transparent)',
        },
      },
      css: () => `
.p-button { height: 2.25rem; }
.p-button-sm { height: 2rem; gap: 0.25rem; }
.p-button-lg { height: 2.5rem; }
.p-button:active:not([aria-haspopup]) { translate: 0 1px; }
.p-button svg { pointer-events: none; flex-shrink: 0; }
.p-button svg:not([class*='size-']) { width: 1rem; height: 1rem; }
.p-button[data-size='xs'], .p-button[data-size='icon-xs'] { height: 1.5rem; font-size: 0.75rem; gap: 0.25rem; }
.p-button[data-size='xs'] { padding-inline: 0.625rem; }
.p-button[data-size='xs'] svg:not([class*='size-']), .p-button[data-size='icon-xs'] svg:not([class*='size-']) { width: 0.75rem; height: 0.75rem; }
.p-button-icon-only[data-size='icon-xs'] { width: 1.5rem; padding-inline: 0; }
.p-button:has([data-icon='inline-end']) { padding-inline-end: 0.625rem; }
.p-button:has([data-icon='inline-start']) { padding-inline-start: 0.625rem; }
.p-button-sm:has([data-icon='inline-end']), .p-button[data-size='xs']:has([data-icon='inline-end']) { padding-inline-end: 0.5rem; }
.p-button-sm:has([data-icon='inline-start']), .p-button[data-size='xs']:has([data-icon='inline-start']) { padding-inline-start: 0.5rem; }
.p-button-lg:has([data-icon='inline-end']) { padding-inline-end: 0.75rem; }
.p-button-lg:has([data-icon='inline-start']) { padding-inline-start: 0.75rem; }
.p-button-text[aria-expanded='true'], .p-button-outlined[aria-expanded='true'] { background: var(--q-surface-muted); color: var(--q-foreground); }
.p-button-text.p-button-danger { background: color-mix(in oklab, var(--q-danger) 10%, transparent); }
.p-button-text.p-button-danger[aria-expanded='true'] { background: color-mix(in oklab, var(--q-danger) 20%, transparent); color: var(--q-danger); }
`,
    },
    inputtext: {
      root: {
        borderRadius: 'calc(var(--q-radius-lg) * 2.6)',
      },
      // the 36px field the whole form rhythm hangs on; 16px type under a
      // coarse pointer so phones do not zoom the page on focus, 14px under
      // a fine one. The file selector button mirrors the old file: styles.
      css: () => `
.p-inputtext { height: 2.25rem; padding-block: 0.25rem; font-size: 1rem; transition: border-color 0.2s, background-color 0.2s; }
@media (pointer: fine) { .p-inputtext { font-size: 0.875rem; } }
.p-inputtext::file-selector-button { display: inline-flex; height: 1.75rem; border: 0; background: transparent; font-size: 0.875rem; font-weight: 500; color: var(--q-foreground); }
.p-inputtext:disabled { pointer-events: none; cursor: not-allowed; opacity: 0.5; }
`,
    },
    textarea: {
      root: {
        borderRadius: 'calc(var(--q-radius-lg) + 4px)',
      },
      // grows with its content, never a drag handle; same anti-zoom type
      // scale as the input
      css: () => `
.p-textarea { field-sizing: content; min-height: 4rem; resize: none; padding: 0.75rem; font-size: 1rem; }
@media (pointer: fine) { .p-textarea { font-size: 0.875rem; } }
`,
    },
  },
})
