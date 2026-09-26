import { Fragment, useMemo, type ReactNode } from 'react'
import * as stylex from '@stylexjs/stylex'
import { useI18n } from '@qualy/web-i18n'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { assessmentMessages as m } from '../../i18n.ts'
import type { LinePart } from './model.ts'

// A claim's identity line drawn with its field names set apart: quieter than
// the figures they name, so "name value" reads as a label and its value
// rather than as one sentence.
//
// The order and what stands between the parts are the catalog's, exactly as
// the same line reads as plain text in search and to a screen reader: each
// message is worded with a mark in each of its places, and the marks are
// then filled with what is drawn there.

const FIRST = ''
const SECOND = ''

type Piece = { readonly place: 0 | 1 } | { readonly text: string }

/** a two-place message as worded, split at its places */
const piecesOf = (worded: string): readonly Piece[] => {
  const pieces: Piece[] = []
  let text = ''
  for (const character of worded) {
    if (character !== FIRST && character !== SECOND) {
      text += character
      continue
    }
    if (text !== '') pieces.push({ text })
    text = ''
    pieces.push({ place: character === FIRST ? 0 : 1 })
  }
  if (text !== '') pieces.push({ text })
  return pieces
}

const fill = (pieces: readonly Piece[], first: ReactNode, second: ReactNode): ReactNode =>
  pieces.map((piece, index) => (
    <Fragment key={index}>
      {'text' in piece ? piece.text : piece.place === 0 ? first : second}
    </Fragment>
  ))

const styles = stylex.create({
  label: { fontWeight: 400, color: tokens.mutedForeground },
})

/** parts of a claim's identity line, joined and each worded as the reader's language has it */
export function LineParts({ parts }: { parts: readonly LinePart[] }) {
  const { format } = useI18n()
  const [figure, join] = useMemo(
    () => [
      piecesOf(format(m.entriesFigure, { label: FIRST, value: SECOND })),
      piecesOf(format(m.entriesPartJoin, { before: FIRST, after: SECOND })),
    ],
    [format],
  )
  const drawn = parts.map((part) =>
    part.label === null
      ? part.value
      : fill(
          figure,
          <span data-part-label="" {...stylex.props(styles.label)}>
            {part.label}
          </span>,
          part.value,
        ),
  )
  if (drawn.length === 0) return null
  return <>{drawn.slice(1).reduce((line, next) => fill(join, line, next), drawn[0])}</>
}
