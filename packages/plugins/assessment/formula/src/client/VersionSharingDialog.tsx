import * as stylex from '@stylexjs/stylex'
import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useApi, useApiQuery, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { UiSlot } from '@qualy/web-runtime'
import { orgNodePicker } from '@qualy/ui-contract'
import { Button } from '@qualy/ui/button'
import { Checkbox } from '@qualy/ui/checkbox'
import { Skeleton } from '@qualy/ui/skeleton'
import { FormDialog } from '@qualy/ui/admin'
import { toast } from '@qualy/ui/toast'
import { formulaApi } from './api.ts'
import { formulaMessages as m } from './i18n.ts'

// Who one published version has been offered to, as a list to tick rather
// than a chip to hunt for.
//
// Widening needs the permission where it widens to; taking an offer back
// never does. So a unit already offered is always shown and can always be
// unticked, while the units that may be added are only the ones this author
// holds the permission in - the list that grows is what a lost permission
// shortens, not the ones already on it.

const styles = stylex.create({
  body: { display: 'flex', flexDirection: 'column', gap: 14, minHeight: 0 },
  hint: { margin: 0, fontSize: 12, lineHeight: 1.5, color: tokens.surfaceMutedForeground },
  part: { display: 'flex', minHeight: 0, flexDirection: 'column', gap: 6 },
  partTitle: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 8,
    margin: 0,
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: '0.06em',
    color: tokens.mutedForeground,
  },
  partCount: { fontWeight: 400, fontVariantNumeric: 'tabular-nums' },
  chips: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  chip: {
    display: 'inline-flex',
    maxWidth: '100%',
    alignItems: 'center',
    height: 22,
    paddingInline: 8,
    borderRadius: 6,
    backgroundColor: tokens.surfaceMuted,
    fontSize: 11.5,
    color: tokens.surfaceMutedForeground,
  },
  chipWords: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  // the tree scrolls inside the dialog rather than making the dialog tall
  seat: { display: 'flex', minHeight: '14rem', maxHeight: '20rem', flexDirection: 'column' },
  none: { margin: 0, fontSize: 12, color: tokens.mutedForeground },
  plain: { display: 'flex', minHeight: 0, flexDirection: 'column', overflowY: 'auto' },
  option: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    paddingBlock: 8,
    paddingInline: 4,
    fontSize: 13,
    cursor: 'pointer',
  },
  optionName: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  failure: { margin: 0, fontSize: 12, color: tokens.danger },
})

