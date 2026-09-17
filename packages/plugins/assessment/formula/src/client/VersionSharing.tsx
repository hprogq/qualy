import * as stylex from '@stylexjs/stylex'
import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useApi, useApiQuery, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@qualy/ui/select'
import { XIcon } from 'lucide-react'
import { formulaApi } from './api.ts'
import { formulaMessages as m } from './i18n.ts'

// Who one published version has been offered to.
//
// Widening needs the permission where it widens to; taking an offer back
// never does. So somebody who no longer holds it still sees what they
// offered and can still withdraw it - the control that adds is what
// disappears, not the ones that remove.

const styles = stylex.create({
  row: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  scope: {
    display: 'inline-flex',
    maxWidth: '100%',
    alignItems: 'center',
    gap: 2,
    height: 22,
    paddingLeft: 8,
    paddingRight: 2,
    borderRadius: 6,
    backgroundColor: tokens.surfaceMuted,
    fontSize: 11,
    color: tokens.surfaceMutedForeground,
  },
  scopeName: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  remove: {
    display: 'inline-flex',
    width: 18,
    height: 18,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 0,
    borderRadius: 4,
    padding: 0,
    backgroundColor: { default: 'transparent', ':hover': tokens.border },
    color: tokens.mutedForeground,
    cursor: { default: 'pointer', ':disabled': 'default' },
  },
  none: { fontSize: 12, color: `color-mix(in oklab, ${tokens.mutedForeground} 85%, transparent)` },
  picker: { maxWidth: '100%', fontSize: 12 },
  failure: { flexBasis: '100%', fontSize: 12, color: tokens.danger },
})

export function VersionSharing({
  functionId,
  versionNo,
}: {
  readonly functionId: string
  readonly versionNo: number
}) {
  const api = useApi(formulaApi)
  const run = useRunApi()
  const query = useApiQuery(formulaApi)
  const { format, formatError } = useI18n()
  const [failure, setFailure] = useState<string | null>(null)

  const params = { functionId, versionNo: String(versionNo) }
  const sharing = useQuery(
    query.assessmentFormula.getFormulaVersionSharing.queryOptions({ params }),
  )
  const options = useQuery(
    query.assessmentFormula.listFormulaShareOptions.queryOptions({ query: {} }),
  )
  const scopes = sharing.data?.scopes ?? []
  const offered = new Set(scopes.map((scope) => scope.orgNodeId))
  const addable = (options.data?.nodes ?? []).filter((node) => !offered.has(node.id))

  const replace = useMutation({
    mutationFn: (orgNodeIds: readonly string[]) =>
      run(
        api.assessmentFormula.replaceFormulaVersionSharing({
          params,
          payload: { expectedToken: sharing.data?.token ?? '', orgNodeIds },
        }),
      ),
    onMutate: () => setFailure(null),
    onSuccess: () => void sharing.refetch(),
    onError: (error: unknown) => setFailure(formatError(error)),
  })

  return (
    <div {...stylex.props(styles.row)} data-testid="version-sharing" data-version={versionNo}>
      {scopes.length === 0
        ? sharing.isSuccess && (
            <span {...stylex.props(styles.none)} data-testid="sharing-private">
              {format(m.sharingPrivate)}
            </span>
          )
        : scopes.map((scope) => (
            <span key={scope.orgNodeId} data-testid="sharing-scope" {...stylex.props(styles.scope)}>
              <span {...stylex.props(styles.scopeName)}>{scope.name}</span>
              <button
                type="button"
                aria-label={format(m.sharingRemove, { name: scope.name })}
                disabled={replace.isPending}
                onClick={() =>
                  replace.mutate(
                    scopes
                      .filter((held) => held.orgNodeId !== scope.orgNodeId)
                      .map((held) => held.orgNodeId),
                  )
                }
                {...stylex.props(styles.remove)}
              >
                <XIcon size={12} aria-hidden />
              </button>
            </span>
          ))}
      {addable.length === 0 ? null : (
        <div data-testid="sharing-add">
          <Select
            value=""
            disabled={replace.isPending}
            onValueChange={(nodeId) =>
              replace.mutate([...scopes.map((scope) => scope.orgNodeId), nodeId])
            }
          >
            <SelectTrigger size="sm" aria-label={format(m.sharingAdd)} xstyle={styles.picker}>
              <SelectValue placeholder={format(m.sharingAdd)} />
            </SelectTrigger>
            <SelectContent>
              {addable.map((node) => (
                <SelectItem key={node.id} value={node.id}>
                  {node.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {failure === null ? null : (
        <span role="alert" data-testid="sharing-failure" {...stylex.props(styles.failure)}>
          {failure}
        </span>
      )}
    </div>
  )
}
