import type { MessageDescriptor } from '@qualy/i18n-contract'
import { assessmentMessages as m } from './i18n.ts'

// What a file field will take, in kinds people recognise.
//
// The stored form is unchanged - a list of mime types and extensions, which
// is what the uploader and the server both check against. These are only a
// way to write that list: an administrator picking "PDF" is picking two
// tokens, and the field is still the tokens.
//
// Which is why nothing records that a preset was picked. An item revision is
// immutable so that what it asked for can be replayed years later; writing
// "the pdf group" into it would mean editing the group's definition silently
// changed what an already-published question accepts. The presets are derived
// back out of the tokens instead, and a definition that changes just means an
// old configuration shows a couple of tokens in the custom box - which is
// honest, because the limit it stores did not change at all.
//
// Shared rather than owned by the item editor: whoever asks for a file asks
// in the same terms, and a second list would be a second answer to "what does
// this accept".

export interface FileKind {
  readonly id: string
  readonly name: MessageDescriptor
  /** what the field actually stores when this kind is picked */
  readonly tokens: readonly string[]
}

/**
 * Office formats go by extension, not by mime type: browsers report docx and
 * xlsx under half a dozen names and sometimes under none, while the server's
 * own check matches a leading dot against the filename.
 */
export const FILE_KINDS: readonly FileKind[] = [
  { id: 'pdf', name: m.fileKindPdf, tokens: ['application/pdf', '.pdf'] },
  { id: 'image', name: m.fileKindImage, tokens: ['image/*'] },
  { id: 'word', name: m.fileKindWord, tokens: ['.doc', '.docx'] },
  { id: 'sheet', name: m.fileKindSheet, tokens: ['.xls', '.xlsx', '.csv'] },
  { id: 'slides', name: m.fileKindSlides, tokens: ['.ppt', '.pptx'] },
  { id: 'archive', name: m.fileKindArchive, tokens: ['.zip', '.rar', '.7z'] },
]

/**
 * Which kinds a stored list amounts to, and what is left over.
 *
 * A kind counts as picked only when every token it stands for is there:
 * half of a kind is not that kind, and showing it as picked would claim the
 * field accepts something it does not. Whatever no kind consumed is what the
 * custom box holds.
 */
export const kindsOf = (
  accept: readonly string[],
): { picked: readonly string[]; rest: readonly string[] } => {
  const held = new Set(accept.map((token) => token.trim().toLowerCase()).filter((t) => t !== ''))
  const picked: string[] = []
  const consumed = new Set<string>()
  for (const kind of FILE_KINDS) {
    if (kind.tokens.every((token) => held.has(token))) {
      picked.push(kind.id)
      for (const token of kind.tokens) consumed.add(token)
    }
  }
  return { picked, rest: [...held].filter((token) => !consumed.has(token)) }
}

/** the tokens a set of kinds stands for, in the kinds' own order */
export const tokensOf = (pickedIds: readonly string[]): readonly string[] =>
  FILE_KINDS.filter((kind) => pickedIds.includes(kind.id)).flatMap((kind) => kind.tokens)

/** everything a field will take: the kinds picked, then anything written by hand */
export const acceptOf = (pickedIds: readonly string[], custom: string): readonly string[] => [
  ...new Set([
    ...tokensOf(pickedIds),
    ...custom
      .split(',')
      .map((token) => token.trim().toLowerCase())
      .filter((token) => token !== ''),
  ]),
]

/** a hand-written token that is neither an extension nor a mime type */
const LOOKS_WRITABLE = /^\.[a-z0-9]+$|^[a-z0-9.+-]+\/(\*|[a-z0-9.+-]+)$/

export const unwritableTokens = (custom: string): readonly string[] =>
  custom
    .split(',')
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token !== '' && !LOOKS_WRITABLE.test(token))
