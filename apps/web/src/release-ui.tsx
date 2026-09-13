import { useSyncExternalStore, type ReactNode } from 'react'
import * as stylex from '@stylexjs/stylex'
import type { SupportedLocale } from '@qualy/i18n-contract'
import { defaultLocale } from '@qualy/i18n-contract'
import type { BootstrapMessages } from '@qualy/web-i18n/bootstrap'
import type { ReleaseCoordinator, ReleaseState } from '@qualy/web-runtime/release'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'

// The gate between the page and its release.
//
// It stands above every provider, the cold start included, because what it
// answers for is the page being unable to go on - a chunk that will not
// load, a server that refuses this page's protocol - and at that moment
// nothing below it can be counted on to render. So it draws with nothing
// but React and the tokens, in words from the bootstrap table, in the
// locale the shell's boot script marked on the root.
//
// Two shapes. A newer release on the server is news: the page keeps
// working and a small notice offers a reload, or later. A page that cannot
// go on is told so on a screen of its own, with the one way out; it is
// never reloaded for the reader, who may be halfway through something.

const styles = stylex.create({
  screen: {
    position: 'fixed',
    inset: 0,
    zIndex: 3000,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingInline: 24,
    textAlign: 'center',
    backgroundColor: tokens.background,
    color: tokens.foreground,
  },
  title: {
    margin: 0,
    fontSize: 24,
    lineHeight: '2rem',
    fontWeight: 600,
  },
  hint: {
    margin: 0,
    maxWidth: '28rem',
    fontSize: 14,
    lineHeight: '1.25rem',
    color: tokens.mutedForeground,
  },
  notice: {
    position: 'fixed',
    zIndex: 3000,
    bottom: {
      default: 24,
      [breakpoints.phone]: 16,
    },
    right: {
      default: 24,
      [breakpoints.phone]: 16,
    },
    left: {
      default: 'auto',
      [breakpoints.phone]: 16,
    },
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    width: {
      default: 320,
      [breakpoints.phone]: 'auto',
    },
    padding: 16,
    borderRadius: tokens.radiusLg,
    backgroundColor: tokens.surface,
    color: tokens.foreground,
    boxShadow: tokens.elevation3,
  },
  noticeTitle: {
    margin: 0,
    fontSize: 14,
    lineHeight: '1.25rem',
    fontWeight: 600,
  },
  noticeHint: {
    margin: 0,
    fontSize: 13,
    lineHeight: '1.25rem',
    color: tokens.mutedForeground,
  },
  actions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 4,
  },
  // the outline button, small, as the widget library draws it (theme/mantine.tsx)
  button: {
    appearance: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    height: 32,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    borderRadius: tokens.radiusMd,
    backgroundColor: {
      default: `color-mix(in oklch, ${tokens.input} 30%, transparent)`,
      ':hover': `color-mix(in oklch, ${tokens.input} 50%, transparent)`,
    },
    color: tokens.foreground,
    paddingInline: 12,
    paddingBlock: 0,
    fontSize: 14,
    lineHeight: '1.25rem',
    fontWeight: 500,
    cursor: 'pointer',
  },
  // the way out sits a little apart from the words, as on the not-found screen
  action: {
    marginTop: 8,
  },
  primary: {
    borderColor: tokens.foreground,
    backgroundColor: tokens.foreground,
    color: tokens.background,
  },
})

const isLocale = (
  value: string | undefined,
  table: Record<string, unknown>,
): value is SupportedLocale => value !== undefined && value in table

/** the table's row for the locale the root is marked with; the default's where it is not */
const copyFor = (table: Record<SupportedLocale, BootstrapMessages>): BootstrapMessages => {
  const marked =
    typeof document === 'undefined' ? undefined : document.documentElement.dataset['locale']
  return table[isLocale(marked, table) ? marked : defaultLocale]
}

const words = (
  state: Extract<ReleaseState, { kind: 'reload-required' }>,
  copy: BootstrapMessages,
) => {
  switch (state.reason) {
    case 'release-skew':
      return { title: copy.releaseSkewTitle, hint: copy.releaseSkewHint }
    case 'client-protocol':
      return { title: copy.clientProtocolTitle, hint: copy.clientProtocolHint }
    case 'asset-load-failed':
      return { title: copy.assetFailedTitle, hint: copy.assetFailedHint }
  }
}

export function ReleaseRecoveryGate({
  coordinator,
  copy: table,
  children,
}: {
  coordinator: ReleaseCoordinator
  copy: Record<SupportedLocale, BootstrapMessages>
  children: ReactNode
}) {
  const state = useSyncExternalStore(
    coordinator.subscribe,
    coordinator.getSnapshot,
    coordinator.getSnapshot,
  )
  if (state.kind === 'reload-required') {
    const copy = copyFor(table)
    const { title, hint } = words(state, copy)
    return (
      <div role="alert" data-release-recovery={state.reason} {...stylex.props(styles.screen)}>
        <h1 {...stylex.props(styles.title)}>{title}</h1>
        <p {...stylex.props(styles.hint)}>{hint}</p>
        <button
          type="button"
          {...stylex.props(styles.button, styles.action)}
          onClick={() => coordinator.reload()}
        >
          {copy.reloadPage}
        </button>
      </div>
    )
  }
  return (
    <>
      {children}
      {state.kind === 'update-available' ? (
        <UpdateNotice
          coordinator={coordinator}
          copy={copyFor(table)}
          releaseId={state.latest.releaseId}
        />
      ) : null}
    </>
  )
}

function UpdateNotice({
  coordinator,
  copy,
  releaseId,
}: {
  coordinator: ReleaseCoordinator
  copy: BootstrapMessages
  releaseId: string
}) {
  return (
    <div role="status" data-release-update={releaseId} {...stylex.props(styles.notice)}>
      <p {...stylex.props(styles.noticeTitle)}>{copy.updateAvailableTitle}</p>
      <p {...stylex.props(styles.noticeHint)}>{copy.updateAvailableHint}</p>
      <div {...stylex.props(styles.actions)}>
        <button
          type="button"
          {...stylex.props(styles.button)}
          onClick={() => coordinator.dismissAvailable()}
        >
          {copy.later}
        </button>
        <button
          type="button"
          {...stylex.props(styles.button, styles.primary)}
          onClick={() => coordinator.reload()}
        >
          {copy.reloadNow}
        </button>
      </div>
    </div>
  )
}
