// Which of a release's maps have to cross the network, and which the
// platform already holds.
//
// A chunk's name carries a hash of its content, so most chunks of a release
// are byte for byte the chunks of the one before, and so are their maps. A
// record is only (version, object key, file name, hash): when some earlier
// version filed the very same bytes, this version needs a record pointing at
// that object, not another copy of it. Crossing an ocean for bytes already
// in the bucket is what made a whole release's maps take half an hour.

/** one map as the platform has it filed */
export interface FiledMap {
  readonly version: string
  readonly key: string
  readonly hash: string
}

export interface FilingPlan {
  /** filed under this version already, with these bytes */
  readonly done: readonly string[]
  /** filed under another version with these bytes: a record, no upload */
  readonly reuse: readonly { readonly name: string; readonly hash: string; readonly key: string }[]
  /** nobody holds these bytes yet */
  readonly upload: readonly { readonly name: string; readonly hash: string }[]
}

export const planFiling = (
  maps: readonly { readonly name: string; readonly hash: string }[],
  filedByName: ReadonlyMap<string, readonly FiledMap[]>,
  version: string,
): FilingPlan => {
  const done: string[] = []
  const reuse: { name: string; hash: string; key: string }[] = []
  const upload: { name: string; hash: string }[] = []
  for (const { name, hash } of maps) {
    const same = (filedByName.get(name) ?? []).filter(
      (filed) => filed.hash === hash && filed.key !== '',
    )
    if (same.some((filed) => filed.version === version)) done.push(name)
    else if (same.length > 0) reuse.push({ name, hash, key: same[0]!.key })
    else upload.push({ name, hash })
  }
  return { done, reuse, upload }
}
