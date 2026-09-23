// A leaf with no imports: the browser reads the same list the server checks.

/**
 * The icons the sign-in page draws itself.
 *
 * A driver names one for its kind and an administrator may choose another,
 * or upload an image; a door with neither is drawn by the first letter of
 * its name. Keys, not drawings: the browser owns how each looks.
 */
export const BUILTIN_LOGIN_ICONS = [
  'campus',
  'key',
  'mail',
  'id-card',
  'shield',
  'globe',
  'github',
  'gitlab',
  'microsoft',
  'google',
  'apple',
  'wechat',
  'wecom',
  'dingtalk',
  'feishu',
  'qq',
] as const

export type BuiltinLoginIcon = (typeof BUILTIN_LOGIN_ICONS)[number]

/** most doors a sign-in page lists in full */
export const MAX_PRIMARY_LOGIN_METHODS = 3
