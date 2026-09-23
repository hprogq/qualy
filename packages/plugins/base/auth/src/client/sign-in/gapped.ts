// A name set inside a sentence of another script.
//
// Chinese runs its words together, so "使用{name}登录" needs no spaces around a
// Chinese name - and reads cramped around a Latin one: "使用GitHub登录". A space
// goes on the side where a Latin letter or digit meets a Chinese character,
// and only there. Other languages already space their words in the sentence.

const LATIN_EDGE = /[A-Za-z0-9]/

export const gapped = (name: string, locale: string): string => {
  if (!locale.startsWith('zh')) return name
  const trimmed = name.trim()
  const first = trimmed.charAt(0)
  const last = trimmed.charAt(trimmed.length - 1)
  return `${LATIN_EDGE.test(first) ? ' ' : ''}${trimmed}${LATIN_EDGE.test(last) ? ' ' : ''}`
}
