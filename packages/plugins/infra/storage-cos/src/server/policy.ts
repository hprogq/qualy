// The permission a browser is given, written out in full.
//
// This is the security boundary of the whole cloud path, so it is a pure
// function with no sdk in sight and a test that reads it back. Six clauses,
// each closing a different door:
//
//   action    - PutObject only, so a leaked credential cannot read or list
//   resource  - one exact object key, not a prefix
//   length    - the size the ticket reserved, enforced by the store
//   overwrite - the header that makes a second write to that key fail
//   acl       - the header that would make the object world-readable
//   grants    - the four headers that would hand it to a named account
//
// The last two are the ones that are easy to miss. A credential that may only
// write one object still writes it *with whatever headers the client sends*,
// and `x-cos-acl: public-read` on that write would publish a student's
// evidence to anyone with the url. Confining the key is not enough; the write
// has to be confined too.

export interface ObjectPolicyInput {
  readonly region: string
  /** the full bucket name, appid suffix and all */
  readonly bucket: string
  readonly key: string
  readonly maxBytes: bigint
}

export interface CosStatement {
  readonly effect: 'allow' | 'deny'
  readonly action: readonly string[]
  readonly resource: readonly string[]
  readonly condition: Record<string, Record<string, string | number>>
}

export interface CosPolicy {
  readonly version: '2.0'
  readonly statement: readonly CosStatement[]
}

/**
 * The account id and short name a bucket carries in its own name.
 *
 * `qualy-dev-files-1301296774` is one string to a person and two facts to cam:
 * everything before the last dash is the bucket, everything after is the
 * account. The official sdk splits it exactly here, which is why this does.
 */
export const bucketParts = (bucket: string): { name: string; appId: string } => {
  const cut = bucket.lastIndexOf('-')
  if (cut <= 0 || cut === bucket.length - 1) {
    throw new Error(`bucket name "${bucket}" does not end in an account id`)
  }
  return { name: bucket.slice(0, cut), appId: bucket.slice(cut + 1) }
}

/** the resource string cam matches against, in the form the sdk builds */
export const objectResource = (input: { region: string; bucket: string; key: string }): string => {
  const { name, appId } = bucketParts(input.bucket)
  return `qcs::cos:${input.region}:uid/${appId}:prefix//${appId}/${name}/${input.key}`
}

/**
 * The headers that would give the object away, each denied on its own.
 *
 * One statement per header rather than one statement listing four: several
 * keys inside a single condition block are read together, so a combined deny
 * would only fire for a request that sent all four - which no attacker would.
 */
const GRANT_HEADERS = [
  'cos:x-cos-grant-read',
  'cos:x-cos-grant-read-acp',
  'cos:x-cos-grant-write-acp',
  'cos:x-cos-grant-full-control',
] as const

export const objectWritePolicy = (input: ObjectPolicyInput): CosPolicy => {
  const resource = objectResource(input)
  return {
    version: '2.0',
    statement: [
      {
        effect: 'allow',
        action: ['name/cos:PutObject'],
        resource: [resource],
        condition: {
          // the store weighs the request itself; nothing here relies on the
          // uploader being honest about the size it declared
          numeric_less_than_equal: { 'cos:content-length': Number(input.maxBytes) },
          string_equal: { 'cos:x-cos-forbid-overwrite': 'true' },
          // if_exist rather than equal: an upload that sends no acl header at
          // all gets the bucket's default, which is private. Requiring the
          // header would refuse the ordinary request while changing nothing
          // about the dangerous one.
          string_equal_if_exist: { 'cos:x-cos-acl': 'private' },
        },
      },
      ...GRANT_HEADERS.map((header): CosStatement => ({
        effect: 'deny',
        action: ['name/cos:PutObject'],
        resource: [resource],
        // any value at all: there is no version of "grant somebody else
        // access to this object" that this credential is for
        condition: { string_like: { [header]: '*' } },
      })),
    ],
  }
}
