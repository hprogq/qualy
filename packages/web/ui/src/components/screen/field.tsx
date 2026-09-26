import { SearchIcon } from 'lucide-react'
import * as stylex from '@stylexjs/stylex'
import type { StyleXStyles } from '@stylexjs/stylex'
import { Input } from '../input.tsx'

// A field for narrowing a list: the glass inside its leading edge, its
// purpose said as the placeholder and as its name.
//
// It looks for somebody or something else, so nothing of the reader's own
// belongs in it: the browser is told not to offer past entries or to
// correct the words, and password managers are told it is no login - a
// field on a screen with a name in it is exactly what they otherwise fill.
//
// It is the product's own field at the product's own height. A mock draws
// the ones in a card's head four pixels shorter; the height and the type of
// every field are decided once for the whole input family - the type answers
// to touch, where a smaller one makes iOS zoom the page - and a second size
// for one corner of one screen is how that stops being true.

const styles = stylex.create({
  glass: { width: 14, height: 14 },
})

export function SearchField({
  value,
  onChange,
  label,
  name,
  xstyle,
}: {
  value: string
  onChange: (next: string) => void
  /** said as the placeholder and as the field's name */
  label: string
  name?: string
  /** the field's width, mainly */
  xstyle?: StyleXStyles
}) {
  return (
    <Input
      type="search"
      {...(name === undefined ? {} : { name })}
      value={value}
      placeholder={label}
      aria-label={label}
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck={false}
      data-1p-ignore=""
      data-lpignore="true"
      data-bwignore="true"
      data-form-type="other"
      onChange={(event) => onChange(event.target.value)}
      lead={<SearchIcon aria-hidden {...stylex.props(styles.glass)} />}
      {...(xstyle === undefined ? {} : { wrapperXstyle: xstyle })}
    />
  )
}
