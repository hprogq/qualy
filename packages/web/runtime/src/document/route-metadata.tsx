import { useEffect, useRef, type ReactNode } from 'react'
import { matchRoutes, useLocation, useNavigation } from 'react-router'
import { recordNavigation, setObservedPage } from '@qualy/browser-observability'
import { useManifest, type Manifest } from '../runtime-context.tsx'
import { DocumentTitleScope, useDocumentTitleOverride } from './document-title.tsx'

/** Page identity, diagnostics and title follow the authorized server projection. */
export function RouteMetadata({ children }: { children: ReactNode }) {
  const { pages, layouts } = useManifest()
  const { pathname, key } = useLocation()
  const navigation = useNavigation()
  const pending = useRef<{ key: string; started: number } | null>(null)
  const available = new Set(layouts.map(({ contract }) => contract))
  const page = matchRoutes(
    pages.filter(({ layout }) => available.has(layout)),
    pathname,
  )?.at(-1)?.route
  useEffect(() => {
    const next = navigation.location
    if (navigation.state !== 'idle' && next !== undefined) {
      if (pending.current?.key !== next.key) {
        pending.current = { key: next.key, started: performance.now() }
      }
      return
    }
    const completed = pending.current
    pending.current = null
    if (completed?.key === key && page !== undefined) {
      recordNavigation({ pageId: page.id, route: page.path }, performance.now() - completed.started)
    }
  }, [navigation.state, navigation.location, key, page?.id, page?.path])
  return (
    <DocumentTitleScope>
      <DocumentTitle title={page?.title} />
      <ObservedRoute page={page} />
      {children}
    </DocumentTitleScope>
  )
}

/**
 * Which screen a browser failure happened on, named the way the manifest
 * names it.
 *
 * A reporting platform must never be told the real address. `/assessment/
 * batches/019a.../review?student=...` identifies a batch and a person and
 * groups into an issue nobody can read; `assessment/review` with its route
 * template identifies a screen, which is the thing anybody would actually
 * ask about. Both come from the authorized manifest, so a page a viewer may
 * not see never names itself here either.
 *
 * Beside `DocumentTitle` and matching the same way on purpose: the two
 * answer the same question - which page is this - and a second way of
 * deciding it would eventually disagree with the first.
 */
function ObservedRoute({ page }: { page: Manifest['pages'][number] | undefined }) {
  const pageId = page?.id
  const route = page?.path
  useEffect(() => {
    setObservedPage(pageId === undefined || route === undefined ? {} : { pageId, route })
  }, [pageId, route])
  return null
}

// The product suffix shared by page titles.
const PRODUCT = 'Qualy'

/**
 * What the browser tab, the history entry and a bookmark call this page.
 *
 * The manifest already carries the words - a page's own title, or the ones
 * its menu entry uses - so the title follows the same authorized projection
 * as everything else, and a page nobody may see never names itself. Pages
 * without either keep the product's own name rather than inventing one from
 * the address. A page that cannot be shown - its record is not there - is
 * named by what stands in its place (document-title.tsx).
 */
function DocumentTitle({ title }: { title: string | undefined }) {
  const instead = useDocumentTitleOverride()
  useEffect(() => {
    const name = instead ?? title
    document.title = name === undefined ? PRODUCT : `${name} - ${PRODUCT}`
  }, [instead, title])
  return null
}
