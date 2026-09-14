import { Component, Suspense, type ComponentType, type ReactNode } from 'react'
import { surfaceLabel, type BrowserSurface } from '@qualy/ui-contract'
import { captureDiagnostic, captureException } from '@qualy/plugin-rum/client'
import { resolveSurface, type ComponentRegistry } from './registry.ts'

// One plugin component must never take down the shell. Every surface the
// manifest names — layout, page, slot item, sign-in renderer — renders inside
// this boundary, which reports the failing SURFACE and shows the caller's
// fallback instead of a blank screen or a raw stack.
//
// The surface is the address, so this resolves it too. A caller that looked
// the component up itself and passed both could pass a component belonging to
// one address under another, and the console line and the report would then
// name the wrong screen - which is the one thing they exist for.

interface BoundaryProps {
  surface: BrowserSurface
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
    // which screen it was is what makes a plugin failure diagnosable at all -
    // and `page assessment/review` is a product fact, where the module path
    // it used to print was a piece of this repository's layout
    console.error(`[qualy] ${surfaceLabel(this.props.surface)} failed`, error)
    // the same fact is what a report is worth reading with: this is the one
    // seam where a component failure is already identified, so it is where it
    // gets reported rather than at each of them
    captureException(error, { surface: this.props.surface })
    this.props.onError?.(error)
  }

  override render() {
    if (this.state.failed) return this.props.fallback(() => this.setState({ failed: false }))
    return this.props.children
  }
}

// resolves a surface against the registry and renders it inside the boundary
// plus its own suspense; a surface the build does not carry is reported
// rather than silently skipped
export function PluginComponent({
  surface,
  registry,
  props,
  loading,
  fallback,
  missing,
}: {
  surface: BrowserSurface
  registry: ComponentRegistry
  /**
   * What the contribution is rendered with.
   *
   * Separate from the component because React reconciles by TYPE identity: a
   * caller that closed over its arguments in a fresh arrow per render made
   * every re-render a remount, so a slot's contributions lost their state and
   * refetched. The type stays the registry's, and only these change.
   */
  props?: Record<string, unknown>
  loading: ReactNode
  fallback: (retry: () => void) => ReactNode
  missing: ReactNode
}) {
  const Resolved = resolveSurface(registry, surface) as
    ComponentType<Record<string, unknown>> | undefined
  if (!Resolved) {
    console.error(
      `[qualy] ${surfaceLabel(surface)} is missing from this build; ` +
        'the manifest and the browser bundle disagree',
    )
    // A deployment fact, not an exception: the manifest offered a surface
    // this build does not carry, which says the two were assembled apart.
    // Reported as a diagnostic so it keeps its own shape instead of arriving
    // as a crash with a stack that points at this line.
    captureDiagnostic('surface-missing', {
      surfaceKind: surface.kind,
      surface: surfaceLabel(surface),
    })
    return <>{missing}</>
  }
  return (
    <PluginComponentBoundary surface={surface} fallback={fallback}>
      <Suspense fallback={loading}>
        <Resolved {...(props ?? {})} />
      </Suspense>
    </PluginComponentBoundary>
  )
}
