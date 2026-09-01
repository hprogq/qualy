import * as stylex from '@stylexjs/stylex'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useApiQuery, usePageNavigate, usePageRouteParams } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { Badge } from '@qualy/ui/badge'
import { Button } from '@qualy/ui/button'
import { AsyncSection, PageHeader, Panel } from '@qualy/ui/admin'
import { formulaApi } from './api.ts'
import { formulaMessages as m } from './i18n.ts'
import { CopyTemplateDialog } from './CopyTemplateDialog.tsx'

// One offered formula, in enough detail to decide whether to start from it.
//
// The source is here because somebody who can see this can copy it, and a
// copy hands them the source anyway - a page that showed only a summary
// would ask them to decide about something they cannot look at.

const styles = stylex.create({
  page: { display: 'flex', flexDirection: 'column', gap: '1rem', padding: '1.5rem' },
  meta: { display: 'flex', gap: '1rem', flexWrap: 'wrap', fontSize: '0.8125rem' },
  source: {
    margin: 0,
    padding: '0.75rem',
    overflowX: 'auto',
    fontFamily: 'var(--q-font-mono, monospace)',
    fontSize: '0.8125rem',
    background: 'var(--q-surface-muted)',
    borderRadius: '0.375rem',
  },
})

export default function FormulaTemplatePage() {
  const { versionId } = usePageRouteParams('versionId')
  const query = useApiQuery(formulaApi)
  const { format } = useI18n()
  const navigate = usePageNavigate()
  const [copying, setCopying] = useState(false)

  const detail = useQuery(
    query.assessmentFormula.getFormulaTemplate.queryOptions({ params: { versionId } }),
  )
  const template = detail.data?.template

  return (
    <div {...stylex.props(styles.page)}>
      <PageHeader
        title={template?.functionName ?? format(m.templatesTitle)}
        description={template?.description ?? undefined}
        actions={
          template === undefined ? undefined : (
            <Button onClick={() => setCopying(true)}>{format(m.templatesCopy)}</Button>
          )
        }
      />
      <Panel title={format(m.templatesTitle)}>
        <AsyncSection
          pending={detail.isPending}
          error={detail.isError ? format(m.templatesLoadFailed) : null}
          loadingLabel={format(m.templatesLoading)}
          retryLabel={format(m.templatesRetry)}
          onRetry={() => void detail.refetch()}
        >
          {template === undefined ? null : (
            <div {...stylex.props(styles.meta)} data-testid="template-detail">
              <span>{format(m.versionNumber, { number: template.versionNo })}</span>
              <span>{template.authorName ?? format(m.templatesAuthorUnknown)}</span>
              <span>{new Date(template.publishedAt).toLocaleDateString()}</span>
              <span>{format(m.templatesExamples, { count: template.tests.length })}</span>
              <span>
                {format(m.templatesParameters, { names: template.parameters.join('、') })}
              </span>
              {template.sourceStatus === 'archived' ? (
                <Badge variant="outline">{format(m.templatesSourceArchived)}</Badge>
              ) : null}
            </div>
          )}
        </AsyncSection>
      </Panel>
      {template === undefined ? null : (
        <Panel title={format(m.templatesSource)}>
          <pre {...stylex.props(styles.source)} data-testid="template-source">
            {template.sourceTs}
          </pre>
        </Panel>
      )}
      <CopyTemplateDialog
        versionId={copying ? versionId : null}
        suggestedName={template?.functionName ?? ''}
        suggestedDescription={template?.description ?? null}
        onClose={() => setCopying(false)}
        onCopied={(functionId) => navigate('assessment-formula/editor', { params: { functionId } })}
      />
    </div>
  )
}
