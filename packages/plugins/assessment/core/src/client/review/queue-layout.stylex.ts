import * as stylex from '@stylexjs/stylex'

// The one-row toolbar and the index use the same measure, so the index
// can stick below the toolbar before any JavaScript measures the page.
export const reviewLayout = stylex.defineConsts({
  wide: '@container review-board (min-width: 880px)',
  controlHeight: '36px',
  toolbarStickyTop: '16px',
  toolbarFadeEdge: '16px',
})
