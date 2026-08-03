import type { MessageDescriptor } from '@qualy/i18n-contract'

// shell copy owned by the runtime itself; plugins declare their own
const define = <T extends Record<string, MessageDescriptor>>(messages: T) => messages

export const commonMessages = define({
  retry: { id: 'common/action/retry', defaultMessage: 'Retry' },
  back: { id: 'common/action/back', defaultMessage: 'Back' },
  cancel: { id: 'common/action/cancel', defaultMessage: 'Cancel' },
  loading: { id: 'common/state/loading', defaultMessage: 'Loading' },
  manifestLoadFailed: {
    id: 'common/manifest/load-failed',
    defaultMessage: 'Could not load the interface manifest. Check your connection.',
  },
  componentMissing: {
    id: 'common/component/missing',
    defaultMessage: 'Missing renderer: {component}',
  },
  layoutMissing: {
    id: 'common/layout/missing',
    defaultMessage: 'Missing layout renderer: {component}',
  },
  emptyPagesTitle: { id: 'common/page/empty-title', defaultMessage: 'No pages available' },
  emptyPagesHint: {
    id: 'common/page/empty-hint',
    defaultMessage: 'Enable a business plugin in the assembly manifest.',
  },
  notFoundTitle: { id: 'common/page/not-found-title', defaultMessage: 'Page not found' },
  notFoundHint: {
    id: 'common/page/not-found-hint',
    defaultMessage: 'Check the address, or pick another page from the navigation.',
  },
})
