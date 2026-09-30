import * as stylex from '@stylexjs/stylex'
import { useMemo } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import {
  PageLink,
  cursorPages,
  useApi,
  useApiQuery,
  useLoadFailure,
  usePageNavigate,
  usePageTitle,
  useRunApi,
} from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'

import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@qualy/ui/empty'
import { AsyncSection } from '@qualy/ui/admin'
import { Screen } from '@qualy/ui/screen'
import { ChevronRightIcon, LibraryIcon } from 'lucide-react'
import { formulaApi } from './api.ts'

import { LibrarySkeleton, ParameterChips } from './library.tsx'
import { libraryStyles as l, shortWhen } from './library-styles.ts'
import * as commonMessages from '@qualy/web-i18n/messages'
import * as m from '#messages'

// Formulas other people have offered you.
//
// Everything here belongs to somebody else, and the only thing to do with
// one is start your own from it - on the template's own page, where the
// source can be read first. A row therefore carries what decides whether a
// template is worth opening: what it takes (the parameters are the first
// thing that says whether it fits a question of mine), who wrote it, and
// which version of theirs it is.

const styles = stylex.create({
  columns: {
    gridTemplateColumns: {
      default: 'minmax(0, 1fr) 9rem 7rem 6rem 1.25rem',
      [breakpoints.phone]: 'minmax(0, 1fr) 1.25rem',
    },
  },
  words: { gap: 6 },
  version: {
    display: { default: null, [breakpoints.phone]: 'none' },
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 13,
    fontVariantNumeric: 'tabular-nums',
    color: tokens.foreground,
  },
  author: { fontSize: 13 },
  takes: { display: 'flex', minWidth: 0, flexWrap: 'wrap', alignItems: 'center', gap: 6 },
})

export default function FormulaTemplatesPage() {
  const api = useApi(formulaApi)
  const runApi = useRunApi()
  const query = useApiQuery(formulaApi)
  const { locale } = useI18n()
  const failure = useLoadFailure()
  const titleRef = usePageTitle(m.templates_title())
  const navigate = usePageNavigate()

  const templates = useInfiniteQuery({
    queryKey: [...query.assessmentFormula.listFormulaTemplates.key({ query: {} }), 'infinite'],
    queryFn: ({ pageParam }) =>
      runApi(
        api.assessmentFormula.listFormulaTemplates({
          query: pageParam !== undefined ? { cursor: pageParam } : {},
        }),
      ),
    ...cursorPages,
  })
  const items = useMemo(
    () => templates.data?.pages.flatMap((page) => page.items) ?? [],
    [templates.data],
  )

  return (
    <Screen title={m.templates_title()} description={m.templates_hint()} titleRef={titleRef}>
      <div {...stylex.props(l.page)}>
        <section {...stylex.props(l.section)}>
          <div {...stylex.props(l.sectionHead)}>
            <span {...stylex.props(l.sectionLabel)}>{m.templates_offered()}</span>
            <span {...stylex.props(l.spring)} />
            <PageLink
              page="assessment-formula/list"
              unavailable={null}
              className={stylex.props(l.elsewhere).className}
            >
              {m.templates_mine()}
              <ChevronRightIcon size={14} aria-hidden />
            </PageLink>
          </div>

          <AsyncSection
            pending={templates.isPending}
            // what is already listed stays through a later page that failed:
            // its way to more is still there to press
            error={
              templates.isError && templates.data === undefined ? failure.of(templates.error) : null
            }
            framed
            retrying={templates.isFetching}
            loadingLabel={commonMessages.state_loading()}
            retryLabel={commonMessages.action_retry()}
            onRetry={() => void templates.refetch()}
            skeleton={<LibrarySkeleton columns={styles.columns} middle={2} />}
          >
            <div {...stylex.props(l.sheet)}>
              {items.length === 0 ? (
                <Empty data-testid="template-list-empty">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <LibraryIcon />
                    </EmptyMedia>
                    <EmptyTitle>{m.templates_empty()}</EmptyTitle>
                    <EmptyDescription>{m.templates_emptyHint()}</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                <>
                  <div {...stylex.props(l.grid, l.headRow, styles.columns)}>
                    <span>{m.templates_nameColumn()}</span>
                    <span>{m.version_label()}</span>
                    <span>{m.templates_authorColumn()}</span>
                    <span {...stylex.props(l.end)}>{m.templates_publishedColumn()}</span>
                    <span />
                  </div>
                  {items.map((row, index) => {
                    const archived = row.sourceStatus === 'archived'
                    const author = row.authorName ?? m.templates_authorUnknown()
                    const published = shortWhen(row.publishedAt, locale)
                    const version =
                      row.releaseName ?? m.history_releaseOrdinal({ number: row.versionNo })
                    return (
                      <div
                        key={row.versionId}
                        data-testid="template-row"
                        data-version-id={row.versionId}
                        data-source-status={row.sourceStatus}
                        onClick={(event) => {
                          if ((event.target as HTMLElement).closest('a') !== null) return
                          navigate('assessment-formula/template', {
                            params: { versionId: row.versionId },
                          })
                        }}
                        {...stylex.props(
                          l.grid,
                          l.row,
                          l.divided,
                          index === 0 && l.firstOnPhone,
                          styles.columns,
                        )}
                      >
                        <span {...stylex.props(l.words, styles.words)}>
                          <span {...stylex.props(l.nameLine)}>
                            <PageLink
                              page="assessment-formula/template"
                              params={{ versionId: row.versionId }}
                              className={stylex.props(l.name, archived && l.retired).className}
                            >
                              {row.functionName}
                            </PageLink>
                            {archived && (
                              <span {...stylex.props(l.tag)}>{m.templates_sourceArchived()}</span>
                            )}
                          </span>
                          <span {...stylex.props(styles.takes)}>
                            {row.parameters.length === 0 ? (
                              <span {...stylex.props(l.chipLabel, l.lineNone)}>
                                {m.parameters_none()}
                              </span>
                            ) : (
                              <>
                                <span {...stylex.props(l.chipLabel)}>{m.parameters_label()}</span>
                                <ParameterChips names={row.parameters} />
                              </>
                            )}
                          </span>
                          <span {...stylex.props(l.phoneMeta)}>
                            <span>{version}</span>
                            <span>{author}</span>
                            <span>{published}</span>
                          </span>
                        </span>
                        <span {...stylex.props(styles.version, archived && l.retired)}>
                          {version}
                        </span>
                        <span
                          data-testid="template-author"
                          {...stylex.props(l.cell, styles.author)}
                        >
                          {author}
                        </span>
                        <span {...stylex.props(l.cell, l.end)}>{published}</span>
                        <ChevronRightIcon size={14} aria-hidden {...stylex.props(l.glyph)} />
                      </div>
                    )
                  })}
                  {templates.hasNextPage && (
                    <button
                      type="button"
                      disabled={templates.isFetchingNextPage}
                      onClick={() => void templates.fetchNextPage()}
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
      </div>
    </Screen>
  )
}
