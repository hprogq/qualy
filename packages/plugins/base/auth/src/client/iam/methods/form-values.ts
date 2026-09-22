import type { ApiResult } from '@qualy/web-runtime/api'
import type { authApi } from '../../api.ts'

// What an entrance's form holds, read the way the server reads it: a box
// somebody typed in holds what was typed, an untouched one what is stored,
// and one nobody ever set its default. Which boxes show depends on those
// values, so the form and its save read them through the same two helpers.

export type EntranceKind = ApiResult<
  typeof authApi,
  'identity',
  'listAuthProviderKinds'
>['kinds'][number]

export type EntranceField = EntranceKind['fields'][number]

/**
 * What each box holds as the form stands: typed, else stored, else its
 * default. An emptied box is back to its default, which for most is nothing.
 */
export const formValues = (
  kind: EntranceKind,
  config: Readonly<Record<string, string>>,
  draft: Readonly<Record<string, string>>,
): Record<string, string> =>
  Object.fromEntries(
    kind.fields.map((field) => {
      const typed = draft[field.key]
      const value =
        typed === undefined
          ? (config[field.key] ?? field.defaultValue ?? '')
          : typed.trim() === ''
            ? (field.defaultValue ?? '')
            : typed
      return [field.key, value]
    }),
  )

/** whether the form shows a box, given what the form holds */
export const fieldShown = (field: EntranceField, values: Readonly<Record<string, string>>) =>
  field.visibleWhen === null || values[field.visibleWhen.field] === field.visibleWhen.equals

