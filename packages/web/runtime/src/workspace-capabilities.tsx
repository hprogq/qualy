import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

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
  readonly publish: (values: ReadonlySet<string> | null) => void
}

const Scope = createContext<CapabilityScope | null>(null)

/** mounted by the workspace shell, around both its rail and its content */
export function WorkspaceCapabilityScope({ children }: { children: ReactNode }) {
  const [state, setState] = useState<WorkspaceCapabilities>({ status: 'loading' })
  // a stable identity, deliberately: the publisher's effect depends on this
  // function, and a publish that minted a new publisher re-armed that effect
  // - publish, re-arm, withdraw, publish - until React called the loop out
  const publish = useCallback(
    (values: ReadonlySet<string> | null) =>
      setState(values === null ? { status: 'loading' } : { status: 'ready', values }),
    [],
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
 * Publishes the capability set of the open workspace, and withdraws it when
 * the values are null (a new workspace is loading) or the publisher leaves.
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
    publish(key === null ? null : new Set(key === '' ? [] : key.split(' ')))
    return () => publish(null)
  }, [publish, key])
}
