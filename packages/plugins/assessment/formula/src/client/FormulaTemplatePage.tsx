import { useLocale } from '@qualy/web-i18n'
import * as stylex from '@stylexjs/stylex'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  LoadFailure,
  PageLink,
  isRecordId,
  useApiQuery,
  useLoadFailure,
  usePageNavigate,
  usePageRouteParams,
  usePageTitle,
} from '@qualy/web-runtime'

import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { Button } from '@qualy/ui/button'
import { Skeleton } from '@qualy/ui/skeleton'
import { PageContainer } from '@qualy/ui/page-container'
import { Reveal } from '@qualy/ui/reveal'
import { AsyncSection } from '@qualy/ui/admin'
import { ArrowLeftIcon, ChevronRightIcon, CopyIcon } from 'lucide-react'
import { formulaApi } from './api.ts'

import { CopyTemplateDialog } from './CopyTemplateDialog.tsx'
import { TemplateExamplesSheet } from './TemplateExamplesSheet.tsx'
import { ParameterChips } from './library.tsx'
import { fullWhen, libraryStyles as l } from './library-styles.ts'
import { SourceView } from './SourceView.tsx'
import { type NormalizedInputSchema } from '@qualy/value-schema'
import * as commonMessages from '@qualy/web-i18n/messages'
import * as m from '#messages'

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
    color: tokens.mutedForeground,
  },
  factValue: {
    margin: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 13,
    fontVariantNumeric: 'tabular-nums',
  },
  /** the one fact with something behind it, said as the way to it */
  examplesOpen: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 2,
    marginLeft: -6,
    padding: 0,
    paddingInline: 6,
    height: 22,
    borderWidth: 0,
    borderRadius: tokens.radiusSm,
    backgroundColor: { default: 'transparent', ':hover': tokens.surfaceMuted },
    fontFamily: 'inherit',
    fontSize: 13,
    fontVariantNumeric: 'tabular-nums',
    color: tokens.foreground,
    cursor: 'pointer',
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
    color: tokens.mutedForeground,
  },
  none: { fontSize: 12, color: tokens.mutedForeground },
  source: { maxHeight: 340 },
  skeleton: { display: 'flex', flexDirection: 'column', gap: 12 },
})

export default function FormulaTemplatePage() {
  const { versionId } = usePageRouteParams('versionId')
  const query = useApiQuery(formulaApi)
  const locale = useLocale()
  const navigate = usePageNavigate()
  const [copying, setCopying] = useState(false)
  const [readingExamples, setReadingExamples] = useState(false)

  // an address that cannot name a template is not asked about
  const shaped = isRecordId(versionId)
  const detail = useQuery({
    ...query.assessmentFormula.getFormulaTemplate.queryOptions({ params: { versionId } }),
    enabled: shaped,
  })
  const template = detail.data?.template
  // A version this reader may not discover is answered exactly as one that
  // is not there, so a template withdrawn and one never offered read alike.
  const loadFailure = useLoadFailure()
  const gone = { title: m.templates_goneTitle(), description: m.templates_goneHint() }
  const absent = shaped
    ? loadFailure.subject(detail, {
        missing: ['ASSESSMENT_FORMULA_TEMPLATE_NOT_FOUND'],
        copy: { missing: gone },
      })
    : loadFailure.missing({ copy: { missing: gone } })
  // the wire carries the structure as an opaque value; a version published
  // before a field existed, or one that carries nothing, reads as no structure
  // rather than as a broken one
  const inputSchema =
    typeof template?.inputSchema === 'object' &&
    template.inputSchema !== null &&
    typeof (template.inputSchema as { properties?: unknown }).properties === 'object'
      ? (template.inputSchema as NormalizedInputSchema)
      : null
  const titleRef = usePageTitle(template?.functionName ?? m.templates_title())

  // the whole page: a way back above a template that is not there would
  // lead back from nothing
  if (absent !== null) {
    return (
      <LoadFailure
        failure={absent}
        back={{ page: 'assessment-formula/templates', label: m.templates_goneBack() }}
        onRetry={() => void detail.refetch()}
        retrying={detail.isFetching}
      />
    )
  }

  return (
    <PageContainer>
      <Reveal className={stylex.props(styles.page).className}>
        <PageLink
          page="assessment-formula/templates"
          className={stylex.props(styles.back).className}
        >
          <ArrowLeftIcon size={15} aria-hidden />
          {m.templates_title()}
        </PageLink>

        <AsyncSection
          pending={detail.isPending}
          loadingLabel={commonMessages.state_loading()}
          retryLabel={commonMessages.action_retry()}
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
                      <span {...stylex.props(l.tag)}>{m.templates_sourceArchived()}</span>
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
                  {m.templates_copy()}
                </Button>
              </div>

              <dl data-testid="template-detail" {...stylex.props(l.sheet, styles.facts)}>
                <div {...stylex.props(styles.fact)}>
                  <dt {...stylex.props(styles.factLabel)}>{m.version_label()}</dt>
                  <dd {...stylex.props(styles.factValue)}>
                    {template.releaseName ??
                      m.history_releaseOrdinal({ number: template.versionNo })}
                  </dd>
                </div>
                <div {...stylex.props(styles.fact)}>
                  <dt {...stylex.props(styles.factLabel)}>{m.templates_authorColumn()}</dt>
                  <dd {...stylex.props(styles.factValue)}>
                    {template.authorName ?? m.templates_authorUnknown()}
                  </dd>
                </div>
                <div {...stylex.props(styles.fact)}>
                  <dt {...stylex.props(styles.factLabel)}>{m.templates_publishedColumn()}</dt>
                  <dd {...stylex.props(styles.factValue)}>
                    {fullWhen(template.publishedAt, locale)}
                  </dd>
                </div>
                <div {...stylex.props(styles.fact)}>
                  <dt {...stylex.props(styles.factLabel)}>{m.editor_tests()}</dt>
                  <dd {...stylex.props(styles.factValue)}>
                    {template.tests.length === 0 ? (
                      m.templates_examples({ count: 0 })
                    ) : (
                      <button
                        type="button"
                        data-testid="template-examples-open"
                        onClick={() => setReadingExamples(true)}
                        {...stylex.props(styles.examplesOpen)}
                      >
                        {m.templates_examples({ count: template.tests.length })}
                        <ChevronRightIcon size={13} aria-hidden />
                      </button>
                    )}
                  </dd>
                </div>
              </dl>

              <section {...stylex.props(l.sheet)}>
                <div {...stylex.props(styles.paneHead)}>
                  <span {...stylex.props(styles.paneTitle)}>{m.parameters_label()}</span>
                  {template.parameters.length === 0 ? (
                    <span {...stylex.props(styles.none)}>{m.parameters_none()}</span>
                  ) : (
                    <ParameterChips names={template.parameters} />
                  )}
                </div>
                <div {...stylex.props(styles.paneHead)}>
                  <span {...stylex.props(styles.paneTitle)}>{m.templates_source()}</span>
                  <span {...stylex.props(l.spring)} />
                  <span {...stylex.props(styles.paneNote)}>{m.templates_readOnly()}</span>
                </div>
                <SourceView
                  source={template.sourceTs}
                  data-testid="template-source"
                  aria-label={m.templates_source()}
                  xstyle={styles.source}
                />
              </section>
            </>
          )}
        </AsyncSection>

        <TemplateExamplesSheet
          open={readingExamples}
          onOpenChange={setReadingExamples}
          examples={template?.tests ?? []}
          schema={inputSchema}
        />

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
