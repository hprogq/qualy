import * as stylex from '@stylexjs/stylex'
import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useApi, useApiQuery, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { Badge } from '@qualy/ui/badge'
import { Button } from '@qualy/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@qualy/ui/select'
import { formulaApi } from './api.ts'
import { formulaMessages as m } from './i18n.ts'

// Who one published version has been offered to.
//
// Widening needs the permission where it widens to; taking an offer back
// never does. So somebody who no longer holds it still sees what they
// offered and can still withdraw it - the button that adds is what
// disappears, not the ones that remove.

const styles = stylex.create({
  row: { display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' },
  scopes: { display: 'flex', gap: '0.375rem', flexWrap: 'wrap' },
  picker: { width: 220 },
  none: { fontSize: '0.8125rem', color: 'var(--q-surface-muted-foreground)' },
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
      <div {...stylex.props(styles.scopes)}>
        {scopes.length === 0 ? (
          <span {...stylex.props(styles.none)} data-testid="sharing-private">
            {format(m.sharingPrivate)}
          </span>
        ) : (
          scopes.map((scope) => (
            <Badge key={scope.orgNodeId} variant="secondary" data-testid="sharing-scope">
              {scope.name}{' '}
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
              >
                ×
              </button>
            </Badge>
          ))
        )}
      </div>
      {addable.length === 0 ? null : (
        <div {...stylex.props(styles.picker)} data-testid="sharing-add">
          <Select
            value=""
            disabled={replace.isPending}
            onValueChange={(nodeId) =>
              replace.mutate([...scopes.map((scope) => scope.orgNodeId), nodeId])
            }
          >
            <SelectTrigger aria-label={format(m.sharingAdd)}>
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
        <span role="alert" data-testid="sharing-failure" {...stylex.props(styles.none)}>
          {failure}
        </span>
      )}
    </div>
  )
}
