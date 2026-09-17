import * as stylex from '@stylexjs/stylex'
import { useEffect, useMemo, useState } from 'react'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { highlightFormulaSource, type SourceToken } from './source-highlight.ts'

// Source to be read, not edited: numbered lines, the code itself, and colour
// once it arrives.
//
// The editor's Monaco is a chunk of its own that a reader deciding whether to
// copy a template should not wait for, and reading needs none of what it
// brings - no language service, no hovers, no session. So this draws the text
// first and asks for colour after: the lines are on screen from the first
// paint, and the tokenizer, which arrives as its own chunk, only changes the
// ink. If it never arrives, or cannot read a grammar, the reader is still a
// reader; nothing on screen says so, because nothing about the page failed.

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
  // the weight the theme asks for; the colour rides an inline style, because
  // it is the tokenizer's answer rather than this file's decision
  strong: { fontWeight: 500 },
})

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
  // one trailing newline ends the file rather than starting a line
  const text = useMemo(() => source.replace(/\n$/, ''), [source])
  const lines = useMemo(() => text.split('\n'), [text])
  const [coloured, setColoured] = useState<readonly (readonly SourceToken[])[] | null>(null)

  useEffect(() => {
    let live = true
    setColoured(null)
    void highlightFormulaSource(text).then((got) => {
      if (live) setColoured(got)
    })
    return () => {
      live = false
    }
  }, [text])

  // a tokenization that does not line up with the text is not drawn: the
  // words on screen are the source, and no colour is worth losing one
  const inked = coloured !== null && coloured.length === lines.length ? coloured : null

  return (
    <pre {...rest} {...stylex.props(styles.frame, xstyle)}>
      {lines.map((line, index) => (
        <div key={index} {...stylex.props(styles.line)}>
          <span aria-hidden {...stylex.props(styles.number)}>
            {index + 1}
          </span>
          <code {...stylex.props(styles.code)}>
            {inked === null
              ? line
              : inked[index]!.map((token, at) => {
                  if (token.color === undefined && token.strong !== true) return token.text
                  const sx = stylex.props(token.strong === true && styles.strong)
                  return (
                    <span
                      key={at}
                      className={sx.className}
                      style={{
                        ...sx.style,
                        ...(token.color === undefined ? {} : { color: token.color }),
                      }}
                    >
                      {token.text}
                    </span>
                  )
                })}
          </code>
        </div>
      ))}
    </pre>
  )
}
