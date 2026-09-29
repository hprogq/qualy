import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import COS from 'cos-nodejs-sdk-v5'
import tencentcloud from 'tencentcloud-sdk-nodejs-rum'
import { CliRefused, type CliContext } from '@qualy/plugin-kit/cli'
import { parseWebReleaseIdentity } from '@qualy/release-contract/private'
import { rumVersionForRelease } from '../version.ts'
import { cosFailure } from './cos-failure.ts'
import { planFiling, type FiledMap } from './filing-plan.ts'

// `qualy rum sourcemaps [dist]` - filing this build's source maps with the
// reporting platform.
//
// Control plane, not runtime: a release pipeline runs it after the build, with
// credentials no serving process ever holds, and this module is loaded only
// when the command is invoked - the server imports the descriptor on every
// boot and has no business paying for a cloud sdk.
//
// The maps go here and nowhere else. The release store refuses to stage them
// and a gate asserts it, because a map carries `sourcesContent`, which is this
// product's source.
//
// The version is not an argument. It comes from the build's own metadata and
// goes through the same mapping the browser stamps its reports with, so a map
// filed under a version no report carries is not a mistake this can make.

/**
 * How long the upload credential lasts, asked for explicitly.
 *
 * Stated because the default is TEN SECONDS - documented nowhere, and not
 * enough for one batch, let alone a build's worth: a credential that expired
 * mid-upload comes back from the bucket as "The Access Key Id you provided
 * does not exist", which is how the v0.1.0-rc.2 maps first failed to file.
 */
const CREDENTIAL_SECONDS = 3600
/** less than this left and the upload is refused before it starts */
const CREDENTIAL_LEAST_SECONDS = 300

/** api calls in flight at once */
const CONCURRENCY = 8
/**
 * And how many may start in a second. The api refuses the twenty-first in a
 * second; a runner abroad reaches it in a few milliseconds, so eight at a
 * time came back and went again fast enough to cross that, which is how
 * v0.1.0-rc.4's maps were all filed and then failed the read-back.
 */
const CALLS_PER_SECOND = 16

// The maps cross an ocean: the pipeline runs on a hosted runner abroad and
// the platform's bucket is in China. The bucket drops a connection it judges
// too slow ("User network is too slow", a 400 the sdk never retries), which is
// how the v0.1.0-rc.3 run lost ten minutes and every map. So fewer uploads
// share the line, a stalled one is abandoned rather than waited out, each map
// is tried again on a fresh key, and records are filed as groups finish - a
// run that still fails keeps what it filed, and the next run starts there.

/** uploads at once, so each connection keeps a speed the bucket accepts */
const UPLOAD_CONCURRENCY = 4
/** tries per map before the run gives up */
const UPLOAD_ATTEMPTS = 3
/** a request that has moved nothing for this long is abandoned */
const STALL_MS = 120_000
/** maps uploaded between records */
const FILE_EVERY = 32

const refuse = (message: string): never => {
  throw new CliRefused(message)
}

const need = (name: string): string => {
  const value = process.env[name]
  if (value === undefined || value === '') {
    refuse(`${name} is not set; it belongs to the release pipeline, never to the application`)
  }
  return value!
}

/**
 * A credential for this project's part of the platform's own bucket, and
 * which bucket that is.
 *
 * The platform issues it per project (DescribeFileCertificate, which replaced
 * DescribeReleaseFileSign; cloud.tencent.com/document/product/248/97909): it
 * reaches only keys that begin with `<project id>-`, which the keys below
 * already do, and the answer names the bucket as `region:bucket` - so the
 * bucket is read from it rather than kept as a constant nothing here could
 * check. The sdk does not name the action yet; it is asked by name, and every
 * field the upload needs is checked before anything is sent.
 */
const certificateFor = async (
  client: InstanceType<typeof tencentcloud.rum.v20210622.Client>,
  projectId: number,
) => {
  const answer = (await call(() =>
    client.request('DescribeFileCertificate', { ID: projectId, Timeout: CREDENTIAL_SECONDS }),
  )) as Record<string, unknown>
  const field = (name: string): string => {
    const value = answer[name]
    return typeof value === 'string' && value !== ''
      ? value
      : refuse(`DescribeFileCertificate answered without ${name}`)
  }
  const [region, bucket, ...rest] = field('BucketAddress').split(':')
  if (
    region === undefined ||
    region === '' ||
    bucket === undefined ||
    bucket === '' ||
    rest.length > 0
  ) {
    refuse(`DescribeFileCertificate named no bucket as region:bucket`)
  }
  const lasts = Number(answer['ExpiredTime']) - Number(answer['StartTime'])
  if (!(lasts >= CREDENTIAL_LEAST_SECONDS)) {
    refuse(
      `DescribeFileCertificate issued a credential that lasts ${String(lasts)}s; the upload needs at least ${String(CREDENTIAL_LEAST_SECONDS)}s`,
    )
  }
  return {
    secretId: field('SecretID'),
    secretKey: field('SecretKey'),
    sessionToken: field('SessionToken'),
    region: region!,
    bucket: bucket!,
  }
}

