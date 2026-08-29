import * as stylex from '@stylexjs/stylex'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
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
  picker: {
    width: '100%',
    padding: '0.5rem',
    borderRadius: '0.375rem',
    border: '1px solid var(--q-border)',
    background: 'var(--q-surface)',
    color: 'var(--q-foreground)',
    fontFamily: 'inherit',
  },
})

/** the tree flattened for a select: indentation says what nesting said */
const indented = (depth: number, name: string) => `${'  '.repeat(depth)}${name}`

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

  const options = useQuery({
    ...query.assessmentFormula.listFormulaOwnerOptions.queryOptions({}),
    enabled: open,
  })
  const nodes = options.data?.nodes ?? []

  const [name, setName] = useState('')
  const [ownerNodeId, setOwnerNodeId] = useState('')
  const [description, setDescription] = useState('')
  const [failure, setFailure] = useState<string | null>(null)

  const reset = () => {
    setName('')
    setOwnerNodeId('')
    setDescription('')
    setFailure(null)
  }

  const create = useMutation({
    mutationFn: () =>
      run(
        api.assessmentFormula.createFormulaFunction({
          payload: {
            ownerNodeId,
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

  const ready = name.trim() !== '' && ownerNodeId !== ''

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
      <Field label={format(m.ownerLabel)} required>
        {(id) => (
          <select
            id={id}
            {...stylex.props(styles.picker)}
            value={ownerNodeId}
            onChange={(event) => setOwnerNodeId(event.target.value)}
          >
            <option value="" />
            {nodes.map((node) => (
              <option key={node.id} value={node.id}>
                {indented(node.depth, node.name)}
              </option>
            ))}
          </select>
        )}
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
  const query = useApiQuery(formulaApi)
  const { format } = useI18n()
  const navigate = usePageNavigate()
  const [creating, setCreating] = useState(false)

  const functions = useQuery(
    query.assessmentFormula.listFormulaFunctions.queryOptions({ query: {} }),
  )
  const items = functions.data?.items ?? []

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
