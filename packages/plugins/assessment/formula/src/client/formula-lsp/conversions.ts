/**
 * Every LSP <-> Monaco shape translation lives here and nowhere else, so
 * the one off-by-one that matters - LSP counts lines and characters from 0,
 * Monaco from 1 - has exactly one home. Both sides index UTF-16 code units
 * (negotiated in the initialize capabilities), so no encoding conversion
 * happens: only the +1.
 */

import type * as monaco from 'monaco-editor/editor'
import type {
  LspCompletionItem,
  LspDiagnostic,
  LspHover,
  LspPosition,
  LspRange,
  LspSignatureHelp,
  LspTextEdit,
} from './protocol.ts'

export const toLspPosition = (position: monaco.Position): LspPosition => ({
  line: position.lineNumber - 1,
  character: position.column - 1,
})

export const toMonacoRange = (range: LspRange): monaco.IRange => ({
  startLineNumber: range.start.line + 1,
  startColumn: range.start.character + 1,
  endLineNumber: range.end.line + 1,
  endColumn: range.end.character + 1,
})

const documentationText = (
  value: string | { readonly value: string } | undefined,
): string | undefined =>
  value === undefined ? undefined : typeof value === 'string' ? value : value.value

/** markdown from the language server renders, but never executes: no
 * command links, no html - the server is trusted, the capability is not
 * needed */
const untrusted = (value: string): monaco.IMarkdownString => ({
  value,
  isTrusted: false,
  supportHtml: false,
})

// LSP CompletionItemKind (1-based) -> Monaco CompletionItemKind, by name;
// unknown kinds fall back to Text rather than guessing
export const completionKindOf = (
  monacoApi: typeof monaco,
  kind: number | undefined,
): monaco.languages.CompletionItemKind => {
  const kinds = monacoApi.languages.CompletionItemKind
  switch (kind) {
    case 1:
      return kinds.Text
    case 2:
      return kinds.Method
    case 3:
      return kinds.Function
    case 4:
      return kinds.Constructor
    case 5:
      return kinds.Field
    case 6:
      return kinds.Variable
    case 7:
      return kinds.Class
    case 8:
      return kinds.Interface
    case 9:
      return kinds.Module
    case 10:
      return kinds.Property
    case 11:
      return kinds.Unit
    case 12:
      return kinds.Value
    case 13:
      return kinds.Enum
    case 14:
      return kinds.Keyword
    case 15:
      return kinds.Snippet
    case 16:
      return kinds.Color
    case 17:
      return kinds.File
    case 18:
      return kinds.Reference
    case 19:
      return kinds.Folder
    case 20:
      return kinds.EnumMember
    case 21:
      return kinds.Constant
    case 22:
      return kinds.Struct
    case 23:
      return kinds.Event
    case 24:
      return kinds.Operator
    case 25:
      return kinds.TypeParameter
    default:
      return kinds.Text
  }
}

/** the range a completion replaces when the server names none: the word at
 * the cursor, which is what Monaco itself would filter against */
const fallbackRange = (
  model: monaco.editor.ITextModel,
  position: monaco.Position,
): monaco.IRange => {
  const word = model.getWordUntilPosition(position)
  return {
    startLineNumber: position.lineNumber,
    startColumn: word.startColumn,
    endLineNumber: position.lineNumber,
    endColumn: position.column,
  }
}

export const toMonacoCompletion = (
  monacoApi: typeof monaco,
  model: monaco.editor.ITextModel,
  position: monaco.Position,
  item: LspCompletionItem,
): monaco.languages.CompletionItem => {
  const insertText = item.textEdit?.newText ?? item.insertText ?? item.label
  const documentation = documentationText(item.documentation)
  return {
    label: item.label,
    kind: completionKindOf(monacoApi, item.kind),
    range:
      item.textEdit === undefined
        ? fallbackRange(model, position)
        : toMonacoRange(item.textEdit.range),
    insertText,
    ...(item.insertTextFormat === 2
      ? { insertTextRules: monacoApi.languages.CompletionItemInsertTextRule.InsertAsSnippet }
      : {}),
    ...(item.detail === undefined ? {} : { detail: item.detail }),
    ...(documentation === undefined ? {} : { documentation: untrusted(documentation) }),
    ...(item.sortText === undefined ? {} : { sortText: item.sortText }),
    ...(item.filterText === undefined ? {} : { filterText: item.filterText }),
    ...(item.commitCharacters === undefined
      ? {}
      : { commitCharacters: [...item.commitCharacters] }),
    ...(item.tags?.includes(1) === true
      ? { tags: [monacoApi.languages.CompletionItemTag.Deprecated] }
      : {}),
  }
}

export const toMonacoHover = (hover: LspHover): monaco.languages.Hover => {
  const parts = Array.isArray(hover.contents) ? hover.contents : [hover.contents]
  return {
    contents: parts
      .map((part) => documentationText(part))
      .filter((text): text is string => text !== undefined && text !== '')
      .map(untrusted),
    ...(hover.range === undefined ? {} : { range: toMonacoRange(hover.range) }),
  }
}

export const toMonacoSignatureHelp = (help: LspSignatureHelp): monaco.languages.SignatureHelp => ({
  signatures: help.signatures.map((signature) => ({
    label: signature.label,
    ...(documentationText(signature.documentation) === undefined
      ? {}
      : { documentation: untrusted(documentationText(signature.documentation)!) }),
    parameters: (signature.parameters ?? []).map((parameter) => ({
      label: Array.isArray(parameter.label)
        ? ([parameter.label[0], parameter.label[1]] as [number, number])
        : (parameter.label as string),
      ...(documentationText(parameter.documentation) === undefined
        ? {}
        : { documentation: untrusted(documentationText(parameter.documentation)!) }),
    })),
  })),
  activeSignature: help.activeSignature ?? 0,
  activeParameter: help.activeParameter ?? 0,
})

const SEVERITIES: Record<number, 'error' | 'warning' | 'info' | 'hint'> = {
  1: 'error',
  2: 'warning',
  3: 'info',
  4: 'hint',
}

export const toMonacoMarker = (
  monacoApi: typeof monaco,
  diagnostic: LspDiagnostic,
): monaco.editor.IMarkerData => {
  const severity = SEVERITIES[diagnostic.severity ?? 1] ?? 'error'
  return {
    severity:
      severity === 'error'
        ? monacoApi.MarkerSeverity.Error
        : severity === 'warning'
          ? monacoApi.MarkerSeverity.Warning
          : severity === 'info'
            ? monacoApi.MarkerSeverity.Info
            : monacoApi.MarkerSeverity.Hint,
    startLineNumber: diagnostic.range.start.line + 1,
    startColumn: diagnostic.range.start.character + 1,
    endLineNumber: diagnostic.range.end.line + 1,
    endColumn: diagnostic.range.end.character + 1,
    message: diagnostic.message,
    ...(diagnostic.code === undefined ? {} : { code: String(diagnostic.code) }),
    ...(diagnostic.source === undefined ? {} : { source: diagnostic.source }),
  }
}

export const toMonacoTextEdits = (edits: readonly LspTextEdit[]): monaco.languages.TextEdit[] =>
  edits.map((edit) => ({ range: toMonacoRange(edit.range), text: edit.newText }))
