import { useInfiniteQuery } from '@tanstack/react-query'
import { cursorPages, useApi, useApiQuery, useLoadFailure, useRunApi } from '@qualy/web-runtime'
import { AsyncSection } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { assessmentApi } from '../api.ts'
import * as commonMessages from '@qualy/web-i18n/messages'
import * as m from '#messages'

/** A select must offer the rest of its catalog, including retrying a later page. */
export function useTemplateChoices(kind: 'phase' | 'timeline') {
  const api = useApi(assessmentApi)
  const query = useApiQuery(assessmentApi)
  const run = useRunApi()
  const failure = useLoadFailure()
  const choices = useInfiniteQuery({
    queryKey: [...query.assessment.listTemplates.key({ query: { kind } }), 'choices'],
    queryFn: ({ pageParam }) =>
      run(
        api.assessment.listTemplates({
          query: { kind, ...(pageParam === undefined ? {} : { cursor: pageParam }) },
        }),
      ),
    ...cursorPages,
  })
  return {
    available:
      choices.isPending ||
      choices.isError ||
      (choices.data?.pages.some((page) => page.items.length > 0) ?? false),
    items: choices.data?.pages.flatMap((page) => page.items) ?? [],
    controls: (
      <AsyncSection
        pending={choices.isPending}
        error={choices.isError ? failure.of(choices.error) : null}
        retrying={choices.isFetching}
        loadingLabel={commonMessages.state_loading()}
        retryLabel={commonMessages.action_retry()}
        onRetry={() =>
          void (choices.isFetchNextPageError ? choices.fetchNextPage() : choices.refetch())
        }
      >
        {choices.hasNextPage && (
          <Button
            size="sm"
            variant="outline"
            disabled={choices.isFetching}
            onClick={() => void choices.fetchNextPage()}
          >
            {m.person_loadMore()}
          </Button>
        )}
      </AsyncSection>
    ),
  }
}
