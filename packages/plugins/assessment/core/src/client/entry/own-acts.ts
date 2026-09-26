import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useApi, useApiQuery, useRunApi } from '@qualy/web-runtime'
import { useI18n, useList } from '@qualy/web-i18n'
import { toast } from '@qualy/ui/toast'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'
import { issueSentence, payloadIssuesOf } from './issues.ts'
import { sayOwnRefusal, type RoundState } from './refusals.ts'
import { answerOf, fieldsOf, type EntryDto, type ItemDto } from './model.ts'

// The owner's three acts on a claim of their own - handing it on, taking it
// back, giving it up - for every page that shows the claim's drawer. Each is
// said out loud when it lands, and a refusal over the claim's fields names
// those fields and what is wrong with each, since no form is open to show
// them. Beside them, the read that marks a claim's news as seen.

export type OwnStatus = 'in_review' | 'draft' | 'voided'

/** what an owner's act needs to say its own failure */
interface OwnClaims {
  /** the questions, for the names of a refused claim's fields */
  items: readonly ItemDto[]
  entries: readonly EntryDto[]
  /** the round's material window, which decides how a refused date is said */
  materialRange: { start: string; end: string } | undefined
}

/**
 * Where a round stands, as its batch was last read: whether it runs, and
 * the name of the stage under way, for saying which stage holds an act.
 * The batch screen has read it already; this asks the same entry of the
 * cache, and a batch not read yet names no stage.
 */
export function useRound(batchId: string | undefined): RoundState | null {
  const query = useApiQuery(assessmentApi)
  const read = useQuery({
    ...query.assessment.getBatch.queryOptions({ params: { batchId: batchId ?? '' } }),
    enabled: batchId !== undefined,
    // the batch screen's own freshness, so opening a drawer asks nothing again
    staleTime: 30_000,
  })
  const batch = read.data?.batch
  return useMemo(
    () =>
      batch === undefined ? null : { status: batch.status, phaseName: batch.currentPhaseName },
    [batch],
  )
}

/**
 * What to tell the owner about an act of theirs that failed.
 *
 * No form is open where these acts are pressed, so a refusal over the
 * claim's fields names those fields and what is wrong with each, rather
 * than reporting a save nobody made. The claim is named where the press was
 * about one; a claim not written yet carried nothing to name. A stage that
 * holds the act is said with the act and the stage named.
 */
export function useOwnFailure({ items, entries, materialRange }: OwnClaims) {
  const { format, formatError, locale } = useI18n()
  const listJoin = useList()
  const round = useRound(entries[0]?.batchId ?? items[0]?.batchId)
  return (error: unknown, itemId: string, entryId?: string): string => {
    const issues = payloadIssuesOf(error)
    if (issues !== null) {
      const fields = fieldsOf(items.find((one) => one.id === itemId)?.currentRevision?.formConfig)
      const payload = (entries.find((one) => one.id === entryId)?.currentRevision?.payload ??
        {}) as Record<string, unknown>
      const said = issues.map((issue) => {
        const field = fields.find((one) => one.key === issue.field)
        const sentence = issueSentence(issue.reason, field, {
          value: answerOf(payload, issue.field),
          ...(materialRange === undefined ? {} : { materialRange }),
        })
        return `${field?.label ?? issue.field} ${format(sentence)}`
      })
      return format(m.entryListIssues, { issues: listJoin(said) })
    }
    return sayOwnRefusal(error, round, { format, locale }) ?? formatError(error)
  }
}

export function useOwnClaimActs({ items, entries, materialRange }: OwnClaims) {
  const api = useApi(assessmentApi)
  const query = useApiQuery(assessmentApi)
  const run = useRunApi()
  const queryClient = useQueryClient()
  const { format } = useI18n()
  const sayFailure = useOwnFailure({ items, entries, materialRange })

  const setStatus = useMutation({
    mutationFn: (input: {
      entryId: string
      /** the question it answers, so a refusal can name the question's fields */
      itemId: string
      status: OwnStatus
      expectedItemRevisionId?: string
      expectedEntryRevisionId?: string
    }) =>
      run(
        api.assessment.setEntryStatus({
          params: { entryId: input.entryId },
          payload: {
            status: input.status,
            ...(input.expectedItemRevisionId === undefined
              ? {}
              : { expectedItemRevisionId: input.expectedItemRevisionId }),
            ...(input.expectedEntryRevisionId === undefined
              ? {}
              : { expectedEntryRevisionId: input.expectedEntryRevisionId }),
          },
        }),
      ),
    onSuccess: (_result, input) => {
      toast.success(
        format(
          input.status === 'in_review'
            ? m.entrySubmittedToast
            : input.status === 'draft'
              ? m.entryWithdrawnToast
              : m.entryAbandonedToast,
        ),
      )
      void queryClient.invalidateQueries({ queryKey: query.assessment.key() })
    },
    onError: (error: unknown, input) => toast.error(sayFailure(error, input.itemId, input.entryId)),
  })

  return setStatus
}

/**
 * The owner has read one of their claims: opened its drawer or its form.
 *
 * Reading is not a business change, so the cached list is corrected in
 * place - everything else it says about what needs attention kept - and
 * nothing is announced. The mark goes the moment the claim opens: a read of
 * the list already on its way was asked before this one, so it is called off
 * rather than let bring the mark back, and asked again once the server has
 * heard. The batch's front page is never on screen beside a claim, and reads
 * its desk afresh whenever it opens.
 */
export function useMarkEntryRead(batchId: string) {
  const api = useApi(assessmentApi)
  const query = useApiQuery(assessmentApi)
  const run = useRunApi()
  const queryClient = useQueryClient()
  const listKey = query.assessment.listMyEntries.key({ params: { batchId }, query: {} })
  return useMutation({
    mutationFn: (entryId: string) =>
      run(api.assessment.markMyEntryRead({ params: { batchId, entryId } })),
    onMutate: async (entryId: string) => {
      const interrupted = queryClient.isFetching({ queryKey: listKey }) > 0
      await queryClient.cancelQueries({ queryKey: listKey })
      queryClient.setQueryData(
        listKey,
        (old: { attention: { unreadEntryIds: readonly string[] } } | undefined) =>
          old === undefined
            ? old
            : {
                ...old,
                attention: {
                  ...old.attention,
                  unreadEntryIds: old.attention.unreadEntryIds.filter((id) => id !== entryId),
                },
              },
      )
      return { interrupted }
    },
    onSettled: (_result, _error, _entryId, context) => {
      if (context?.interrupted === true) {
        void queryClient.invalidateQueries({ queryKey: listKey })
      }
    },
  })
}
