import type { HighlighterCore, ThemedToken, ThemeRegistration } from 'shiki/core'

// TypeScript, coloured for reading.
//
// A template's source is somebody else's code being read to decide whether to
// copy it; the editor's Monaco is a chunk of its own that such a reader should
// never wait for. So this is the reader's half of the pair: a TextMate
// tokenizer and nothing else - no language service, no worker, no session.
//
// Taken in fine grains on purpose. The core, the JavaScript regex engine and
// the TypeScript grammar are imported one by one, and only when a source is
// actually on screen, so no other language, no theme collection and no
// Oniguruma wasm reaches the browser. The whole of it arrives as its own async
// chunk after the page has already painted its plain text.

/** one coloured piece of a line; `color` is a CSS colour, already themed */
export interface SourceToken {
  readonly text: string
  readonly color?: string
  /** the reader's medium weight, which the theme asks for by TextMate's bold bit */
  readonly strong?: boolean
}

/**
 * The colours, as the product's own tokens.
 *
 * Every value is a CSS variable this product already flips between light and
 * dark, so a theme change needs no second tokenization and no parallel React
 * state. The palette is deliberately short: code is black, what the language
 * owns recedes, text in quotes is green, comments are quieter still. Danger
 * and warning are not used here - in this product those two colours mean an
 * error and a warning, and syntax is neither.
 */
const FOREGROUND = 'var(--q-foreground)'
const RECEDED = 'var(--q-surface-muted-foreground)'
const QUOTED = 'var(--q-success-foreground)'
const QUIET = 'color-mix(in oklab, var(--q-muted-foreground) 75%, transparent)'
const CONSTANT = 'color-mix(in oklab, var(--q-foreground) 75%, transparent)'

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
        'storage',
        'storage.type',
        'storage.modifier',
        'keyword.control',
        'keyword.operator.expression',
        'keyword.operator.new',
        'variable.language',
        'support.type.primitive',
        'entity.name.type',
      ],
      settings: { foreground: RECEDED, fontStyle: 'bold' },
    },
    {
      scope: ['constant.numeric', 'constant.language', 'support.constant'],
      settings: { foreground: CONSTANT },
    },
    // punctuation and operators hold the code together; they do not compete
    {
      scope: ['punctuation', 'meta.brace', 'keyword.operator'],
      settings: { foreground: FOREGROUND },
    },
  ],
}

let opening: Promise<HighlighterCore> | null = null

/**
 * The one highlighter this browser ever builds.
 *
 * Kept at module level rather than in a hook: building it compiles a grammar,
 * and a component that rebuilt it per render - or per keystroke of a source -
 * would pay that price again and again for the same answer.
 */
const highlighter = (): Promise<HighlighterCore> =>
  (opening ??= (async () => {
    const [core, engine, typescript] = await Promise.all([
      import('shiki/core'),
      import('shiki/engine/javascript'),
      import('@shikijs/langs/typescript'),
    ])
    return core.createHighlighterCore({
      langs: [typescript.default],
      themes: [theme],
      // the JavaScript engine, so no wasm is fetched; a pattern it cannot
      // compile costs that pattern's colour, never the whole reader
      engine: engine.createJavaScriptRegexEngine({ forgiving: true }),
    })
  })())

const pieces = (tokens: readonly ThemedToken[]): readonly SourceToken[] =>
  tokens.map((token) => ({
    text: token.content,
    ...(token.color === undefined ? {} : { color: token.color }),
    ...(((token.fontStyle ?? 0) & BOLD) === 0 ? {} : { strong: true }),
  }))

/**
 * The source as coloured lines, or null where it could not be coloured.
 *
 * Null is an ordinary answer: highlighting is an enhancement of a reader that
 * already works, so a failure here leaves plain text on screen and nothing in
 * front of the person reading it.
 */
export const highlightFormulaSource = async (
  source: string,
): Promise<readonly (readonly SourceToken[])[] | null> => {
  try {
    const shiki = await highlighter()
    const { tokens } = shiki.codeToTokens(source, { lang: 'typescript', theme: theme.name! })
    return tokens.map(pieces)
  } catch {
    return null
  }
}
