import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { orgNodePicker, type OrgNodePickerContext } from '@qualy/ui-contract'
import { UiSlot, useApi, useApiQuery, usePageRouteParams, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import * as stylex from '@stylexjs/stylex'
import { ArrowRightLeftIcon } from 'lucide-react'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { AsyncSection, ConfirmDialog, Feedback, FormDialog } from '@qualy/ui/admin'
import {
  Card,
  CardEmpty,
  DefLine,
  DefList,
  EditorSkeleton,
  SectionHead,
  Tag,
} from '@qualy/ui/screen'
import { Button } from '@qualy/ui/button'
import { iamMessages as m } from '../i18n.ts'
import { authApi } from '../api.ts'

// Where the person stands in the organization, and the one act that changes
// it.
//
// The chain is read as an address - kind, then name, a rung to a line -
// because a column of bare names only tells somebody who already knows the
// naming anything.
//
// Moving somebody is a task with an end, so it is a dialog over the record
// rather than a tree sitting open on a page nobody came to that page to use;
// and it is confirmed, because it re-anchors every authority that follows
// the unit. The units this person's kind may not stand in are drawn and
// refused with the reason - the write refuses them anyway, and a picker that
// offers them turns a rule into an error message after the press.

const styles = stylex.create({
  page: { display: 'flex', flexDirection: 'column', gap: 24 },
  section: { display: 'flex', flexDirection: 'column', gap: 12 },
  standing: { display: 'flex', minWidth: 0, alignItems: 'center', gap: 8 },
  // the picker draws its own box; the dialog gives it a height to grow into
  seat: { display: 'flex', minHeight: 0, height: '25rem', flexDirection: 'column' },
  chosen: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'center',
    gap: 6,
    fontSize: 12.5,
    color: tokens.mutedForeground,
  },
  chosenName: { color: tokens.foreground, fontWeight: 500 },
})

export default function UserOrganizationPage() {
  const { userId } = usePageRouteParams('userId')
  const api = useApi(authApi)
  const runApi = useRunApi()
  const query = useApiQuery(authApi)
  const queryClient = useQueryClient()
  const { format, formatError } = useI18n()
  const [picking, setPicking] = useState(false)
  const [destination, setDestination] = useState('')
  const [confirming, setConfirming] = useState('')
  const [feedback, setFeedback] = useState<string | null>(null)
  const [moved, setMoved] = useState(false)

  const user = useQuery(query.identity.getUser.queryOptions({ params: { userId } }))
  const record = user.data?.user
  const manageable = record?.manageable ?? false
  // the same read the picker makes, for the two things it cannot know: which
  // units this reader may place into, and what they are called afterwards
  const options = useQuery({
    ...query.identity.getUserOptions.queryOptions({ query: {} }),
    enabled: manageable,
  })
  const path = user.data?.orgPath ?? []
  const here = record?.primaryOrgNode?.id
  const rule = user.data?.placement

  // Shown and refused rather than absent. A tree with holes in it is harder
  // to read than one that says which rows cannot be taken, and each of these
  // has a different answer: not yours, they are already there, or their kind
  // does not stand in that sort of unit.
  const barred = useMemo(() => {
    const out: Record<string, string> = {}
    for (const node of options.data?.nodes ?? []) {
      const fits =
        rule === undefined ||
        rule.mode === 'unrestricted' ||
        (rule.mode === 'tenant-root'
          ? node.parentId === null
          : rule.orgTypeIds.includes(node.orgTypeId))
      if (!fits) out[node.orgNodeId] = format(m.moveTypeRefused)
      else if (!node.manageable) out[node.orgNodeId] = format(m.moveNotManageable)
    }
    if (here !== undefined) out[here] = format(m.moveAlreadyHere)
    return out
  }, [options.data, rule, here, format])

  const named = useMemo(
    () => new Map((options.data?.nodes ?? []).map((node) => [node.orgNodeId, node.name])),
    [options.data],
  )

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

  const picker: OrgNodePickerContext = {
    value: destination === '' ? [] : [destination],
    onChange: (ids) => setDestination(ids[0] ?? ''),
    single: true,
    disabled: barred,
  }
  const target = named.get(confirming) ?? confirming

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
          <section {...stylex.props(styles.section)}>
            <SectionHead
              title={format(m.personPlacement)}
              actions={
                manageable && (
                  <Button
                    size="sm"
                    variant="outline"
                    data-testid="move-open"
                    onClick={() => {
                      setDestination('')
                      setPicking(true)
                    }}
                  >
                    <ArrowRightLeftIcon aria-hidden />
                    {format(m.moveLabel)}
                  </Button>
                )
              }
            />
            <Feedback message={feedback} />
            {moved && feedback === null && <Feedback message={format(m.saved)} tone="success" />}
            <Card>
              {path.length === 0 ? (
                <CardEmpty>{format(m.placementEmpty)}</CardEmpty>
              ) : (
                <div data-testid="org-chain">
                  <DefList>
                    {path.map((node, depth) => (
                      <DefLine key={node.id} label={node.orgTypeName}>
                        <span data-org-node={node.id} {...stylex.props(styles.standing)}>
                          {node.name}
                          {depth === path.length - 1 && <Tag>{format(m.columnUnit)}</Tag>}
                        </span>
                      </DefLine>
                    ))}
                  </DefList>
                </div>
              )}
            </Card>
          </section>
        )}
      </AsyncSection>

      <FormDialog
        open={picking}
        title={format(m.moveLabel)}
        description={format(m.movePick)}
        onClose={() => setPicking(false)}
        footer={
          <>
            {destination !== '' && (
              <span {...stylex.props(styles.chosen)}>
                {format(m.moveTarget)}{' '}
                <span {...stylex.props(styles.chosenName)}>
                  {named.get(destination) ?? destination}
                </span>
              </span>
            )}
            <Button variant="ghost" size="sm" onClick={() => setPicking(false)}>
              {format(commonMessages.cancel)}
            </Button>
            <Button
              size="sm"
              data-testid="move-choose"
              disabled={destination === '' || destination === here}
              onClick={() => {
                setPicking(false)
                setConfirming(destination)
              }}
            >
              {format(m.moveAction)}
            </Button>
          </>
        }
      >
        <div data-testid="move-picker" {...stylex.props(styles.seat)}>
          <UiSlot
            token={orgNodePicker}
            context={picker}
            fallback={<CardEmpty>{format(m.movePickerUnavailable)}</CardEmpty>}
          />
        </div>
      </FormDialog>

      <ConfirmDialog
        open={confirming !== ''}
        title={format(m.moveConfirmTitle)}
        description={format(m.moveConfirmBody, {
          name: record?.displayName ?? '',
          from: record?.primaryOrgNode?.name ?? format(m.noneWord),
          to: target,
        })}
        confirmLabel={format(m.moveAction)}
        cancelLabel={format(commonMessages.cancel)}
        pending={move.isPending}
        onConfirm={() => {
          const to = confirming
          setConfirming('')
          move.mutate(to)
        }}
        onCancel={() => setConfirming('')}
      />
    </div>
  )
}
