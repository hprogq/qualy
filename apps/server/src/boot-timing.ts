// How long each band of the boot actually takes, when someone asks.
//
// The bands are the ones the process crosses on its way up, and they are
// worth naming because they are about to be split across two lifecycles: the
// work before the application layer is built is pure - reading the manifest,
// checking it against the lock, importing descriptors, composing layers - and
// the work after it acquires everything the process owns. A development
// supervisor stages a candidate through the first band and only lets it into
// the second once the old process is gone, so knowing what each band costs is
// what says whether that is worth doing at all.
//
// Off unless asked for. It exists to be measured against, not to narrate
// every start.

const enabled = process.env.QUALY_BOOT_TIMING === '1'

interface Mark {
  readonly name: string
  /** milliseconds since this process began */
  readonly at: number
}

const marks: Mark[] = []
let print: ((line: string) => void) | null = null

const say = ({ name, at }: Mark, previous: number) =>
  print?.(`boot ${at.toFixed(0)}ms (+${(at - previous).toFixed(0)}ms) ${name}`)

/** the moment a band ended, named by what finished */
export const mark = (name: string): void => {
  if (!enabled) return
  const at = performance.now()
  const previous = marks.at(-1)?.at ?? 0
  marks.push({ name, at })
  if (print !== null) say({ name, at }, previous)
}

/**
 * Where the lines go, once the process knows how it renders a line.
 *
 * The first band ends before the logger exists - reading the manifest is what
 * tells the process how to log - so those marks wait here rather than being
 * lost or printed in a second format.
 */
export const reportBootTiming = (line: (text: string) => void): void => {
  if (!enabled || print !== null) return
  print = line
  let previous = 0
  for (const at of marks) {
    say(at, previous)
    previous = at.at
  }
}
