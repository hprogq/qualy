// Coalescing live wake-ups into reads.
//
// A reviewer working down a queue wakes the roster several times a second,
// and every read of the roster's totals is a page of whole accounts. So the
// wake-ups of one burst become one read, once the burst has gone quiet - and
// at the latest a fixed time after it began, because a queue worked through
// steadily never goes quiet, and a page that read only after quiet would then
// never read at all.

export interface Settler<T> {
  /** one wake-up, and what it was about */
  readonly wake: (about: T) => void
  /** forget whatever is gathered; nothing fires */
  readonly cancel: () => void
}

export function settler<T>(options: {
  /** how long a burst has to be quiet before it is read */
  readonly settle: number
  /** how long after a burst began it is read, quiet or not */
  readonly maxWait: number
  /** the read, with what every wake-up of the burst was about */
  readonly fire: (gathered: readonly T[]) => void
}): Settler<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  let since = 0
  let gathered: T[] = []
  return {
    wake: (about) => {
      const now = Date.now()
      if (timer === null) since = now
      else clearTimeout(timer)
      gathered.push(about)
      const wait = Math.max(0, Math.min(options.settle, since + options.maxWait - now))
      timer = setTimeout(() => {
        const held = gathered
        timer = null
        gathered = []
        options.fire(held)
      }, wait)
    },
    cancel: () => {
      if (timer !== null) clearTimeout(timer)
      timer = null
      gathered = []
    },
  }
}
