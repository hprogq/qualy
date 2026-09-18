import { useEffect, useState } from 'react'

/**
 * A value as it stands once it has stopped moving.
 *
 * For work that should follow what somebody typed rather than each letter of
 * it: a request keyed on this is made a beat after the typing stops, so the
 * screen is not rebuilt under the hand that is still writing. The first
 * value is taken as it is - an opening state is not something anybody typed.
 */
export function useSettled<T>(value: T, afterMs = 400): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    if (Object.is(settled, value)) return
    const timer = setTimeout(() => setSettled(value), afterMs)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, afterMs])
  return settled
}
