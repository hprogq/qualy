import type { ReactNode } from 'react'
import { cn } from '../../lib/cn.ts'
import { PageHeader } from '../admin/page.tsx'
import { PageContainer } from '../page-container.tsx'
import { Tabs, TabsList, TabsTrigger } from '../tabs.tsx'

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
      <div className="shrink-0 border-b bg-background">
        <PageContainer size={size} className="py-5">
          <PageHeader
            title={title}
            {...(description === undefined ? {} : { description })}
            {...(actions === undefined ? {} : { actions })}
            variant="banner"
          />
        </PageContainer>
      </div>
      <PageContainer size={size} className="flex flex-col gap-5">
        {children}
      </PageContainer>
    </>
  )
}

/**
 * A choice between a few views of the same page.
 *
 * The product's tab list, not a hand-rolled one: it stands 36px tall like
 * every button and field beside it, which is the whole reason a filter row
 * reads as one row.
 */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: T
  onChange: (next: T) => void
  options: readonly { value: T; label: string }[]
  /** spoken name for the group; the options name themselves */
  label: string
  className?: string
}) {
  return (
    <Tabs
      value={value}
      onValueChange={(next) => onChange(next as T)}
      className={cn('shrink-0', className)}
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