const md5 = (bytes: Buffer): string => crypto.createHash('md5').update(bytes).digest('hex')

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/** every map beside a chunk, named the way the platform will hold it */
const mapsUnder = (dist: string): { readonly file: string; readonly name: string }[] => {
  const found: { file: string; name: string }[] = []
  const visit = (dir: string) => {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) visit(full)
      // The BASENAME, not the path from dist. Every chunk this build writes
      // carries a content hash, so the basename is unique within a release,
      // and a stack frame arrives as a whole url - the last segment is the one
      // form both ends agree on. It is also what the vendor's own example files.
      else if (entry.name.endsWith('.js.map')) found.push({ file: full, name: entry.name })
    }
  }
  visit(dist)
  return found.sort((a, b) => a.name.localeCompare(b.name))
}

/** `size` at a time; a batch of api calls takes at least as long as the rate allows */
const inBatches = async <T, R>(
  items: readonly T[],
  run: (item: T) => Promise<R>,
  size = CONCURRENCY,
  perSecond: number = CALLS_PER_SECOND,
): Promise<R[]> => {
  const out: R[] = []
  for (let at = 0; at < items.length; at += size) {
    const started = Date.now()
    out.push(...(await Promise.all(items.slice(at, at + size).map(run))))
    const least = (size / perSecond) * 1000 - (Date.now() - started)
    if (least > 0) await pause(least)
  }
  return out
}

/** one api call, asked again after a second if the rate refused it */
const call = async <T>(make: () => Promise<T>): Promise<T> => {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await make()
    } catch (error) {
      const code = (error as { code?: unknown }).code
      if (code !== 'RequestLimitExceeded' || attempt >= 3) throw error
      await pause(1_000)
    }
  }
}

