import { useEffect, useState } from 'react'
import { useDocumentNow } from '@qualy/web-runtime'
import type { Message } from '@qualy/i18n-contract'
import { spanMessage, spanOf } from './progress.ts'

/** A live document clock; server HTML and the takeover use the document instant. */
export function useDeadlineNow(at: number | null): number {
  const now = useDocumentNow()
  const [, redraw] = useState(0)
  useEffect(() => {
    if (at === null) return
    let timer: ReturnType<typeof setTimeout>
    const arm = () => {
      const left = at - Date.now()
      if (left <= 0) return
      const precision = left < 3_600_000 ? 1000 : 60_000
      const next = left % precision || 1
      timer = setTimeout(
        () => {
          redraw((n) => n + 1)
          arm()
        },
        Math.min(left, next + 1),
      )
    }
    arm()
    return () => clearTimeout(timer)
  }, [at])
  return now
}

export function deadlineWords(at: number, now: number): string {
  const remaining = at - now
  const span = spanMessage(
    { kind: 'until', at, remaining, span: spanOf(Math.max(1_000, remaining)), fraction: null },
    'single',
  )
  return (span.message as Message)(span.values)
}
