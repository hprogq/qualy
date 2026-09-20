import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  resourceGrantPresenters,
  resourceGrantRenderer,
  type ResourceGrantContext,
} from '@qualy/ui-contract'
import {
  PluginSurface,
  useApi,
  useApiQuery,
  usePageRouteParams,
  useRunApi,
  useUiCollection,
} from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { AsyncSection, ConfirmDialog, Feedback } from '@qualy/ui/admin'
import { SectionHead } from '@qualy/ui/screen'
import { PageContainer } from '@qualy/ui/page-container'
import { Button } from '@qualy/ui/button'
import { rbacMessages as m } from './i18n.ts'
import { GrantRoleForm } from './GrantRoleForm.tsx'
import { accessApi } from './api.ts'
import { useMoment } from './when.ts'

// What one person has been granted, as a section of their record.
//
// Two lists, not one. A grant confined to one object - a round's reviewer,
// say - confers nothing outside that object, is made and withdrawn through
// the object's owner, and beside organizational authority with the same
// revoke press it read as the same thing. So the ordinary grants come first
// with their form, and the confined ones follow as something to read and
// follow to its source: whoever owns the object explains it through the
// presenter it registered, and where nobody has, the kind is named plainly.

const styles = stylex.create({
  page: {
    display: 'flex',
    flexDirection: 'column',
    gap: 28,
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  hint: {
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
    color: tokens.mutedForeground,
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    borderRadius: 14,
    backgroundColor: tokens.surface,
    boxShadow: `0 0 0 1px ${tokens.border}, 0 1px 2px rgb(0 0 0 / 0.04)`,
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    borderTopWidth: { default: 1, ':first-child': 0 },
    borderTopStyle: 'solid',
    borderTopColor: tokens.border,
    paddingInline: 16,
    paddingBlock: 10,
  },
  rowText: {
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  roleName: {
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
    fontWeight: 500,
  },
  where: {
    fontSize: '0.75rem',
    lineHeight: '1rem',
    color: tokens.mutedForeground,
  },
  // where the grant came from and how long it holds, said by whoever knows
  origin: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 12,
    rowGap: 2,
    fontSize: '0.75rem',
    lineHeight: '1rem',
    color: tokens.mutedForeground,
  },
})

type Grant = {
  id: string
  roleName: string
  target:
    | { kind: 'tenant' }
    | { kind: 'org-node'; orgNodeId: string; orgNodeName: string; coverage: 'self' | 'subtree' }
  manageable: boolean
  resource: { namespace: string; type: string; id: string } | null
  validFrom: string | null
  validUntil: string | null
}

export default function UserRoleGrantsPage() {
  const { userId } = usePageRouteParams('userId')
  const api = useApi(accessApi)
  const run = useRunApi()
  const query = useApiQuery(accessApi)
  const queryClient = useQueryClient()
  const { format, formatError } = useI18n()
  const moment = useMoment()
  // whose authority is waiting on an answer; taking one away is not undone
  // by pressing again
  const [revoking, setRevoking] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)

  const grants = useQuery(query.access.getUserRoleGrants.queryOptions({ params: { userId } }))
  const items: readonly Grant[] = grants.data?.grants ?? []
  const organizational = items.filter((grant) => grant.resource === null)
  const confined = items.filter((grant) => grant.resource !== null)

  // one grant at a time: replacing the whole set meant proposing to delete
  // every grant this caller could not see
  const revoke = useMutation({
    mutationFn: (grantId: string) => run(api.access.deleteRoleGrant({ params: { grantId } })),
    onMutate: () => setFeedback(null),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: query.access.key() })
    },
    onError: (error: unknown) => setFeedback(formatError(error)),
  })

  const where = (grant: Grant) =>
    grant.target.kind === 'tenant'
      ? format(m.tenantWide)
      : grant.target.coverage === 'subtree'
        ? format(m.atSubtree, { node: grant.target.orgNodeName })
        : format(m.atNode, { node: grant.target.orgNodeName })

  const window = (grant: Grant) => (
    <>
      {grant.validFrom !== null && <span>{format(m.validFrom, { when: moment(grant.validFrom) })}</span>}
      {grant.validUntil !== null && (
        <span data-testid="grant-until">{format(m.validUntil, { when: moment(grant.validUntil) })}</span>
      )}
    </>
  )

  return (
    <PageContainer size="default" xstyle={styles.page}>
      <section {...stylex.props(styles.section)}>
        <SectionHead title={format(m.organizationalSection)} count={organizational.length} />
        <p {...stylex.props(styles.hint)}>{format(m.organizationalHint)}</p>
        <Feedback message={feedback} />
        <AsyncSection
          pending={grants.isPending}
          error={grants.isError ? formatError(grants.error) : null}
          loadingLabel={format(commonMessages.loading)}
          retryLabel={format(commonMessages.retry)}
          onRetry={() => void grants.refetch()}
        >
          {organizational.length === 0 ? (
            <p {...stylex.props(styles.hint)}>{format(m.organizationalEmpty)}</p>
          ) : (
            <ul {...stylex.props(styles.list)}>
              {organizational.map((grant) => (
                <li
                  key={grant.id}
                  data-testid="grant-row"
                  data-grant-kind="organizational"
                  {...stylex.props(styles.row)}
                >
                  <div {...stylex.props(styles.rowText)}>
                    <p {...stylex.props(styles.roleName)}>{grant.roleName}</p>
                    <p {...stylex.props(styles.where)}>{where(grant)}</p>
                    {(grant.validFrom !== null || grant.validUntil !== null) && (
                      <p {...stylex.props(styles.origin)}>{window(grant)}</p>
                    )}
                  </div>
                  {grant.manageable && (
                    <Button
                      variant="ghost"
                      size="sm"
                      // per-row pending: revoking one grant must not freeze the
                      // controls of every other row
                      disabled={revoke.isPending && revoke.variables === grant.id}
                      onClick={() => setRevoking(grant.id)}
                    >
                      {format(m.revokeAction)}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </AsyncSection>
        <GrantRoleForm userId={userId} />
      </section>

      <section {...stylex.props(styles.section)}>
        <SectionHead title={format(m.confinedSection)} count={confined.length} />
        <p {...stylex.props(styles.hint)}>{format(m.confinedHint)}</p>
        {!grants.isPending &&
          (confined.length === 0 ? (
            <p {...stylex.props(styles.hint)}>{format(m.confinedEmpty)}</p>
          ) : (
            <ul {...stylex.props(styles.list)}>
              {confined.map((grant) => (
                <li
                  key={grant.id}
                  data-testid="grant-row"
                  data-grant-kind="confined"
                  {...stylex.props(styles.row)}
                >
                  <div {...stylex.props(styles.rowText)}>
                    <p {...stylex.props(styles.roleName)}>{grant.roleName}</p>
                    <p {...stylex.props(styles.where)}>{where(grant)}</p>
                    <p {...stylex.props(styles.origin)}>
                      <ConfinedOrigin grant={grant} />
                      {window(grant)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          ))}
      </section>

      <ConfirmDialog
        open={revoking !== null}
        tone="destructive"
        title={format(m.revokeTitle)}
        description={format(m.revokeHint)}
        confirmLabel={format(m.revokeAction)}
        cancelLabel={format(commonMessages.cancel)}
        pending={revoke.isPending}
        onCancel={() => setRevoking(null)}
        onConfirm={() => {
          const id = revoking
          setRevoking(null)
          if (id !== null) revoke.mutate(id)
        }}
      />
    </PageContainer>
  )
}

/**
 * Where a confined grant came from, in the words of whoever owns the object.
 *
 * Exactly one renderer, looked up by the object's kind, rather than every
 * renderer in the slot: a slot renders all its contributions, and three
 * owners registering three explanations would each be asked about the
 * other two's objects. A kind nobody speaks for is named plainly.
 */
function ConfinedOrigin({ grant }: { grant: Grant }) {
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
      loading={plain}
      fallback={() => plain}
      missing={plain}
    />
  )
}
