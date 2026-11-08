/** A browser preference, never a credential or an authorization input. */
export const RECENT_LOGIN_METHOD_COOKIE = 'qualy_login_method'
export const RECENT_LOGIN_METHOD_MAX_AGE = 15_552_000

/** Read only the bounded method code; the page matches it against its offered methods. */
export function recentLoginMethod(header: string | undefined): string | null {
  const value = (header ?? '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${RECENT_LOGIN_METHOD_COOKIE}=`))
    ?.slice(RECENT_LOGIN_METHOD_COOKIE.length + 1)
  if (!value || value.length > 384) return null
  try {
    const code = decodeURIComponent(value)
    const control = [...code].some((character) => {
      const point = character.charCodeAt(0)
      return point < 32 || point === 127
    })
    return code.length <= 128 && !control ? code : null
  } catch {
    return null
  }
}
