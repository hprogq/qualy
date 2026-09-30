import { useMemo } from 'react'

import { recordedOnly, trimAmount, type ItemDto } from '../model.ts'
import { eachWorth } from '../standing.ts'
import type { LineWords } from './model.ts'
import * as m from '#messages'

/** the one line that says how a question scores, in the reader's language */
export const useCalcLine = () => {
  return (item: ItemDto): string => {
    const each = eachWorth(item)
    if (item.itemType === 'constant') {
      return each === undefined
        ? m.entry_granted()
        : m.paper_grantedEach({ value: trimAmount(each) })
    }
    if (recordedOnly(item)) return m.entries_calcRecorded()
    return each === undefined
      ? m.entries_calcByRule()
      : m.myEntries_headEach({ value: trimAmount(each) })
  }
}

/** how a claim's identity line is joined, in the reader's language */
export const useLineWords = (): LineWords => {
  return useMemo(
    () => ({
      figure: (label, value) => m.entries_figure({ label, value }),
      join: (before, after) => m.entries_partJoin({ before, after }),
    }),
    [],
  )
}
