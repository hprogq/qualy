// The permission a browser is given, written out in full.
//
// This is the security boundary of the whole cloud path, so it is a pure
// function with no sdk in sight and a test that reads it back. Four clauses,
// each closing a different door:
//
//   action    - PutObject only, so a leaked credential cannot read or list
//   resource  - one exact object key, not a prefix
//   length    - the size the ticket reserved, enforced by the store
//   overwrite - the header that makes a second write to that key fail
//
// Together they mean a stolen credential can do exactly what the person it was
// issued to was already allowed to do, once, until it expires.

export interface ObjectPolicyInput {
  readonly region: string
  /** the full bucket name, appid suffix and all */
  readonly bucket: string
  readonly key: string
  readonly maxBytes: bigint
}

export interface CosPolicy {
  readonly version: '2.0'
  readonly statement: readonly {
    readonly effect: 'allow'
    readonly action: readonly string[]
    readonly resource: readonly string[]
    readonly condition: {
      readonly numeric_less_than_equal: { readonly 'cos:content-length': number }
      readonly string_equal: { readonly 'cos:x-cos-forbid-overwrite': 'true' }
    }
  }[]
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

export const objectWritePolicy = (input: ObjectPolicyInput): CosPolicy => ({
  version: '2.0',
  statement: [
    {
      effect: 'allow',
      action: ['name/cos:PutObject'],
      resource: [objectResource(input)],
      condition: {
        // the store weighs the request itself; nothing here relies on the
        // uploader being honest about the size it declared
        numeric_less_than_equal: { 'cos:content-length': Number(input.maxBytes) },
        string_equal: { 'cos:x-cos-forbid-overwrite': 'true' },
      },
    },
  ],
})
