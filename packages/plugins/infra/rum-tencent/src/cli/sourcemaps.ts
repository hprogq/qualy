import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import COS from 'cos-nodejs-sdk-v5'
import tencentcloud from 'tencentcloud-sdk-nodejs-rum'
import { CliRefused, type CliContext } from '@qualy/plugin-kit/cli'
import { parseWebReleaseIdentity } from '@qualy/release-contract/private'
import { rumVersionForRelease } from '../version.ts'

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

/** enough to keep the wire busy, few enough to stay well inside the api's rate */
const CONCURRENCY = 8

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
  const answer = (await client.request('DescribeFileCertificate', { ID: projectId })) as Record<
    string,
    unknown
  >
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
  return {
    secretId: field('SecretID'),
    secretKey: field('SecretKey'),
    sessionToken: field('SessionToken'),
    region: region!,
    bucket: bucket!,
  }
}

const md5 = (file: string): string =>
  crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex')

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

const inBatches = async <T, R>(items: readonly T[], run: (item: T) => Promise<R>): Promise<R[]> => {
  const out: R[] = []
  for (let at = 0; at < items.length; at += CONCURRENCY) {
    out.push(...(await Promise.all(items.slice(at, at + CONCURRENCY).map(run))))
  }
  return out
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

  // What this release already has.
  //
  // Asked per NAME rather than by listing, because the listing answers with at
  // most ten records and offers no way to page past them - which is how a run
  // that had filed everything correctly still reported most of it missing. A
  // name is exact, and this only asks at all when the version has been seen
  // before: a release is filed once, so the ordinary run is one call.
  const anyFiled = await client.DescribeReleaseFiles({ ProjectID: projectId, FileVersion: version })
  const resuming = (anyFiled.Files ?? []).length > 0
  const filed = new Map<string, string>()
  if (resuming) {
    console.log(`rum: version ${version} has been filed before; checking each map`)
    for (const found of await inBatches(maps, async ({ name }) =>
      client.DescribeReleaseFiles({ ProjectID: projectId, FileName: name }),
    )) {
      for (const file of found.Files ?? []) {
        if (file.FileName !== undefined && file.Version === version) {
          filed.set(file.FileName, file.FileHash ?? '')
        }
      }
    }
  }

  const pending = maps.filter(({ file, name }) => filed.get(name) !== md5(file))
  const skipped = maps.length - pending.length
  if (pending.length === 0) {
    console.log(`rum: all ${String(maps.length)} map(s) are already filed; nothing to do`)
    return
  }

  // One credential for the whole batch; the pipeline's own key never touches
  // the object store.
  const certificate = await certificateFor(client, projectId)
  const cos = new COS({
    SecretId: certificate.secretId,
    SecretKey: certificate.secretKey,
    SecurityToken: certificate.sessionToken,
  })
  const put = (key: string, file: string) =>
    new Promise<void>((resolve, reject) => {
      cos.putObject(
        {
          Bucket: certificate.bucket,
          Region: certificate.region,
          Key: key,
          Body: fs.createReadStream(file),
          ContentLength: fs.statSync(file).size,
        },
        (error) => {
          if (error) reject(error instanceof Error ? error : new Error(String(error)))
          else resolve()
        },
      )
    })

  const uploaded = await inBatches(pending, async ({ file, name }) => {
    // the shape the platform's own records use: project, version, when, and
    // the file - unique per attempt, so a retry never writes over an object an
    // existing record points at
    const key = `${String(projectId)}-${version}-${String(Date.now())}-${name}`
    await put(key, file)
    return { Version: version, FileKey: key, FileName: name, FileHash: md5(file) }
  })
  console.log(`rum: uploaded ${String(uploaded.length)} map(s)`)

  // The records, last. The platform checks each object is really there before
  // it makes one, so a record that exists is a map that can be read.
  await client.CreateReleaseFile({ ProjectID: projectId, Files: uploaded })

  // Read back by name, for the same reason the check above is by name.
  const missing = (
    await inBatches(uploaded, async (file) => {
      const found = await client.DescribeReleaseFiles({
        ProjectID: projectId,
        FileName: file.FileName,
      })
      return (found.Files ?? []).some(
        (record) => record.Version === version && record.FileHash === file.FileHash,
      )
        ? null
        : file.FileName
    })
  ).filter((name): name is string => name !== null)
  if (missing.length > 0) {
    refuse(
      `${String(missing.length)} map(s) were uploaded but are not filed under ${version}: ${missing.slice(0, 5).join(', ')}`,
    )
  }
  console.log(
    `rum: ${String(uploaded.length)} filed under ${version}, ${String(skipped)} already there`,
  )
}
