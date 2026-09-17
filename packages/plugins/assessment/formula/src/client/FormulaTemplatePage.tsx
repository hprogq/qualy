import * as stylex from '@stylexjs/stylex'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  PageLink,
  useApiQuery,
  usePageNavigate,
  usePageRouteParams,
  usePageTitle,
} from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { Button } from '@qualy/ui/button'
import { Skeleton } from '@qualy/ui/skeleton'
import { PageContainer } from '@qualy/ui/page-container'
import { Reveal } from '@qualy/ui/reveal'
import { AsyncSection } from '@qualy/ui/admin'
import { ArrowLeftIcon, CopyIcon } from 'lucide-react'
import { formulaApi } from './api.ts'
import { formulaMessages as m } from './i18n.ts'
import { CopyTemplateDialog } from './CopyTemplateDialog.tsx'
import { ParameterChips } from './library.tsx'
import { fullWhen, libraryStyles as l } from './library-styles.ts'
import { SourceView } from './SourceView.tsx'

// One offered formula, in enough detail to decide whether to start from it.
//
// The source is here because somebody who can see this can copy it, and a
// copy hands them the source anyway - a page that showed only a summary
// would ask them to decide about something they cannot look at. Copying is
// the one thing to do, so it is the one filled button; there is nothing to
// edit, follow or run here.

const styles = stylex.create({
  page: { display: 'flex', flexGrow: 1, flexDirection: 'column', gap: 18 },
  back: {
    display: 'inline-flex',
    alignSelf: 'flex-start',
    alignItems: 'center',
    gap: 6,
    height: 28,
    marginLeft: -8,
    paddingInline: 8,
    borderRadius: tokens.radiusMd,
    fontSize: 13,
    color: { default: tokens.mutedForeground, ':hover': tokens.foreground },
    backgroundColor: { default: null, ':hover': tokens.surfaceMuted },
    textDecoration: 'none',
  },
  head: {
    display: 'flex',
    flexDirection: { default: 'row', [breakpoints.phone]: 'column' },
    alignItems: { default: 'flex-start', [breakpoints.phone]: 'stretch' },
    justifyContent: 'space-between',
    gap: { default: 20, [breakpoints.phone]: 14 },
  },
  words: { display: 'flex', minWidth: 0, flexDirection: 'column', gap: 6 },
  titleLine: { display: 'flex', minWidth: 0, flexWrap: 'wrap', alignItems: 'center', gap: 10 },
  description: {
    margin: 0,
    maxWidth: '64ch',
    fontSize: 14,
    lineHeight: 1.7,
    color: tokens.mutedForeground,
    textWrap: 'pretty',
  },
  copy: { flexShrink: 0 },
  facts: {
    display: 'grid',
    gridTemplateColumns: {
      default: 'repeat(4, minmax(0, 1fr))',
      [breakpoints.phone]: 'repeat(2, minmax(0, 1fr))',
    },
    gap: 20,
    paddingBlock: 16,
    paddingInline: 20,
    margin: 0,
  },
  fact: { display: 'flex', minWidth: 0, flexDirection: 'column', gap: 3 },
  factLabel: {
    fontSize: 11,
    color: `color-mix(in oklab, ${tokens.mutedForeground} 85%, transparent)`,
  },
  factValue: {
    margin: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 13,
    fontVariantNumeric: 'tabular-nums',
  },
  paneHead: {
    display: 'flex',
    minHeight: 40,
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
    paddingBlock: 8,
    paddingInline: 20,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
  },
  paneTitle: {
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: '0.06em',
    color: tokens.surfaceMutedForeground,
  },
  paneNote: {
    fontSize: 12,
    color: `color-mix(in oklab, ${tokens.mutedForeground} 85%, transparent)`,
  },
  none: { fontSize: 12, color: tokens.mutedForeground },
  source: { maxHeight: 340 },
  skeleton: { display: 'flex', flexDirection: 'column', gap: 12 },
})

