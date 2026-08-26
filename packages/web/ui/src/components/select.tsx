'use client'

import * as React from 'react'
import { Combobox, InputBase as MInputBase, InputPlaceholder, useCombobox } from '@mantine/core'
import * as stylex from '@stylexjs/stylex'
import type { StyleXStyles } from '@stylexjs/stylex'
import { clsx } from 'clsx'

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
      // parity with the previous substrate: the dropdown stays visible even
      // if the trigger leaves the viewport (hideDetached would blank it)
      hideDetached={false}
      // a closed list leaves the document entirely - a hidden copy of every
      // option is a phantom for tests and assistive tech alike
      keepMounted={false}
      transitionProps={{ transition: 'pop', duration: 130 }}
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

// The trigger's own width opinion lives in its StyleX base, where an xstyle
// override wins property by property in the same composition. It used to be
// a utility class, which sat in the layer ABOVE consumer StyleX and forced
// every caller that sized a field back into Tailwind strings.
const triggerStyles = stylex.create({
  base: {
    // fit by default, as the closed control has always been: the caller
    // whose field must fill or fix its width says so through xstyle
    width: 'fit-content',
  },
})

function SelectTrigger({
  className,
  xstyle,
  size = 'default',
  children,
  onKeyDown,
  'aria-invalid': ariaInvalid,
  ...props
}: React.ComponentProps<'button'> & {
  size?: 'sm' | 'default'
  /**
   * The standard StyleX seat, composed over the trigger's base styles -
   * sizing a field is its main use. `className` stays as the legacy escape
   * hatch: its utilities still win by cascade for callers not yet on
   * StyleX, but that is the layer contract, not a promise of this API.
   */
  xstyle?: StyleXStyles
}) {
  const { disabled, opened, toggle } = useSelect()
  // the product marks invalid controls with aria-invalid; the widget wants
  // its own error prop
  const invalid = ariaInvalid === true || ariaInvalid === 'true'
  const sx = stylex.props(triggerStyles.base, xstyle)
  return (
    <Combobox.Target>
      <MInputBase
        component="button"
        type="button"
        role="combobox"
        aria-expanded={opened}
        pointer
        data-slot="select-trigger"
        data-size={size}
        size={size === 'sm' ? 'xs' : 'sm'}
        style={sx.style}
        className={clsx(sx.className, className)}
        {...(invalid ? { error: true } : {})}
        disabled={disabled}
        rightSection={<Combobox.Chevron />}
        rightSectionPointerEvents="none"
        onClick={toggle}
        onKeyDown={(event) => {
          onKeyDown?.(event)
          // while the list is open the Escape answered here must not also
          // close a modal underneath; when it is closed, it may
          if (event.key === 'Escape' && opened) event.stopPropagation()
        }}
        {...props}
      >
        {children}
      </MInputBase>
    </Combobox.Target>
  )
}

function SelectValue({ placeholder }: { placeholder?: React.ReactNode }) {
  const { value, items } = useSelect()
  const chosen = value !== undefined && items.has(value) ? items.get(value) : undefined
  if (chosen === undefined) return <InputPlaceholder>{placeholder}</InputPlaceholder>
  return (
    <span
      data-slot="select-value"
      className="flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap"
    >
      {chosen}
    </span>
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
      // presses inside this layer belong to it: a menu or popover BENEATH
      // listens for outside presses on mousedown, and a portal makes this
      // list "outside" - without the stop, holding the mouse on an option
      // unmounted everything under the cursor before the click could land
      onMouseDown={(event) => event.stopPropagation()}
      onTouchStart={(event) => event.stopPropagation()}
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
      // structure only - the reserved indicator seat and the row's shape;
      // hover, active and disabled looks are the widget's own
      className={cn('relative flex w-full items-center gap-2.5 pr-8', className)}
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
