import * as stylex from '@stylexjs/stylex'

// The three widths the product is laid out for, named once.
//
// Every media query in browser code goes through these, so the phone
// boundary is the same number everywhere: the hook that folds the shell
// (use-mobile.ts, 768) and the stylesheets agree by construction. A rule
// is written with its widest layout as the default and the narrower one
// under `phone`; `desktop` is for the few grids that grow a third column.
//
// A conditional value of `null` means "declare nothing under this
// condition", NOT "reset": `{ default: X, [phone]: null }` is X everywhere,
// because the phone branch declares nothing and the default keeps applying.
// A rule that exists only from the tablet up is therefore written as
// `{ default: null, [tablet]: X, [desktop]: X }` - two keys, never
// `[phone]: null`. This has been got wrong once already.
export const breakpoints = stylex.defineConsts({
  phone: '@media (max-width: 767.98px)',
  tablet: '@media (min-width: 768px) and (max-width: 1023.98px)',
  desktop: '@media (min-width: 1024px)',
})
