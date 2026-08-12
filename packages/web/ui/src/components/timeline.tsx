import * as React from 'react'

import { cn } from '../lib/utils.ts'

// Events in the order they happen: a rail, a marker per event, and whatever
// each event has to say.
//
// The markup and the class names are reui's timeline (reui.io/r/timeline),
// with its render-prop polymorphism left out - nothing here needs to become
// another element, and taking it meant taking a second component library
// into a package that already has one.
//
// Which events are behind the reader is stated rather than counted: the
// caller sets `value` to the step it has reached, and every item at or below
// it draws as done. That is the whole of the state; a timeline knows nothing
// about what its events are.

interface TimelineContextValue {
  activeStep: number
}

const TimelineContext = React.createContext<TimelineContextValue | undefined>(undefined)

const useTimeline = () => {
  const context = React.useContext(TimelineContext)
  if (!context) throw new Error('useTimeline must be used within a Timeline')
  return context
}

function Timeline({
  value = 1,
  orientation = 'vertical',
  className,
  children,
  ...props
}: React.ComponentProps<'div'> & {
  /** the step the reader has got to; everything up to it draws as done */
  value?: number
  orientation?: 'horizontal' | 'vertical'
}) {
  return (
    <TimelineContext value={{ activeStep: value }}>
      <div
        data-slot="timeline"
        data-orientation={orientation}
        className={cn(
          'group/timeline flex data-[orientation=horizontal]:w-full data-[orientation=horizontal]:flex-row data-[orientation=vertical]:flex-col',
          className,
        )}
        {...props}
      >
        {children}
      </div>
    </TimelineContext>
  )
}

function TimelineItem({
  step,
  className,
  children,
  ...props
}: React.ComponentProps<'div'> & { step: number }) {
  const { activeStep } = useTimeline()
  return (
    <div
      data-slot="timeline-item"
      data-completed={step <= activeStep || undefined}
      className={cn(
        'group/timeline-item relative flex flex-1 flex-col gap-0.5 group-data-[orientation=horizontal]/timeline:mt-8 group-data-[orientation=vertical]/timeline:ms-8 group-data-[orientation=horizontal]/timeline:not-last:pe-8 group-data-[orientation=vertical]/timeline:not-last:pb-6 has-[+[data-completed]]:**:data-[slot=timeline-separator]:bg-primary',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}

function TimelineHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="timeline-header" className={cn(className)} {...props} />
}

function TimelineDate({ className, ...props }: React.ComponentProps<'time'>) {
  return (
    <time
      data-slot="timeline-date"
      className={cn(
        'mb-1 block text-xs font-medium text-muted-foreground group-data-[orientation=vertical]/timeline:max-sm:h-4',
        className,
      )}
      {...props}
    />
  )
}

function TimelineTitle({ className, ...props }: React.ComponentProps<'h3'>) {
  return (
    <h3 data-slot="timeline-title" className={cn('text-sm font-medium', className)} {...props} />
  )
}

function TimelineContent({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="timeline-content"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  )
}

function TimelineIndicator({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      aria-hidden
      data-slot="timeline-indicator"
      className={cn(
        'absolute size-4 rounded-full border-2 border-primary/20 group-data-completed/timeline-item:border-primary group-data-[orientation=horizontal]/timeline:-top-6 group-data-[orientation=horizontal]/timeline:left-0 group-data-[orientation=horizontal]/timeline:-translate-y-1/2 group-data-[orientation=vertical]/timeline:top-0 group-data-[orientation=vertical]/timeline:-left-6 group-data-[orientation=vertical]/timeline:-translate-x-1/2',
        className,
      )}
      {...props}
    />
  )
}

function TimelineSeparator({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      aria-hidden
      data-slot="timeline-separator"
      className={cn(
        'absolute self-start bg-primary/10 group-last/timeline-item:hidden group-data-[orientation=horizontal]/timeline:-top-6 group-data-[orientation=horizontal]/timeline:h-0.5 group-data-[orientation=horizontal]/timeline:w-[calc(100%-1rem-0.25rem)] group-data-[orientation=horizontal]/timeline:translate-x-4.5 group-data-[orientation=horizontal]/timeline:-translate-y-1/2 group-data-[orientation=vertical]/timeline:h-[calc(100%-1rem-0.25rem)] group-data-[orientation=vertical]/timeline:w-0.5 group-data-[orientation=vertical]/timeline:-left-6 group-data-[orientation=vertical]/timeline:translate-y-4.5 group-data-[orientation=vertical]/timeline:-translate-x-1/2',
        className,
      )}
      {...props}
    />
  )
}

export {
  Timeline,
  TimelineContent,
  TimelineDate,
  TimelineHeader,
  TimelineIndicator,
  TimelineItem,
  TimelineSeparator,
  TimelineTitle,
}
