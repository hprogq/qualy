import {
  resourceGrantPresenters,
  resourceGrantRenderer,
  type ResourceGrantContext,
} from '@qualy/ui-contract'
import { PluginSurface, useUiCollection } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { Skeleton } from '@qualy/ui/skeleton'
import { rbacMessages as m } from './i18n.ts'

/** as much of a grant as saying where it came from needs */
export interface OriginGrant {
  readonly id: string
  readonly roleName: string
  readonly resource: {
    readonly namespace: string
    readonly type: string
    readonly id: string
  } | null
  readonly validFrom: string | null
  readonly validUntil: string | null
}

/**
 * Where a confined grant came from, in the words of whoever owns the object.
 *
 * Exactly one renderer, looked up by the object's kind, rather than every
 * renderer in the slot: a slot renders all its contributions, and three
 * owners registering three explanations would each be asked about the
 * other two's objects. A kind nobody speaks for is named plainly.
 */
export function GrantOrigin({ grant }: { grant: OriginGrant }) {
  const { format } = useI18n()
  const presenters = useUiCollection(resourceGrantPresenters)
  const resource = grant.resource!
  const presenter = presenters.find(
    (candidate) => candidate.namespace === resource.namespace && candidate.type === resource.type,
  )
  const plain = (
    <span data-testid="grant-origin-plain">
      {format(m.confinedPlain, { namespace: resource.namespace, type: resource.type })}
    </span>
  )
  if (presenter === undefined) return plain
  const context: ResourceGrantContext = {
    grant: {
      id: grant.id,
      roleName: grant.roleName,
      resource,
      validFrom: grant.validFrom,
      validUntil: grant.validUntil,
    },
  }
  return (
    <PluginSurface
      surface={{ kind: 'slot', slot: resourceGrantRenderer.key, id: presenter.renderer }}
      props={{ context }}
      // a bar, not the plain sentence: the sentence would be replaced by the
      // owner's own a moment later, and that reads as the page changing its mind
      loading={<Skeleton height={11} width="8rem" radius={4} />}
      fallback={() => plain}
      missing={plain}
    />
  )
}
