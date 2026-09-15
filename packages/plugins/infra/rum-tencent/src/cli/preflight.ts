import { CliRefused, type CliContext } from '@qualy/plugin-kit/cli'
import { RUM_ENVIRONMENTS, TENCENT_RUM_HOST, type RumEnvironment } from '../settings.ts'

// `qualy rum preflight <origin>` - asking the platform whether a deployment
// would be allowed to report, before it is deployed.
//
// This exists because getting the order wrong is silent and expensive. The
// platform decides per origin, and a browser reporting from one it does not
// know gets `403 forbidden` - at which point the sdk destroys its own
// instance, so the page reports nothing for the rest of its life. Nothing in
// the product notices: no error, no violation, no failed request a viewer
// could see. The first sign is an incident nobody recorded.
//
// So this asks the same question the sdk asks, from wherever it is run, and
// says what came back. It needs no credentials: the reporting id travels in
// every report a browser sends and is public by construction.
//
// What it cannot do is prove the reverse. An origin the platform accepts here
// is one it accepted for this id at this moment; it is not a promise about
// the deployment, and it is not a substitute for reading the console.

/**
 * What the platform answers with when it refuses.
 *
 * Observed rather than documented, and the header is not a bare code - it
 * reads `type:business, code:41, msg:project(...) is not exist`, so the code
 * is dug out of it. The message beside it is the platform's own and is
 * printed as well: these three are the ones worth translating, and anything
 * else is worth reading in full rather than being told a number.
 */
const REFUSALS: Record<string, string> = {
  '41': 'no project has that reporting id',
  '111': 'that origin is not on the project allow list',
  '12': 'the platform did not recognise the request itself',
}

/** the numeric code inside that header, when there is one */
const codeIn = (header: string): string | undefined => /\bcode:\s*(\d+)/.exec(header)?.[1]

/**
 * What a refusal header means, in this product's words plus the platform's.
 *
 * Separate from the request so the reading can be asserted without one: the
 * whole value of this command is that somebody acts on what it says, and a
 * header shape that drifted would otherwise be found by an operator reading
 * "the platform refused" and no more.
 */
export const explainRefusal = (header: string): string => {
  const code = codeIn(header)
  const known = code === undefined ? undefined : REFUSALS[code]
  return known === undefined ? `the platform refused: ${header}` : `${known} (${header})`
}

const refuse = (message: string): never => {
  throw new CliRefused(message)
}

/** the origin a browser would report from, as a browser would send it */
const originOf = (given: string | undefined): string => {
  if (given === undefined) {
    return refuse('qualy rum preflight <origin> - the origin a browser would report from')
  }
  let parsed: URL
  try {
    parsed = new URL(given)
  } catch {
    return refuse(`${given} is not an absolute url`)
  }
  if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost') {
    return refuse(`${given} is not https; the platform matches the origin exactly, port included`)
  }
  return parsed.origin
}

const environmentOf = (given: string | undefined): RumEnvironment => {
  if (given === undefined) return 'production'
  const known = RUM_ENVIRONMENTS.find((candidate) => candidate === given)
  return known ?? refuse(`QUALY_RUM_TENCENT_ENV is ${given}, which is not one this sdk knows`)
}

export async function run(context: CliContext): Promise<void> {
  const origin = originOf(context.args[0])
  const id = process.env['QUALY_RUM_TENCENT_ID']
  if (id === undefined || id === '') {
    refuse('QUALY_RUM_TENCENT_ID is not set; it is the browser reporting id, not the project id')
  }
  const environment = environmentOf(process.env['QUALY_RUM_TENCENT_ENV'])

  // the same endpoint the sdk asks on its way up, with the two things the
  // platform decides on: which project, and who is asking
  const probe = new URL(`${TENCENT_RUM_HOST}/collect/whitelist`)
  probe.searchParams.set('id', id!)
  probe.searchParams.set('env', environment)

  const answered = await fetch(probe, {
    headers: { origin, referer: `${origin}/` },
  }).catch((error: unknown) => {
    return refuse(`could not reach ${TENCENT_RUM_HOST}: ${String(error)}`)
  })

  const said = answered.headers.get('rum-error')
  const body = await answered.text().catch(() => '')

  if (said !== null) refuse(`${explainRefusal(said)} id=${id!} origin=${origin}`)
  if (!answered.ok) {
    refuse(`the platform answered ${String(answered.status)}: ${body.slice(0, 200)}`)
  }

  // The sampling the platform will actually apply. It is a ceiling this
  // deployment does not control: whatever it is configured with, the rate
  // that comes back here overrides it, and a zero means nothing is reported
  // however loudly the browser is asked to.
  const rate = (() => {
    try {
      const parsed = JSON.parse(body) as { result?: { rate?: unknown } }
      const value = parsed.result?.rate
      return typeof value === 'number' ? value : undefined
    } catch {
      return undefined
    }
  })()

  console.log(`rum: ${origin} may report to ${id!} as ${environment}`)
  if (rate === 0) {
    console.log(
      'rum: the platform is returning a sample rate of 0, so nothing would be reported yet',
    )
  } else if (rate !== undefined) {
    console.log(`rum: the platform's own sample rate for this project is ${String(rate)}`)
  }
}
