// The date words, in the reader's language, from the product's own locale.
//
// The widget library formats through dayjs, which needs a locale module
// imported per language before it will say anything but English. That would
// be a second register of languages to keep in step with the product's own,
// so instead every formatting prop is handed a function - the library
// documents them all as accepting one - and the platform's Intl does the
// speaking. One locale tag, from one source, and no language bundles.

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
  const narrow = new Intl.DateTimeFormat(localeTag, { weekday: 'narrow' })
  const said = week.map((day) => narrow.format(day))
  return new Set(said).size === week.length ? 'narrow' : 'short'
}

export function dateWordsIn(localeTag: string | undefined): DateWords {
  const say = (options: Intl.DateTimeFormatOptions) => (date: string) =>
    new Intl.DateTimeFormat(localeTag, options).format(dayOf(date))
  return {
    monthLabelFormat: say({ year: 'numeric', month: 'long' }),
    yearLabelFormat: say({ year: 'numeric' }),
    weekdayFormat: say({ weekday: weekdayWidthIn(localeTag) }),
    monthsListFormat: say({ month: 'short' }),
    yearsListFormat: say({ year: 'numeric' }),
    getDayAriaLabel: say({ year: 'numeric', month: 'long', day: 'numeric' }),
  }
}

/** one calendar date, spelled the way the reader reads dates */
export const dayIn = (localeTag: string | undefined, date: string) =>
  new Intl.DateTimeFormat(localeTag, { dateStyle: 'medium' }).format(dayOf(date))
