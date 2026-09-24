import { Fragment } from 'react'
import * as stylex from '@stylexjs/stylex'
import { PageLink, usePageHref } from '@qualy/web-runtime'
import { tokens } from '@qualy/ui/theme/tokens.stylex'

// Where somebody stands, spelled from the top, each step a way to that unit's
// own roster. A reader who may not open the roster reads the same path as
// plain words: the path is a fact first and a set of links second.

const styles = stylex.create({
  path: {
    display: 'inline-flex',
    minWidth: 0,
    flexWrap: 'wrap',
    alignItems: 'baseline',
    columnGap: 6,
  },
  slash: { color: `color-mix(in oklab, ${tokens.mutedForeground} 60%, transparent)` },
  step: {
    color: tokens.mutedForeground,
    textDecorationLine: { default: 'none', ':hover': 'underline' },
    textUnderlineOffset: 3,
  },
  last: { color: tokens.foreground },
})

export function PlacementPath({
  steps,
  empty,
}: {
  /** root first, the unit they stand at last */
  steps: readonly { readonly id: string; readonly name: string }[]
  empty: string
}) {
  const reachable = usePageHref('auth/users') !== undefined
  if (steps.length === 0) return <>{empty}</>
  return (
    <span {...stylex.props(styles.path)} data-testid="placement-path">
      {steps.map((step, index) => {
        const look = stylex.props(styles.step, index === steps.length - 1 && styles.last)
        return (
          <Fragment key={step.id}>
            {index > 0 && (
              <span aria-hidden {...stylex.props(styles.slash)}>
                /
              </span>
            )}
            {reachable ? (
              <PageLink
                page="auth/users"
                search={{ anchor: step.id }}
                className={look.className}
                data-path-step={step.id}
              >
                {step.name}
              </PageLink>
            ) : (
              <span {...look}>{step.name}</span>
            )}
          </Fragment>
        )
      })}
    </span>
  )
}
