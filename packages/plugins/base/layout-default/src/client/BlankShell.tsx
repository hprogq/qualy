import * as stylex from '@stylexjs/stylex'
import { Outlet } from 'react-router'

// blank-shell/v1 provider: no chrome, the page owns the whole viewport.
//
// What it owes its page is the same thing the application shell owes its
// pages: a seat of a known height to stand in. The shell's seat is the room
// between the bars and the foot; this one's is the viewport, as a column,
// so a page that centres itself - and the not-found screen the host lands
// here for a viewer with no other shell - has the room to do it in without
// claiming the viewport's height on its own. A page that already takes the
// viewport, as the login page does, stands in it as before.

const styles = stylex.create({
  seat: {
    display: 'flex',
    flexDirection: 'column',
    minHeight: '100dvh',
  },
})

export default function BlankShell() {
  return (
    <div {...stylex.props(styles.seat)}>
      <Outlet />
    </div>
  )
}
