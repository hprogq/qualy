import { Schema } from 'effect'

// The settings domain's failures, as tagged errors on the wire.

/** no plugin in this assembly declares a setting by that id, or it is not a term */
export class SettingNotFound extends Schema.TaggedError<SettingNotFound>()(
  'SETTING_NOT_FOUND',
  {},
  { httpApiStatus: 404, identifier: 'SettingNotFound' },
) {}

/** the version carried back is not the one on the row: somebody wrote in between */
export class SettingVersionConflict extends Schema.TaggedError<SettingVersionConflict>()(
  'SETTING_VERSION_CONFLICT',
  {},
  { httpApiStatus: 409, identifier: 'SettingVersionConflict' },
) {}

/** the value offered is not one the definition admits: an unknown locale, a word too long */
export class SettingValueInvalid extends Schema.TaggedError<SettingValueInvalid>()(
  'SETTING_VALUE_INVALID',
  { reason: Schema.String, locale: Schema.String },
  { httpApiStatus: 400, identifier: 'SettingValueInvalid' },
) {}

/** the one unique index a write can meet, and what meeting it means */
export const settingConstraints = {
  uq_tenant_setting_values_tenant_setting: () => new SettingVersionConflict(),
}
