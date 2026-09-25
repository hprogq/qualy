import { useI18n } from '@qualy/web-i18n'
import { dayKeyOf, inZone, readableZone, useBatchZone, yearOf } from './zone.ts'

// When a stage runs, said as shortly as it can be said without becoming
// ambiguous.
//
// Two stages of one round can begin and end on the same day, so the minute
// is never dropped. Everything above it is: the year goes when it is this
// year, and the date of the far edge goes when both edges fall on one day -
// "8月10日 02:17 — 07:01" says exactly what the long form said, in half the
// width of a column that has none to spare.
//
// Read on the batch's clock: "this year" and "one day" are that clock's
// year and day. A screen that lists several rounds hands each row's zone in.

export interface When {
  /** a day and a minute, as short as it can be */
  moment: (at: number) => string
  /** both edges of a span, with everything repeated between them dropped */
  span: (from: number | null, to: number | null) => string | null
}

export const useWhen = (zone?: string): When => {
  const { locale } = useI18n()
  const batchZone = useBatchZone()
  const clock = zone === undefined ? batchZone : readableZone(zone)
  const thisYear = yearOf(Date.now(), clock)

  const day = (at: number) =>
    new Date(at).toLocaleDateString(
      locale,
      yearOf(at, clock) === thisYear
        ? { month: 'short', day: 'numeric', ...inZone(clock) }
        : { year: 'numeric', month: 'short', day: 'numeric', ...inZone(clock) },
    )
  const time = (at: number) =>
    new Date(at).toLocaleTimeString(locale, {
      hour: '2-digit',
      minute: '2-digit',
      ...inZone(clock),
    })
  const moment = (at: number) => `${day(at)} ${time(at)}`
  const sameDay = (a: number, b: number) => dayKeyOf(a, clock) === dayKeyOf(b, clock)

  return {
    moment,
    // both edges or nothing: a span with one end is a sentence, and the
    // caller is the one that knows how to say it
    span: (from, to) =>
      from === null || to === null
        ? null
        : sameDay(from, to)
          ? `${day(from)} ${time(from)} – ${time(to)}`
          : `${moment(from)} – ${moment(to)}`,
  }
}
