import { assertNever, useLocale } from '@qualy/web-i18n'

import {
  useRunApi,
  useApiMutation,
  PageLink,
  cursorPages,
  useApi,
  useApiQuery,
  useLoadFailure,
  usePageNavigate,
  usePageTitle,
} from '@qualy/web-runtime'

import * as stylex from '@stylexjs/stylex'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'

import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { Button } from '@qualy/ui/button'
import { Screen } from '@qualy/ui/screen'
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
import { AsyncSection, Feedback, Field, FormDialog } from '@qualy/ui/admin'
import { ChevronRightIcon, PlusIcon, SigmaIcon } from 'lucide-react'
import { formulaApi } from './api.ts'

import { LibrarySkeleton } from './library.tsx'
import { libraryStyles as l, shortWhen } from './library-styles.ts'
import * as commonMessages from '@qualy/web-i18n/messages'
import * as m from '#messages'

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
  newButton: {
    flexShrink: 0,
    // square around the mark where the word is not drawn, rather than a pill
    // with air on both sides of it
    paddingInline: { default: null, [breakpoints.phone]: 0 },
    width: { default: null, [breakpoints.phone]: 36 },
  },
  newWord: { display: { default: 'inline', [breakpoints.phone]: 'none' } },
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
  const query = useApiQuery(formulaApi)
  const queryClient = useQueryClient()

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [failure, setFailure] = useState<string | null>(null)

  const reset = () => {
    setName('')
    setDescription('')
    setFailure(null)
  }

  const create = useApiMutation({
    mutationFn: () =>
      api.assessmentFormula.createFormulaFunction({
        payload: {
          name: name.trim(),
          ...(description.trim() === '' ? {} : { description: description.trim() }),
        },
      }),
    onMutate: () => setFailure(null),
    onSuccess: async (result: { function: { id: string } }) => {
      reset()
      await queryClient.invalidateQueries({ queryKey: query.assessmentFormula.key() })
      onCreated(result.function.id)
    },
    onError: (error) => {
      switch (error._tag) {
        case 'ASSESSMENT_FORMULA_AUTHORING_BUSY':
          setFailure(m.error_authoringBusy())
          return
        case 'ASSESSMENT_FORMULA_SOURCE_TOO_LARGE':
          setFailure(m.error_sourceTooLarge())
          return
        default:
          assertNever(error)
      }
    },
  })

  const ready = name.trim() !== ''

  const close = () => {
    reset()
    onClose()
  }

  return (
    <FormDialog
      open={open}
      title={m.list_new()}
      onClose={close}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            {m.common_cancel()}
          </Button>
          <Button disabled={!ready || create.isPending} onClick={() => create.mutate()}>
            {m.create_confirm()}
          </Button>
        </>
      }
    >
      <Field label={m.field_name()} required>
        {(id) => <Input id={id} value={name} onChange={(event) => setName(event.target.value)} />}
      </Field>
      <Field label={m.field_description()}>
        {(id) => (
          <Textarea
            id={id}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        )}
      </Field>
      {/* the same refusal every form in the product says under its fields */}
      <Feedback message={failure} />
    </FormDialog>
  )
}

export default function FormulaListPage() {
  const api = useApi(formulaApi)
  const runApi = useRunApi()
  const query = useApiQuery(formulaApi)
  const locale = useLocale()
  const failure = useLoadFailure()
  const titleRef = usePageTitle(m.list_title())
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

  // A mark under a thumb and the words beside a pointer: the band is one row
  // at every width, so on a phone the act has to fit beside the page's own
  // name - and the other two pages of this library have no act at all, so
  // anything wider than the mark made this one band taller than theirs.
  const newButton = (
    <Button
      onClick={() => setCreating(true)}
      aria-label={m.list_new()}
      className={stylex.props(styles.newButton).className}
    >
      <PlusIcon />
      <span {...stylex.props(styles.newWord)}>{m.list_new()}</span>
    </Button>
  )

  return (
    <Screen
      title={m.list_title()}
      description={m.list_hint()}
      titleRef={titleRef}
      actions={newButton}
    >
      <div {...stylex.props(l.page)}>
        <section {...stylex.props(l.section)}>
          <div {...stylex.props(l.sectionHead)}>
            <span {...stylex.props(l.sectionLabel)}>{m.list_all()}</span>
            <span {...stylex.props(l.spring)} />
            <PageLink
              page="assessment-formula/templates"
              unavailable={null}
              className={stylex.props(l.elsewhere).className}
            >
              {m.navigation_templates()}
              <ChevronRightIcon size={14} aria-hidden />
            </PageLink>
          </div>

          <AsyncSection
            pending={functions.isPending}
            // what is already listed stays through a later page that failed:
            // its way to more is still there to press
            error={
              functions.isError && functions.data === undefined ? failure.of(functions.error) : null
            }
            framed
            retrying={functions.isFetching}
            loadingLabel={commonMessages.state_loading()}
            retryLabel={commonMessages.action_retry()}
            onRetry={() => void functions.refetch()}
            skeleton={<LibrarySkeleton columns={styles.columns} />}
          >
            <div {...stylex.props(l.sheet)}>
              {items.length === 0 ? (
                <Empty data-testid="formula-list-empty">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <SigmaIcon />
                    </EmptyMedia>
                    <EmptyTitle>{m.list_empty()}</EmptyTitle>
                    <EmptyDescription>{m.list_emptyHint()}</EmptyDescription>
                  </EmptyHeader>
                  <EmptyContent>
                    <Button variant="outline" onClick={() => setCreating(true)}>
                      <PlusIcon />
                      {m.list_new()}
                    </Button>
                  </EmptyContent>
                </Empty>
              ) : (
                <>
                  <div {...stylex.props(l.grid, l.headRow, styles.columns)}>
                    <span>{m.list_nameColumn()}</span>
                    <span>{m.list_versionColumn()}</span>
                    <span {...stylex.props(l.end)}>{m.list_updatedColumn()}</span>
                    <span />
                  </div>
                  {items.map((row, index) => {
                    const archived = row.status === 'archived'
                    const published =
                      row.latestVersionNo === null ? (
                        <span {...stylex.props(styles.standing, styles.draftOnly)}>
                          <span aria-hidden {...stylex.props(styles.dot, styles.dotQuiet)} />
                          {m.list_versionNone()}
                        </span>
                      ) : (
                        <span {...stylex.props(styles.standing)}>
                          <span aria-hidden {...stylex.props(styles.dot)} />
                          <span {...stylex.props(styles.releaseName)}>
                            {row.latestReleaseName ??
                              m.history_releaseOrdinal({ number: row.latestVersionNo })}
                          </span>
                        </span>
                      )
                    const updated = shortWhen(row.updatedAt, locale)
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
                              <span {...stylex.props(l.tag)}>{m.status_archived()}</span>
                            )}
                          </span>
                          <span
                            {...stylex.props(
                              l.line,
                              (row.description === null || row.description === '') && l.lineNone,
                            )}
                          >
                            {row.description === null || row.description === ''
                              ? m.editor_descriptionNone()
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
                      {m.list_loadMore()}
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
      </div>
    </Screen>
  )
}
