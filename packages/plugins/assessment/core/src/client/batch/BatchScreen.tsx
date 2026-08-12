import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useApiQuery, usePageRouteParams } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection, PageHeader } from '@qualy/ui/admin'
import { PageContainer } from '@qualy/ui/page-container'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'
import type { BatchDto } from '../phase/model.ts'

// What every section of a batch needs and none of them should fetch twice:
// the batch itself.
//
// Which batch this is, where it stands and what can be done to it as a whole
// are not here - they are in the bar above the rail, said once for the whole
// workspace instead of again at the top of every section.

export function BatchScreen({
  title,
  description,
  size = 'default',
  children,
}: {
  /** which of the batch's pages this is; the bar above says which batch */
  title: string
  description?: string
  size?: 'default' | 'wide' | 'full'
  /** rendered once the batch is loaded, because a section without one is blank */
  children: (batch: BatchDto) => ReactNode
}) {
  const { batchId } = usePageRouteParams('batchId')
  const query = useApiQuery(assessmentApi)
  const { format, formatError } = useI18n()

  const detail = useQuery({
    ...query.assessment.getBatch.queryOptions({ params: { batchId } }),
    // a section is a route away, not a reload: what changes the batch
    // invalidates this key explicitly and is not waiting on the clock
    staleTime: 30_000,
  })
  const batch = detail.data?.batch

  return (
    <>
      {/* Edge to edge, cutting the content area in two: a band inset inside
          the page's own width is a card pretending to be a header, and it
          reads as one more box among the boxes below it. */}
      <div className="relative overflow-hidden border-b bg-background">
        {/* the dots fade out downwards, so the band gives way to the work
            instead of stopping at a line */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.18] [background-image:radial-gradient(currentColor_1px,transparent_1px)] [background-size:14px_14px] [mask-image:linear-gradient(to_bottom,black,transparent)]"
        />
        <PageContainer size={size} className="relative py-6">
          <PageHeader title={title} description={description} variant="banner" />
        </PageContainer>
      </div>
      <PageContainer size={size} className="space-y-5">
        <AsyncSection
          pending={detail.isPending}
          error={detail.isError ? formatError(detail.error) : null}
          loadingLabel={format(commonMessages.loading)}
          retryLabel={format(commonMessages.retry)}
          onRetry={() => void detail.refetch()}
        >
          {batch && (
            <div className="flex flex-col gap-4">
              {batch.status === 'draft' && (
                <p className="rounded-md bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
                  {format(m.draftBanner)}
                </p>
              )}
              {children(batch)}
            </div>
          )}
        </AsyncSection>
      </PageContainer>
    </>
  )
}
