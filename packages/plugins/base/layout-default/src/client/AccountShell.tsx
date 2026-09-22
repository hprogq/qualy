import { accountHeader, accountNavigation } from '@qualy/ui-contract'
import { RailShell } from './RailShell.tsx'

// account-shell/v1 provider: the rail shell around the reader themselves.
// The banner is whoever owns sessions saying who is signed in; the rail is
// every part of the product that keeps something of theirs, one page each.

export default function AccountShell() {
  return <RailShell navigation={accountNavigation} context={accountHeader} banner />
}
