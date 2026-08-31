/**
 * The exact LSP surface this client speaks - nothing more. The server side
 * (F1) allowlists methods and eats server-to-client requests, so this is a
 * document client, not a general language client: no dynamic registration,
 * no workspace features, no completionItem/resolve, no $/cancelRequest.
 *
 * The initialize capabilities below are a PROMISE, not a wish list: every
 * capability declared here is one this adapter actually implements, because
 * declaring more licenses the server to answer in shapes we cannot render
 * (InsertReplaceEdit, resolve-deferred documentation).
 */

/** the one editable document, byte-identical to the F1 virtual scheme */
export const FORMULA_URI = 'qualy-formula:///formula.ts'

export interface LspPosition {
  readonly line: number
  readonly character: number
}

export interface LspRange {
  readonly start: LspPosition
  readonly end: LspPosition
}

export interface LspDiagnostic {
  readonly range: LspRange
  readonly severity?: number
  readonly code?: string | number
  readonly source?: string
  readonly message: string
}

export interface LspCompletionItem {
  readonly label: string
  readonly kind?: number
  readonly detail?: string
  readonly documentation?: string | { readonly value: string }
  readonly sortText?: string
  readonly filterText?: string
  readonly insertText?: string
  readonly insertTextFormat?: number
  readonly textEdit?: { readonly range: LspRange; readonly newText: string }
  readonly commitCharacters?: readonly string[]
  readonly tags?: readonly number[]
}

export interface LspCompletionList {
  readonly isIncomplete?: boolean
  readonly items: readonly LspCompletionItem[]
}

export interface LspHover {
  readonly contents:
    string | { readonly value: string } | readonly (string | { readonly value: string })[]
  readonly range?: LspRange
}

export interface LspSignatureHelp {
  readonly signatures: readonly {
    readonly label: string
    readonly documentation?: string | { readonly value: string }
    readonly parameters?: readonly {
      readonly label: string | readonly [number, number]
      readonly documentation?: string | { readonly value: string }
    }[]
  }[]
  readonly activeSignature?: number
  readonly activeParameter?: number
}

export interface LspTextEdit {
  readonly range: LspRange
  readonly newText: string
}

export interface LspServerCapabilities {
  readonly completionProvider?: { readonly triggerCharacters?: readonly string[] }
  readonly signatureHelpProvider?: {
    readonly triggerCharacters?: readonly string[]
    readonly retriggerCharacters?: readonly string[]
  }
  readonly documentFormattingProvider?: boolean | object
}

/** a full pull-diagnostics report; unchanged reports do not occur (no previousResultId is sent) */
export interface LspDiagnosticReport {
  readonly kind?: string
  readonly items?: readonly LspDiagnostic[]
}

/** what this adapter truly implements - see the module note */
export const CLIENT_CAPABILITIES = {
  general: {
    // Monaco and JavaScript strings index UTF-16 code units; saying so
    // keeps columns honest around emoji and surrogate pairs even if the
    // server ever learns other encodings
    positionEncodings: ['utf-16'],
  },
  textDocument: {
    synchronization: { didSave: false, willSave: false },
    completion: {
      completionItem: {
        snippetSupport: true,
        documentationFormat: ['markdown', 'plaintext'],
        commitCharactersSupport: true,
        tagSupport: { valueSet: [1] },
      },
    },
    hover: { contentFormat: ['markdown', 'plaintext'] },
    signatureHelp: {
      signatureInformation: {
        documentationFormat: ['markdown', 'plaintext'],
        parameterInformation: { labelOffsetSupport: true },
      },
    },
    diagnostic: {},
    publishDiagnostics: { versionSupport: true },
    formatting: {},
  },
} as const
