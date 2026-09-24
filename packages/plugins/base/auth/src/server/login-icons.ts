import {
  BUILTIN_LOGIN_ICONS,
  type BuiltinLoginIcon,
  type LoginMethodIcon,
} from '@qualy/auth-contract/login'

// What a door's icon column holds, and how it goes out on the wire.
//
// One of the page's own icons by key, or an image in up to two versions: one
// for a light surface, and one for a dark surface if the tenant gave one. Each
// version is a stored upload, or an SVG kept in the column itself - it is a
// few kilobytes, and serving the very bytes that were checked leaves nothing
// to change between the check and the reader.

export type IconSlot =
  | { readonly kind: 'upload'; readonly attachmentId: string }
  | { readonly kind: 'svg'; readonly markup: string; readonly version: string }

export type StoredIcon =
  | { readonly kind: 'builtin'; readonly key: BuiltinLoginIcon }
  | { readonly kind: 'image'; readonly onLight: IconSlot; readonly onDark: IconSlot | null }

const slotOf = (value: unknown): IconSlot | null => {
  const slot = value as {
    kind?: unknown
    attachmentId?: unknown
    markup?: unknown
    version?: unknown
  }
  if (slot?.kind === 'upload' && typeof slot.attachmentId === 'string') {
    return { kind: 'upload', attachmentId: slot.attachmentId }
  }
  if (slot?.kind === 'svg' && typeof slot.markup === 'string' && typeof slot.version === 'string') {
    return { kind: 'svg', markup: slot.markup, version: slot.version }
  }
  return null
}

/** the column read as an icon, or null for none of the tenant's own */
export const storedIconOf = (stored: unknown): StoredIcon | null => {
  const icon = stored as {
    kind?: unknown
    key?: unknown
    onLight?: unknown
    onDark?: unknown
  } | null
  if (icon?.kind === 'builtin' && BUILTIN_LOGIN_ICONS.includes(icon.key as BuiltinLoginIcon)) {
    return { kind: 'builtin', key: icon.key as BuiltinLoginIcon }
  }
  if (icon?.kind === 'image') {
    const onLight = slotOf(icon.onLight)
    if (onLight !== null) return { kind: 'image', onLight, onDark: slotOf(icon.onDark) }
  }
  return null
}

/** what a version of an image is addressed by */
export const slotVersion = (slot: IconSlot) =>
  slot.kind === 'upload' ? slot.attachmentId : slot.version

/** the uploads an icon holds, which are what storage must keep */
export const uploadsOf = (icon: StoredIcon | null): string[] =>
  icon?.kind === 'image'
    ? [icon.onLight, icon.onDark].flatMap((slot) =>
        slot?.kind === 'upload' ? [slot.attachmentId] : [],
      )
    : []

/**
 * How a door is drawn on the wire: what an administrator chose, or its
 * driver's own icon. An image goes by the version of each image, which is
 * also what makes a replaced one a new address for a browser's cache.
 */
export const iconOf = (
  stored: unknown,
  fallback: BuiltinLoginIcon | undefined,
): LoginMethodIcon => {
  const chosen = storedIconOf(stored)
  if (chosen?.kind === 'builtin') return chosen
  if (chosen?.kind === 'image') {
    return {
      kind: 'image',
      version: slotVersion(chosen.onLight),
      onDark: chosen.onDark === null ? null : slotVersion(chosen.onDark),
    }
  }
  return fallback === undefined ? null : { kind: 'builtin', key: fallback }
}
