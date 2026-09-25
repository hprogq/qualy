import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useApi, useApiQuery, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { Button } from '@qualy/ui/button'
import { toast } from '@qualy/ui/toast'
import { useLingering } from '@qualy/ui/use-lingering'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'
import { ManagedEntrySheet, type RecognitionDto } from '../entry/ManagedEntrySheet.tsx'
import { sayEntryFailure } from '../entry/refusals.ts'
import type { ItemDto } from '../entry/model.ts'

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
  writable,
  entryId,
  onClose,
  onOpenImport,
  onOpenAct,
  onFailed,
}: {
  /** false while the sheet is shutting; the caller keeps it mounted for that */
  open: boolean
  batchId: string
  /** false once the round is archived: its records are kept as they closed */
  writable: boolean
  entryId: string
  onClose: () => void
  /** to the import this fact arrived in, when it arrived in one */
  onOpenImport: (importId: string) => void
  /** to the act that settled it, when it was settled with others */
  onOpenAct: (operationId: string) => void
  /** the record could not be opened; the screen behind decides what to say */
  onFailed: (reason: string) => void
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
  // carry one at all. Asked for this one fact by id, because the one being
  // read may be the thousandth line of the book.
  const book = useQuery(
    query.assessment.listAdministrativeEntries.queryOptions({
      params: { batchId },
      query: { entryId, limit: '1' },
    }),
  )
  const line = (book.data?.entries ?? []).find((one) => one.entryId === entryId)
  const determined: RecognitionDto | null = (() => {
    const row = line
    if (row === undefined || row.recognition === null) return null
    // off the determination's own row: a record written in one act has the
    // same hand on both, and an appeal that re-determines one does not -
    // borrowing the filing's author said the office decided something it
    // did not
    return {
      id: row.recognition.id,
      source: row.recognition.source,
      entryRevisionId: row.revision.id,
      values: row.recognition.values,
      createdAt: Date.parse(row.recognition.createdAt),
      createdByName: row.recognition.actorName,
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
      void queryClient.invalidateQueries({
        queryKey: query.assessment.listAdministrativeImports.key({
          params: { batchId },
          query: {},
        }),
      })
      void queryClient.invalidateQueries({
        queryKey: query.assessment.getAdministrativeImport.key(),
      })
      void queryClient.invalidateQueries({
        queryKey: query.assessment.listAdministrativeImportRows.key(),
      })
      onClose()
    },
    onError: (error) => toast.error(sayEntryFailure(error, { format, formatError })),
  })

  // A record that will not open has to say so.
  //
  // Returning nothing here meant a press on a row did nothing at all: no
  // sheet, no message, nothing to retry - which is what a reader saw when a
  // deep link named an entry that is not theirs, or when the read simply
  // failed. Whether it exists is not said either way; whether THIS reader
  // can open it is.
  if (detail.isError && lingering === null) {
    onFailed(formatError(detail.error))
    return null
  }
  if (lingering === null) return null
  return (
    <ManagedEntrySheet
      key={lingering.entry.id}
      open={open && ready !== null}
      entry={lingering.entry}
      item={lingering.item}
      recognition={determined}
      trail={trailOf(lingering.item, new Map((groups.data?.groups ?? []).map((g) => [g.id, g])))}
      busy={withdraw.isPending}
      may={{ returnForRevision: false, withdraw: writable }}
      onClose={onClose}
      onIntervene={(kind, reason) => {
        if (kind !== 'void') return
        withdraw.mutate({ entryId: lingering.entry.id, reason })
      }}
      provenance={
        // one or the other, never both: a fact comes from a file or from an
        // act, and the way back is to whichever settled it
        line !== undefined && line.importId !== null ? (
          <Button size="sm" variant="ghost" onClick={() => onOpenImport(line.importId!)}>
            {format(m.importViewImport)}
          </Button>
        ) : line !== undefined && line.operationId !== null ? (
          <Button size="sm" variant="ghost" onClick={() => onOpenAct(line.operationId!)}>
            {format(m.recordActOpen)}
          </Button>
        ) : null
      }
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
