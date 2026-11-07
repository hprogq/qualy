import { useQuery } from '@tanstack/react-query'
import type { SlotSurface } from '@qualy/ui-contract'
import { PluginComponent, type PluginComponentProps } from './component-boundary.tsx'
import { identityOfManifest } from './document-identity.ts'
import { resolveSurface, withSurfaces, type RegisteredComponent } from './registry.ts'
import { useRuntime, type Manifest } from './runtime-context.tsx'

export type SlotReference =
  | { readonly kind: 'found'; readonly component: RegisteredComponent }
  | { readonly kind: 'denied' }
  | { readonly kind: 'missing' }

export type LoadSlotReference = (
  surface: SlotSurface,
  signal: AbortSignal,
) => Promise<SlotReference>

const QUERY = 'qualy:slot-reference'
const projectionOf = (manifest: Manifest, slot: string): string =>
  JSON.stringify((manifest.slots[slot] ?? []).map(({ id }) => id).sort())

/** The document's QueryClient supplies both deduplication and cancellation. */
export const staleSlotReference = (key: readonly unknown[], manifest: Manifest): boolean =>
  key[0] === QUERY &&
  (key[1] !== identityOfManifest(manifest) ||
    typeof key[2] !== 'string' ||
    key[3] !== projectionOf(manifest, key[2]))

export function SlotReferenceComponent({
  surface,
  load,
  ...props
}: Omit<PluginComponentProps, 'registry' | 'surface'> & {
  surface: SlotSurface
  load: LoadSlotReference
}) {
  const { manifest, registry } = useRuntime()
  const { slot, id } = surface
  const allowed = manifest.slots[slot]?.some((item) => item.id === id) === true
  const seeded = resolveSurface(registry, surface)
  const reference = useQuery({
    queryKey: [QUERY, identityOfManifest(manifest), slot, projectionOf(manifest, slot), id],
    queryFn: ({ signal }) => load(surface, signal),
    enabled: allowed && seeded === undefined,
    staleTime: Infinity,
    retry: false,
  })

  if (!allowed) return <>{props.missing}</>
  if (seeded !== undefined)
    return <PluginComponent {...props} surface={surface} registry={registry} />
  if (reference.isPending) return <>{props.loading}</>
  if (reference.isError)
    return (
      <>
        {props.fallback(() => {
          void reference.refetch()
        })}
      </>
    )
  if (reference.data.kind === 'denied') return <>{props.missing}</>
  const available =
    reference.data.kind === 'found'
      ? withSurfaces(registry, { slots: { [slot]: { [id]: reference.data.component } } })
      : registry
  return <PluginComponent {...props} surface={surface} registry={available} />
}
