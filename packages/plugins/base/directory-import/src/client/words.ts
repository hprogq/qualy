import type { useI18n } from '@qualy/web-i18n'
import { directoryImportMessages as m } from './i18n.ts'

// What an import problem says, in the reader's words; and when something
// happened, in their calendar.

type Format = ReturnType<typeof useI18n>['format']

export interface IssueLike {
  readonly field: string | null
  readonly reason: string
  readonly detail?: string | undefined
}

const FIELD_WORDS = {
  displayName: m.fieldDisplayName,
  userType: m.fieldUserType,
  organization: m.fieldOrganization,
} as const

/** the sentence for one problem; `businessNo` is the tenant's word for a person's identifier */
export const issueText = (format: Format, issue: IssueLike, businessNo: string): string => {
  switch (issue.reason) {
    case 'business-no-required':
      return format(m.issueBusinessNoRequired, { businessNo })
    case 'business-no-too-long':
      return format(m.issueBusinessNoTooLong, { businessNo })
    case 'duplicate-in-file':
      return format(m.issueDuplicate, { businessNo, row: issue.detail ?? '' })
    case 'display-name-required':
      return format(m.issueDisplayNameRequired)
    case 'display-name-too-long':
      return format(m.issueDisplayNameTooLong)
    case 'org-level-required':
      return format(m.issueOrgLevelRequired)
    case 'org-name-too-long':
      return format(m.issueOrgNameTooLong)
    case 'control-character':
      return format(m.issueControlCharacter)
    case 'user-conflict':
      return format(m.issueUserConflict, {
        businessNo,
        fields: (issue.detail ?? '')
          .split(',')
          .filter((field) => field !== '')
          .map((field) =>
            Object.hasOwn(FIELD_WORDS, field)
              ? format(FIELD_WORDS[field as keyof typeof FIELD_WORDS])
              : field,
          )
          .join('/'),
      })
    case 'business-no-taken':
      return format(m.issueBusinessNoTaken, { businessNo })
    case 'node-type-conflict':
      return format(m.issueNodeConflict, { path: issue.detail ?? '' })
    default:
      return format(m.issueOther, { reason: issue.reason })
  }
}

/** a moment as the reader's calendar writes it: month, day, time */
export const whenText = (locale: string, iso: string): string =>
  new Intl.DateTimeFormat(locale, {
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
