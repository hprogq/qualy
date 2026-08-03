import { Component, Suspense, type ComponentType, type ReactNode } from 'react'

// One plugin component must never take down the shell. Every dynamically
// resolved component — layout, page, slot item, driver renderer — renders
// inside this boundary, which reports the failing component id and kind and
// shows the caller's fallback instead of a blank screen or a raw stack.

export type PluginComponentKind = 'layout' | 'page' | 'slot' | 'renderer'

interface BoundaryProps {
  componentId: string
  kind: PluginComponentKind
  // rendered when the component throws; a slot may choose to render nothing
  fallback: (retry: () => void) => ReactNode
  onError?: (error: unknown) => void
  children: ReactNode
}

interface BoundaryState {
  failed: boolean
}

export class PluginComponentBoundary extends Component<BoundaryProps, BoundaryState> {
  override state: BoundaryState = { failed: false }

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true }
  }

  override componentDidCatch(error: unknown) {
    // the id and kind are what makes a plugin failure diagnosable at all
    console.error(`[qualy] ${this.props.kind} component ${this.props.componentId} failed`, error)
    this.props.onError?.(error)
  }

  override render() {
    if (this.state.failed) return this.props.fallback(() => this.setState({ failed: false }))
    return this.props.children
  }
}

// resolves a component from the registry and renders it inside the boundary
// plus its own suspense; a component the build does not contain is reported
// rather than silently skipped
export function PluginComponent({
  componentId,
  kind,
  component: Resolved,
  loading,
  fallback,
  missing,
}: {
  componentId: string
  kind: PluginComponentKind
  component: ComponentType | undefined
  loading: ReactNode
  fallback: (retry: () => void) => ReactNode
  missing: ReactNode
}) {
  if (!Resolved) {
    console.error(
      `[qualy] ${kind} component ${componentId} is missing from this build; ` +
        'the manifest and the browser bundle disagree',
    )
    return <>{missing}</>
  }
  return (
    <PluginComponentBoundary componentId={componentId} kind={kind} fallback={fallback}>
      <Suspense fallback={loading}>
        <Resolved />
      </Suspense>
    </PluginComponentBoundary>
  )
}
