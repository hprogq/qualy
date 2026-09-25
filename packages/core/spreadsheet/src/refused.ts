/** why an archive is not handed to the reader */
export type ArchiveRefusal = 'malformed' | 'too-large' | 'too-many-sheets' | 'too-many-rows'

/** an archive this will not hand to the reader, in one word */
export class ArchiveRefused extends Error {
  readonly reason: ArchiveRefusal
  constructor(reason: ArchiveRefusal) {
    super(reason)
    this.name = 'ArchiveRefused'
    this.reason = reason
  }
}
