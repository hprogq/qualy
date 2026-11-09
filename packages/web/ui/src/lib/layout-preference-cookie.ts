const prefix = 'qualy-layout-'
const name = /^[a-z][a-z0-9-]{0,39}$/

export type LayoutPreferences = Readonly<Record<string, number>>

/** Only small, numeric layout preferences cross the document boundary. */
export function readLayoutPreferences(header: string | null): LayoutPreferences {
  const values: Record<string, number> = {}
  for (const part of header?.split(';') ?? []) {
    const [key, value, extra] = part.trim().split('=')
    if (!key?.startsWith(prefix) || value === undefined || extra !== undefined) continue
    const preference = key.slice(prefix.length)
    if (name.test(preference) && /^\d{1,4}$/.test(value) && !Object.hasOwn(values, preference)) {
      values[preference] = Number(value)
      if (Object.keys(values).length === 16) break
    }
  }
  return values
}

export function layoutPreferenceCookie(key: string, value: number, secure: boolean): string {
  if (!name.test(key) || !Number.isInteger(value) || value < 0 || value > 9999) {
    throw new RangeError('Invalid layout preference')
  }
  return `${prefix}${key}=${value}; Path=/; SameSite=Lax; Max-Age=31536000${secure ? '; Secure' : ''}`
}
