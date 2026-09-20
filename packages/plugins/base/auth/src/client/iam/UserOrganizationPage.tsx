import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useApi, useApiQuery, usePageRouteParams, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { AsyncSection, Feedback } from '@qualy/ui/admin'
import { EditorSkeleton, SectionHead } from '@qualy/ui/screen'
import { Button } from '@qualy/ui/button'
import { iamMessages as m } from '../i18n.ts'
import { NodePicker } from './NodePicker.tsx'
import { authApi } from '../api.ts'

// Where the person stands in the organization: the chain of units from the
// top down to the one they are placed at, and the one act that changes it.
// The rules that refuse a move belong to the destination, not to this page.

const styles = stylex.create({
  page: {
    display: 'flex',
    flexDirection: 'column',
    gap: 24,
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  chain: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    borderRadius: 14,
    backgroundColor: tokens.surface,
    boxShadow: `0 0 0 1px ${tokens.border}, 0 1px 2px rgb(0 0 0 / 0.04)`,
    paddingInline: 16,
    paddingBlock: 12,
  },
  step: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
    color: tokens.mutedForeground,
  },
  stepHere: {
    color: tokens.foreground,
    fontWeight: 500,
  },
  stepDepth: {
    flexShrink: 0,
    fontVariantNumeric: 'tabular-nums',
    fontSize: '0.75rem',
    lineHeight: '1rem',
    color: `color-mix(in oklab, ${tokens.mutedForeground} 70%, transparent)`,
  },
  quiet: {
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
    color: tokens.mutedForeground,
  },
  moveRow: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  picker: {
    width: '18rem',
  },
})

export default function UserOrganizationPage() {
  const { userId } = usePageRouteParams('userId')
  const api = useApi(authApi)
  const runApi = useRunApi()
  const query = useApiQuery(authApi)
  const queryClient = useQueryClient()
  const { format, formatError } = useI18n()
  const [destination, setDestination] = useState('')
  const [feedback, setFeedback] = useState<string | null>(null)
  const [moved, setMoved] = useState(false)

  const user = useQuery(query.identity.getUser.queryOptions({ params: { userId } }))
  const record = user.data?.user
  const manageable = record?.manageable ?? false
  const options = useQuery({
    ...query.identity.getUserOptions.queryOptions({ query: {} }),
    enabled: manageable,
  })
  const path = user.data?.orgPath ?? []
  const movable = (options.data?.nodes ?? []).filter((node) => node.manageable)

  const move = useMutation({
    mutationFn: (primaryOrgNodeId: string) =>
      runApi(
        api.identity.setUserPlacement({
          params: { userId },
          payload: { primaryOrgNodeId, version: record?.version ?? 1 },
        }),
      ),
    onMutate: () => {
      setFeedback(null)
      setMoved(false)
    },
    onSuccess: async () => {
      setDestination('')
      setMoved(true)
      await queryClient.invalidateQueries({ queryKey: query.identity.key() })
    },
    onError: (error: unknown) => setFeedback(formatError(error)),
  })

  return (
    <div {...stylex.props(styles.page)}>
      <AsyncSection
        pending={user.isPending}
        error={user.isError ? formatError(user.error) : null}
        loadingLabel={format(commonMessages.loading)}
        retryLabel={format(commonMessages.retry)}
        onRetry={() => void user.refetch()}
        skeleton={<EditorSkeleton />}
      >
        {record && (
          <>
            <section {...stylex.props(styles.section)}>
              <SectionHead title={format(m.personPlacement)} />
              {path.length === 0 ? (
                <p {...stylex.props(styles.quiet)}>{format(m.placementEmpty)}</p>
              ) : (
                <ol data-testid="org-chain" {...stylex.props(styles.chain)}>
                  {path.map((node, depth) => (
                    <li
                      key={node.id}
                      data-org-node={node.id}
                      {...stylex.props(styles.step, depth === path.length - 1 && styles.stepHere)}
                    >
                      <span {...stylex.props(styles.stepDepth)}>{depth + 1}</span>
                      <span>{node.name}</span>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            {manageable && record.status !== 'deleted' && (
              <section {...stylex.props(styles.section)}>
                <SectionHead title={format(m.moveLabel)} />
                <Feedback message={feedback} />
                {moved && feedback === null && (
                  <Feedback message={format(m.saved)} tone="success" />
                )}
                <div {...stylex.props(styles.moveRow)}>
                  <NodePicker
                    label={format(m.moveLabel)}
                    nodes={movable}
                    value={destination}
                    onChange={setDestination}
                    placeholder={format(m.movePick)}
                    disabled={options.isPending}
                    xstyle={styles.picker}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={
                      destination === '' ||
                      destination === record.primaryOrgNode?.id ||
                      move.isPending
                    }
                    onClick={() => move.mutate(destination)}
                  >
                    {format(m.moveAction)}
                  </Button>
                </div>
              </section>
            )}
          </>
        )}
      </AsyncSection>
    </div>
  )
}
