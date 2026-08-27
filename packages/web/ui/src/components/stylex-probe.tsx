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
