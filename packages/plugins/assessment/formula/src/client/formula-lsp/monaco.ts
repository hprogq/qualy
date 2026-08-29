/**
 * The Monaco face of the language session: three providers and two marker
 * owners. Providers register against {language, scheme} so another page's
 * ordinary TypeScript model is never intercepted, and every provider call
 * flushes pending document sync first - the ordered bridge then guarantees
 * the server answers about the text the person actually sees.
 *
 * The two diagnostic voices NEVER share a marker owner: the type voice
 * (pull) and the policy voice (push) each own their channel, so a clean
 * type report cannot wipe a policy refusal off the screen, nor the other
 * way around.
 */

import type * as monaco from 'monaco-editor/editor'
import type { LspConnection } from './connection.ts'
import type { FormulaDocument } from './document.ts'
import {
  toLspPosition,
  toMonacoCompletion,
  toMonacoHover,
  toMonacoMarker,
  toMonacoSignatureHelp,
} from './conversions.ts'
import {
  FORMULA_URI,
  type LspCompletionItem,
  type LspCompletionList,
  type LspDiagnostic,
  type LspHover,
  type LspServerCapabilities,
  type LspSignatureHelp,
} from './protocol.ts'

export const TYPESCRIPT_MARKERS = 'qualy-formula/typescript'
export const POLICY_MARKERS = 'qualy-formula/policy'

const FILTER = { language: 'typescript', scheme: 'qualy-formula' } as const

export interface ProviderDeps {
  readonly connection: () => LspConnection | null
  readonly document: () => FormulaDocument | null
}

/** completion, factored out so tests can drive the mapping directly */
export const provideCompletions = async (
  monacoApi: typeof monaco,
  deps: ProviderDeps,
  model: monaco.editor.ITextModel,
  position: monaco.Position,
): Promise<monaco.languages.CompletionList> => {
  const connection = deps.connection()
  const document = deps.document()
  if (connection === null || document === null || connection.state !== 'ready')
    return { suggestions: [] }
  document.syncNow()
  try {
    const result = (await connection.request('textDocument/completion', {
      textDocument: { uri: FORMULA_URI },
      position: toLspPosition(position),
    })) as LspCompletionList | readonly LspCompletionItem[] | null
    const items: readonly LspCompletionItem[] =
      result === null
        ? []
        : Array.isArray(result)
          ? (result as readonly LspCompletionItem[])
          : ((result as LspCompletionList).items ?? [])
    return {
      suggestions: items.map((item) => toMonacoCompletion(monacoApi, model, position, item)),
    }
  } catch {
    return { suggestions: [] }
  }
}

export const provideHover = async (
  deps: ProviderDeps,
  position: monaco.Position,
): Promise<monaco.languages.Hover | null> => {
  const connection = deps.connection()
  const document = deps.document()
  if (connection === null || document === null || connection.state !== 'ready') return null
  document.syncNow()
  try {
    const result = (await connection.request('textDocument/hover', {
      textDocument: { uri: FORMULA_URI },
      position: toLspPosition(position),
    })) as LspHover | null
    return result === null ? null : toMonacoHover(result)
  } catch {
    return null
  }
}

export const provideSignatureHelp = async (
  deps: ProviderDeps,
  position: monaco.Position,
): Promise<monaco.languages.SignatureHelpResult | null> => {
  const connection = deps.connection()
  const document = deps.document()
  if (connection === null || document === null || connection.state !== 'ready') return null
  document.syncNow()
  try {
    const result = (await connection.request('textDocument/signatureHelp', {
      textDocument: { uri: FORMULA_URI },
      position: toLspPosition(position),
    })) as LspSignatureHelp | null
    if (result === null || result.signatures.length === 0) return null
    return { value: toMonacoSignatureHelp(result), dispose: () => {} }
  } catch {
    return null
  }
}

export const registerFormulaProviders = (
  monacoApi: typeof monaco,
  deps: ProviderDeps,
  serverCapabilities: LspServerCapabilities,
): monaco.IDisposable[] => [
  monacoApi.languages.registerCompletionItemProvider(FILTER, {
    triggerCharacters: [...(serverCapabilities.completionProvider?.triggerCharacters ?? ['.'])],
    provideCompletionItems: (model, position) =>
      provideCompletions(monacoApi, deps, model, position),
  }),
  monacoApi.languages.registerHoverProvider(FILTER, {
    provideHover: (_model, position) => provideHover(deps, position),
  }),
  monacoApi.languages.registerSignatureHelpProvider(FILTER, {
    signatureHelpTriggerCharacters: [
      ...(serverCapabilities.signatureHelpProvider?.triggerCharacters ?? ['(', ',']),
    ],
    signatureHelpRetriggerCharacters: [
      ...(serverCapabilities.signatureHelpProvider?.retriggerCharacters ?? [')']),
    ],
    provideSignatureHelp: (_model, position) => provideSignatureHelp(deps, position),
  }),
]

export const applyMarkers = (
  monacoApi: typeof monaco,
  model: monaco.editor.ITextModel,
  owner: string,
  diagnostics: readonly LspDiagnostic[],
): void => {
  monacoApi.editor.setModelMarkers(
    model,
    owner,
    diagnostics.map((diagnostic) => toMonacoMarker(monacoApi, diagnostic)),
  )
}

export const clearAllMarkers = (
  monacoApi: typeof monaco,
  model: monaco.editor.ITextModel,
): void => {
  monacoApi.editor.setModelMarkers(model, TYPESCRIPT_MARKERS, [])
  monacoApi.editor.setModelMarkers(model, POLICY_MARKERS, [])
}
