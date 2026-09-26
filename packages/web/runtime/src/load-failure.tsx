import { useCallback, useMemo, type ReactNode } from 'react'
import { Link } from 'react-router'
import { RotateCwIcon } from 'lucide-react'
import type { NamespacedId } from '@qualy/ui-contract'
import { Button } from '@qualy/ui/button'
import { Spinner } from '@qualy/ui/spinner'
import {
  ResourceState,
  type ResourceFailure,
  type ResourceStateKind,
} from '@qualy/ui/resource-state'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { usePageHref } from './runtime-context.tsx'
import type { PageHrefOptions } from './pages.ts'
import { loadFailureKind, retryHelps, subjectFailureKind } from './failure-kind.ts'
import { useClaimDocumentTitle } from './document-title.tsx'

// A reading that failed, worded for the reader and drawn as a state (see
// failure-kind.ts for how it is told apart). The generic words say what
// happened to "this"; an owner that knows the noun - a batch, a person -
// says its own heading instead, and keeps the generic sentence under it
// unless it has a better one.

export interface LoadFailureOptions {
  /** the codes that mean the thing being read is not there, as its owner declares them */
  readonly missing?: readonly string[]
  /** the owner's own words, by kind; whatever it leaves out stays generic */
  readonly copy?: Partial<
    Record<ResourceStateKind, { readonly title?: string; readonly description?: string }>
  >
}

const words = {
  missing: [commonMessages.loadMissingTitle, commonMessages.loadMissingHint],
  denied: [commonMessages.loadDeniedTitle, commonMessages.loadDeniedHint],
  offline: [commonMessages.loadOfflineTitle, commonMessages.loadOfflineHint],
  unavailable: [commonMessages.loadUnavailableTitle, commonMessages.loadUnavailableHint],
  failed: [commonMessages.loadFailedTitle, commonMessages.loadFailedHint],
} as const

export interface LoadFailureWords {
  /** a reading that failed, classified and worded */
  readonly of: (error: unknown, options?: LoadFailureOptions) => ResourceFailure
  /** the thing is not there, known without asking: an address that names nothing */
  readonly missing: (options?: LoadFailureOptions) => ResourceFailure
  /**
   * The failure of the reading a screen is about, or null while the screen
   * still has something to show (see `subjectFailureKind`).
   */
  readonly subject: (
    query: { readonly data: unknown; readonly error: unknown; readonly isError: boolean },
    options?: LoadFailureOptions,
  ) => ResourceFailure | null
}

/**
 * Words for a reading that failed, in the reader's language: pass the
 * result to `AsyncSection`'s `error` for one pane, or to `LoadFailure` for
 * a whole page.
 */
export function useLoadFailure(): LoadFailureWords {
  const { format } = useI18n()
  const worded = useCallback(
    (kind: ResourceStateKind, options?: LoadFailureOptions): ResourceFailure => {
      const [title, description] = words[kind]
      const own = options?.copy?.[kind]
      return {
        kind,
        title: own?.title ?? format(title),
        description: own?.description ?? format(description),
        retryable: retryHelps(kind),
      }
    },
    [format],
  )
  return useMemo(
    () => ({
      of: (error, options) => worded(loadFailureKind(error, options?.missing), options),
      missing: (options) => worded('missing', options),
      subject: (query, options) => {
        const kind = subjectFailureKind(query, options?.missing)
        return kind === null ? null : worded(kind, options)
      },
    }),
    [worded],
  )
}

/** what no manifest names, for the hook that must be asked whether or not there is a way back */
const NO_PAGE = 'none/none' as NamespacedId

/** a way out of a failed page, named by the page it leads to */
export interface LoadFailureWayBack extends PageHrefOptions {
  readonly page: NamespacedId
  readonly label: string
}

/**
 * A failed reading drawn as a state: the heading, the sentence, and the
 * ways out - asking again when that can help, and back to where the reader
 * came from when the owner names it. A way back to a page the reader cannot
 * open is left out rather than drawn as a dead link. At page size the
 * heading also names the browser tab while it stands.
 */
export function LoadFailure({
  failure,
  onRetry,
  retrying = false,
  back,
  size = 'page',
  headingLevel,
  extra,
}: {
  failure: ResourceFailure
  onRetry?: () => void
  /** a retry is on its way: the button says so rather than taking a second press */
  retrying?: boolean
  back?: LoadFailureWayBack
  size?: 'page' | 'section'
  /**
   * A section's heading rank: 2 on the page's own ground (the default), 3
   * inside a card or a dialog that has a title of its own. A page is always 1.
   */
  headingLevel?: 2 | 3 | 4
  /** anything else worth offering, after the ways out */
  extra?: ReactNode
}) {
  const { format } = useI18n()
  useClaimDocumentTitle(size === 'page' ? failure.title : null)
  const backHref = usePageHref(back?.page ?? NO_PAGE, back)
  const retry = failure.retryable && onRetry !== undefined
  const buttonSize = size === 'page' ? 'default' : 'sm'
  const actions: ReactNode[] = []
  if (retry) {
    actions.push(
      <Button
        key="retry"
        size={buttonSize}
        disabled={retrying}
        aria-busy={retrying || undefined}
        onClick={onRetry}
      >
        {retrying ? <Spinner aria-hidden /> : <RotateCwIcon aria-hidden />}
        {format(commonMessages.retry)}
      </Button>,
    )
  }
  if (back !== undefined && backHref !== undefined) {
    actions.push(
      <Button key="back" asChild size={buttonSize} variant={retry ? 'outline' : 'default'}>
        <Link to={backHref} data-way-back="">
          {back.label}
        </Link>
      </Button>,
    )
  }
  if (extra !== undefined) actions.push(extra)
  return (
    <ResourceState
      kind={failure.kind}
      title={failure.title}
      description={failure.description}
      size={size}
      {...(size === 'section' && headingLevel !== undefined ? { headingLevel } : {})}
      actions={actions}
    />
  )
}
