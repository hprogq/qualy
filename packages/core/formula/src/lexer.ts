/**
 * The pre-compiler module-closure fence, token-based. tsc RESOLVES whatever
 * a source names even though it executes nothing, so every syntax that can
 * reach module resolution must be caught BEFORE the compiler is spawned —
 * and a regex over raw text cannot enumerate TypeScript's specifier
 * grammar (`import type X = require(...)` alone defeats a binding-name
 * pattern). This lexer walks the pinned TS7 scanner's token stream instead.
 *
 * Two channels run in union; a specifier from either counts:
 *
 * 1. TOKEN channel — the official scanner, comments skipped, strings exact.
 *    A string literal is a specifier when it follows `from`, `import`, or
 *    opens an `import(`/`require(` call; a NON-string in call position is
 *    refused outright as a dynamic specifier (nothing provable there).
 * 2. BYTE channel — the original conservative patterns over the raw text,
 *    kept because they are immune to token mis-alignment: TS/ES grammar
 *    offers no way to spell a resolvable specifier without the literal
 *    keywords `import`, `require`, or `from`, so a shape that somehow
 *    slipped the token walk still trips the byte match (in comments and
 *    strings too — refusing those stays deliberate).
 *
 * The one lexical ambiguity, `/` as division vs regex, is closed by policy:
 * a formula computes scores and has no regular expression literals (the
 * schema-level `pattern` keyword is the host's business). At a
 * non-division position the slash is speculatively re-scanned; a
 * well-formed regex refuses the source. Both misjudgement directions end in
 * refusal, never in a silently mis-lexed string: a regex mistaken for
 * division re-lexes its body, where any specifier-looking content trips a
 * rule and any odd quote leaves an unterminated literal — also refused.
 */

import { createScanner, LanguageVariant, SyntaxKind } from 'typescript/unstable/ast'

/** call-position specifier that is not a plain string literal */
export const DYNAMIC_SPECIFIER = '<dynamic specifier>'
/** regular expression literal: not part of the formula language */
export const REGEX_LITERAL = '<regular expression literal>'
/** an unclosed string or template: the only sure sign of a mis-lexed tail */
export const UNTERMINATED_TEXT = '<unterminated text>'

// prev-token kinds after which `/` is division, not a regex start (the
// established expression-tail set; `)` must be here or `(a+b)/2 + c/3`
// would false-positive, `}` must NOT be so statement-position regexes
// after a block still re-scan and get refused as regex literals)
const DIVISION_CONTEXT: ReadonlySet<SyntaxKind> = new Set([
  SyntaxKind.Identifier,
  SyntaxKind.StringLiteral,
  SyntaxKind.NoSubstitutionTemplateLiteral,
  SyntaxKind.TemplateTail,
  SyntaxKind.NumericLiteral,
  SyntaxKind.BigIntLiteral,
  SyntaxKind.RegularExpressionLiteral,
  SyntaxKind.CloseParenToken,
  SyntaxKind.CloseBracketToken,
  SyntaxKind.PlusPlusToken,
  SyntaxKind.MinusMinusToken,
  SyntaxKind.ThisKeyword,
  SyntaxKind.TrueKeyword,
  SyntaxKind.FalseKeyword,
  SyntaxKind.NullKeyword,
  SyntaxKind.SuperKeyword,
])

const UNTERMINATABLE: ReadonlySet<SyntaxKind> = new Set([
  SyntaxKind.StringLiteral,
  SyntaxKind.NoSubstitutionTemplateLiteral,
  SyntaxKind.TemplateHead,
  SyntaxKind.TemplateMiddle,
  SyntaxKind.TemplateTail,
  SyntaxKind.RegularExpressionLiteral,
])

const tokenSpecifiers = (source: string): readonly string[] => {
  const scanner = createScanner(/* skipTrivia */ true, LanguageVariant.Standard, source)
  const found: string[] = []
  let prev: SyntaxKind = SyntaxKind.Unknown
  let expectCallSpecifier = false
  let braceDepth = 0
  // brace depths at which an outstanding `${` opened, so the matching `}`
  // is re-scanned as template middle/tail instead of a block close
  const templateStack: number[] = []
  for (;;) {
    let kind = scanner.scan()
    if (kind === SyntaxKind.EndOfFile) break

    if (kind === SyntaxKind.OpenBraceToken) {
      braceDepth += 1
    } else if (kind === SyntaxKind.CloseBraceToken) {
      if (templateStack.length > 0 && templateStack[templateStack.length - 1] === braceDepth) {
        kind = scanner.reScanTemplateToken(/* isTaggedTemplate */ false)
        if (kind === SyntaxKind.TemplateTail) templateStack.pop()
      } else {
        braceDepth -= 1
      }
    }
    if (kind === SyntaxKind.TemplateHead) templateStack.push(braceDepth)

    if (
      (kind === SyntaxKind.SlashToken || kind === SyntaxKind.SlashEqualsToken) &&
      !DIVISION_CONTEXT.has(prev)
    ) {
      const rescanned = scanner.tryScan(() =>
        scanner.reScanSlashToken() === SyntaxKind.RegularExpressionLiteral &&
        !scanner.isUnterminated()
          ? SyntaxKind.RegularExpressionLiteral
          : undefined,
      )
      if (rescanned !== undefined) {
        found.push(REGEX_LITERAL)
        kind = rescanned
      }
    }

    if (UNTERMINATABLE.has(kind) && scanner.isUnterminated()) found.push(UNTERMINATED_TEXT)

    if (expectCallSpecifier) {
      expectCallSpecifier = false
      if (kind === SyntaxKind.StringLiteral) found.push(scanner.getTokenValue())
      else found.push(DYNAMIC_SPECIFIER)
    } else if (
      kind === SyntaxKind.StringLiteral &&
      (prev === SyntaxKind.FromKeyword || prev === SyntaxKind.ImportKeyword)
    ) {
      found.push(scanner.getTokenValue())
    }
    if (
      kind === SyntaxKind.OpenParenToken &&
      (prev === SyntaxKind.ImportKeyword || prev === SyntaxKind.RequireKeyword)
    )
      expectCallSpecifier = true

    prev = kind
  }
  return found
}

// the byte channel: raw-text patterns, comments and strings included —
// refusal there is conservative on purpose and mis-alignment-proof
const SPECIFIER_SYNTAX = [
  /\bfrom\s*['"]([^'"\n]*)['"]/g,
  /\bimport\s*\(\s*['"]([^'"\n]*)['"]/g,
  /\brequire\s*\(\s*['"]([^'"\n]*)['"]/g,
  /\bimport\s*['"]([^'"\n]*)['"]/g,
] as const

const DYNAMIC_SYNTAX = [/\bimport\s*\(\s*[`]/, /\brequire\s*\(\s*[`]/] as const

const byteSpecifiers = (source: string): readonly string[] => {
  const found: string[] = []
  for (const syntax of SPECIFIER_SYNTAX)
    for (const match of source.matchAll(syntax)) found.push(match[1]!)
  for (const syntax of DYNAMIC_SYNTAX) if (syntax.test(source)) found.push(DYNAMIC_SPECIFIER)
  return found
}

/**
 * Every module specifier the source could make a resolver look at, plus
 * sentinel names for shapes the fence refuses outright. Publication allows
 * exactly `@qualy/formula`; the sentinels can never equal it.
 */
export const moduleSpecifiers = (source: string): readonly string[] => [
  ...new Set([...tokenSpecifiers(source), ...byteSpecifiers(source)]),
]
