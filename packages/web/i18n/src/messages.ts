import type { MessageDescriptor } from '@qualy/i18n-contract'

// Shell copy owned by the runtime itself; plugins declare their own. Every
// sentence here is what the reader sees when something did not work, so it
// names the reader's situation and the reader's move - never the manifest,
// the renderer, the deployment or the server that failed, which are the
// console's and the telemetry's to name. The release notices say three
// things whatever the page found out: a newer Qualy is there and the page
// still works; the page must be reloaded to go on (a chunk gone with a
// newer release, a server that no longer speaks this page - the reader's
// move is the same); the page could not be loaded at all. The ids keep the
// distinction the code and the telemetry make; the words do not.
// Said to the reader when a page's module is not in the bundle; which
// module is a fact for the console and the telemetry, never for the screen
export const componentMissingMessage = {
  id: 'common/component/missing',
  defaultMessage: 'This page cannot be opened right now',
} as const satisfies MessageDescriptor

export const layoutMissingMessage = {
  id: 'common/layout/missing',
  defaultMessage: 'Qualy cannot be displayed right now. Try again.',
} as const satisfies MessageDescriptor

export const commonMessages = {
  retry: { id: 'common/action/retry', defaultMessage: 'Retry' },
  back: { id: 'common/action/back', defaultMessage: 'Back' },
  cancel: { id: 'common/action/cancel', defaultMessage: 'Cancel' },
  // for a panel whose changes have already been made, where 'cancel' would
  // promise to undo something
  close: { id: 'common/action/close', defaultMessage: 'Close' },
  yes: { id: 'common/answer/yes', defaultMessage: 'Yes' },
  no: { id: 'common/answer/no', defaultMessage: 'No' },
  loading: { id: 'common/state/loading', defaultMessage: 'Loading' },
  // under the wordmark once a cold start has run past six seconds; said
  // again in bootstrap.ts for before the catalogs, and held in step by a test
  stillLoading: {
    id: 'common/state/still-loading',
    defaultMessage: 'Taking longer than expected…',
  },
  // the release recovery notices, said again in bootstrap.ts for the gate
  // that stands above the catalogs, and held in step by a test
  updateAvailableTitle: {
    id: 'common/release/update-available-title',
    defaultMessage: 'Qualy has been updated',
  },
  updateAvailableHint: {
    id: 'common/release/update-available-hint',
    defaultMessage: 'Reload to use the latest version.',
  },
  later: { id: 'common/action/later', defaultMessage: 'Later' },
  reloadNow: { id: 'common/action/reload', defaultMessage: 'Reload' },
  releaseSkewTitle: { id: 'common/release/skew-title', defaultMessage: 'Reload needed' },
  releaseSkewHint: {
    id: 'common/release/skew-hint',
    defaultMessage: 'Reload the page to continue.',
  },
  assetFailedTitle: {
    id: 'common/release/asset-failed-title',
    defaultMessage: 'The page could not be loaded',
  },
  assetFailedHint: {
    id: 'common/release/asset-failed-hint',
    defaultMessage: 'Check your connection and reload the page.',
  },
  clientProtocolTitle: {
    id: 'common/release/client-protocol-title',
    defaultMessage: 'Reload needed',
  },
  clientProtocolHint: {
    id: 'common/release/client-protocol-hint',
    defaultMessage: 'Reload the page to continue.',
  },
  reloadPage: { id: 'common/action/reload-page', defaultMessage: 'Reload the page' },
  // what a picker says while nothing has been chosen, and the press that
  // puts it back to that
  unanswered: { id: 'common/state/unanswered', defaultMessage: 'Not set' },
  clear: { id: 'common/action/clear', defaultMessage: 'Clear' },
  // the calendar's caption pickers, named for whoever cannot see them
  clockHour: { id: 'common/clock/hour', defaultMessage: 'Hour' },
  clockMinute: { id: 'common/clock/minute', defaultMessage: 'Minute' },
  clockSecond: { id: 'common/clock/second', defaultMessage: 'Second' },
  calendarMonth: { id: 'common/calendar/month', defaultMessage: 'Month' },
  calendarYear: { id: 'common/calendar/year', defaultMessage: 'Year' },
  // the press that opens what a band had no room to lay out; every screen
  // that folds its actions names it the same, so it is named once here
  bandMore: { id: 'common/action/more', defaultMessage: 'More actions' },
  // a paginated list that is not showing everything says so; the alternative
  // is a silent truncation that reads as "this is all of it"
  moreResults: {
    id: 'common/state/more-results',
    defaultMessage: 'More results are available. Narrow the search to see them.',
  },
  // the heading over whatever the runtime could not load everything else
  // with; the sentence under it says what the reader can do
  manifestLoadFailed: {
    id: 'common/manifest/load-failed',
    defaultMessage: 'Qualy could not be loaded',
  },
  componentMissing: componentMissingMessage,
  layoutMissing: layoutMissingMessage,
  emptyPagesTitle: { id: 'common/page/empty-title', defaultMessage: 'No pages available' },
  // said to whoever is looking, which may be an operator with an empty
  // assembly manifest or a person whose account has not been granted
  // anything yet; both are told the same true thing and neither is told to
  // go edit a configuration file
  emptyPagesHint: {
    id: 'common/page/empty-hint',
    defaultMessage: 'Nothing is available to your account yet',
  },
  // the same screen for somebody signed in, whose one way out is to sign
  // out: what to do next, in the order most readers want it
  emptyPagesSignedInHint: {
    id: 'common/page/empty-signed-in-hint',
    defaultMessage: 'Ask an administrator for access, or sign out and use another account',
  },
  goHome: { id: 'common/action/go-home', defaultMessage: 'Go to the home page' },
  notFoundTitle: { id: 'common/page/not-found-title', defaultMessage: "This page can't be opened" },
  pageFailed: {
    id: 'common/component/page-failed',
    defaultMessage: 'This page could not be displayed',
  },
  layoutFailed: {
    id: 'common/component/layout-failed',
    defaultMessage: 'Qualy cannot be displayed right now',
  },
  // the manifest is an authorization projection, so the shell cannot tell
  // "no such page" from "not yours to see", and must not, since answering
  // differently would leak which pages exist
  notFoundHint: {
    id: 'common/page/not-found-hint',
    defaultMessage: 'It may not exist, or you may not have access',
  },
  // A reading that failed, said by what the reader can do about it. The
  // sentences a failed write gets (formatError) speak of an action; these
  // speak of something the reader came to look at. A plugin that knows the
  // noun - a batch, a person - says its own heading instead.
  loadMissingTitle: { id: 'common/load/missing-title', defaultMessage: "This can't be found" },
  loadMissingHint: {
    id: 'common/load/missing-hint',
    defaultMessage: 'The link may be out of date or mistyped',
  },
  loadDeniedTitle: { id: 'common/load/denied-title', defaultMessage: "You can't view this" },
  loadDeniedHint: {
    id: 'common/load/denied-hint',
    defaultMessage: 'Ask an administrator if you need access',
  },
  loadOfflineTitle: { id: 'common/load/offline-title', defaultMessage: "Can't reach Qualy" },
  loadOfflineHint: {
    id: 'common/load/offline-hint',
    defaultMessage: 'Check your connection and try again',
  },
  loadUnavailableTitle: {
    id: 'common/load/unavailable-title',
    defaultMessage: 'Qualy is unavailable right now',
  },
  loadUnavailableHint: {
    id: 'common/load/unavailable-hint',
    defaultMessage: 'Try again in a moment',
  },
  loadFailedTitle: { id: 'common/load/failed-title', defaultMessage: "This couldn't be loaded" },
  loadFailedHint: {
    id: 'common/load/failed-hint',
    defaultMessage: 'Try again, or contact an administrator if it keeps happening',
  },
  // Leaving a page with changes on it. Three answers, the safe one under
  // the reader's hand: keep editing, save and then go, or go and let the
  // changes drop.
  leaveTitle: { id: 'common/leave/title', defaultMessage: 'Leave this page?' },
  leaveHint: { id: 'common/leave/hint', defaultMessage: 'Some changes have not been saved' },
  leaveSave: { id: 'common/leave/save', defaultMessage: 'Save and leave' },
  leaveDiscard: { id: 'common/leave/discard', defaultMessage: 'Discard changes' },
  leaveStay: { id: 'common/leave/stay', defaultMessage: 'Keep editing' },
  // The session ended while the page was open. The reader signs in again in
  // another tab and comes back; what they were doing here carries on. If
  // somebody else signs in instead, the page can only start over as them.
  sessionLostTitle: { id: 'common/session/lost-title', defaultMessage: 'You have been signed out' },
  sessionLostHint: {
    id: 'common/session/lost-hint',
    defaultMessage:
      'Sign in again in a new tab, then come back here to carry on where you left off',
  },
  sessionSignIn: { id: 'common/session/sign-in', defaultMessage: 'Sign in in a new tab' },
  sessionSignOut: { id: 'common/session/sign-out', defaultMessage: 'Sign out' },
  sessionLater: { id: 'common/session/later', defaultMessage: 'Not now' },
  sessionSwitchedTitle: {
    id: 'common/session/switched-title',
    defaultMessage: 'Another account is signed in',
  },
  sessionSwitchedHint: {
    id: 'common/session/switched-hint',
    defaultMessage: 'Reload to continue as that account. What was not saved here is discarded',
  },
  sessionReload: { id: 'common/session/reload', defaultMessage: 'Reload' },
} as const satisfies Record<string, MessageDescriptor>
