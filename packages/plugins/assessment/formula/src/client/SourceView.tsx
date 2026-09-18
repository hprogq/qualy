import * as stylex from '@stylexjs/stylex'
import { useEffect, useMemo, useState } from 'react'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { highlightFormulaSource, type SourceToken } from './source-highlight.ts'

// Source to be read, not edited: numbered lines and the code itself.
//
// The editor's Monaco is a chunk of its own that a reader deciding whether to
// copy a template should not wait for, and reading needs none of what it
// brings - no language service, no hovers, no session. The colouring arrives
// as its own chunk instead, and the source is on screen before it: every line
// is there to read from the first paint, held back from full strength while
// the colour is on its way and fading up to it when it lands. Nothing moves,
// nothing is hidden, and the change a reader sees is the one that happened.
//
// The colouring failing is not a failure of the page: the source settles the
// same way, plain, and nothing on screen says anything about it.

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
    transitionProperty: 'opacity',
    transitionDuration: '220ms',
  },
  /** the source before its colours: legible, plainly not settled yet */
  settling: { opacity: 0.45 },
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
  // three states, not two: the colouring has not answered yet, it answered
  // with colours, or it answered that it has none. Only the first is a wait
  const [answer, setAnswer] = useState<{
    readonly of: string
    readonly lines: readonly (readonly SourceToken[])[] | null
  } | null>(null)

  useEffect(() => {
    let live = true
    setAnswer(null)
    void highlightFormulaSource(text).then((got) => {
      if (live) setAnswer({ of: text, lines: got })
    })
    return () => {
      live = false
    }
  }, [text])

  const waiting = answer === null || answer.of !== text
  // a tokenization that does not line up with the text is not drawn: the
  // words on screen are the source, and no colour is worth losing one
  const inked = answer?.lines != null && answer.lines.length === lines.length ? answer.lines : null

  return (
    <pre
      {...rest}
      data-state={waiting ? 'waiting' : 'read'}
      {...stylex.props(styles.frame, xstyle, waiting && styles.settling)}
    >
      {lines.map((line, index) => (
        <div key={index} {...stylex.props(styles.line)}>
          <span aria-hidden {...stylex.props(styles.number)}>
            {index + 1}
          </span>
          <code {...stylex.props(styles.code)}>
            {waiting || inked === null
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
