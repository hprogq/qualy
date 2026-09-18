import * as stylex from '@stylexjs/stylex'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import {
  PageLink,
  cursorPages,
  useApi,
  useApiQuery,
  usePageNavigate,
  usePageTitle,
  useRunApi,
} from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'
import { Textarea } from '@qualy/ui/textarea'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@qualy/ui/empty'
import { PageContainer } from '@qualy/ui/page-container'
import { Reveal } from '@qualy/ui/reveal'
import { AsyncSection, Field, FormDialog } from '@qualy/ui/admin'
import { ChevronRightIcon, PlusIcon, SigmaIcon } from 'lucide-react'
import { formulaApi } from './api.ts'
import { formulaMessages as m } from './i18n.ts'
import { LibraryMasthead, LibrarySkeleton } from './library.tsx'
import { libraryStyles as l, shortWhen } from './library-styles.ts'

// Every formula this author has, and the way into one.
//
// A row says what a formula is called, what it works out, and whether it
// can be bound to a question yet - which is the published column, and the
// reason the list exists. The parameters are left to the editor and the
// chooser: they matter when you are writing or binding, not when you are
// finding the formula to do either with.

const styles = stylex.create({
  columns: {
    gridTemplateColumns: {
      default: 'minmax(0, 1fr) 10rem 6.5rem 1.25rem',
      [breakpoints.phone]: 'minmax(0, 1fr) 1.25rem',
    },
  },
  published: {
    display: { default: 'flex', [breakpoints.phone]: 'none' },
    minWidth: 0,
    alignItems: 'center',
    gap: 6,
    fontSize: 12,
    fontVariantNumeric: 'tabular-nums',
    color: tokens.foreground,
  },
  standing: { display: 'inline-flex', minWidth: 0, alignItems: 'center', gap: 6 },
  // a publication's name is its author's words, and may run long
  releaseName: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  draftOnly: { color: tokens.mutedForeground },
  dot: {
    width: 6,
    height: 6,
    flexShrink: 0,
    borderRadius: '9999px',
    backgroundColor: tokens.success,
  },
  dotQuiet: {
    backgroundColor: `color-mix(in oklab, ${tokens.mutedForeground} 45%, transparent)`,
  },
  newButton: { flexShrink: 0 },
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
  const { format, formatError, locale } = useI18n()
  const titleRef = usePageTitle(format(m.listTitle))
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
    ...cursorPages,
  })
  const items = useMemo(
    () => functions.data?.pages.flatMap((page) => page.items) ?? [],
    [functions.data],
  )

  const openEditor = (functionId: string) =>
    navigate('assessment-formula/editor', { params: { functionId } })

  const newButton = (
    <Button onClick={() => setCreating(true)} className={stylex.props(styles.newButton).className}>
      <PlusIcon />
      {format(m.newFormula)}
    </Button>
  )

  return (
    <PageContainer>
      <Reveal className={stylex.props(l.page).className}>
        <LibraryMasthead
          title={format(m.listTitle)}
          hint={format(m.listHint)}
          titleRef={titleRef}
          actions={newButton}
        />

        <section {...stylex.props(l.section)}>
          <div {...stylex.props(l.sectionHead)}>
            <span {...stylex.props(l.sectionLabel)}>{format(m.listAll)}</span>
            <span {...stylex.props(l.spring)} />
            <PageLink
              page="assessment-formula/templates"
              unavailable={null}
              className={stylex.props(l.elsewhere).className}
            >
              {format(m.navigationTemplates)}
              <ChevronRightIcon size={14} aria-hidden />
            </PageLink>
          </div>

          <AsyncSection
            pending={functions.isPending}
            error={functions.isError ? formatError(functions.error) : null}
            loadingLabel={format(commonMessages.loading)}
            retryLabel={format(commonMessages.retry)}
            onRetry={() => void functions.refetch()}
            skeleton={<LibrarySkeleton />}
          >
            <div {...stylex.props(l.sheet)}>
              {items.length === 0 ? (
                <Empty data-testid="formula-list-empty">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <SigmaIcon />
                    </EmptyMedia>
                    <EmptyTitle>{format(m.emptyList)}</EmptyTitle>
                    <EmptyDescription>{format(m.emptyListHint)}</EmptyDescription>
                  </EmptyHeader>
                  <EmptyContent>
                    <Button variant="outline" onClick={() => setCreating(true)}>
                      <PlusIcon />
                      {format(m.newFormula)}
                    </Button>
                  </EmptyContent>
                </Empty>
              ) : (
                <>
                  <div {...stylex.props(l.grid, l.headRow, styles.columns)}>
                    <span>{format(m.listNameColumn)}</span>
                    <span>{format(m.versionColumn)}</span>
                    <span {...stylex.props(l.end)}>{format(m.updatedColumn)}</span>
                    <span />
                  </div>
                  {items.map((row, index) => {
                    const archived = row.status === 'archived'
                    const published =
                      row.latestVersionNo === null ? (
                        <span {...stylex.props(styles.standing, styles.draftOnly)}>
                          <span aria-hidden {...stylex.props(styles.dot, styles.dotQuiet)} />
                          {format(m.versionNone)}
                        </span>
                      ) : (
                        <span {...stylex.props(styles.standing)}>
                          <span aria-hidden {...stylex.props(styles.dot)} />
                          <span {...stylex.props(styles.releaseName)}>
                            {row.latestReleaseName ??
                              format(m.releaseOrdinal, { number: row.latestVersionNo })}
                          </span>
                        </span>
                      )
                    const updated = shortWhen(row.updatedAt, format, locale)
                    return (
                      <div
                        key={row.id}
                        data-testid="formula-row"
                        data-status={row.status}
                        data-published={row.latestVersionNo ?? undefined}
                        onClick={(event) => {
                          // the name is a real link; a press on it is already on its way
                          if ((event.target as HTMLElement).closest('a') !== null) return
                          openEditor(row.id)
                        }}
                        {...stylex.props(
                          l.grid,
                          l.row,
                          l.divided,
                          index === 0 && l.firstOnPhone,
                          styles.columns,
                        )}
                      >
                        <span {...stylex.props(l.words)}>
                          <span {...stylex.props(l.nameLine)}>
                            <PageLink
                              page="assessment-formula/editor"
                              params={{ functionId: row.id }}
                              className={stylex.props(l.name, archived && l.retired).className}
                            >
                              {row.name}
                            </PageLink>
                            {archived && (
                              <span {...stylex.props(l.tag)}>{format(m.statusArchived)}</span>
                            )}
                          </span>
                          <span
                            {...stylex.props(
                              l.line,
                              (row.description === null || row.description === '') && l.lineNone,
                            )}
                          >
                            {row.description === null || row.description === ''
                              ? format(m.descriptionNone)
                              : row.description}
                          </span>
                          <span {...stylex.props(l.phoneMeta)}>
                            {published}
                            <span>{updated}</span>
                          </span>
                        </span>
                        <span {...stylex.props(styles.published)}>{published}</span>
                        <span {...stylex.props(l.cell, l.end)}>{updated}</span>
                        <ChevronRightIcon size={14} aria-hidden {...stylex.props(l.glyph)} />
                      </div>
                    )
                  })}
                  {functions.hasNextPage && (
                    <button
                      type="button"
                      disabled={functions.isFetchingNextPage}
                      onClick={() => void functions.fetchNextPage()}
                      {...stylex.props(l.more)}
                    >
                      {format(m.loadMore)}
                    </button>
                  )}
                </>
              )}
            </div>
          </AsyncSection>
        </section>

        <NewFormulaDialog
          open={creating}
          onClose={() => setCreating(false)}
          onCreated={(functionId) => {
            setCreating(false)
            openEditor(functionId)
          }}
        />
      </Reveal>
    </PageContainer>
  )
}
