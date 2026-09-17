/**
 * The formula source editors: the draft, editable, and a frozen source,
 * read-only - both Monaco over an editor session (editor-session.ts), with
 * the language service's hovers and signatures on either.
 *
 * The editable one is strictly semi-controlled against React state. The
 * model is the editing buffer, never the persistence authority; ordinary
 * rerenders never write to it, and only a moved `seed` - a real adoption
 * from outside (a restore, loading the example, discarding local edits) -
 * replaces its text, as one undoable step.
 *
 * The language service is assistance, not authority: with the connection
 * down the editor still edits, and saving and publishing never depend on
 * it. The status line says connecting / ready / unavailable, and when the
 * server turned a session away because this person holds too many, says
 * that instead - closing another window is what fixes it.
 */

import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react'
import * as stylex from '@stylexjs/stylex'
import { useI18n } from '@qualy/web-i18n'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { Button } from '@qualy/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@qualy/ui/tooltip'
import { CodeXmlIcon, WandSparklesIcon } from 'lucide-react'
import { monaco } from './monaco-setup.ts'
import { holdEditorLease } from './editor-lease.ts'
import { editorSession, type EditorSession, type SessionState } from './editor-session.ts'
import { FORMULA_URI } from './formula-lsp/protocol.ts'
import { formulaMessages as m } from './i18n.ts'

// A pane rather than a boxed field: a head naming what is below it and how
// the language connection stands, and the editor taking every pixel the
// pane is given. Whoever places it decides the pane's height; standing on
// its own it keeps a floor, so it is never a line tall.
const styles = stylex.create({
  frame: {
    display: 'flex',
    height: '100%',
    minHeight: 0,
    flexDirection: 'column',
    backgroundColor: tokens.surface,
  },
  head: {
    display: 'flex',
    height: 38,
    flexShrink: 0,
    alignItems: 'center',
    gap: 8,
    paddingInline: 16,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
  },
  // named like the columns beside it, so the three heads read as one row
  label: { flexShrink: 0, fontSize: 13, fontWeight: 600, color: tokens.foreground },
  labelIcon: { display: 'inline-flex', flexShrink: 0, color: tokens.mutedForeground },
  tipHost: { display: 'inline-flex' },
  readOnly: {
    flexShrink: 0,
    paddingInline: 6,
    height: 18,
    display: 'inline-flex',
    alignItems: 'center',
    borderRadius: 4,
    backgroundColor: tokens.surfaceMuted,
    fontSize: 11,
    color: tokens.mutedForeground,
  },
  spring: { flexGrow: 1 },
  editor: {
    flexGrow: 1,
    minHeight: 240,
    overflow: 'hidden',
  },
  status: {
    display: 'inline-flex',
    minWidth: 0,
    alignItems: 'center',
    gap: 6,
    margin: 0,
    fontSize: 11,
    color: tokens.mutedForeground,
  },
  statusWords: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  dot: {
    width: 6,
    height: 6,
    flexShrink: 0,
    borderRadius: '9999px',
    backgroundColor: `color-mix(in oklab, ${tokens.mutedForeground} 45%, transparent)`,
  },
  dotReady: { backgroundColor: tokens.success },
  dotDown: { backgroundColor: tokens.warning },
})

const EDITOR_OPTIONS = {
  automaticLayout: true,
  minimap: { enabled: false },
  // the page owns the wheel once the editor has nothing left to scroll;
  // without this the editor pins the page under the cursor
  scrollbar: { alwaysConsumeMouseWheel: false },
  fontSize: 13,
  lineNumbersMinChars: 3,
  scrollBeyondLastLine: false,
  fixedOverflowWidgets: true,
} as const

const silent = () => () => {}
const connecting = (): SessionState => 'connecting'

