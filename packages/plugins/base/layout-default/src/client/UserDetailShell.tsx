import {
  userDetailHeader,
  userDetailNavigation,
  userDetailNavigationBadge,
} from '@qualy/ui-contract'
import { RailShell } from './RailShell.tsx'

// user-detail-shell/v1 provider: the rail shell around one person. The
// banner is whoever owns people saying who this is; the rail is every part
// of the product that keeps something about them, one page each.

export default function UserDetailShell() {
  return (
    <RailShell
      navigation={userDetailNavigation}
      context={userDetailHeader}
      badge={userDetailNavigationBadge}
      banner
    />
  )
}
