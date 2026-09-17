// Handing a reader a file of text the screen already holds.
//
// No request goes out: the bytes are the ones on screen, which is exactly
// what a reader pressing "download" expects to get - including whatever they
// have typed and not saved. A server download is for something the server
// assembles; a page's own text is not that.

/** characters no file system takes in a name, each replaced by a hyphen */
const UNSAFE = /[\\/:*?"<>|]/g

/**
 * A file name from the words that name its content, joined and made safe.
 * Empty parts are dropped; the extension is the caller's.
 */
export const fileNameOf = (parts: readonly (string | null | undefined)[], extension: string) => {
  const stem = parts
    .map((part) =>
      [...(part ?? '')]
        .map((character) => (character.charCodeAt(0) < 32 ? '-' : character))
        .join('')
        .replace(UNSAFE, '-')
        .trim(),
    )
    .filter((part) => part !== '')
    .join(' - ')
  return `${stem === '' ? 'download' : stem}${extension}`
}

export const downloadText = ({
  filename,
  text,
  type = 'text/plain;charset=utf-8',
}: {
  readonly filename: string
  readonly text: string
  readonly type?: string
}) => {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.rel = 'noopener'
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  // after the click has been handed the url, not before
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
