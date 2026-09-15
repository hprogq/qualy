import fs from 'node:fs'
import path from 'node:path'
import { repoRoot } from '../lib/manifest.ts'
import { storeAt, readCurrentWebRelease } from '../../packages/build/web/src/release-store.ts'
import { BROWSER_SURFACE_MAP } from '../../packages/build/web/src/release-vite.ts'
import { releaseProbeOf } from '@qualy/release-contract/private'

// What a stranger can learn from this deployment by loading it.
//
// The other gates each hold one thing: the store carries no debug artifact,
// no chunk went missing, nothing executes code from a string. This one asks
// the question those add up to - a browser is served product semantics and
// the server keeps assembly semantics - and asks it of the artifact that is
// actually served, because that is the only place the answer is true or not.
//
// Three kinds of check, and they are different on purpose:
//
//   the artifact       what the store holds and what its file names say
//   the contracts      the shape of documents a browser is handed
//   the environment    that nothing server-only rode along
//
// The contract half is static, here rather than only in a unit test, because
// what it is really asserting is that these three documents and no others are
// public - a fact that lives between packages and belongs where the public
// surface is stated as a whole.

const problems: string[] = []
const fail = (message: string) => problems.push(message)
const ok = (message: string) => console.log(`check-public-web: ${message}`)

const store = storeAt(
  process.argv[2] === undefined
    ? path.join(repoRoot, 'packages/plugins/infra/web/client-dist')
    : path.resolve(process.argv[2]),
)
const current = readCurrentWebRelease(store)
if (current === undefined) {
  console.error('check-public-web: no web release is installed; run `pnpm build`')
  process.exit(1)
}

/** every file a viewer can fetch, with its bytes */
const served = current.release.assets
  .map((asset) => ({ asset, at: path.join(store.root, asset) }))
  .filter((one) => fs.existsSync(one.at))
const text = served
  .filter((one) => /\.(?:js|css|html|json|map)$/.test(one.asset))
  .map((one) => ({ ...one, body: fs.readFileSync(one.at, 'utf8') }))
const shell = path.join(current.root, 'index.html')
const shellBody = fs.existsSync(shell) ? fs.readFileSync(shell, 'utf8') : ''

// ---------------------------------------------------------------- the artifact

// A source map is the whole source, and a pointer to one is an invitation to
// look for it. The store filters them out; this reads what is actually there.
{
  const maps = served.filter((one) => /\.map(?:\.br|\.gz)?$/.test(one.asset))
  const pointers = text.filter((one) => one.body.includes('sourceMappingURL'))
  if (maps.length > 0) fail(`the release serves ${String(maps.length)} source map(s)`)
  if (pointers.length > 0) {
    fail(`${pointers.length} served file(s) point at a source map: ${pointers[0]!.asset}`)
  }
  if (maps.length === 0 && pointers.length === 0) ok('no source map, and nothing pointing at one')
}

// A public file name says nothing about what is inside it. The names of the
// modules behind each surface come from the build's own private map, so this
// asks the real question - is a source file named in public - rather than
// matching a shape somebody has to remember to keep.
{
  const mapFile = path.join(repoRoot, 'apps/web/dist', BROWSER_SURFACE_MAP)
  if (!fs.existsSync(mapFile)) {
    fail(`no ${BROWSER_SURFACE_MAP} beside the build; run \`pnpm build\` in this tree`)
  } else {
    const map = JSON.parse(fs.readFileSync(mapFile, 'utf8')) as Record<string, { module: string }>
    const basenames = new Set(
      Object.values(map).map((entry) =>
        entry.module
          .split('/')
          .pop()!
          .replace(/\.\w+$/, ''),
      ),
    )
    const named = served.filter((one) =>
      [...basenames].some((base) => path.basename(one.asset).includes(base)),
    )
    if (named.length > 0) {
      fail(
        `${String(named.length)} served file(s) are named after a source module: ${named[0]!.asset}`,
      )
    } else {
      ok(`${String(basenames.size)} source module name(s), none of them in a served file name`)
    }
  }
}

// A plugin this deployment did not select contributes zero bytes. The other
// half of this - that the same fixture DOES appear when it is selected - is
// proven by the dist-only plugin suite, which builds it for real.
{
  const SENTINELS = ['acme-dist-probe-page-8f21c6', 'acme-dist-probe-boot-4d90ab']
  const found = text.filter((one) => SENTINELS.some((sentinel) => one.body.includes(sentinel)))
  if (found.length > 0) fail(`an unselected plugin reached the artifact: ${found[0]!.asset}`)
  else ok('no unselected plugin left a byte in the artifact')
}

// The shell describes the product, not how it is built.
{
  const ARCHITECTURE = ['plugin', 'assembly', 'resolution', 'descriptor', 'provider']
  const said = ARCHITECTURE.filter((word) => shellBody.toLowerCase().includes(word))
  if (said.length > 0) fail(`the shell says ${said.join(', ')}`)
  else ok('the shell names nothing about how this product is assembled')
}

// --------------------------------------------------------------- the contracts

// The shell manifest's own shape is asserted where the whole api is already
// compared against its rendered document - `tools/tests/effect-api-parity`,
// which reads the OpenAPI the server actually publishes. Reading a schema
// value's internals from here would be asserting on the framework instead.

// The probe answers which release is being served, and the private identity it
// is projected from stays private - field by field, so a field added there is
// not published by having been added.
{
  const probe = releaseProbeOf({
    schema: 1,
    releaseId: 'probe',
    mode: 'production',
    clientProtocol: 2,
  })
  const keys = Object.keys(probe).sort().join(',')
  if (keys !== 'releaseId,schema') fail(`the release probe answers with ${keys}`)
  else ok('the release probe answers with the release id and the generation')
}

// ------------------------------------------------------------- the environment

// Nothing server-only rode along. The named variables are the ones this
// deployment actually holds; the sentinel is for a pipeline that wants to
// prove it for a value of its own choosing.
{
  const SERVER_ONLY = [
    'QUALY_SERVER_PRIVATE_SENTINEL',
    'DATABASE_URL',
    'TENCENTCLOUD_SECRET_ID',
    'TENCENTCLOUD_SECRET_KEY',
    'QUALY_TENCENT_RUM_PROJECT_ID',
  ]
  const leaked: string[] = []
  for (const name of SERVER_ONLY) {
    const value = process.env[name]
    // a short value would match by accident and prove nothing
    if (value === undefined || value.length < 8) continue
    for (const one of text) if (one.body.includes(value)) leaked.push(`${name} in ${one.asset}`)
  }
  if (leaked.length > 0) fail(`server-only values in the artifact: ${leaked.join(', ')}`)
  else ok('no server-only value from this environment is in the artifact')
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`check-public-web: ${problem}`)
  process.exit(1)
}
console.log(
  `check-public-web: release ${current.releaseId} discloses nothing it should not (${String(served.length)} served files)`,
)
