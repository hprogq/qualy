/** A hint only; receivers ask the server for the current identity. */
export const SESSION_CHANNEL = 'qualy:session'
export const SESSION_NOTICE_STORAGE_KEY = 'qualy.session-notice'
export const SESSION_RESUME_PARAM = 'resume'
export const SESSION_NOTICE_COOKIE = 'qualy_session_notice'
export const SESSION_NOTICE_SECURE_COOKIE = `__Host-${SESSION_NOTICE_COOKIE}`

/** Recovery returns to the login page, whose existing handshake notifies the waiting tab. */
export const recoveryReturn = (path: string | undefined): boolean => {
  if (path === undefined) return false
  try {
    const url = new URL(path, 'https://qualy.invalid')
    return (
      url.origin === 'https://qualy.invalid' &&
      url.pathname === '/login' &&
      url.searchParams.get(SESSION_RESUME_PARAM) === '1'
    )
  } catch {
    return false
  }
}
