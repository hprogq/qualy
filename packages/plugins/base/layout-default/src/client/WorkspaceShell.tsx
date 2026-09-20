import { workspaceContext, workspaceNavigation, workspaceNavigationBadge } from '@qualy/ui-contract'
import { RailShell } from './RailShell.tsx'

// workspace-shell/v1 provider: the rail shell around the thing being worked
// on, with the workspace's own rail, context bar and live badges.

export default function WorkspaceShell() {
  return (
    <RailShell
      navigation={workspaceNavigation}
      context={workspaceContext}
      badge={workspaceNavigationBadge}
    />
  )
}
