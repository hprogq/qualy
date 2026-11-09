import * as stylex from '@stylexjs/stylex'

// The slot's fallback and its implementation use the same viewport-bounded
// seat. Neither the options nor a page of people determine the dialog height.
export const peoplePickerLayout = stylex.defineConsts({
  height: 'min(30rem, max(18rem, 62dvh), 72dvh)',
})
