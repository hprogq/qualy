'use client'

import * as React from 'react'
import { Combobox, useCombobox } from '@mantine/core'

import { cn } from '../lib/utils.ts'
import { ChevronDownIcon, CheckIcon } from 'lucide-react'

// The Qualy select keeps its compound shape (Root/Trigger/Value/Content/
// Item) over the widget combobox, whose option model is children-registered
// like the API itself - no option arrays, no index maps. The one derived
// structure is the closed trigger's echo: options live in a portal that only
// exists while the list is open, so the root reads its declared items once
// per render to know what the chosen value looks like as a label.
//
// Escape layering: focus stays on the trigger while the list is open (the
// combobox pattern), so the trigger stops a handled Escape from travelling
// on to a modal's window listener - one press, one layer.

interface SelectState {
  value: string | undefined
  onValueChange?: (value: string) => void
  disabled: boolean
  items: ReadonlyMap<string, React.ReactNode>
  opened: boolean
  toggle: () => void
}
const SelectCtx = React.createContext<SelectState | null>(null)

function useSelect(): SelectState {
  const ctx = React.use(SelectCtx)
  if (ctx === null) throw new Error('Select components must sit inside <Select>')
  return ctx
}

interface ItemDecl {
  value: string
  children?: React.ReactNode
}

function collectItems(node: React.ReactNode, out: Map<string, React.ReactNode>): void {
  React.Children.forEach(node, (child) => {
    if (!React.isValidElement(child)) return
    const props = child.props as ItemDecl & { children?: React.ReactNode }
    if (child.type === SelectItem && typeof props.value === 'string') {
      out.set(props.value, props.children)
      return
    }
    if (props.children !== undefined) collectItems(props.children, out)
  })
}

function Select({
  value,
  defaultValue,
  onValueChange,
  disabled = false,
  children,
}: {
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  disabled?: boolean
  children?: React.ReactNode
}) {
  const [inner, setInner] = React.useState(defaultValue)
  const [opened, setOpened] = React.useState(false)
  const store = useCombobox({
    onDropdownOpen: () => setOpened(true),
    onDropdownClose: () => setOpened(false),
  })
  const chosen = value ?? inner
  const items = new Map<string, React.ReactNode>()
  collectItems(children, items)
  const state = React.useMemo<SelectState>(
    () => ({
      value: chosen,
      ...(onValueChange === undefined ? {} : { onValueChange }),
      disabled,
      items,
      opened,
      toggle: () => store.toggleDropdown(),
    }),
    // the item map is rebuilt each render by design; identity is not stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chosen, onValueChange, disabled, opened, children],
  )
  return (
    <Combobox
      store={store}
      withinPortal
      // a closed list leaves the document entirely - a hidden copy of every
      // option is a phantom for tests and assistive tech alike
      keepMounted={false}
      transitionProps={{ duration: 100 }}
      disabled={disabled}
      onOptionSubmit={(next) => {
        setInner(next)
        onValueChange?.(next)
        store.closeDropdown()
      }}
    >
      <SelectCtx value={state}>{children}</SelectCtx>
    </Combobox>
  )
}

function SelectTrigger({
  className,
  size = 'default',
  children,
  onKeyDown,
  ...props
}: React.ComponentProps<'button'> & {
  size?: 'sm' | 'default'
}) {
  const { value, disabled, opened, toggle } = useSelect()
  const empty = value === undefined || value === ''
  return (
    <Combobox.Target>
      <button
        type="button"
        role="combobox"
        aria-expanded={opened}
        data-slot="select-trigger"
        data-size={size}
        {...(empty ? { 'data-placeholder': '' } : {})}
        disabled={disabled}
        onClick={toggle}
        onKeyDown={(event) => {
          onKeyDown?.(event)
          // while the list is open the Escape answered here must not also
          // close a modal underneath; when it is closed, it may
          if (event.key === 'Escape' && opened) event.stopPropagation()
        }}
        className={cn(
          "flex w-fit items-center justify-between gap-1.5 rounded-4xl border border-input bg-input/30 px-3 py-2 text-sm whitespace-nowrap transition-colors outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-[3px] aria-invalid:ring-destructive/20 data-placeholder:text-muted-foreground data-[size=default]:h-9 data-[size=sm]:h-8 *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-1.5 dark:hover:bg-input/50 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
          className,
        )}
        {...props}
      >
        {children}
        <ChevronDownIcon aria-hidden className="pointer-events-none size-4 text-muted-foreground" />
      </button>
    </Combobox.Target>
  )
}

function SelectValue({ placeholder }: { placeholder?: React.ReactNode }) {
  const { value, items } = useSelect()
  const chosen = value !== undefined && items.has(value) ? items.get(value) : undefined
  return (
    <span data-slot="select-value">{chosen === undefined ? (placeholder ?? null) : chosen}</span>
  )
}

function SelectContent({
  className,
  children,
}: React.ComponentProps<'div'> & {
  /** kept for call-site compatibility; the widget positions the list */
  position?: string
  align?: string
}) {
  return (
    <Combobox.Dropdown
      data-slot="select-content"
      // structure only; the surface is the widget's own under the theme
      className={cn('max-h-72 min-w-36 overflow-x-hidden overflow-y-auto', className)}
    >
      <Combobox.Options>{children}</Combobox.Options>
    </Combobox.Dropdown>
  )
}

function SelectItem({
  className,
  children,
  description,
  value,
  disabled,
  textValue: _textValue,
  ...props
}: React.ComponentProps<'div'> & {
  value: string
  disabled?: boolean
  textValue?: string
  /**
   * A grey second line under the label, shown in the open list only: the
   * closed trigger echoes the label alone, so the choice stays one line
   * where the room is one line and explains itself where there is room to.
   */
  description?: React.ReactNode
}) {
  const { value: chosen } = useSelect()
  const selected = chosen === value
  return (
    <Combobox.Option
      value={value}
      {...(disabled === undefined ? {} : { disabled })}
      data-slot="select-item"
      className={cn(
        "relative flex w-full cursor-default items-center gap-2.5 rounded-xl py-2 pr-8 pl-3 text-sm outline-hidden select-none data-combobox-active:bg-accent data-combobox-active:text-accent-foreground data-combobox-active:**:text-accent-foreground data-combobox-disabled:pointer-events-none data-combobox-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      {/* the indicator seat is always reserved, so choosing never reflows the row */}
      <span
        aria-hidden
        className="pointer-events-none absolute right-2 flex size-4 items-center justify-center"
      >
        {selected && <CheckIcon className="pointer-events-none" />}
      </span>
      {description === undefined ? (
        <span data-slot="select-item-text">{children}</span>
      ) : (
        <span className="flex min-w-0 flex-col items-start gap-0.5 text-left">
          <span data-slot="select-item-text">{children}</span>
          <span className="text-xs text-muted-foreground">{description}</span>
        </span>
      )}
    </Combobox.Option>
  )
}

function SelectGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      role="group"
      data-slot="select-group"
      className={cn('scroll-my-1 p-1', className)}
      {...props}
    />
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

function SelectSeparator({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="select-separator"
      aria-hidden
      className={cn('pointer-events-none -mx-1 my-1 h-px bg-border/50', className)}
      {...props}
    />
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
}
