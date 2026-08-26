import type { ReactNode } from 'react'
import * as stylex from '@stylexjs/stylex'
import type { StyleXStyles } from '@stylexjs/stylex'
import { tokens } from '../../theme/tokens.stylex.ts'
import { PageHeader } from '../admin/page.tsx'
import { PageContainer } from '../page-container.tsx'
import { SegmentedControl } from '@mantine/core'

const styles = stylex.create({
  band: {
    flexShrink: 0,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.border,
    backgroundColor: tokens.background,
  },
  // the band's own rhythm: tighter than a page body
  bandInset: {
    paddingBlock: 20,
  },
  stack: {
    display: 'flex',
    flexDirection: 'column',
    gap: 20,
  },
  pinned: {
    flexShrink: 0,
  },
})

export function Screen({
  title,
  description,
  actions,
  size = 'default',
  children,
}: {
  title: ReactNode
  description?: ReactNode
  /** what this page offers as a whole: a view switch, an import, a create */
  actions?: ReactNode
  size?: 'default' | 'wide' | 'full'
  children: ReactNode
}) {
  return (
    <>
      {/* edge to edge: a band inset inside the page's own width is a card
          pretending to be a header */}
      <div {...stylex.props(styles.band)}>
        <PageContainer size={size} xstyle={styles.bandInset}>
          <PageHeader
            title={title}
            {...(description === undefined ? {} : { description })}
            {...(actions === undefined ? {} : { actions })}
            variant="banner"
          />
        </PageContainer>
      </div>
      <PageContainer size={size} xstyle={styles.stack}>
        {children}
      </PageContainer>
    </>
  )
}

/**
 * A choice between a few views of the same page.
 *
 * The widget's segmented control - a sliding thumb over radio semantics -
 * standing 36px tall like every button and field beside it, which is the
 * whole reason a filter row reads as one row.
 */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  fill = false,
  xstyle,
}: {
  value: T
  onChange: (next: T) => void
  options: readonly { value: T; label: ReactNode }[]
  /** spoken name for the group; the options name themselves */
  label: string
  /** stretch across the row instead of hugging the options */
  fill?: boolean
  xstyle?: StyleXStyles
}) {
  const sx = stylex.props(styles.pinned, xstyle)
  return (
    <SegmentedControl
      value={value}
      onChange={(next) => onChange(next as T)}
      data={options.map((option) => ({ value: option.value, label: option.label }))}
      aria-label={label}
      fullWidth={fill}
      className={sx.className}
      style={sx.style}
    />
  )
}
