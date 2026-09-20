import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup } from 'effect/unstable/httpapi'
import { BadRequest, uiText } from '@qualy/api-kit/schema'
import { AccessDenied } from '@qualy/rbac-contract/effect'
import { Authenticated } from '@qualy/auth-contract/session'
import { SettingNotFound, SettingValueInvalid, SettingVersionConflict } from './server/errors.ts'

// The settings api, as definitions only. Paths are frozen.
//
// Reading terminology is for everyone signed in - a student's screen shows
// the tenant's word for their identifier like anyone else's - so the GET
// carries no permission; changing a word is an administrative act behind
// `settings.terminology.manage`. One resource, one PUT: an empty override
// is "back to the default", not a second action.

/** words by locale tag; a locale left out follows the default */
const localizedWords = Schema.Record(Schema.String, Schema.String)

const settingCategory = Schema.Struct({
  id: Schema.String,
  label: uiText,
  order: Schema.Number,
})

/** one term as the screen edits it: what the plugin says, what the tenant said */
const termView = Schema.Struct({
  id: Schema.String,
  categoryId: Schema.String,
  label: uiText,
  description: Schema.NullOr(uiText),
  order: Schema.Number,
  maxLength: Schema.Number,
  defaults: localizedWords,
  override: localizedWords,
  /** 0 while the tenant never wrote this setting; what a PUT has to carry back */
  version: Schema.Number,
})

/** one segment of a setting id: kebab-case, as the catalog admits it */
const segment = Schema.String.check(Schema.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/))

export const settingsApiGroup = HttpApiGroup.make('settings')
  .add(
    HttpApiEndpoint.get('getTerminology', '/tenant/terminology', {
      success: Schema.Struct({
        categories: Schema.Array(settingCategory),
        terms: Schema.Array(termView),
      }),
      error: [BadRequest],
    }).middleware(Authenticated),
  )
  .add(
    HttpApiEndpoint.put('putTerm', '/tenant/terminology/:namespace/:name', {
      params: Schema.Struct({ namespace: segment, name: segment }),
      payload: Schema.Struct({
        /** the version read; 0 for a setting the tenant never wrote */
        version: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
        override: localizedWords,
      }),
      success: Schema.Struct({
        id: Schema.String,
        override: localizedWords,
        version: Schema.Number,
      }),
      error: [SettingNotFound, SettingVersionConflict, SettingValueInvalid, AccessDenied, BadRequest],
    }).middleware(Authenticated),
  )
