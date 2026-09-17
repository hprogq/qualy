import * as stylex from '@stylexjs/stylex'
import { useMemo } from 'react'
import { tokens } from '@qualy/ui/theme/tokens.stylex'

// Source to be read, not edited: numbered lines and three inks - words the
// language owns, text in quotes, and comments.
//
// The editor's Monaco is a chunk of its own that a reader deciding whether
// to copy a template should not wait for, and reading needs none of what it
// brings. So this is a small scanner rather than a grammar: it knows where a
// string or a comment starts and ends, across lines where TypeScript lets
// them run on, and nothing about what the code means. A token it misreads
// costs a colour, never a character.

const styles = stylex.create({
  frame: {
    margin: 0,
    overflow: 'auto',
    paddingBlock: 14,
    paddingInline: 20,
    fontFamily: 'ui-monospace, SFMono-Regular, "JetBrains Mono", Menlo, Consolas, monospace',
    fontSize: 12.5,
    lineHeight: '22px',
    color: tokens.foreground,
  },
  line: { display: 'flex', gap: 16 },
  number: {
    flexShrink: 0,
    minWidth: 18,
    textAlign: 'right',
    color: `color-mix(in oklab, ${tokens.mutedForeground} 55%, transparent)`,
    userSelect: 'none',
  },
  code: { minWidth: 0, whiteSpace: 'pre' },
  keyword: { color: tokens.surfaceMutedForeground, fontWeight: 500 },
  string: { color: tokens.successForeground },
  comment: { color: `color-mix(in oklab, ${tokens.mutedForeground} 75%, transparent)` },
})

const KEYWORDS = new Set([
  'as',
  'async',
  'await',
  'break',
  'case',
  'catch',
  'const',
  'continue',
  'default',
  'else',
  'export',
  'false',
  'for',
  'from',
  'function',
  'if',
  'import',
  'in',
  'let',
  'new',
  'null',
  'of',
  'return',
  'switch',
  'throw',
  'true',
  'try',
  'type',
  'typeof',
  'undefined',
  'while',
])

type Ink = 'plain' | 'keyword' | 'string' | 'comment'
interface Piece {
  readonly ink: Ink
  readonly text: string
}
/** what a line ended inside, carried to the next one */
type Open = null | 'block-comment' | 'template'

const scanLine = (line: string, open: Open): { pieces: Piece[]; open: Open } => {
  const pieces: Piece[] = []
  const push = (ink: Ink, text: string) => {
    if (text === '') return
    const last = pieces[pieces.length - 1]
    if (last !== undefined && last.ink === ink)
      pieces[pieces.length - 1] = { ink, text: last.text + text }
    else pieces.push({ ink, text })
  }
  let at = 0
  let carried = open
  if (carried === 'block-comment') {
    const end = line.indexOf('*/')
    if (end < 0) return { pieces: [{ ink: 'comment', text: line }], open: carried }
    push('comment', line.slice(0, end + 2))
    at = end + 2
    carried = null
  } else if (carried === 'template') {
    const end = line.indexOf('`')
    if (end < 0) return { pieces: [{ ink: 'string', text: line }], open: carried }
    push('string', line.slice(0, end + 1))
    at = end + 1
    carried = null
  }
  while (at < line.length) {
    const rest = line.slice(at)
    if (rest.startsWith('//')) {
      push('comment', rest)
      break
    }
    if (rest.startsWith('/*')) {
      const end = rest.indexOf('*/', 2)
      if (end < 0) {
        push('comment', rest)
        return { pieces, open: 'block-comment' }
      }
      push('comment', rest.slice(0, end + 2))
      at += end + 2
      continue
    }
    const quote = rest[0]
    if (quote === "'" || quote === '"' || quote === '`') {
      let end = 1
      while (end < rest.length && rest[end] !== quote) end += rest[end] === '\\' ? 2 : 1
      if (end >= rest.length) {
        push('string', rest)
        return { pieces, open: quote === '`' ? 'template' : null }
      }
      push('string', rest.slice(0, end + 1))
      at += end + 1
      continue
    }
    const word = /^[A-Za-z_$][\w$]*/.exec(rest)
    if (word !== null) {
      push(KEYWORDS.has(word[0]) ? 'keyword' : 'plain', word[0])
      at += word[0].length
      continue
    }
    push('plain', rest[0]!)
    at += 1
  }
  return { pieces, open: carried }
}

export function SourceView({
  source,
  xstyle,
  ...rest
}: {
  readonly source: string
  readonly xstyle?: stylex.StyleXStyles
  readonly 'data-testid'?: string
  readonly 'aria-label'?: string
}) {
  const lines = useMemo(() => {
    let open: Open = null
    return source
      .replace(/\n$/, '')
      .split('\n')
      .map((line) => {
        const scanned = scanLine(line, open)
        open = scanned.open
        return scanned.pieces
      })
  }, [source])
  return (
    <pre {...rest} {...stylex.props(styles.frame, xstyle)}>
      {lines.map((pieces, index) => (
        <div key={index} {...stylex.props(styles.line)}>
          <span aria-hidden {...stylex.props(styles.number)}>
            {index + 1}
          </span>
          <code {...stylex.props(styles.code)}>
            {pieces.map((piece, at) =>
              piece.ink === 'plain' ? (
                piece.text
              ) : (
                <span key={at} {...stylex.props(styles[piece.ink])}>
                  {piece.text}
                </span>
              ),
            )}
          </code>
        </div>
      ))}
    </pre>
  )
}
