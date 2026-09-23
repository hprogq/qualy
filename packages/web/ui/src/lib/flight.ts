// While the wordmark flies from the loading screen into the top bar.
//
// The flight animates layout, so it moves only on frames the main thread
// gets to draw; a long render during those 320ms freezes it mid-air, and it
// lands with a jump when the render ends. The renders that land there are
// the page's first answers arriving, so the runtime hands its query
// notifications to `afterFlight`: held for the flight, run the moment it
// lands. Outside a flight a callback runs at once.

/** the most a flight may hold anything, should it never report landing */
const HOLD_LIMIT_MS = 800

let held: (() => void)[] | null = null
let limit: ReturnType<typeof setTimeout> | undefined

/** the flight is leaving: from now until it lands, callbacks wait */
export const flightDeparted = () => {
  held ??= []
  clearTimeout(limit)
  limit = setTimeout(flightLanded, HOLD_LIMIT_MS)
}

/** the flight is down: everything held runs, in the order it came */
export const flightLanded = () => {
  clearTimeout(limit)
  const due = held
  held = null
  for (const callback of due ?? []) callback()
}

/** run now, or once the wordmark in flight has landed */
export const afterFlight = (callback: () => void) => {
  if (held === null) callback()
  else held.push(callback)
}
