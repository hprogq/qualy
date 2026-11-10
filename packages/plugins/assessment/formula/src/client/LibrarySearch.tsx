import { useEffect, useRef, useState } from 'react'
import { Input } from '@qualy/ui/input'
import * as m from '#messages'

/** Keep composition local; publish only a settled search to the address bar. */
export function LibrarySearch({
  value,
  onSearch,
}: {
  value: string
  onSearch: (value: string) => void
}) {
  const [text, setText] = useState(value)
  const [composing, setComposing] = useState(false)
  const commit = useRef(onSearch)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => {
    commit.current = onSearch
  }, [onSearch])
  useEffect(() => {
    setText(value)
  }, [value])
  useEffect(() => {
    if (composing || text === value) return
    timer.current = setTimeout(() => commit.current(text.slice(0, 200)), 250)
    return () => clearTimeout(timer.current)
  }, [text, value, composing])
  return (
    <Input
      type="search"
      aria-label={m.pagination_search()}
      placeholder={m.pagination_search()}
      maxLength={200}
      value={text}
      onCompositionStart={() => {
        clearTimeout(timer.current)
        setComposing(true)
      }}
      onCompositionEnd={(event) => {
        setText(event.currentTarget.value)
        setComposing(false)
      }}
      onChange={(event) => setText(event.currentTarget.value)}
    />
  )
}
