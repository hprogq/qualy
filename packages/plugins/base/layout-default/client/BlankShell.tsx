import { Outlet } from 'react-router'

// blank-shell/v1 provider: no chrome, the page owns the whole viewport
export default function BlankShell() {
  return <Outlet />
}
