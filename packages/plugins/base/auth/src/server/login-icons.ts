import {
  BUILTIN_LOGIN_ICONS,
  type BuiltinLoginIcon,
  type LoginMethodIcon,
} from '@qualy/auth-contract/login'

/**
 * How a door is drawn on the wire: what an administrator chose, or its
 * driver's own icon. An upload goes by its attachment id, which is also what
 * makes a replaced image a new address for a browser's cache.
 */
export const iconOf = (
  stored: unknown,
  fallback: BuiltinLoginIcon | undefined,
): LoginMethodIcon => {
  const chosen = stored as { kind?: unknown; key?: unknown; attachmentId?: unknown } | null
  if (chosen?.kind === 'builtin' && BUILTIN_LOGIN_ICONS.includes(chosen.key as BuiltinLoginIcon)) {
    return { kind: 'builtin', key: chosen.key as BuiltinLoginIcon }
  }
  if (chosen?.kind === 'upload' && typeof chosen.attachmentId === 'string') {
    return { kind: 'image', version: chosen.attachmentId }
  }
  return fallback === undefined ? null : { kind: 'builtin', key: fallback }
}
