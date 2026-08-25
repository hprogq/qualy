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
    // the product grey is pure neutral; Aura's default surfaces are slate
    // (light) and zinc (dark), and the blue cast leaked into everything
    // severity-secondary. One chroma-free scale for both schemes, values
    // taken verbatim from the product palette in styles/tokens.css.
    surface: {
      0: '#ffffff',
      50: 'oklch(0.985 0 0)',
      100: 'oklch(0.97 0 0)',
      200: 'oklch(0.922 0 0)',
      300: 'oklch(0.87 0 0)',
      400: 'oklch(0.708 0 0)',
      500: 'oklch(0.556 0 0)',
      600: 'oklch(0.439 0 0)',
      700: 'oklch(0.371 0 0)',
      800: 'oklch(0.269 0 0)',
      900: 'oklch(0.205 0 0)',
      950: 'oklch(0.145 0 0)',
    },
    // The whole primary scale maps onto the neutral surfaces (the noir
    // pattern from the theming guide): Aura's default primary is emerald,
    // and every token that references a primary shade - the select
    // highlight, focus tints, checked states - was coming up green.
    primary: {
      50: '{surface.50}',
      100: '{surface.100}',
      200: '{surface.200}',
      300: '{surface.300}',
      400: '{surface.400}',
      500: '{surface.500}',
      600: '{surface.600}',
      700: '{surface.700}',
      800: '{surface.800}',
      900: '{surface.900}',
      950: '{surface.950}',
      color: 'var(--q-primary)',
      contrastColor: 'var(--q-primary-foreground)',
      hoverColor: 'color-mix(in oklab, var(--q-primary) 90%, transparent)',
      activeColor: 'color-mix(in oklab, var(--q-primary) 80%, transparent)',
    },
    // What a chosen row wears: the product's muted surface, not a tinted
    // accent. Focus does not repaint it - a chosen row that darkens when
    // the list gains focus reads as if the press landed on it.
    highlight: {
      background: 'var(--q-surface-muted)',
      focusBackground: 'var(--q-surface-muted)',
      color: 'var(--q-foreground)',
      focusColor: 'var(--q-foreground)',
    },
    focusRing: {
      // the product's 3px translucent ring, worn by every Prime widget
      width: '3px',
      color: 'color-mix(in oklab, var(--q-focus-ring) 50%, transparent)',
    },
    // every form widget reads these: the product's tinted field surface,
    // its border, and the focus border that matches the ring
    formField: {
      // the product's 14px form scale; Aura defaults to 1rem
      fontSize: '0.875rem',
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
      root: {},
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
    checkbox: {
      root: {
        width: '1rem',
        height: '1rem',
        borderRadius: '6px',
        background: 'light-dark(transparent, color-mix(in oklab, var(--q-input) 30%, transparent))',
      },
      icon: {
        size: '0.875rem',
      },
      // The touch target reaches well past the 16px box, as it always has.
      // The glyph shows only for a state that has something to say: Prime's
      // base css sizes whatever sits in the indicator but never hides it,
      // so an unticked box wore a dark check. Indeterminate keeps the old
      // look - an unfilled box with a foreground-colored mark.
      css: () => `
.p-checkbox { position: relative; }
.p-checkbox::after { content: ''; position: absolute; inset: -0.5rem -0.75rem; }
.p-checkbox:not(.p-checkbox-checked):not([data-indeterminate='true']) .p-checkbox-indicator svg { display: none; }
`,
    },
    radiobutton: {
      root: {
        width: '1rem',
        height: '1rem',
        background: 'light-dark(transparent, color-mix(in oklab, var(--q-input) 30%, transparent))',
      },
      icon: {
        size: '0.5rem',
      },
      css: () => `
.p-radiobutton { position: relative; }
.p-radiobutton::after { content: ''; position: absolute; inset: -0.5rem -0.75rem; }
`,
    },
    radiobuttongroup: {
      // the stacked default every form uses; a caller's own layout classes
      // sit in the utilities layer and win over this
      css: () => `
.p-radiobutton-group { display: grid; width: 100%; gap: 0.75rem; }
`,
    },
    select: {
      // The closed trigger echoes the choice on one line whatever the
      // option carried. Press feedback belongs to the row under the
      // pointer: hover tints it, active tints it deeper.
      css: () => `
.p-select-option:not(.p-disabled):hover { background: color-mix(in oklch, var(--q-surface-muted), var(--q-foreground) 3%); }
.p-select-option:not(.p-disabled):active { background: color-mix(in oklch, var(--q-surface-muted), var(--q-foreground) 8%); }
.p-select-value [data-slot='select-item-description'] { display: none; }
.p-select-list { outline: none; }
`,
    },
    menu: {
      // Prime marks the highlighted item with a class instead of real
      // focus, so the product's item states are said here
      css: () => `
.p-menu-item[data-variant='destructive'] { color: var(--q-danger); }
.p-menu-item[data-variant='destructive'] svg { color: var(--q-danger); }
.p-menu-item[data-variant='destructive'].p-focus { background: color-mix(in oklab, var(--q-danger) 10%, transparent); color: var(--q-danger); }
.p-menu-list { outline: none; }
`,
    },
    popover: {
      root: {
        gutter: '4px',
      },
      // the product panel: a 288px column with its own rhythm; callers strip
      // or resize it with utility classes that outrank this layer
      css: () => `
.p-popover-popup { display: flex; width: 18rem; flex-direction: column; gap: 1rem; padding: 1rem; font-size: 0.875rem; }
`,
    },
    tooltip: {
      // the bubble keeps the product type scale and the kbd chips keep
      // their inset look inside the inverted surface
      css: () => `
.p-tooltip-popup:has([data-slot='kbd']) { padding-inline-end: 0.375rem; }
.p-tooltip-popup [data-slot='kbd'] { position: relative; isolation: isolate; z-index: 50; border-radius: calc(var(--q-radius-lg) * 2.6); }
`,
    },
    tag: {
      root: {
        fontWeight: '500',
        padding: '0.125rem 0.5rem',
        gap: '0.25rem',
      },
      primary: {
        background: 'var(--q-primary)',
        color: 'var(--q-primary-foreground)',
      },
      secondary: {
        color: 'light-dark(oklch(0.205 0 0), oklch(0.985 0 0))',
      },
      danger: {
        background: 'color-mix(in oklab, var(--q-danger) 10%, transparent)',
        color: 'var(--q-danger)',
      },
      // the 20px chip line the product sets badges on, and the variants Tag
      // has no severity for
      css: () => `
.p-tag { height: 1.25rem; white-space: nowrap; }
.p-tag > svg { pointer-events: none; width: 0.75rem; height: 0.75rem; }
.p-tag[data-variant='outline'] { background: color-mix(in oklab, var(--q-input) 30%, transparent); border: 1px solid var(--q-border); color: var(--q-foreground); }
.p-tag[data-variant='ghost'] { background: transparent; color: var(--q-foreground); }
.p-tag[data-variant='link'] { background: transparent; color: var(--q-primary); text-underline-offset: 4px; }
.p-tag[data-variant='link']:hover { text-decoration: underline; }
`,
    },
    skeleton: {
      root: {
        background: 'var(--q-surface-muted)',
      },
    },
    divider: {
      root: {
        borderColor: 'var(--q-border)',
      },
      horizontal: {
        margin: '0',
        padding: '0',
      },
      vertical: {
        margin: '0',
        padding: '0',
      },
    },
    textarea: {
      root: {},
      // grows with its content, never a drag handle; same anti-zoom type
      // scale as the input
      css: () => `
.p-textarea { field-sizing: content; min-height: 4rem; resize: none; padding: 0.75rem; font-size: 1rem; }
@media (pointer: fine) { .p-textarea { font-size: 0.875rem; } }
`,
    },
  },
})
