// Where codegen says what it did.
//
// The generators run in two places and neither should have to care which: the
// `pnpm gen` script, where a line on stdout is the whole point, and the server
// entry in development, where the same line has to reach the application's
// logger so a developer reads one format instead of two.
//
// A module-level sink rather than a parameter threaded through six generators,
// because every one of them writes exactly one kind of line and none of them
// has an opinion about where it goes.

type Sink = (line: string) => void

let sink: Sink = (line) => console.log(line)

export const report = (line: string): void => sink(line)

/**
 * Runs a body with the lines collected instead of printed.
 *
 * The sink is restored whatever happens, so a generator that throws does not
 * leave the next caller writing into an array nobody reads.
 */
export async function collectReport(body: () => Promise<void>): Promise<string[]> {
  const lines: string[] = []
  const previous = sink
  sink = (line) => lines.push(line)
  try {
    await body()
    return lines
  } finally {
    sink = previous
  }
}
