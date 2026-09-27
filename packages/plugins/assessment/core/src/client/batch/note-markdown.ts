// The batch note's markup: the few things a notice to students is written
// with, and nothing that could run or reach out.
//
// Paragraphs and their line breaks, bulleted and numbered lists, bold, and
// links - written `[text](address)`, or an address on its own - to http,
// https or mailto only. That is what a round's notice is made of: what to
// bring, by when, and the school's own document to read. Everything else is
// text as it was typed: an image is its source, a heading its hashes, and
// markup somebody pasted is shown, never read, because what this returns is
// data the page renders as text nodes and elements it chooses itself.

export type Inline =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'strong'; readonly children: readonly Inline[] }
  | { readonly kind: 'link'; readonly href: string; readonly children: readonly Inline[] }

export type Block =
  | { readonly kind: 'paragraph'; readonly lines: readonly (readonly Inline[])[] }
  | {
      readonly kind: 'list'
      readonly ordered: boolean
      readonly start: number
      readonly items: readonly (readonly (readonly Inline[])[])[]
    }

/** the only places a link may lead */
const SAFE_ADDRESS = /^(?:https?:\/\/[^\s]+|mailto:[^\s]+)$/i

const BULLET = /^ {0,3}[-*+][ \t]+(.*)$/
const NUMBERED = /^ {0,3}(\d{1,9})[.)][ \t]+(.*)$/
/** a line that carries on the list item above it */
const CONTINUED = /^(?: {2,}|\t)\S/

/** an address typed on its own, up to the space or bracket after it */
const BARE_ADDRESS = /https?:\/\/[^\s<>()[\]{}"'，。；：！？、（）《》「」]+/iy
/** what a sentence may end on right after an address, and is not part of it */
const TRAILING = /[.,;:!?)\]'"]+$/

const text = (value: string): Inline => ({ kind: 'text', text: value })

/** adjacent text runs made one, so the page renders one node for them */
const merged = (parts: readonly Inline[]): Inline[] => {
  const out: Inline[] = []
  for (const part of parts) {
    const last = out[out.length - 1]
    if (part.kind === 'text' && last?.kind === 'text') {
      out[out.length - 1] = text(last.text + part.text)
    } else if (part.kind !== 'text' || part.text !== '') {
      out.push(part)
    }
  }
  return out
}

/** one line's inline markup */
export const parseInline = (line: string): Inline[] => {
  const parts: Inline[] = []
  let plain = ''
  let at = 0
  const flush = () => {
    if (plain !== '') parts.push(text(plain))
    plain = ''
  }
  while (at < line.length) {
    const char = line[at]!
    // an escaped mark is the mark as text
    if (char === '\\' && at + 1 < line.length && '\\*[]()!'.includes(line[at + 1]!)) {
      plain += line[at + 1]
      at += 2
      continue
    }
    if (line.startsWith('**', at)) {
      const close = line.indexOf('**', at + 2)
      if (close > at + 2) {
        flush()
        parts.push({ kind: 'strong', children: parseInline(line.slice(at + 2, close)) })
        at = close + 2
        continue
      }
    }
    // an image is not shown: its markup stays as it was typed
    if (char === '!' && line[at + 1] === '[') {
      const image = /^!\[[^\]]*\]\([^\s)]*\)/.exec(line.slice(at))
      if (image !== null) {
        plain += image[0]
        at += image[0].length
        continue
      }
    }
    if (char === '[') {
      const link = /^\[([^\]]+)\]\(([^\s)]+)\)/.exec(line.slice(at))
      if (link !== null) {
        if (SAFE_ADDRESS.test(link[2]!)) {
          flush()
          parts.push({ kind: 'link', href: link[2]!, children: parseInline(link[1]!) })
        } else {
          // an address this page will not lead to: its words, as typed
          plain += link[0]
        }
        at += link[0].length
        continue
      }
    }
    if (char === 'h' || char === 'H') {
      BARE_ADDRESS.lastIndex = at
      const bare = BARE_ADDRESS.exec(line)
      if (bare !== null) {
        const address = bare[0].replace(TRAILING, '')
        flush()
        parts.push({ kind: 'link', href: address, children: [text(address)] })
        at += address.length
        continue
      }
    }
    plain += char
    at += 1
  }
  flush()
  return merged(parts)
}

/** the note, as blocks of lines */
export const parseNote = (source: string): Block[] => {
  const blocks: Block[] = []
  let paragraph: string[] | undefined
  let list: { ordered: boolean; start: number; items: string[][] } | undefined
  const close = () => {
    if (paragraph !== undefined) {
      blocks.push({ kind: 'paragraph', lines: paragraph.map(parseInline) })
    }
    if (list !== undefined) {
      blocks.push({
        kind: 'list',
        ordered: list.ordered,
        start: list.start,
        items: list.items.map((lines) => lines.map(parseInline)),
      })
    }
    paragraph = undefined
    list = undefined
  }
  for (const line of source.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n')) {
    if (line.trim() === '') {
      close()
      continue
    }
    const bullet = BULLET.exec(line)
    const numbered = bullet === null ? NUMBERED.exec(line) : null
    if (bullet !== null || numbered !== null) {
      const ordered = numbered !== null
      if (list === undefined || list.ordered !== ordered) {
        close()
        list = { ordered, start: numbered === null ? 1 : Number(numbered[1]), items: [] }
      }
      list.items.push([(bullet ?? numbered)![bullet === null ? 2 : 1]!])
      continue
    }
    if (list !== undefined && CONTINUED.test(line)) {
      list.items[list.items.length - 1]!.push(line.trim())
      continue
    }
    if (list !== undefined) close()
    paragraph = [...(paragraph ?? []), line]
  }
  close()
  return blocks
}
