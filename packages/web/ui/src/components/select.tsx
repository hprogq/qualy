'use client'

import * as React from 'react'
import { Select as PrimeSelect, useSelectContext } from '@primereact/ui/select'
import { CheckIcon, ChevronDownIcon } from 'lucide-react'

import { cn } from '../lib/utils.ts'

// The product select over Prime's compound select, with two impedance
// matches the adapter absorbs. Prime's options are a data array on the
// root and its Option parts are views over it, so the adapter walks its
// children and registers what it finds. And Prime's styled field box is
// the ROOT element - the trigger inside is bare - so the classes and size
// callers put on SelectTrigger are lifted onto the root where the theme
// expects them.

interface ItemEntry {
  value: string
  disabled?: boolean
  node: React.ReactNode
  index: number
}

const ItemsContext = React.createContext<ReadonlyMap<string, ItemEntry> | null>(null)

function collectItems(children: React.ReactNode, out: ItemEntry[]): void {
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return
    const props = child.props as {
      value?: string
      disabled?: boolean
      children?: React.ReactNode
    }
    if (child.type === SelectItem && typeof props.value === 'string') {
      out.push({
        value: props.value,
        disabled: props.disabled,
        node: props.children,
        index: out.length,
      })
      return
    }
    if (props.children !== undefined) collectItems(props.children, out)
  })
}

function triggerStyleOf(children: React.ReactNode): {
  className?: string
  size?: 'sm' | 'default'
} {
  let found: { className?: string; size?: 'sm' | 'default' } | undefined
  const walk = (node: React.ReactNode): void => {
    React.Children.forEach(node, (child) => {
      if (found !== undefined || !React.isValidElement(child)) return
      const props = child.props as {
        className?: string
        size?: 'sm' | 'default'
        children?: React.ReactNode
      }
      if (child.type === SelectTrigger) {
        found = { className: props.className, size: props.size }
        return
      }
      if (props.children !== undefined) walk(props.children)
    })
  }
  walk(children)
  return found ?? {}
}

function Select({
  value,
  defaultValue,
  onValueChange,
  children,
  ...props
}: {
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  disabled?: boolean
  name?: string
  required?: boolean
  children?: React.ReactNode
}) {
  const entries: ItemEntry[] = []
  collectItems(children, entries)
  const byValue = new Map(entries.map((entry) => [entry.value, entry]))
  const trigger = triggerStyleOf(children)
  return (
    <ItemsContext.Provider value={byValue}>
      <PrimeSelect.Root
        options={entries.map((entry) => ({ value: entry.value, disabled: entry.disabled }))}
        optionKey="value"
        optionValue="value"
        optionLabel="value"
        optionDisabled="disabled"
        {...(trigger.size === 'sm' ? { size: 'small' as const } : {})}
        {...(trigger.className === undefined ? {} : { className: cn('w-fit', trigger.className) })}
        {...(value === undefined ? {} : { value })}
        {...(defaultValue === undefined ? {} : { defaultValue })}
        {...(onValueChange === undefined
          ? {}
          : { onValueChange: (event: { value?: unknown }) => onValueChange(String(event.value)) })}
        {...props}
      >
        {children}
      </PrimeSelect.Root>
    </ItemsContext.Provider>
  )
}

function SelectGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="select-group" className={cn('scroll-my-1 p-1', className)} {...props} />
}

// The closed trigger echoes the chosen item's own markup, exactly as the
// Radix ItemText echo did; Prime renders the placeholder when nothing is.
function SelectValue({
  placeholder,
  ...props
}: React.ComponentProps<'span'> & { placeholder?: string }) {
  const select = useSelectContext() as { state?: { value?: unknown } } | null
  const items = React.useContext(ItemsContext)
  const value = select?.state?.value
  const chosen =
    typeof value === 'string' && items?.has(value) === true ? items.get(value)?.node : undefined
  return (
    <PrimeSelect.Value {...(placeholder === undefined ? {} : { placeholder })} {...props}>
      {chosen === undefined ? undefined : <>{chosen}</>}
    </PrimeSelect.Value>
  )
}

function SelectTrigger({
  className: _className,
  size: _size = 'default',
  children,
  ...props
}: React.ComponentProps<'button'> & {
  size?: 'sm' | 'default'
}) {
  // className and size were lifted onto the root by the Select adapter,
  // where Prime's theme reads them; the trigger itself stays bare
  return (
    <PrimeSelect.Trigger type="button" data-slot="select-trigger" {...props}>
      {children}
      <PrimeSelect.Indicator>
        <ChevronDownIcon className="pointer-events-none size-4 text-muted-foreground" />
      </PrimeSelect.Indicator>
    </PrimeSelect.Trigger>
  )
}

function SelectContent({
  className,
  children,
  ...props
}: React.ComponentProps<'div'> & {
  position?: 'item-aligned' | 'popper'
  align?: 'start' | 'center' | 'end'
}) {
  const { position: _position, align, ...rest } = props
  return (
    <PrimeSelect.Portal>
      <PrimeSelect.Positioner sideOffset={4} {...(align === undefined ? {} : { align })}>
        <PrimeSelect.Popup
          data-slot="select-content"
          className={cn('min-w-36', className)}
          {...rest}
        >
          <PrimeSelect.List>{children}</PrimeSelect.List>
        </PrimeSelect.Popup>
      </PrimeSelect.Positioner>
    </PrimeSelect.Portal>
  )
}

function SelectLabel({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="select-label"
      className={cn('px-3 py-2.5 text-xs text-muted-foreground', className)}
      {...props}
    />
  )
}

function SelectItem({
  className,
  children,
  description,
  value,
  disabled: _disabled,
  ...props
}: React.ComponentProps<'div'> & {
  value: string
  disabled?: boolean
  /**
   * A grey second line under the label, shown in the open list only: the
   * closed trigger echoes the label alone, so the choice stays one line
   * where the room is one line and explains itself where there is room to.
   */
  description?: React.ReactNode
}) {
  const items = React.useContext(ItemsContext)
  const index = items?.get(value)?.index
  return (
    <PrimeSelect.Option
      // the option data itself lives on the root; the key and index pair
      // this view with its entry there. Prime's theme paints the row.
      uKey={value}
      {...(index === undefined ? {} : { index })}
      data-slot="select-item"
      className={cn("[&_svg:not([class*='size-'])]:size-4", className)}
      {...props}
    >
      {description === undefined ? (
        <span data-slot="select-item-text">{children}</span>
      ) : (
        <span className="flex min-w-0 flex-col gap-0.5 text-left">
          <span data-slot="select-item-text">{children}</span>
          <span data-slot="select-item-description" className="text-xs text-muted-foreground">
            {description}
          </span>
        </span>
      )}
      {/* always in the row so a selection never shifts the layout; the
          unselected mark is invisible, not absent */}
      <PrimeSelect.OptionIndicator className="ml-auto data-unselected:invisible">
        <CheckIcon className="pointer-events-none size-4" />
      </PrimeSelect.OptionIndicator>
    </PrimeSelect.Option>
  )
}

function SelectSeparator({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="select-separator"
      className={cn('pointer-events-none -mx-1 my-1 h-px bg-border/50', className)}
      {...props}
    />
  )
}

// Prime's list scrolls natively; the Radix scroll chrome has no equivalent
// and nothing outside this file composed it, so the exports stay for the
// surface and render nothing.
function SelectScrollUpButton(_props: React.ComponentProps<'div'>) {
  return null
}

function SelectScrollDownButton(_props: React.ComponentProps<'div'>) {
  return null
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
}
