import type { ReactNode } from 'react'
import * as stylex from '@stylexjs/stylex'
import type { StyleXStyles } from '@stylexjs/stylex'
import { tokens } from '../../theme/tokens.stylex.ts'
import { PageHeader } from '../admin/page.tsx'
import { PageContainer } from '../page-container.tsx'
import { Tabs, TabsList, TabsTrigger } from '../tabs.tsx'

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
 * A tablist, not a radio group: each option swaps what the page shows, and
 * that is what a reader's screen reader should hear. The widget's segmented
 * control is the right shape for choosing a VALUE, which is a different
 * question from choosing a VIEW.
 *
 * It wears the segmented look because this is what a filter row asks for -
 * and because these appear in pairs. Two underlined rows side by side read
 * as one tablist with two things selected at once.
 */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  xstyle,
}: {
  value: T
  onChange: (next: T) => void
  options: readonly { value: T; label: ReactNode }[]
  /** spoken name for the group; the options name themselves */
  label: string
  xstyle?: StyleXStyles
}) {
  return (
    <Tabs
      variant="segmented"
      value={value}
      onValueChange={(next) => onChange(next as T)}
      xstyle={xstyle}
    >
      <TabsList aria-label={label}>
        {options.map((option) => (
          <TabsTrigger key={option.value} value={option.value}>
            {option.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}
