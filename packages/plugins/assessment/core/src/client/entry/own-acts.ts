import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useApi, useApiQuery, useRunApi } from '@qualy/web-runtime'
import { useI18n, useList } from '@qualy/web-i18n'
import { toast } from '@qualy/ui/toast'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'
import { issueSentence, payloadIssuesOf } from './issues.ts'
import { entryRefusalMessage } from './refusals.ts'
import { answerOf, fieldsOf, type EntryDto, type ItemDto } from './model.ts'

// The owner's three acts on a claim of their own - handing it on, taking it
// back, giving it up - for a page other than the filing page that shows the
// claim's drawer. Each is said out loud when it lands, and a refusal over the
// claim's fields names those fields and what is wrong with each, since no
// form is open to show them.

export type OwnStatus = 'in_review' | 'draft' | 'voided'

export function useOwnClaimActs({
  items,
  entries,
  materialRange,
}: {
  /** the questions, for the names of a refused claim's fields */
  items: readonly ItemDto[]
  entries: readonly EntryDto[]
  /** the round's material window, which decides how a refused date is said */
  materialRange: { start: string; end: string } | undefined
}) {
  const api = useApi(assessmentApi)
  const query = useApiQuery(assessmentApi)
  const run = useRunApi()
  const queryClient = useQueryClient()
  const { format, formatError } = useI18n()
  const listJoin = useList()

  const sayFailure = (error: unknown, itemId: string, entryId: string): string => {
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
    const refusal = entryRefusalMessage(error)
    return refusal === null ? formatError(error) : format(refusal)
  }

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
