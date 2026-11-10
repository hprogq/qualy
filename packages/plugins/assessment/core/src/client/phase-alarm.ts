// Recheck the wall clock at least daily: browser timers can run late, and the
// clock can change while a tab is open. Once due, retry at a bounded rate
// until a fresh timetable removes or changes the planned instant.
const HORIZON = 24 * 60 * 60 * 1_000
const MARGIN = 750
const FIRST_RETRY = 5_000
const MAX_RETRY = 120_000

export function phaseAlarm(at: number, wake: () => void): () => void {
  let timer: ReturnType<typeof setTimeout>
  let retry = FIRST_RETRY
  const arm = () => {
    const remaining = at + MARGIN - Date.now()
    if (remaining > 0) {
      timer = setTimeout(arm, Math.min(remaining, HORIZON))
      return
    }
    wake()
    timer = setTimeout(arm, retry)
    retry = Math.min(retry * 2, MAX_RETRY)
  }
  arm()
  return () => clearTimeout(timer)
}
