import { Fragment, useMemo, type ReactNode } from 'react'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { parseNote, type Inline } from './note-markdown.ts'

// The batch note, rendered: loaded when a note is shown, never with the page
// that might not have one. Every element here is one this component chose;
// the note itself only ever becomes text inside them.

const styles = stylex.create({
  note: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.6em',
    minWidth: 0,
    overflowWrap: 'anywhere',
  },
  block: { margin: 0 },
  list: { margin: 0, paddingInlineStart: '1.4em' },
  item: { paddingInlineStart: '0.1em' },
  strong: { fontWeight: 600, color: tokens.foreground },
  link: {
    color: tokens.primary,
    textDecorationLine: 'underline',
    textUnderlineOffset: '0.15em',
  },
})

const inline = (parts: readonly Inline[]): ReactNode =>
  parts.map((part, index) =>
    part.kind === 'text' ? (
      <Fragment key={index}>{part.text}</Fragment>
    ) : part.kind === 'strong' ? (
      <strong key={index} {...stylex.props(styles.strong)}>
        {inline(part.children)}
      </strong>
    ) : (
      <a
        key={index}
        href={part.href}
        target="_blank"
        rel="noopener noreferrer"
        {...stylex.props(styles.link)}
      >
        {inline(part.children)}
      </a>
    ),
  )

/** lines of one block, with the breaks the writer typed between them */
const lines = (all: readonly (readonly Inline[])[]): ReactNode =>
  all.map((line, index) => (
    <Fragment key={index}>
      {index > 0 && <br />}
      {inline(line)}
    </Fragment>
  ))

export default function NoteMarkdown({ text }: { text: string }) {
  const blocks = useMemo(() => parseNote(text), [text])
  return (
    <div data-testid="note-markdown" {...stylex.props(styles.note)}>
      {blocks.map((block, index) =>
        block.kind === 'paragraph' ? (
          <p key={index} {...stylex.props(styles.block)}>
            {lines(block.lines)}
          </p>
        ) : block.ordered ? (
          <ol key={index} start={block.start} {...stylex.props(styles.list)}>
            {block.items.map((item, at) => (
              <li key={at} {...stylex.props(styles.item)}>
                {lines(item)}
              </li>
            ))}
          </ol>
        ) : (
          <ul key={index} {...stylex.props(styles.list)}>
            {block.items.map((item, at) => (
              <li key={at} {...stylex.props(styles.item)}>
                {lines(item)}
              </li>
            ))}
          </ul>
        ),
      )}
    </div>
  )
}
