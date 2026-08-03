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
  loading: { id: 'common/state/loading', defaultMessage: 'Loading' },
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
  emptyPagesHint: {
    id: 'common/page/empty-hint',
    defaultMessage: 'Enable a business plugin in the assembly manifest.',
  },
  notFoundTitle: { id: 'common/page/not-found-title', defaultMessage: 'Page not found' },
  pageFailed: {
    id: 'common/component/page-failed',
    defaultMessage: 'This page could not be displayed.',
  },
  layoutFailed: {
    id: 'common/component/layout-failed',
    defaultMessage: 'The application shell could not be displayed.',
  },
  notFoundHint: {
    id: 'common/page/not-found-hint',
    defaultMessage: 'Check the address, or pick another page from the navigation.',
  },
} as const satisfies Record<string, MessageDescriptor>
