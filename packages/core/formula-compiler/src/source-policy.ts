/**
 * The formula language's own law, decided on a real AST before the real
 * compiler ever runs. tsc RESOLVES whatever a source names even though it
 * executes nothing, so everything that could reach module resolution - and
 * everything the language forbids outright - is found here first, by a
 * parser that resolves nothing: TypeScript 6's classic in-memory
 * `createSourceFile`, no project, no tsconfig, no filesystem, no
 * subprocess. TS6 answers only "what syntax is this?"; type correctness
 * stays with the workspace TS7, and TS6's checker, resolver and emitter
 * are never invoked.
 *
 * Rulings encoded here: only `import ... from '@qualy/formula'` (type-only
 * included) may exist; `import =` and `import(...)` type positions are
 * refused even for the legal name; dynamic import is refused outright;
 * explicit `any` is refused wherever it appears as SYNTAX - a string or a
 * comment saying "any" is content, not syntax, which is exactly why this
 * replaced a whole-text scan; suppression directives are matched inside
 * comment ranges only; triple-slash references count when the compiler
 * would honor them (file-head positions, reported by the parser itself).
 */

import ts from 'typescript6'
import type { FormulaDiagnostic } from './staging.ts'

/** the language policy's own version, frozen into published versions */
export const FORMULA_SOURCE_POLICY_VERSION = 1

/** the parser actually deciding the syntax questions */
export const sourcePolicyParserVersion = (): string => `typescript@${ts.version}`

export type PolicyReason = 'import' | 'any' | 'suppression' | 'triple-slash'

export interface PolicyFinding {
  readonly reason: PolicyReason
  readonly specifier?: string
  /** 1-based, where the finding anchors; editors surface it, wires may not */
  readonly line?: number
  readonly column?: number
}

export type PolicyVerdict =
  | { readonly kind: 'clean' }
  | { readonly kind: 'refused'; readonly findings: readonly PolicyFinding[] }
  /** the source does not even parse: the caller shows these as diagnostics */
  | { readonly kind: 'syntax'; readonly diagnostics: readonly FormulaDiagnostic[] }

const SDK = '@qualy/formula'
const SUPPRESSION = /@ts-(?:ignore|nocheck|expect-error)\b/

const flatten = (text: string | ts.DiagnosticMessageChain): string =>
  typeof text === 'string' ? text : text.messageText

interface ParsedSourceFile extends ts.SourceFile {
  /** internal but stable since TS 1.x; the pinned 6.0.3 freezes its shape */
  readonly parseDiagnostics: readonly ts.DiagnosticWithLocation[]
}

const specifierOf = (node: ts.Node): string => {
  if (ts.isStringLiteralLike(node)) return node.text
  return '<dynamic specifier>'
}

export const sourcePolicy = (source: string): PolicyVerdict => {
  const file = ts.createSourceFile(
    'formula.ts',
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TS,
  ) as ParsedSourceFile

  // syntax must be clean before anything else is believed: error recovery
  // is good, but a fence must not reason from a guessed tree - and the
  // author gets line/column diagnostics either way
  if (file.parseDiagnostics.length > 0) {
    return {
      kind: 'syntax',
      diagnostics: file.parseDiagnostics.slice(0, 50).map((diagnostic) => {
        const at = file.getLineAndCharacterOfPosition(diagnostic.start)
        return {
          line: at.line + 1,
          column: at.character + 1,
          code: `TS${diagnostic.code}`,
          message: flatten(diagnostic.messageText).slice(0, 2000),
        }
      }),
    }
  }

  const findings: PolicyFinding[] = []
  const at = (node: ts.Node): { line: number; column: number } => {
    const position = file.getLineAndCharacterOfPosition(node.getStart(file))
    return { line: position.line + 1, column: position.character + 1 }
  }

  const directive =
    file.referencedFiles[0] ?? file.typeReferenceDirectives[0] ?? file.libReferenceDirectives[0]
  if (directive !== undefined || file.amdDependencies.length > 0) {
    const position = file.getLineAndCharacterOfPosition(directive?.pos ?? 0)
    findings.push({
      reason: 'triple-slash',
      line: position.line + 1,
      column: position.character + 1,
    })
  }

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      const specifier = specifierOf(node.moduleSpecifier)
      if (specifier !== SDK) findings.push({ reason: 'import', specifier, ...at(node) })
    } else if (ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier !== undefined)
        findings.push({
          reason: 'import',
          specifier: specifierOf(node.moduleSpecifier),
          ...at(node),
        })
    } else if (ts.isImportEqualsDeclaration(node)) {
      // refused even for the sdk: one import shape is enough surface
      const reference = node.moduleReference
      findings.push({
        reason: 'import',
        specifier: ts.isExternalModuleReference(reference)
          ? specifierOf(reference.expression)
          : reference.getText(file),
        ...at(node),
      })
    } else if (node.kind === ts.SyntaxKind.ImportType) {
      const argument = (node as ts.ImportTypeNode).argument
      findings.push({
        reason: 'import',
        specifier: ts.isLiteralTypeNode(argument)
          ? specifierOf(argument.literal)
          : '<dynamic specifier>',
        ...at(node),
      })
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const argument = node.arguments[0]
      findings.push({
        reason: 'import',
        specifier: argument !== undefined ? specifierOf(argument) : '<dynamic specifier>',
        ...at(node),
      })
    } else if (node.kind === ts.SyntaxKind.AnyKeyword) {
      findings.push({ reason: 'any', ...at(node) })
    }
    ts.forEachChild(node, visit)
  }
  visit(file)

  // suppressions live in comments, which the AST walk above never sees;
  // one trivia-aware scan finds every comment range, and ONLY comments -
  // the same directive spelled inside a string is content
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    /* skipTrivia */ false,
    ts.LanguageVariant.Standard,
    source,
  )
  for (;;) {
    const kind = scanner.scan()
    if (kind === ts.SyntaxKind.EndOfFileToken) break
    if (
      (kind === ts.SyntaxKind.SingleLineCommentTrivia ||
        kind === ts.SyntaxKind.MultiLineCommentTrivia) &&
      SUPPRESSION.test(scanner.getTokenText())
    ) {
      findings.push({
        reason: 'suppression',
        specifier: SUPPRESSION.exec(scanner.getTokenText())![0],
        line: file.getLineAndCharacterOfPosition(scanner.getTokenStart()).line + 1,
        column: file.getLineAndCharacterOfPosition(scanner.getTokenStart()).character + 1,
      })
      break
    }
  }

  return findings.length > 0 ? { kind: 'refused', findings } : { kind: 'clean' }
}
