import type { ReactNode } from 'react'
import type { UiCollectionToken, UiSlotContext, UiSlotKey, UiSlotToken } from '@qualy/ui-contract'
import { useManifest, useRuntime } from '../runtime-context.tsx'
import { PluginComponent, type PluginComponentProps } from './component-boundary.tsx'
import { SlotReferenceComponent } from './slot-reference.tsx'

/**
 * One surface of this build, rendered: isolated, reported, and drawn with the
 * caller's own states for loading, failing and not being here at all.
 *
 * The same component the route tree and the slots use, resolved against the
 * runtime's registry instead of one passed in - which is what a plugin has.
 * There is deliberately no way to get the raw component out: a caller that
 * rendered it itself would be outside the boundary, so a renderer that threw
 * would take the screen with it and nothing would report which surface it
 * was. That is exactly what the sign-in screen used to do.
 */
export function PluginSurface(props: Omit<PluginComponentProps, 'registry'>) {
  const { registry, loadSlotReference } = useRuntime()
  if (props.surface.kind === 'slot' && loadSlotReference !== undefined) {
    return <SlotReferenceComponent {...props} surface={props.surface} load={loadSlotReference} />
  }
  return <PluginComponent {...props} registry={registry} />
}
export function useUiCollection<TContribution, TResolved>(
  token: UiCollectionToken<TContribution, TResolved>,
): TResolved[] {
  const manifest = useManifest()
  return (manifest.collections[token.key] ?? []) as TResolved[]
}

// renders every contribution of a slot surface, each item isolated behind
// its own suspense and error boundary; context is runtime state handed down
// by the surrounding layout or page, never serialized into the manifest.
// A failing or missing slot item takes no layout space but is always
// reported — silence here used to hide broken contributions completely.
export function UiSlot<K extends UiSlotKey>({
  token,
  context,
  fallback,
  loading,
  waitForFirstPaint = false,
}: {
  token: UiSlotToken<K>
  /**
   * What to show when nobody contributes here.
   *
   * A surface is empty for two ordinary reasons - the plugin that fills it is
   * not installed, or the viewer may not see what it offers - and a slot that
   * a screen depends on for meaning (a person's name, say) must not leave a
   * hole in either case. Absent by design for decorative surfaces.
   */
  fallback?: ReactNode
  /**
   * What stands there while the contribution's chunk is in flight.
   *
   * Defaults to the fallback, which is right when the fallback is the same
   * thing drawn plainly - a person's name, say. It is wrong when the fallback
   * says "you may not see this", because for a moment that is what a reader
   * who may see it is told. Anything with a fallback like that passes a
   * skeleton here instead.
   */
  loading?: ReactNode
  /** keep this chrome in the first HTML frame of a server-rendered document */
  waitForFirstPaint?: boolean
} & (undefined extends NoInfer<UiSlotContext<K>>
  ? { context?: NoInfer<UiSlotContext<K>> }
  : { context: NoInfer<UiSlotContext<K>> })) {
  const manifest = useManifest()
  const items = manifest.slots[token.key] ?? []
  if (items.length === 0) return <>{fallback ?? null}</>
  // While the contribution's chunk is in flight the fallback holds its place.
  // Rendering nothing there is what made a table of names appear a beat after
  // the rest of the row and push everything sideways when it arrived: the
  // fallback is the same person drawn the plain way, so the swap is invisible.
  return (
    <>
      {items.map((item) => (
        <PluginSurface
          key={item.id}
          surface={{ kind: 'slot', slot: token.key, id: item.id }}
          props={{ context }}
          loading={loading ?? fallback ?? null}
          waitForFirstPaint={waitForFirstPaint}
          fallback={() => null}
          missing={null}
        />
      ))}
    </>
  )
}
