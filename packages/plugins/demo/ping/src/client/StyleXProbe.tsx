import * as stylex from '@stylexjs/stylex'

// Infrastructure probe for the UI platform migration: proves StyleX compiles
// plugin client source that reaches the build through the virtual plugin
// aggregation, not through a direct app import. The sentinel background is
// grepped for in the production CSS asset and asserted by computed style in
// apps/web/tests/stylex-probe.browser.test.tsx. Remove once the first real
// StyleX usage in a business plugin takes over that role.
const styles = stylex.create({
  probe: {
    backgroundColor: '#2c3742',
    borderRadius: '7px',
    height: '8px',
    width: '8px',
  },
})

export default function StyleXProbe() {
  return <div data-testid="stylex-probe-plugin" aria-hidden {...stylex.props(styles.probe)} />
}
