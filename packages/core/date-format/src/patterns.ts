import { enUS } from 'date-fns/locale/en-US'
import { zhCN } from 'date-fns/locale/zh-CN'
import type { SupportedLocale } from '@qualy/i18n-contract'

// Product display templates, not an Intl implementation. Localized P/p
// tokens, month names and parsing are supplied by date-fns's locale data.
const english = {
  'date-time': 'PPp',
  'event-time': 'PPpp',
  'month-day-time': 'MMMM d, p',
  'year-month-day-time': 'MMMM d, yyyy, p',
  'month-day-clock': 'MMM d, HH:mm',
  'month-day-short-time': 'MMM d, p',
  'year-month-day-short-time': 'MMM d, yyyy, p',
  'month-day-long-clock': 'MMMM d, HH:mm',
  'year-month-day-clock': 'MMM d, yyyy, HH:mm',
  'numeric-time': 'MM/dd, pp',
  'numeric-year-time': 'MM/dd/yyyy, pp',
  'calendar-month': 'LLLL yyyy',
  'calendar-year': 'yyyy',
  'weekday-narrow': 'EEEEE',
  'weekday-short': 'EEE',
  'month-short': 'LLL',
  date: 'PP',
  'long-date': 'MMMM d, yyyy',
  'short-date': 'MMM d, yyyy',
  'month-day': 'MMMM d',
  'short-month-day': 'MMM d',
  clock: 'HH:mm',
  'clock-local': 'p',
}

export type DateTimeStyle = keyof typeof english

export const dateLanguages = {
  'en-US': { locale: enUS, patterns: english },
  'zh-CN': {
    locale: zhCN,
    patterns: {
      'date-time': 'yyyy年M月d日 HH:mm',
      'event-time': 'yyyy年M月d日 HH:mm:ss',
      'month-day-time': 'M月d日 HH:mm',
      'year-month-day-time': 'yyyy年M月d日 HH:mm',
      'month-day-clock': 'M月d日 HH:mm',
      'month-day-short-time': 'M月d日 HH:mm',
      'year-month-day-short-time': 'yyyy年M月d日 HH:mm',
      'month-day-long-clock': 'M月d日 HH:mm',
      'year-month-day-clock': 'yyyy年M月d日 HH:mm',
      'numeric-time': 'MM/dd HH:mm:ss',
      'numeric-year-time': 'yyyy/MM/dd HH:mm:ss',
      'calendar-month': 'yyyy年M月',
      'calendar-year': 'yyyy年',
      'weekday-narrow': 'EEEEE',
      'weekday-short': 'EEE',
      'month-short': 'LLL',
      date: 'yyyy年M月d日',
      'long-date': 'yyyy年M月d日',
      'short-date': 'yyyy年M月d日',
      'month-day': 'M月d日',
      'short-month-day': 'M月d日',
      clock: 'HH:mm',
      'clock-local': 'HH:mm',
    },
  },
} satisfies Record<
  SupportedLocale,
  { locale: typeof enUS; patterns: Record<DateTimeStyle, string> }
>
