import { formatDateTime, type DateTimeStyle } from '@qualy/date-format'

// Calendar captions use the same locale data as timestamps, without changing
// the widget's Date values or introducing another calendar/selection model.

const dayOf = (date: string) => new Date(`${date.slice(0, 10)}T00:00:00`)

export interface DateWords {
  /** the month a calendar page is showing, as its header */
  monthLabelFormat: (date: string) => string
  yearLabelFormat: (date: string) => string
  /** the single letters over the columns */
  weekdayFormat: (date: string) => string
  monthsListFormat: (date: string) => string
  yearsListFormat: (date: string) => string
  /** what a day control is called when it is read out */
  getDayAriaLabel: (date: string) => string
}

/**
 * How wide the column headings have to be to stay distinct.
 *
 * A calendar wants the shortest weekday it can use: Chinese reads 一二三四五六日
 * down the top of every calendar ever printed, and 周一 周二 is the sentence
 * form. English narrow, though, is M T W T F S S - two T's and two S's - so
 * the rule is the property that matters rather than a list of languages:
 * take the narrow form when all seven differ, and step up when they do not.
 */
const weekdayWidthIn = (localeTag: string | undefined): 'narrow' | 'short' => {
  const week = [4, 5, 6, 7, 8, 9, 10].map((day) => new Date(2026, 0, day))
  const said = week.map((day) => formatDateTime(day, localeTag ?? 'en-US', 'weekday-narrow'))
  return new Set(said).size === week.length ? 'narrow' : 'short'
}

export function dateWordsIn(localeTag: string | undefined): DateWords {
  const say = (style: DateTimeStyle) => (date: string) =>
    formatDateTime(dayOf(date), localeTag ?? 'en-US', style)
  return {
    monthLabelFormat: say('calendar-month'),
    yearLabelFormat: say('calendar-year'),
    weekdayFormat: say(weekdayWidthIn(localeTag) === 'narrow' ? 'weekday-narrow' : 'weekday-short'),
    monthsListFormat: say('month-short'),
    yearsListFormat: say('calendar-year'),
    getDayAriaLabel: say('long-date'),
  }
}

/** one calendar date, spelled the way the reader reads dates */
export const dayIn = (localeTag: string | undefined, date: string) =>
  formatDateTime(dayOf(date), localeTag ?? 'en-US', 'date')
