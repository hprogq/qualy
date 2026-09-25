import { useMemo } from 'react'
import { useI18n } from '@qualy/web-i18n'
import { assessmentMessages as m } from '../../i18n.ts'
import { recordedOnly, trimAmount, type ItemDto } from '../model.ts'
import { eachWorth } from '../standing.ts'
import type { LineWords } from './model.ts'

/** the one line that says how a question scores, in the reader's language */
export const useCalcLine = () => {
  const { format } = useI18n()
  return (item: ItemDto): string => {
    const each = eachWorth(item)
    if (item.itemType === 'constant') {
      return each === undefined
        ? format(m.myEntriesGranted)
        : format(m.paperGrantedEach, { value: trimAmount(each) })
    }
    if (recordedOnly(item)) return format(m.entriesCalcRecorded)
    return each === undefined
      ? format(m.entriesCalcByRule)
      : format(m.myEntriesHeadEach, { value: trimAmount(each) })
  }
}

/** how a claim's identity line is joined, in the reader's language */
export const useLineWords = (): LineWords => {
  const { format } = useI18n()
  return useMemo(
    () => ({
      figure: (label, value) => format(m.entriesFigure, { label, value }),
      join: (before, after) => format(m.entriesPartJoin, { before, after }),
    }),
    [format],
  )
}