export async function run(context: CliContext): Promise<void> {
  const dist = path.resolve(context.args[0] ?? 'apps/web/dist')
  const metadataFile = path.join(dist, '.qualy-web-build.json')
  if (!fs.existsSync(metadataFile)) {
    refuse(`${metadataFile} is missing; run \`pnpm build\` first`)
  }
  const identity = parseWebReleaseIdentity(
    JSON.parse(fs.readFileSync(metadataFile, 'utf8')) as unknown,
  )
  if (identity.mode !== 'production') {
    refuse(
      `${metadataFile} names a ${identity.mode} build; only a production build has maps to file`,
    )
  }
  const version = rumVersionForRelease(identity.releaseId)

  const maps = mapsUnder(dist)
  if (maps.length === 0) {
    refuse(`${dist} holds no .js.map; the build did not write source maps`)
  }

  const projectId = Number(need('QUALY_RUM_TENCENT_SOURCEMAP_PROJECT_ID'))
  if (!Number.isInteger(projectId)) {
    refuse(
      'QUALY_RUM_TENCENT_SOURCEMAP_PROJECT_ID must be the numeric project id, not the reporting id',
    )
  }

  const client = new tencentcloud.rum.v20210622.Client({
    credential: {
      secretId: need('QUALY_RUM_TENCENT_SOURCEMAP_SECRET_ID'),
      secretKey: need('QUALY_RUM_TENCENT_SOURCEMAP_SECRET_KEY'),
    },
    region: '',
    profile: { httpProfile: { endpoint: 'rum.tencentcloudapi.com' } },
  })

  console.log(`rum: release ${identity.releaseId} files as version ${version}`)

  // What the platform already holds under each map's name, in any version.
  //
  // Asked per NAME rather than by listing, because the listing answers with at
  // most ten records and offers no way to page past them - which is how a run
  // that had filed everything correctly still reported most of it missing. A
  // name is exact. A name filed under more than ten versions may not show the
  // one that matches; that map is uploaded again, which is only slower.
  const hashes = new Map(maps.map(({ file, name }) => [name, md5(fs.readFileSync(file))]))
  const filedByName = new Map<string, FiledMap[]>()
  for (const found of await inBatches(maps, async ({ name }) =>
    call(() => client.DescribeReleaseFiles({ ProjectID: projectId, FileName: name })),
  )) {
    for (const file of found.Files ?? []) {
      if (file.FileName === undefined || file.Version === undefined) continue
      const known = filedByName.get(file.FileName) ?? []
      known.push({ version: file.Version, key: file.FileKey ?? '', hash: file.FileHash ?? '' })
      filedByName.set(file.FileName, known)
    }
  }
  const plan = planFiling(
    maps.map(({ name }) => ({ name, hash: hashes.get(name)! })),
    filedByName,
    version,
  )
  console.log(
    `rum: ${String(maps.length)} map(s): ${String(plan.done.length)} filed under this version already, ` +
      `${String(plan.reuse.length)} held from earlier versions, ${String(plan.upload.length)} to upload`,
  )
  if (plan.reuse.length === 0 && plan.upload.length === 0) {
    console.log(`rum: all ${String(maps.length)} map(s) are already filed; nothing to do`)
    return
  }

  type ReleaseRecord = { Version: string; FileKey: string; FileName: string; FileHash: string }
  const filed: ReleaseRecord[] = []
  // A group's records at once. The platform checks each object is really
  // there before it makes one, so a record that exists is a map that can be
  // read - and a run that fails part way keeps what it filed.
  const fileGroup = async (group: ReleaseRecord[]) => {
    await call(() => client.CreateReleaseFile({ ProjectID: projectId, Files: group }))
    filed.push(...group)
    console.log(
      `rum: filed ${String(filed.length)}/${String(plan.reuse.length + plan.upload.length)}`,
    )
  }

  const reused = plan.reuse.map(({ name, hash, key }) => ({
    Version: version,
    FileKey: key,
    FileName: name,
    FileHash: hash,
  }))
  // A record pointing at an object another version uploaded is taken on the
  // platform's word that it checks the object, not the key it was written
  // under. Should it ever refuse one, those maps are uploaded like any other:
  // slower, never missing.
  const refused: string[] = []
  for (let at = 0; at < reused.length; at += FILE_EVERY) {
    const group = reused.slice(at, at + FILE_EVERY)
    try {
      await fileGroup(group)
    } catch (error) {
      console.log(
        `rum: ${String(group.length)} record(s) pointing at earlier uploads were refused (${messageOf(error)}); uploading those maps instead`,
      )
      refused.push(...group.map((record) => record.FileName))
    }
  }

  const toUpload = new Set([...plan.upload.map(({ name }) => name), ...refused])
  const pending = maps.filter(({ name }) => toUpload.has(name))

  // One credential for the whole batch, asked for only when something has to
  // be uploaded; the pipeline's own key never touches the object store.
  const certificate = pending.length > 0 ? await certificateFor(client, projectId) : undefined
  const cos =
    certificate === undefined
      ? undefined
      : new COS({
          SecretId: certificate.secretId,
          SecretKey: certificate.secretKey,
          SecurityToken: certificate.sessionToken,
          Timeout: STALL_MS,
          // one connection carried from map to map: most maps are small, and a
          // fresh connection across an ocean spends its first round trips on
          // the handshake and on a window that starts small every time
          KeepAlive: true,
        })
  // the bytes rather than a stream, so an attempt that failed can be sent again
  const put = (key: string, bytes: Buffer) =>
    new Promise<void>((resolve, reject) => {
      cos!.putObject(
        {
          Bucket: certificate!.bucket,
          Region: certificate!.region,
          Key: key,
          Body: bytes,
          ContentLength: bytes.length,
        },
        (error) => {
          if (error) reject(cosFailure(error))
          else resolve()
        },
      )
    })

  const upload = async (name: string, bytes: Buffer): Promise<string> => {
    for (let attempt = 1; ; attempt += 1) {
      // the shape the platform's own records use: project, version, when, and
      // the file - unique per attempt, so a retry never writes over an object
      // an existing record points at
      const key = `${String(projectId)}-${version}-${String(Date.now())}-${name}`
      try {
        await put(key, bytes)
        return key
      } catch (error) {
        if (attempt >= UPLOAD_ATTEMPTS) {
          throw new Error(`${name} did not upload in ${String(attempt)} attempts`, { cause: error })
        }
        console.log(`rum: ${name} did not upload (${messageOf(error)}); trying again`)
        await pause(attempt * 5_000)
      }
    }
  }

  // each group filed as soon as its maps are up
  for (let at = 0; at < pending.length; at += FILE_EVERY) {
    await fileGroup(
      await inBatches(
        pending.slice(at, at + FILE_EVERY),
        async ({ file: source, name }) => {
          const bytes = fs.readFileSync(source)
          const key = await upload(name, bytes)
          return { Version: version, FileKey: key, FileName: name, FileHash: md5(bytes) }
        },
        UPLOAD_CONCURRENCY,
        // the object store, not the api: no rate to keep under
        Infinity,
      ),
    )
  }

  // Read back by name, for the same reason the check above is by name.
  const missing = (
    await inBatches(filed, async (file) => {
      const found = await call(() =>
        client.DescribeReleaseFiles({ ProjectID: projectId, FileName: file.FileName }),
      )
      return (found.Files ?? []).some(
        (record) => record.Version === version && record.FileHash === file.FileHash,
      )
        ? null
        : file.FileName
    })
  ).filter((name): name is string => name !== null)
  if (missing.length > 0) {
    refuse(
      `${String(missing.length)} map(s) were filed but are not under ${version}: ${missing.slice(0, 5).join(', ')}`,
    )
  }
  console.log(
    `rum: ${String(filed.length)} filed under ${version} (${String(pending.length)} uploaded), ${String(plan.done.length)} already there`,
  )
}
