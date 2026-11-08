import {
  startTransition,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { RuntimeContext } from '../runtime-context.tsx'
import { sharedContext } from '../shared-context.ts'

// Who the reader is inside the thing currently open, as an opaque set of
// namespaced tokens ('assessment/review'). The shell that renders workspace
// navigation mounts the scope; whatever plugin owns the open workspace
// publishes the set it computed server-side; entries carrying a capability
// token render only while the set holds theirs.
//
// The unloaded state is explicit on purpose: treating "not published yet" as
// "no filtering" would flash every gated entry on arrival and then take the
// wrong ones away. Until the workspace has spoken, gated entries stay off
// the screen; ungated entries never wait.

export type WorkspaceCapabilities =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly values: ReadonlySet<string> }

interface CapabilityScope {
  readonly state: WorkspaceCapabilities
  readonly publish: (values: ReadonlySet<string> | null) => () => void
}

const Scope = sharedContext<CapabilityScope | null>('workspace-capabilities', null)

/** mounted by the workspace shell, around both its rail and its content */
export function WorkspaceCapabilityScope({
  children,
  pathname,
}: {
  children: ReactNode
  pathname?: string
}) {
  const initial = useContext(RuntimeContext)?.initialWorkspaceCapabilities
  const [published, setPublished] = useState<{
    pathname: string | undefined
    initial: readonly string[] | undefined
    state: WorkspaceCapabilities
  }>()
  const state = useMemo<WorkspaceCapabilities>(() => {
    if (published !== undefined && published.pathname === pathname && published.initial === initial)
      return published.state
    return initial === undefined
      ? { status: 'loading' }
      : { status: 'ready', values: new Set(initial) }
  }, [initial, pathname, published])
  // A live publication belongs to the address and server projection it was
  // read under. A new server projection replaces it immediately, even while
  // the replacement context component is still loading.
  const publish = useCallback(
    (values: ReadonlySet<string> | null) => {
      const publication = {
        pathname,
        initial,
        state:
          values === null ? { status: 'loading' as const } : { status: 'ready' as const, values },
      }
      // Publishing background reads must not discard visible server content
      // whose client module is still loading in a nested Suspense boundary.
      startTransition(() => setPublished(publication))
      // Unmounting a context slot is not an authorization result. Let the
      // server projection stand until a live publisher takes over again;
      // an old publisher must not withdraw its replacement's publication.
      return () => {
        startTransition(() =>
          setPublished((before) => (before === publication ? undefined : before)),
        )
      }
    },
    [pathname, initial],
  )
  const value = useMemo<CapabilityScope>(() => ({ state, publish }), [state, publish])
  return <Scope.Provider value={value}>{children}</Scope.Provider>
}

/**
 * What the open workspace has said so far. Outside any scope the answer is
 * permanently loading, which keeps gated entries off screens that have no
 * workspace to speak for them.
 */
export function useWorkspaceCapabilities(): WorkspaceCapabilities {
  const scope = useContext(Scope)
  return scope?.state ?? { status: 'loading' }
}

/**
 * Publishes the capability set of the open workspace. Null explicitly means
 * a workspace is loading; unmounting releases only this live publication,
 * leaving the server projection (if any) in place.
 * Called by the plugin that owns the workspace context, with values it read
 * from its own server - never computed in the browser.
 */
export function usePublishWorkspaceCapabilities(values: ReadonlySet<string> | null): void {
  const scope = useContext(Scope)
  const publish = scope?.publish
  // membership is the identity that matters; the set object may be rebuilt
  // per render by the caller
  const key = values === null ? null : [...values].sort().join(' ')
  useEffect(() => {
    if (publish === undefined) return
    return publish(key === null ? null : new Set(key === '' ? [] : key.split(' ')))
  }, [publish, key])
}
