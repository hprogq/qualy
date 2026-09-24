import { normalizeEmail } from '@qualy/auth-contract/email'

// Accounts a demonstration deployment hands out to anybody who asks.
//
// A shared account is only shared while nobody can take it: a visitor who
// changed its password or its address, or tied their own GitHub to it, would
// lock out or expose everybody after them. So a deployment that names demo
// accounts also freezes their credentials - no password set by anyone, no
// address changed, no way in added or removed, and no reset mail sent - and
// the sign-in page offers them by name. A deployment that names none has
// neither behaviour.

export interface DemoAccount {
  readonly email: string
  readonly password: string
  /** what the sign-in page calls it: 学生, 班级综测负责人, … */
  readonly label: string
}

export const DEMO_ACCOUNTS_MALFORMED =
  'QUALY_DEMO_ACCOUNTS must be a JSON array of objects with a string email, password and label'

/** the accounts named in the environment, or undefined when the value is not that shape */
export const parseDemoAccounts = (raw: string): readonly DemoAccount[] | undefined => {
  if (raw.trim() === '') return []
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (!Array.isArray(value)) return undefined
  const accounts: DemoAccount[] = []
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) return undefined
    const { email, password, label } = entry as Record<string, unknown>
    if (typeof email !== 'string' || typeof password !== 'string' || typeof label !== 'string') {
      return undefined
    }
    const normalized = normalizeEmail(email)
    if (normalized === null || password === '' || label.trim() === '') return undefined
    accounts.push({ email: normalized, password, label: label.trim() })
  }
  return accounts
}

/** whether this address belongs to one of the frozen accounts */
export const isDemoAccount = (
  accounts: readonly DemoAccount[] | undefined,
  email: string | null | undefined,
): boolean => {
  if (email === null || email === undefined || accounts === undefined || accounts.length === 0) {
    return false
  }
  const normalized = normalizeEmail(email)
  return normalized !== null && accounts.some((account) => account.email === normalized)
}