/** how the language connection stands, in the head of either pane */
function LanguageStatus({ session }: { readonly session: EditorSession | null }) {
  const { format } = useI18n()
  const raw = useSyncExternalStore(session?.subscribe ?? silent, session?.state ?? connecting)
  // no session asked for yet reads as about to connect
  const state = raw === 'idle' ? 'connecting' : raw
  const words =
    state === 'ready'
      ? format(m.lspReady)
      : state === 'connecting'
        ? format(m.lspConnecting)
        : state === 'limited'
          ? format(m.lspLimited)
          : format(m.lspUnavailable)
  return (
    <p
      {...stylex.props(styles.status)}
      data-testid="formula-lsp-status"
      data-state={state}
      title={words}
    >
      <span
        aria-hidden
        {...stylex.props(
          styles.dot,
          state === 'ready' && styles.dotReady,
          state !== 'ready' && state !== 'connecting' && styles.dotDown,
        )}
      />
      <span {...stylex.props(styles.statusWords)}>{words}</span>
    </p>
  )
}

/**
 * Formats the whole source through the language service - the same thing the
 * editor's context menu offers, where few people look for it.
 */
function FormatButton({
  ready,
  onFormat,
}: {
  readonly ready: boolean
  readonly onFormat: () => void
}) {
  const { format } = useI18n()
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={ready ? -1 : 0} {...stylex.props(styles.tipHost)}>
          <Button
            variant="ghost"
            size="xs"
            data-testid="formula-format"
            disabled={!ready}
            onClick={onFormat}
          >
            <WandSparklesIcon aria-hidden />
            {format(m.formatCode)}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>{format(ready ? m.formatCodeHint : m.formatCodeWaiting)}</TooltipContent>
    </Tooltip>
  )
}

/**
 * Draws a session's model in a container for as long as it is mounted; the
 * session itself outlives it. Returns the session once it exists.
 */
