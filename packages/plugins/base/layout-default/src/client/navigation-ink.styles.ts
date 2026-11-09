import * as stylex from '@stylexjs/stylex'

// Stroke under the fill adds ink without changing the glyph advances. Fade
// its color, since stroke width itself does not interpolate across engines.
export const navigationInk = stylex.create({
  label: {
    paintOrder: 'stroke fill',
    WebkitTextStrokeWidth: '0.015em',
    WebkitTextStrokeColor: 'transparent',
    transitionProperty: '-webkit-text-stroke-color',
    transitionDuration: { default: '150ms', '@media (prefers-reduced-motion: reduce)': '0ms' },
    transitionTimingFunction: 'ease-out',
  },
  selected: { WebkitTextStrokeColor: 'currentColor' },
})
