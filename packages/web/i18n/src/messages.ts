import { defineMessage, type MessageDescriptor } from '@qualy/i18n-contract'

// shell copy owned by the runtime itself; plugins declare their own. The
// two interpolating messages declare their placeholders, so a call site
// that forgets the value fails typecheck.
export const componentMissingMessage = defineMessage<{ component: string }>()({
  id: 'common/component/missing',
  defaultMessage: 'Missing renderer: {component}',
})

export const layoutMissingMessage = defineMessage<{ component: string }>()({
  id: 'common/layout/missing',
  defaultMessage: 'Missing layout renderer: {component}',
})

export const commonMessages = {
  retry: { id: 'common/action/retry', defaultMessage: 'Retry' },
  back: { id: 'common/action/back', defaultMessage: 'Back' },
  cancel: { id: 'common/action/cancel', defaultMessage: 'Cancel' },
  // for a panel whose changes have already been made, where 'cancel' would
  // promise to undo something
  close: { id: 'common/action/close', defaultMessage: 'Close' },
  loading: { id: 'common/state/loading', defaultMessage: 'Loading' },
  // the calendar's caption pickers, named for whoever cannot see them
  calendarMonth: { id: 'common/calendar/month', defaultMessage: 'Month' },
  calendarYear: { id: 'common/calendar/year', defaultMessage: 'Year' },
  clockHour: { id: 'common/clock/hour', defaultMessage: 'Hour' },
  clockMinute: { id: 'common/clock/minute', defaultMessage: 'Minute' },
  // a paginated list that is not showing everything says so; the alternative
  // is a silent truncation that reads as "this is all of it"
  moreResults: {
    id: 'common/state/more-results',
    defaultMessage: 'More results are available. Narrow the search to see them.',
  },
  manifestLoadFailed: {
    id: 'common/manifest/load-failed',
    defaultMessage: 'Could not load the interface manifest. Check your connection.',
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
    defaultMessage: 'No page in this deployment is available to your account.',
  },
  goHome: { id: 'common/action/go-home', defaultMessage: 'Go to the home page' },
  notFoundTitle: { id: 'common/page/not-found-title', defaultMessage: 'Page not found' },
  pageFailed: {
    id: 'common/component/page-failed',
    defaultMessage: 'This page could not be displayed.',
  },
  layoutFailed: {
    id: 'common/component/layout-failed',
    defaultMessage: 'The application shell could not be displayed.',
  },
  // the manifest is an authorization projection, so the shell cannot tell
  // "no such page" from "not yours to see", and must not, since answering
  // differently would leak which pages exist
  notFoundHint: {
    id: 'common/page/not-found-hint',
    defaultMessage: 'This address does not match any page available to you.',
  },
} as const satisfies Record<string, MessageDescriptor>
