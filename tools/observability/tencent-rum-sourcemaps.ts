import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import COS from 'cos-nodejs-sdk-v5'
import tencentcloud from 'tencentcloud-sdk-nodejs-rum'
import { parseWebReleaseIdentity } from '@qualy/release-contract'
import { rumVersionForRelease } from '@qualy/plugin-rum-tencent/version'
import { repoRoot } from '../lib/manifest.ts'

// Sending this build's source maps to the reporting platform, and nowhere else.
//
// Control-plane tooling: it is neither the browser's code nor the server's. A
// release pipeline runs it after `pnpm build`, with credentials no application
// process ever holds, and the maps it reads never leave `apps/web/dist` in any
// other direction - the release store refuses to stage them and a gate asserts
// it, because a map carries `sourcesContent`, which is the whole source of this
// product.
//
// Deliberately NOT part of `pnpm build`. A build that could fail because a
// vendor's api was unreachable would be a build that needs the internet to
// produce the same bytes it produced yesterday, and ordinary CI would need
// credentials it has no business holding.
//
// The version is not an argument. It is read from the build's own metadata and
// mapped by the same function the browser stamps its reports with, so a map
// filed under a version no report carries is not a mistake this can make.

const fail = (message: string): never => {
  console.error(`rum:sourcemaps: ${message}`)
  process.exit(1)
}

const need = (name: string): string => {
  const value = process.env[name]
  if (value === undefined || value === '') {
    fail(`${name} is not set; it belongs to the release pipeline, never to the application`)
  }
  return value!
}

/** what the reporting platform accepts, and what the platform's own records call a file */
const FILE_TYPE_SOURCEMAP = 1

/** long enough for a whole build's maps to go up under one credential */
const CREDENTIAL_SECONDS = 3600

const dist = path.join(repoRoot, 'apps/web/dist')
const metadataFile = path.join(dist, '.qualy-web-build.json')
if (!fs.existsSync(metadataFile)) {
  fail(`${metadataFile} is missing; run \`pnpm build\` first`)
}
const identity = parseWebReleaseIdentity(
  JSON.parse(fs.readFileSync(metadataFile, 'utf8')) as unknown,
)
if (identity.mode !== 'production') {
  fail(`${metadataFile} names a ${identity.mode} build; only a production build has maps to file`)
}
const version = rumVersionForRelease(identity.releaseId)

/** every map beside a chunk, as the platform will name it */
const maps = (() => {
  const found: { readonly file: string; readonly name: string }[] = []
  const visit = (dir: string) => {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) visit(full)
      // The name is the BASENAME rather than the path from dist. Every chunk
      // this build writes carries a content hash, so the basename is already
      // unique within a release, and a stack frame arrives as a whole url -
      // matching on the last segment is the one form both ends agree on.
      else if (entry.name.endsWith('.js.map')) found.push({ file: full, name: entry.name })
    }
  }
  visit(dist)
  return found.sort((a, b) => a.name.localeCompare(b.name))
})()
if (maps.length === 0) {
  fail(`${dist} holds no .js.map; the build did not write source maps`)
}

const md5 = (file: string): string =>
  crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex')

const projectId = Number(need('QUALY_TENCENT_RUM_PROJECT_ID'))
if (!Number.isInteger(projectId)) {
  fail('QUALY_TENCENT_RUM_PROJECT_ID must be the numeric project id, not the browser reporting id')
}

const client = new tencentcloud.rum.v20210622.Client({
  credential: {
    secretId: need('TENCENTCLOUD_SECRET_ID'),
    secretKey: need('TENCENTCLOUD_SECRET_KEY'),
  },
  region: '',
  profile: { httpProfile: { endpoint: 'rum.tencentcloudapi.com' } },
})

console.log(`rum:sourcemaps: release ${identity.releaseId} filed as version ${version}`)

// What is already there. Re-running after a partial failure, or re-running at
// all, must not file a second copy of a map that is already filed: the same
// release is the same bytes, and a platform holding two records for one name
// is a platform that has to choose.
const already = await client
  .DescribeReleaseFiles({ ProjectID: projectId, FileVersion: version })
  .catch((error: unknown) => fail(`listing the filed maps failed: ${String(error)}`))
const filed = new Map(
  (already.Files ?? []).flatMap((file) =>
    file.FileName === undefined ? [] : [[file.FileName, file.FileHash ?? ''] as const],
  ),
)

const pending = maps.filter(({ file, name }) => filed.get(name) !== md5(file))
const skipped = maps.length - pending.length
if (pending.length === 0) {
  console.log(`rum:sourcemaps: all ${String(maps.length)} map(s) are already filed; nothing to do`)
  process.exit(0)
}

// Where the platform keeps them. Asked for only once there is something to
// send, so a run with nothing to do needs nothing but a read credential.
const bucket = need('QUALY_TENCENT_RUM_SOURCEMAP_BUCKET')
const bucketRegion = need('QUALY_TENCENT_RUM_SOURCEMAP_REGION')

// One credential for the whole batch. It is a short-lived COS credential the
// platform mints for this purpose; the pipeline's own key never touches the
// object store.
const sign = await client
  .DescribeReleaseFileSign({ Timeout: CREDENTIAL_SECONDS, FileType: FILE_TYPE_SOURCEMAP })
  .catch((error: unknown) => fail(`asking for an upload credential failed: ${String(error)}`))

const cos = new COS({
  SecretId: sign.SecretID,
  SecretKey: sign.SecretKey,
  SecurityToken: sign.SessionToken,
})

const put = (key: string, file: string) =>
  new Promise<void>((resolve, reject) => {
    cos.putObject(
      {
        Bucket: bucket,
        Region: bucketRegion,
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

const uploaded: { Version: string; FileKey: string; FileName: string; FileHash: string }[] = []
for (const { file, name } of pending) {
  // the shape the platform's own records use: the project, the version, when,
  // and the file - unique per attempt, so a retry never writes over an object
  // a record already points at
  const key = `${String(projectId)}-${version}-${String(Date.now())}-${name}`
  await put(key, file).catch((error: unknown) => fail(`uploading ${name} failed: ${String(error)}`))
  uploaded.push({ Version: version, FileKey: key, FileName: name, FileHash: md5(file) })
  console.log(`rum:sourcemaps: uploaded ${name}`)
}

// The record, last. The platform checks the object is really there before it
// makes one, so a record that exists is a map that can be read.
await client
  .CreateReleaseFile({ ProjectID: projectId, Files: uploaded })
  .catch((error: unknown) => fail(`filing the uploaded maps failed: ${String(error)}`))

// And read back, because "the call returned" is not the same as "the platform
// has it": this is the only check that the version a browser reports under is
// the version a map is filed under.
const after = await client
  .DescribeReleaseFiles({ ProjectID: projectId, FileVersion: version })
  .catch((error: unknown) => fail(`verifying the filed maps failed: ${String(error)}`))
const present = new Set((after.Files ?? []).map((file) => file.FileName))
const missing = maps.filter(({ name }) => !present.has(name)).map(({ name }) => name)
if (missing.length > 0) {
  fail(
    `${String(missing.length)} map(s) were uploaded but are not filed under ${version}: ${missing.slice(0, 5).join(', ')}`,
  )
}
console.log(
  `rum:sourcemaps: ${String(uploaded.length)} filed, ${String(skipped)} already there, ${String(present.size)} total under ${version}`,
)
