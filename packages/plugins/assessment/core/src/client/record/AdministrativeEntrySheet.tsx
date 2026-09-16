import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useApi, useApiQuery, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { toast } from '@qualy/ui/toast'
import { useLingering } from '@qualy/ui/use-lingering'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'
import { ManagedEntrySheet, type RecognitionDto } from '../entry/ManagedEntrySheet.tsx'
import type { EntryDto, ItemDto } from '../entry/model.ts'

// One administrative fact, read and corrected.
//
// The same sheet a participant's account opens, because it is the same
// question: what was filed, what it was determined to be, and what may still
// be done about it. `ManagedEntrySheet` already knows that a record has no
// author to send it back to, so the only correction it offers on one is to
// withdraw it - which is the whole of §11.
//
// Fetched by id rather than handed down from the list: the address carries
// which claim is open, so a reload and a shared link have to be able to draw
// it without the list having been walked to it.

export function AdministrativeEntrySheet({
  open,
  batchId,
  entryId,
  onClose,
}: {
  /** false while the sheet is shutting; the caller keeps it mounted for that */
  open: boolean
  batchId: string
  entryId: string
  onClose: () => void
}) {
  const api = useApi(assessmentApi)
  const run = useRunApi()
  const query = useApiQuery(assessmentApi)
  const queryClient = useQueryClient()
  const { format, formatError } = useI18n()

  const detail = useQuery(query.assessment.getEntry.queryOptions({ params: { entryId } }))
  const items = useQuery(query.assessment.listItems.queryOptions({ params: { batchId } }))
  const groups = useQuery(query.assessment.listScoreGroups.queryOptions({ params: { batchId } }))

  // the determination comes from the record book, which reads it through the
  // question version it was judged under; the general entry read does not
  // carry one at all
  const book = useQuery(
    query.assessment.listAdministrativeEntries.queryOptions({
      params: { batchId },
      query: { limit: '200' },
    }),
  )
  const determined: RecognitionDto | null = (() => {
    const row = (book.data?.entries ?? []).find((one) => one.entryId === entryId)
    if (row === undefined || row.recognition === null) return null
    return {
      id: row.recognition.id,
      source: row.source,
      entryRevisionId: row.revision.id,
      values: row.recognition.values,
      createdAt: Date.parse(row.revision.createdAt),
      createdByName: row.revision.actorName,
    }
  })()

  const entry = detail.data?.entry
  const item = ((items.data?.items ?? []) as readonly ItemDto[]).find(
    (candidate) => candidate.id === entry?.itemId,
  )
  // the words arrive after the sheet does; until they do there is nothing
  // to draw
  const ready = entry !== undefined && item !== undefined ? { entry, item } : null
  const lingering = useLingering(ready)

  // Withdrawing changes what the score is made of, so the book, the claim
  // and the person's account are all asked again rather than patched here.
  const withdraw = useMutation({
    mutationFn: (input: { entryId: string; reason: string }) =>
      run(
        api.assessment.interveneOnEntry({
          params: { entryId: input.entryId },
          payload: { kind: 'void', reason: input.reason },
        }),
      ),
    onSuccess: () => {
      toast.success(format(m.staffVoided))
      void queryClient.invalidateQueries({
        queryKey: query.assessment.listAdministrativeEntries.key({
          params: { batchId },
          query: {},
        }),
      })
      void queryClient.invalidateQueries({ queryKey: query.assessment.getEntry.key() })
      onClose()
    },
    onError: (error) => toast.error(formatError(error)),
  })

  if (lingering === null) return null
  return (
    <ManagedEntrySheet
      key={lingering.entry.id}
      open={open && ready !== null}
      entry={lingering.entry as EntryDto}
      item={lingering.item}
      recognition={determined}
      trail={trailOf(lingering.item, new Map((groups.data?.groups ?? []).map((g) => [g.id, g])))}
      busy={withdraw.isPending}
      onClose={onClose}
      onIntervene={(kind, reason) => {
        if (kind !== 'void') return
        withdraw.mutate({ entryId: lingering.entry.id, reason })
      }}
    />
  )
}

/** the groups above a question, outermost first */
const trailOf = (
  item: ItemDto,
  groups: ReadonlyMap<string, { name: string; parentGroupId: string | null }>,
): readonly string[] => {
  const names: string[] = []
  let at = groups.get(item.scoreGroupId)
  // a cycle cannot happen in a saved tree, but a bound keeps a bad one from
  // hanging the screen it is drawn on
  for (let depth = 0; at !== undefined && depth < 16; depth += 1) {
    names.unshift(at.name)
    at = at.parentGroupId === null ? undefined : groups.get(at.parentGroupId)
  }
  return names
}
