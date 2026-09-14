import * as stylex from '@stylexjs/stylex'

import { tokens } from '../theme/tokens.stylex.ts'

// One veil for the whole overlay family - dialog, alert, sheet - in two
// layers, because of one rule of WebKit's: the layer that carries a
// backdrop-filter has the blur re-run on every frame in which any property
// of its own changes. Its opacity, its colour, anything. So the blur is a
// layer of its own that never changes once it is on the page - laid down
// the moment the veil mounts and taken up the moment it unmounts, computed
// once in between - and the dimming is a plain colour on a child above
// it, outside the blur's backdrop, free to fade in and out as it likes.
//
// The child, not a parent: an ancestor with opacity under one becomes the
// blur's backdrop root, and the blur would then see only that ancestor's
// own contents rather than the page.
//
// The blur layer keeps a faint tint of its own, so the browser's chrome has
// a colour to read off the page's edge before the child has faded in. The
// two tints compose to the scrim token - a third of it below, two thirds
// above.
//
// The rule about never changing governs the veil's LIFE, not its leaving.
// Fading only the child left the blur and its trace standing at full
// strength until the panel had gone and the whole veil unmounted, and then
// cut in a single frame - small on a desktop dialog, the whole screen on a
// phone, where the panel covers it. So the last EXIT_MS fades both layers.
// Recomputing the blur for those few frames costs nothing anybody waits
// on: nothing follows them but the unmount. An element's own opacity does
// not make it the blur's backdrop root - only an ancestor's does - so the
// blur goes on seeing the page while it fades.

const REDUCE = '@media (prefers-reduced-motion: reduce)'

export const veil = stylex.create({
  blur: {
    isolation: 'isolate',
    backgroundColor: `color-mix(in oklab, ${tokens.scrim} 35%, transparent)`,
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
  },
  tint: {
    position: 'absolute',
    inset: 0,
    pointerEvents: 'none',
    backgroundColor: `color-mix(in oklab, ${tokens.scrim} 70%, transparent)`,
    animationName: { default: 'q-tint-in', [REDUCE]: 'none' },
    animationDuration: { default: '150ms', [REDUCE]: '0s' },
    animationTimingFunction: 'ease-out',
  },
  // the way out, as long as the panel's own, worn by both layers
  closing: {
    opacity: 0,
    transitionProperty: { default: 'opacity', [REDUCE]: 'none' },
    transitionTimingFunction: 'ease',
  },
  exit: (ms: number) => ({
    transitionDuration: `${String(ms)}ms`,
  }),
})
