import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ShieldQuestionIcon } from 'lucide-react'
import { peoplePickerView } from '@qualy/ui-contract'
import { UiSlot, useApiQuery } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { assessmentApi } from '../api.ts'

import { DialogBlank } from '../DialogBlank.tsx'
import * as m from '#messages'

// Choosing people for an administrative finding.
//
// The drawing is the one the directory uses - the same tree, search, kind
// filter and paging - but the people in it are this round's participants and
// nobody else. That is not a nicety: a recorder may hold
// `assessment.entry.record` without holding `auth.user.read`, so the
// directory's picker would not even appear for them; and even where it did,
// it would offer people who are not in this round at all.
//
// So the view comes from the slot and the population comes from here
// (§32.78). The units are the ones this round froze its people under, and
// the list is `listParticipants`, whose reach is already narrowed in sql.
// Nothing chosen here is authorized by having been chosen - the write proves
// every id again.
//
// That list is read forwards by cursor, unlike the directory's and the
// roster candidates', so its pages are walked one at a time rather than
// numbered: the strip under it is the numbered one's, holding the way back,
// the page being read and the way on. Numbering it would mean counting the
// reach on every page for a list that is searched far more often than it is
// paged through.

const PAGE = 25

export function RosterPeoplePicker({
  batchId,
  value,
  onChange,
  disabled,
  disabledLabel,
}: {
  batchId: string
  value: readonly string[]
  onChange: (participantIds: readonly string[]) => void
  /** people who may not be chosen, by participant id */
  disabled?: readonly string[]
  disabledLabel?: string
}) {
  const query = useApiQuery(assessmentApi)
  const { formatError } = useI18n()

  const [nodeId, setNodeId] = useState<string | null>(null)
  const [scope, setScope] = useState<'self' | 'subtree'>('subtree')
  const [userTypeId, setUserTypeId] = useState('')
  const [search, setSearch] = useState('')
  // the cursor stack carries the question it belongs to: a cursor from one
  // question applied to another silently skips or repeats people
  const [paging, setPaging] = useState<{
    question: string
    cursors: readonly (string | undefined)[]
    at: number
  }>({ question: '', cursors: [undefined], at: 0 })

  const units = useQuery(
    query.assessment.listRosterUnits.queryOptions({ params: { batchId }, query: {} }),
  )
  const nodes = units.data?.units ?? []
  const here = nodeId ?? nodes[0]?.id ?? null
  // the kinds this round admitted its people as, which the list narrows by
  // and each row is named with
  const kinds = units.data?.userTypes ?? []
  const kindOf = new Map(kinds.map((kind) => [kind.id, kind.name]))

  const question = `${here ?? ''}:${scope}:${search}:${userTypeId}`
  const page = paging.question === question ? paging : { question, cursors: [undefined], at: 0 }
  const { cursors, at } = page

  const people = useQuery({
    ...query.assessment.listParticipants.queryOptions({
      params: { batchId },
      query: {
        status: 'active',
        ...(here !== null ? { orgNodeIds: [here], orgScope: scope } : {}),
        ...(search !== '' ? { q: search } : {}),
        ...(userTypeId !== '' ? { userTypeId } : {}),
        ...(cursors[at] !== undefined ? { cursor: cursors[at] } : {}),
        limit: String(PAGE),
      },
    }),
    enabled: here !== null,
  })

  const nextCursor = people.data?.nextCursor ?? null
  const chosen = new Set(value)
  const blocked = new Set(disabled ?? [])

  return (
    <UiSlot
      token={peoplePickerView}
      context={{
        nodes,
        userTypes: kinds,
        rows: (people.data?.items ?? []).map((row) => ({
          // the participant is what an act reaches, so it is what is chosen
          id: row.id,
          displayName: row.displayName,
          businessNo: row.businessNo,
          userTypeName: kindOf.get(row.userTypeId) ?? null,
          // where this round has them, spelled from the round's own units
          unitId: row.anchorNodeId,
        })),
        nodeId: here,
        scope,
        userTypeId,
        search,
        value,
        ...(disabled === undefined ? {} : { disabled }),
        ...(disabledLabel === undefined ? {} : { disabledLabel }),
        pending: people.isPending && here !== null,
        error: people.isError ? formatError(people.error) : null,
        hasPrevious: at > 0,
        hasNext: nextCursor !== null,
        position: at + 1,
        onNodeChange: setNodeId,
        onScopeChange: setScope,
        onUserTypeChange: setUserTypeId,
        onSearchChange: setSearch,
        onToggle: (participantId: string) => {
          if (blocked.has(participantId)) return
          const next = new Set(chosen)
          if (next.has(participantId)) next.delete(participantId)
          else next.add(participantId)
          onChange([...next])
        },
        onChange: (participantIds: readonly string[]) =>
          onChange(participantIds.filter((id) => !blocked.has(id))),
        onPrevious: () => setPaging({ question, cursors, at: Math.max(0, at - 1) }),
        onNext: () => {
          if (nextCursor !== null && cursors[at + 1] !== nextCursor) {
            setPaging({ question, cursors: [...cursors.slice(0, at + 1), nextCursor], at: at + 1 })
            return
          }
          setPaging({ question, cursors, at: at + 1 })
        },
        onRetry: () => void people.refetch(),
      }}
      fallback={
        <DialogBlank
          testId="record-people-unavailable"
          icon={<ShieldQuestionIcon />}
          title={m.roster_pickerUnavailable()}
          description={m.roster_pickerUnavailableHint()}
        />
      }
    />
  )
}
