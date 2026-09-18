import { createHighlighterCore, type ThemedToken, type ThemeRegistration } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import typescript from '@shikijs/langs/typescript'
import type { SourceToken } from './source-highlight.ts'

// Where the colouring actually happens: off the page's thread.
//
// Tokenizing TypeScript means compiling a grammar of some hundreds of
// patterns, and the first source pays for all of it at once - measured at
// 125ms in Node and more in a browser that has just loaded the page. On the
// main thread that is a visible stall in a page whose whole job is to be read,
// so the grammar, the engine and every tokenization live here instead, and the
// page only ever receives coloured lines.
//
// Taken in fine grains on purpose: the core, the JavaScript regex engine and
// the TypeScript grammar are named one by one, so no other language, no theme
// collection and no Oniguruma wasm is ever fetched.

/**
 * The colours.
 *
 * Four hues and two greys, which is what it takes for the eye to sort a
 * formula's source at a glance: what the language says (violet), what is
 * called (blue), what a value is (teal), and text in quotes (the product's
 * own green). Everything a person wrote themselves - names, properties,
 * arguments - stays ink, so colour marks the language rather than the code.
 *
 * Each colour is one `light-dark()` pair, resolved by the `color-scheme` this
 * product already sets on the root, so a scheme change repaints without a
 * second tokenization and without any React state. The hues sit at the low
 * chroma the rest of the palette keeps, and stay away from danger's red and
 * warning's amber: in this product those two mean an error and a warning, and
 * syntax is neither.
 */
const FOREGROUND = 'var(--q-foreground)'
const KEYWORD = 'light-dark(oklch(0.5 0.15 305), oklch(0.8 0.11 305))'
const CALLED = 'light-dark(oklch(0.48 0.13 255), oklch(0.79 0.1 255))'
const VALUE = 'light-dark(oklch(0.48 0.09 215), oklch(0.79 0.08 215))'
const QUOTED = 'var(--q-success-foreground)'
const QUIET = 'color-mix(in oklab, var(--q-muted-foreground) 75%, transparent)'
/** brackets, commas and operators hold the code together without competing */
const PUNCTUATION = 'color-mix(in oklab, var(--q-foreground) 65%, transparent)'

/** TextMate's bold bit, which this reader draws as the product's medium weight */
const BOLD = 2

const theme: ThemeRegistration = {
  name: 'qualy-reader',
  // a reader draws its own surface; the theme only says what the ink is
  type: 'light',
  colors: { 'editor.foreground': FOREGROUND, 'editor.background': 'transparent' },
  settings: [
    { settings: { foreground: FOREGROUND } },
    { scope: ['comment', 'punctuation.definition.comment'], settings: { foreground: QUIET } },
    {
      scope: ['string', 'string.template', 'constant.character.escape', 'string.regexp'],
      settings: { foreground: QUOTED },
    },
    // what is inside `${ }` is code again, and reads as code
    {
      scope: ['meta.template.expression', 'punctuation.definition.template-expression'],
      settings: { foreground: FOREGROUND },
    },
    {
      scope: [
        'keyword',
        'keyword.control',
        'keyword.operator.expression',
        'keyword.operator.new',
        'storage',
        'storage.type',
        'storage.modifier',
        'variable.language',
        'entity.name.tag',
      ],
      settings: { foreground: KEYWORD },
    },
    {
      scope: [
        'entity.name.function',
        'support.function',
        'meta.function-call.ts',
        'variable.function',
      ],
      settings: { foreground: CALLED },
    },
    {
      scope: [
        'constant.numeric',
        'constant.language',
        'support.constant',
        'entity.name.type',
        'entity.name.class',
        'support.type',
        'support.class',
        'entity.other.inherited-class',
      ],
      settings: { foreground: VALUE },
    },
    {
      scope: ['punctuation', 'meta.brace', 'keyword.operator'],
      settings: { foreground: PUNCTUATION },
    },
  ],
}

/** the one highlighter this worker ever builds; a grammar is compiled once */
const opening = createHighlighterCore({
  langs: [typescript],
  themes: [theme],
  // the JavaScript engine, so no wasm is fetched; a pattern it cannot
  // compile costs that pattern's colour, never the whole reader
  engine: createJavaScriptRegexEngine({ forgiving: true }),
})

const pieces = (tokens: readonly ThemedToken[]): SourceToken[] =>
  tokens.map((token) => ({
    text: token.content,
    ...(token.color === undefined ? {} : { color: token.color }),
    ...(((token.fontStyle ?? 0) & BOLD) === 0 ? {} : { strong: true }),
  }))

export interface HighlightAsk {
  readonly id: number
  readonly source: string
}

export interface HighlightAnswer {
  readonly id: number
  /** null where the source could not be coloured; the page then reads it plain */
  readonly lines: SourceToken[][] | null
}

self.onmessage = (event: MessageEvent<HighlightAsk>) => {
  const { id, source } = event.data
  void opening
    .then((shiki) => {
      const { tokens } = shiki.codeToTokens(source, { lang: 'typescript', theme: theme.name! })
      const answer: HighlightAnswer = { id, lines: tokens.map(pieces) }
      self.postMessage(answer)
    })
    .catch(() => {
      const answer: HighlightAnswer = { id, lines: null }
      self.postMessage(answer)
    })
}