export function VersionSharingDialog({
  open,
  functionId,
  version,
  onClose,
  onSaved,
}: {
  readonly open: boolean
  readonly functionId: string
  /** the publication whose audience is being changed */
  readonly version: { readonly versionNo: number; readonly name: string } | null
  readonly onClose: () => void
  readonly onSaved: () => void
}) {
  const api = useApi(formulaApi)
  const run = useRunApi()
  const query = useApiQuery(formulaApi)
  const { format, formatError } = useI18n()
  const [chosen, setChosen] = useState<readonly string[]>([])
  const [failure, setFailure] = useState<string | null>(null)

  const versionNo = version?.versionNo ?? 0
  const params = { functionId, versionNo: String(versionNo) }
  const sharing = useQuery({
    ...query.assessmentFormula.getFormulaVersionSharing.queryOptions({ params }),
    enabled: open && version !== null,
  })
  const options = useQuery({
    ...query.assessmentFormula.listFormulaShareOptions.queryOptions({ query: {} }),
    enabled: open,
  })

  const scopes = sharing.data?.scopes ?? []
  const offered = (options.data?.nodes ?? []).map((node) => ({
    id: node.id,
    name: node.name,
    // a unit whose parent is not among the ones this author may share to
    // hangs from the root here: the tree shows what can be chosen, not the
    // shape of the organization above it
    parentId:
      node.parentId !== null && (options.data?.nodes ?? []).some((one) => one.id === node.parentId)
        ? node.parentId
        : null,
  }))
  // what is already offered stays choosable even where it can no longer be
  // added, so it can still be taken back
  const nodes = [
    ...offered,
    ...scopes
      .filter((scope) => !offered.some((node) => node.id === scope.orgNodeId))
      .map((scope) => ({ id: scope.orgNodeId, name: scope.name, parentId: null })),
  ]

  // every opening starts from what is offered now: edits abandoned last time
  // are not what somebody means to save this time
  useEffect(() => {
    if (!open) return
    setFailure(null)
    setChosen(sharing.data?.scopes.map((scope) => scope.orgNodeId) ?? [])
  }, [open, sharing.data])

  const replace = useMutation({
    mutationFn: (orgNodeIds: readonly string[]) =>
      run(
        api.assessmentFormula.replaceFormulaVersionSharing({
          params,
          payload: { expectedToken: sharing.data?.token ?? '', orgNodeIds },
        }),
      ),
    onMutate: () => setFailure(null),
    onSuccess: async () => {
      toast.success(format(m.sharingSaved))
      await sharing.refetch()
      onSaved()
      onClose()
    },
    onError: (error: unknown) => setFailure(formatError(error)),
  })

  const toggle = (id: string) =>
    setChosen((held) => (held.includes(id) ? held.filter((one) => one !== id) : [...held, id]))

  return (
    <FormDialog
      open={open && version !== null}
      title={format(m.sharingTitle, { name: version?.name ?? '' })}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {format(m.cancel)}
          </Button>
          <Button
            data-testid="formula-sharing-save"
            disabled={replace.isPending || sharing.data === undefined}
            onClick={() => replace.mutate(chosen)}
          >
            {format(m.sharingSave)}
          </Button>
        </>
      }
    >
      <div data-testid="formula-sharing" data-version={versionNo} {...stylex.props(styles.body)}>
        <p {...stylex.props(styles.hint)}>{format(m.sharingHint)}</p>
        {/* what it is offered to now, named rather than counted */}
        <section {...stylex.props(styles.part)}>
          <h3 {...stylex.props(styles.partTitle)}>
            {format(m.sharingCurrent)}
            <span {...stylex.props(styles.partCount)}>
              {scopes.length === 0 ? format(m.sharingPrivate) : scopes.length}
            </span>
          </h3>
          {scopes.length === 0 ? null : (
            <div data-testid="formula-sharing-current" {...stylex.props(styles.chips)}>
              {scopes.map((scope) => (
                <span key={scope.orgNodeId} {...stylex.props(styles.chip)}>
                  <span {...stylex.props(styles.chipWords)}>{scope.name}</span>
                </span>
              ))}
            </div>
          )}
        </section>
        <section {...stylex.props(styles.part)}>
          <h3 {...stylex.props(styles.partTitle)}>{format(m.sharingChoose)}</h3>
          {sharing.isPending || options.isPending ? (
            <Skeleton className={stylex.props(styles.seat).className} />
          ) : nodes.length === 0 ? (
            <p {...stylex.props(styles.none)}>{format(m.sharingNoOptions)}</p>
          ) : (
            <div {...stylex.props(styles.seat)}>
              <UiSlot
                token={orgNodePicker}
                context={{
                  value: chosen,
                  onChange: setChosen,
                  fill: true,
                  nodes,
                  loading: options.isPending,
                }}
                fallback={
                  // no organization picker installed: the units still list, so
                  // an audience can be changed wherever this plugin runs
                  <div {...stylex.props(styles.plain)}>
                    {nodes.map((node) => (
                      <label
                        key={node.id}
                        data-testid="formula-sharing-unit"
                        {...stylex.props(styles.option)}
                      >
                        <Checkbox
                          checked={chosen.includes(node.id)}
                          disabled={replace.isPending}
                          onCheckedChange={() =>
                            setChosen((held) =>
                              held.includes(node.id)
                                ? held.filter((one) => one !== node.id)
                                : [...held, node.id],
                            )
                          }
                        />
                        <span {...stylex.props(styles.optionName)}>{node.name}</span>
                      </label>
                    ))}
                  </div>
                }
                loading={<Skeleton className={stylex.props(styles.seat).className} />}
              />
            </div>
          )}
        </section>
        {failure === null ? null : (
          <p role="alert" data-testid="sharing-failure" {...stylex.props(styles.failure)}>
            {failure}
          </p>
        )}
      </div>
    </FormDialog>
  )
}
