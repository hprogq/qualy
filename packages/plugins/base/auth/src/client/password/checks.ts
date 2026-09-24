import { useEffect, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { SecretChecks } from '@qualy/auth-contract/login'

// What a new password is held to, worked out while it is typed: its length
// here, and whether it carries the person or would be guessed early, asked
// of the server once typing pauses - the words it is judged against are the
// person's, which the page may not have. The save is judged by the same
// answer.

const PAUSE_MS = 350

/** how long a password is, in characters, as the server measures it */
export const lengthOf = (password: string) => [...password.normalize('NFKC')].length

export type CheckState = 'met' | 'unmet' | 'checking'

export interface PasswordChecks {
  readonly length: CheckState
  readonly impersonal: CheckState
  readonly unguessable: CheckState
  /** nothing is known to be wrong: what is still being asked may yet be */
  readonly passable: boolean
  readonly error: unknown
}

/**
 * The checks for what is typed now. `scope` names whose password it is, so
 * one person's answers are never shown for another's; `assess` asks the
 * server. `error` is what asking failed with, for a page that has more to
 * say about it than the list does (a reset link that stopped working).
 */
export function usePasswordChecks({
  password,
  min,
  max,
  scope,
  assess,
}: {
  password: string
  min: number
  max: number
  scope: readonly unknown[]
  assess: (password: string) => Promise<SecretChecks>
}): PasswordChecks {
  const [settled, setSettled] = useState(password)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(password), PAUSE_MS)
    return () => clearTimeout(timer)
  }, [password])
  const length = lengthOf(password)
  const long = length >= min && length <= max
  const asked = useQuery({
    queryKey: ['auth', 'password-checks', ...scope, settled],
    queryFn: () => assess(settled),
    enabled: settled !== '' && settled === password,
    // an answer is about one string; nothing to refresh, nothing to keep long
    staleTime: Infinity,
    gcTime: 60_000,
    retry: false,
    placeholderData: keepPreviousData,
  })
  const answered = asked.data !== undefined && !asked.isPlaceholderData && settled === password
  const state = (key: 'impersonal' | 'unguessable'): CheckState =>
    password === '' ? 'unmet' : !answered ? 'checking' : asked.data[key] ? 'met' : 'unmet'
  const impersonal = state('impersonal')
  const unguessable = state('unguessable')
  return {
    length: long ? 'met' : 'unmet',
    impersonal,
    unguessable,
    passable: long && impersonal !== 'unmet' && unguessable !== 'unmet',
    error: asked.error,
  }
}
