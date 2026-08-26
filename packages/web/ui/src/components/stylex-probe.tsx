import * as stylex from '@stylexjs/stylex'

// Infrastructure probe for the UI platform migration: proves the StyleX
// compiler transforms this workspace package (a pnpm symlink, not an
// optimized dep) in every pipeline - dev server, browser tests, production
// build. The sentinel values below are asserted by computed style in
// apps/web/tests/stylex-probe.browser.test.tsx and grepped for in the
// emitted CSS asset. Remove once the first real StyleX component lands in
// this package and takes over that role.
const styles = stylex.create({
  probe: {
    backgroundColor: '#0b1621',
    borderRadius: '7px',
    height: '8px',
    width: '8px',
  },
})

export function StyleXProbe() {
  return <div data-testid="stylex-probe-ui" aria-hidden {...stylex.props(styles.probe)} />
}

// The transitional cascade contract, worn by one element: a legacy Tailwind
// utility on a StyleX-styled node must keep winning, the way it won when both
// sides were Tailwind and tailwind-merge arbitrated. The utility layer is
// declared after the StyleX priority layers for exactly this reason, and the
// probe is what notices if that order ever regresses. Mixing className with a
// stylex.props spread is the antipattern the migration permits at exactly this
// boundary - a caller's classes over a component's compiled styles.
export function CascadeYieldProbe() {
  const sx = stylex.props(styles.probe)
  return (
    <div
      data-testid="stylex-yield-probe"
      aria-hidden
      {...sx}
      className={`${sx.className ?? ''} bg-[#123456]`}
    />
  )
}