const useSessionView = (
  containerRef: RefObject<HTMLDivElement | null>,
  open: () => EditorSession,
  key: string,
  editorOptions: monaco.editor.IStandaloneEditorConstructionOptions,
) => {
  const [session, setSession] = useState<EditorSession | null>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const openRef = useRef(open)
  openRef.current = open
  const optionsRef = useRef(editorOptions)
  optionsRef.current = editorOptions

  useEffect(() => {
    const container = containerRef.current
    if (container === null) return
    const opened = openRef.current()
    setSession(opened)
    const editor = monaco.editor.create(container, {
      ...EDITOR_OPTIONS,
      ...optionsRef.current,
      model: opened.model,
    })
    if (opened.viewState !== null) editor.restoreViewState(opened.viewState)
    editorRef.current = editor
    const detach = opened.attach()
    return () => {
      opened.viewState = editor.saveViewState()
      detach()
      editor.dispose()
      editorRef.current = null
    }
    // the view belongs to one session; everything else flows through refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return { session, editorRef }
}

export interface FormulaCodeEditorProps {
  readonly functionId: string
  readonly value: string
  readonly onChange: (value: string) => void
  /**
   * The reseed signal: increment it and the buffer adopts `value`. An
   * unchanged seed means the buffer is the authority - ordinary rerenders
   * and value echoes NEVER touch it. Inferring a reseed from value diffs
   * was a real bug: an IME composition emits several model changes per
   * keystroke, React's echo lags the model, and the diff heuristic wrote a
   * stale value back mid-composition - teleporting the cursor, breaking
   * the composition and resetting the undo stack.
   */
  readonly seed: number
  readonly readOnly: boolean
  readonly ariaLabel: string
  /** the pane's own name in its head; the accessible name when not given */
  readonly label?: string
  /**
   * The page's editor lease. With one, the buffer and its undo history
   * outlive this component; without one, the editor owns them and ends them
   * when it unmounts.
   */
  readonly lease?: string
}

export default function FormulaCodeEditor(props: FormulaCodeEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [ownLease] = useState(() => `formula-editor-${Math.random().toString(36).slice(2)}`)
  const lease = props.lease ?? ownLease
  const onChangeRef = useRef(props.onChange)
  onChangeRef.current = props.onChange
  const valueRef = useRef(props.value)
  valueRef.current = props.value

  const { session, editorRef } = useSessionView(
    containerRef,
    () => {
      const opened = editorSession({
        key: `${lease}/draft`,
        lease,
        functionId: props.functionId,
        value: valueRef.current,
        frozen: false,
        // a lone editor keeps the historical address its tests know it by
        uri: props.lease === undefined ? FORMULA_URI : `qualy-formula:///${lease}/draft/formula.ts`,
      })
      opened.onChange = (value) => onChangeRef.current(value)
      return opened
    },
    `${lease}/${props.functionId}`,
    { readOnly: props.readOnly, ariaLabel: props.ariaLabel },
  )

  // after the view effect on purpose: on unmount the view lets go of the
  // model before a lone editor's own lease ends it
  useEffect(() => {
    if (props.lease !== undefined) return
    return holdEditorLease(ownLease, { immediate: true })
  }, [props.lease, ownLease])

  // the buffer follows `value` ONLY when the seed moves - an explicit
  // adoption, never a diff guess. It also runs when a view is drawn again
  // over a session whose text moved while nothing was drawing it.
  useEffect(() => {
    if (session === null) return
    if (valueRef.current === session.model.getValue()) return
    session.replace(valueRef.current)
  }, [props.seed, session])

  useEffect(() => {
    editorRef.current?.updateOptions({ readOnly: props.readOnly })
  }, [props.readOnly, editorRef, session])

  const state = useSyncExternalStore(session?.subscribe ?? silent, session?.state ?? connecting)

  return (
    <div {...stylex.props(styles.frame)}>
      <div {...stylex.props(styles.head)}>
        <span {...stylex.props(styles.labelIcon)}>
          <CodeXmlIcon size={14} aria-hidden />
        </span>
        <span {...stylex.props(styles.label)}>{props.label ?? props.ariaLabel}</span>
        <span {...stylex.props(styles.spring)} />
        <LanguageStatus session={session} />
        {props.readOnly ? null : (
          <FormatButton
            ready={session !== null && state === 'ready'}
            onFormat={() => {
              const editor = editorRef.current
              if (editor === null) return
              editor.focus()
              void editor.getAction('editor.action.formatDocument')?.run()
            }}
          />
        )}
      </div>
      <div ref={containerRef} {...stylex.props(styles.editor)} data-testid="formula-code-editor" />
    </div>
  )
}

export interface FormulaSourceViewerProps {
  readonly functionId: string
  /** the page's editor lease */
  readonly lease: string
  /** which frozen source, unique on the page: `release-3`, `revision-18` */
  readonly name: string
  readonly source: string
  readonly label: string
  readonly readOnlyLabel: string
  readonly 'data-testid'?: string
}

/** a frozen source in Monaco: read-only, with hovers and signatures from the language service */
export function FormulaSourceViewer(props: FormulaSourceViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const { session } = useSessionView(
    containerRef,
    () =>
      editorSession({
        key: `${props.lease}/${props.name}`,
        lease: props.lease,
        functionId: props.functionId,
        value: props.source,
        frozen: true,
        uri: `qualy-formula:///${props.lease}/${props.name}/formula.ts`,
      }),
    `${props.lease}/${props.name}`,
    { readOnly: true, domReadOnly: true, ariaLabel: props.label },
  )
  return (
    <div {...stylex.props(styles.frame)}>
      <div {...stylex.props(styles.head)}>
        <span {...stylex.props(styles.labelIcon)}>
          <CodeXmlIcon size={14} aria-hidden />
        </span>
        <span {...stylex.props(styles.label)}>{props.label}</span>
        <span {...stylex.props(styles.readOnly)}>{props.readOnlyLabel}</span>
        <span {...stylex.props(styles.spring)} />
        <LanguageStatus session={session} />
      </div>
      <div
        ref={containerRef}
        {...stylex.props(styles.editor)}
        data-testid={props['data-testid'] ?? 'formula-source-viewer'}
      />
    </div>
  )
}