export default function FormulaTemplatePage() {
  const { versionId } = usePageRouteParams('versionId')
  const query = useApiQuery(formulaApi)
  const { format, formatError, locale } = useI18n()
  const navigate = usePageNavigate()
  const [copying, setCopying] = useState(false)

  const detail = useQuery(
    query.assessmentFormula.getFormulaTemplate.queryOptions({ params: { versionId } }),
  )
  const template = detail.data?.template
  const titleRef = usePageTitle(template?.functionName ?? format(m.templatesTitle))

  return (
    <PageContainer>
      <Reveal className={stylex.props(styles.page).className}>
        <PageLink
          page="assessment-formula/templates"
          className={stylex.props(styles.back).className}
        >
          <ArrowLeftIcon size={15} aria-hidden />
          {format(m.templatesTitle)}
        </PageLink>

        <AsyncSection
          pending={detail.isPending}
          error={detail.isError ? formatError(detail.error) : null}
          loadingLabel={format(commonMessages.loading)}
          retryLabel={format(commonMessages.retry)}
          onRetry={() => void detail.refetch()}
          skeleton={
            <div {...stylex.props(styles.skeleton)} aria-hidden>
              <Skeleton height={24} width="30%" radius={6} />
              <Skeleton height={14} width="55%" radius={4} />
              <Skeleton height={72} radius={14} />
              <Skeleton height={240} radius={14} />
            </div>
          }
        >
          {template === undefined ? null : (
            <>
              <div {...stylex.props(styles.head)}>
                <div {...stylex.props(styles.words)}>
                  <div {...stylex.props(styles.titleLine)}>
                    <h1 ref={titleRef} {...stylex.props(l.title)}>
                      {template.functionName}
                    </h1>
                    {template.sourceStatus === 'archived' && (
                      <span {...stylex.props(l.tag)}>{format(m.templatesSourceArchived)}</span>
                    )}
                  </div>
                  {template.description !== null && template.description !== '' && (
                    <p {...stylex.props(styles.description)}>{template.description}</p>
                  )}
                </div>
                <Button
                  onClick={() => setCopying(true)}
                  className={stylex.props(styles.copy).className}
                >
                  <CopyIcon />
                  {format(m.templatesCopy)}
                </Button>
              </div>

              <dl data-testid="template-detail" {...stylex.props(l.sheet, styles.facts)}>
                <div {...stylex.props(styles.fact)}>
                  <dt {...stylex.props(styles.factLabel)}>{format(m.versionLabel)}</dt>
                  <dd {...stylex.props(styles.factValue)}>
                    {format(m.versionNumber, { number: template.versionNo })}
                  </dd>
                </div>
                <div {...stylex.props(styles.fact)}>
                  <dt {...stylex.props(styles.factLabel)}>{format(m.templatesAuthorColumn)}</dt>
                  <dd {...stylex.props(styles.factValue)}>
                    {template.authorName ?? format(m.templatesAuthorUnknown)}
                  </dd>
                </div>
                <div {...stylex.props(styles.fact)}>
                  <dt {...stylex.props(styles.factLabel)}>{format(m.templatesPublishedColumn)}</dt>
                  <dd {...stylex.props(styles.factValue)}>
                    {fullWhen(template.publishedAt, locale)}
                  </dd>
                </div>
                <div {...stylex.props(styles.fact)}>
                  <dt {...stylex.props(styles.factLabel)}>{format(m.testsTitle)}</dt>
                  <dd {...stylex.props(styles.factValue)}>
                    {format(m.templatesExamples, { count: template.tests.length })}
                  </dd>
                </div>
              </dl>

              <section {...stylex.props(l.sheet)}>
                <div {...stylex.props(styles.paneHead)}>
                  <span {...stylex.props(styles.paneTitle)}>{format(m.parametersLabel)}</span>
                  {template.parameters.length === 0 ? (
                    <span {...stylex.props(styles.none)}>{format(m.parametersNone)}</span>
                  ) : (
                    <ParameterChips names={template.parameters} />
                  )}
                </div>
                <div {...stylex.props(styles.paneHead)}>
                  <span {...stylex.props(styles.paneTitle)}>{format(m.templatesSource)}</span>
                  <span {...stylex.props(l.spring)} />
                  <span {...stylex.props(styles.paneNote)}>{format(m.templatesReadOnly)}</span>
                </div>
                <SourceView
                  source={template.sourceTs}
                  data-testid="template-source"
                  aria-label={format(m.templatesSource)}
                  xstyle={styles.source}
                />
              </section>
            </>
          )}
        </AsyncSection>

        <CopyTemplateDialog
          versionId={copying ? versionId : null}
          suggestedName={template?.functionName ?? ''}
          suggestedDescription={template?.description ?? null}
          onClose={() => setCopying(false)}
          onCopied={(functionId) =>
            navigate('assessment-formula/editor', { params: { functionId } })
          }
        />
      </Reveal>
    </PageContainer>
  )
}
