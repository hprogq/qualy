import * as stylex from '@stylexjs/stylex'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useApi, useApiQuery, usePageNavigate, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'
import { Textarea } from '@qualy/ui/textarea'
import { Badge } from '@qualy/ui/badge'
import { Empty } from '@qualy/ui/empty'
import { Field, FormDialog, PageHeader, Panel } from '@qualy/ui/admin'
import { formulaApi } from './api.ts'
import { formulaMessages as m } from './i18n.ts'

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
})

function NewFormulaDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: (functionId: string) => void
}) {
  const api = useApi(formulaApi)
  const run = useRunApi()
  const query = useApiQuery(formulaApi)
  const queryClient = useQueryClient()
  const { format, formatError } = useI18n()

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [failure, setFailure] = useState<string | null>(null)

  const reset = () => {
    setName('')
    setDescription('')
    setFailure(null)
  }

  const create = useMutation({
    mutationFn: () =>
      run(
        api.assessmentFormula.createFormulaFunction({
          payload: {
            name: name.trim(),
            ...(description.trim() === '' ? {} : { description: description.trim() }),
          },
        }),
      ),
    onMutate: () => setFailure(null),
    onSuccess: async (result: { function: { id: string } }) => {
      reset()
      await queryClient.invalidateQueries({ queryKey: query.assessmentFormula.key() })
      onCreated(result.function.id)
    },
    onError: (error: unknown) => setFailure(formatError(error)),
  })

  const ready = name.trim() !== ''

  const close = () => {
    reset()
    onClose()
  }

  return (
    <FormDialog
      open={open}
      title={format(m.newFormula)}
      onClose={close}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            {format(m.cancel)}
          </Button>
          <Button disabled={!ready || create.isPending} onClick={() => create.mutate()}>
            {format(m.createConfirm)}
          </Button>
        </>
      }
    >
      <Field label={format(m.nameLabel)} required>
        {(id) => <Input id={id} value={name} onChange={(event) => setName(event.target.value)} />}
      </Field>
      <Field label={format(m.descriptionLabel)}>
        {(id) => (
          <Textarea
            id={id}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        )}
      </Field>
      {failure === null ? null : <p role="alert">{failure}</p>}
    </FormDialog>
  )
}

export default function FormulaListPage() {
  const api = useApi(formulaApi)
  const runApi = useRunApi()
  const query = useApiQuery(formulaApi)
  const { format } = useI18n()
  const navigate = usePageNavigate()
  const [creating, setCreating] = useState(false)

  const functions = useInfiniteQuery({
    queryKey: [...query.assessmentFormula.listFormulaFunctions.key({ query: {} }), 'infinite'],
    queryFn: ({ pageParam }) =>
      runApi(
        api.assessmentFormula.listFormulaFunctions({
          query: pageParam !== undefined ? { cursor: pageParam } : {},
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  })
  const items = useMemo(
    () => functions.data?.pages.flatMap((page) => page.items) ?? [],
    [functions.data],
  )

  const openEditor = (functionId: string) =>
    navigate('assessment-formula/editor', { params: { functionId } })

  return (
    <div {...stylex.props(styles.page)}>
      <PageHeader
        title={format(m.listTitle)}
        description={format(m.listHint)}
        actions={<Button onClick={() => setCreating(true)}>{format(m.newFormula)}</Button>}
      />
      <Panel title={format(m.listTitle)}>
        {functions.isSuccess && items.length === 0 ? (
          <Empty title={format(m.emptyList)}>
            <Button onClick={() => setCreating(true)}>{format(m.newFormula)}</Button>
          </Empty>
        ) : (
          <table {...stylex.props(styles.table)}>
            <thead>
              <tr>
                <th {...stylex.props(styles.headCell)}>{format(m.nameLabel)}</th>
                <th {...stylex.props(styles.headCell)}>{format(m.versionColumn)}</th>
                <th {...stylex.props(styles.headCell)}>{format(m.updatedColumn)}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr
                  key={row.id}
                  {...stylex.props(styles.row)}
                  data-testid="formula-row"
                  data-status={row.status}
                  onClick={() => openEditor(row.id)}
                >
                  <td {...stylex.props(styles.cell)}>
                    {row.name}{' '}
                    {row.status === 'archived' ? (
                      <Badge variant="outline">{format(m.statusArchived)}</Badge>
                    ) : null}
                  </td>
                  <td {...stylex.props(styles.cell)}>
                    {row.latestVersionNo === null
                      ? format(m.versionNone)
                      : format(m.versionNumber, { number: row.latestVersionNo })}
                  </td>
                  <td {...stylex.props(styles.cell)}>
                    {new Date(row.updatedAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {functions.hasNextPage ? (
          <Button
            size="sm"
            variant="outline"
            disabled={functions.isFetchingNextPage}
            onClick={() => void functions.fetchNextPage()}
          >
            {format(m.loadMore)}
          </Button>
        ) : null}
      </Panel>
      <NewFormulaDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(functionId) => {
          setCreating(false)
          openEditor(functionId)
        }}
      />
    </div>
  )
}
