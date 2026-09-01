import * as stylex from '@stylexjs/stylex'
import { useMemo, useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useApi, useApiQuery, usePageNavigate, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { Badge } from '@qualy/ui/badge'
import { Button } from '@qualy/ui/button'
import { Empty } from '@qualy/ui/empty'
import { AsyncSection, PageHeader, Panel } from '@qualy/ui/admin'
import { formulaApi } from './api.ts'
import { formulaMessages as m } from './i18n.ts'
import { CopyTemplateDialog } from './CopyTemplateDialog.tsx'

// Formulas other people have offered you.
//
// Everything here belongs to somebody else, and the only thing to do with
// one is start your own from it. So the row leads to a copy rather than to
// an editor: what a reader can act on is "make this mine", and until they
// do there is nothing of theirs to open.

const styles = stylex.create({
  page: { display: 'flex', flexDirection: 'column', gap: '1rem', padding: '1.5rem' },
  table: { width: '100%', borderCollapse: 'collapse' },
  headCell: {
    textAlign: 'left',
    padding: '0.5rem 0.75rem',
    fontSize: '0.8125rem',
    color: 'var(--q-surface-muted-foreground)',
  },
  row: { cursor: 'pointer', borderTop: '1px solid var(--q-border)' },
  cell: { padding: '0.625rem 0.75rem' },
  muted: { fontSize: '0.8125rem', color: 'var(--q-surface-muted-foreground)' },
})

export default function FormulaTemplatesPage() {
  const api = useApi(formulaApi)
  const runApi = useRunApi()
  const query = useApiQuery(formulaApi)
  const { format } = useI18n()
  const navigate = usePageNavigate()
  const [copying, setCopying] = useState<string | null>(null)

  const templates = useInfiniteQuery({
    queryKey: [...query.assessmentFormula.listFormulaTemplates.key({ query: {} }), 'infinite'],
    queryFn: ({ pageParam }) =>
      runApi(
        api.assessmentFormula.listFormulaTemplates({
          query: pageParam !== undefined ? { cursor: pageParam } : {},
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  })
  const items = useMemo(
    () => templates.data?.pages.flatMap((page) => page.items) ?? [],
    [templates.data],
  )

  return (
    <div {...stylex.props(styles.page)}>
      <PageHeader title={format(m.templatesTitle)} description={format(m.templatesHint)} />
      <Panel title={format(m.templatesTitle)}>
        <AsyncSection
          pending={templates.isPending}
          error={templates.isError ? format(m.templatesLoadFailed) : null}
          loadingLabel={format(m.templatesLoading)}
          retryLabel={format(m.templatesRetry)}
          onRetry={() => void templates.refetch()}
        >
          {items.length === 0 ? (
            <Empty title={format(m.templatesEmpty)} />
          ) : (
            <table {...stylex.props(styles.table)}>
              <thead>
                <tr>
                  <th {...stylex.props(styles.headCell)}>{format(m.nameLabel)}</th>
                  <th {...stylex.props(styles.headCell)}>{format(m.versionColumn)}</th>
                  <th {...stylex.props(styles.headCell)}>{format(m.templatesAuthorColumn)}</th>
                  <th {...stylex.props(styles.headCell)}>{format(m.templatesPublishedColumn)}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr
                    key={row.versionId}
                    {...stylex.props(styles.row)}
                    data-testid="template-row"
                    data-version-id={row.versionId}
                    data-source-status={row.sourceStatus}
                    onClick={() =>
                      navigate('assessment-formula/template', {
                        params: { versionId: row.versionId },
                      })
                    }
                  >
                    <td {...stylex.props(styles.cell)}>
                      {row.functionName}{' '}
                      {row.sourceStatus === 'archived' ? (
                        <Badge variant="outline">{format(m.templatesSourceArchived)}</Badge>
                      ) : null}
                      <div {...stylex.props(styles.muted)}>
                        {format(m.templatesParameters, { names: row.parameters.join('、') })}
                      </div>
                    </td>
                    <td {...stylex.props(styles.cell)}>
                      {format(m.versionNumber, { number: row.versionNo })}
                    </td>
                    <td {...stylex.props(styles.cell)} data-testid="template-author">
                      {row.authorName ?? format(m.templatesAuthorUnknown)}
                    </td>
                    <td {...stylex.props(styles.cell)}>
                      {new Date(row.publishedAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {templates.hasNextPage ? (
            <Button
              size="sm"
              variant="outline"
              disabled={templates.isFetchingNextPage}
              onClick={() => void templates.fetchNextPage()}
            >
              {format(m.loadMore)}
            </Button>
          ) : null}
        </AsyncSection>
      </Panel>
      <CopyTemplateDialog
        versionId={copying}
        suggestedName=""
        onClose={() => setCopying(null)}
        onCopied={(functionId) => navigate('assessment-formula/editor', { params: { functionId } })}
      />
    </div>
  )
}
