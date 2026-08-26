'use client'

import * as React from 'react'
import { Menu as MMenu } from '@mantine/core'

import { cn } from '../lib/utils.ts'
import { CheckIcon, ChevronRightIcon } from 'lucide-react'

// The Qualy dropdown menu keeps its compound shape over the widget menu,
// which shares the model almost part for part. Escape layering: while the
// menu is open, an Escape answered here must not also reach the window
// listener a modal underneath uses - the dropdown stops its propagation
// after the menu has handled it, so each press peels exactly one layer.

const OpenedCtx = React.createContext(false)

function DropdownMenu({
  open,
  defaultOpen,
  onOpenChange,
  children,
}: {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  children?: React.ReactNode
}) {
  const [inner, setInner] = React.useState(defaultOpen ?? false)
  const opened = open ?? inner
  return (
    <MMenu
      withinPortal
      offset={4}
      // parity with the previous substrate: the dropdown stays visible even
      // if the trigger leaves the viewport (hideDetached would blank it)
      hideDetached={false}
      transitionProps={{ transition: 'pop', duration: 130 }}
      {...(open === undefined ? {} : { opened: open })}
      {...(defaultOpen === undefined ? {} : { defaultOpened: defaultOpen })}
      onOpen={() => {
        setInner(true)
        onOpenChange?.(true)
      }}
      onClose={() => {
        setInner(false)
        onOpenChange?.(false)
      }}
      position="bottom-start"
    >
      <OpenedCtx value={opened}>{children}</OpenedCtx>
    </MMenu>
  )
}

function DropdownMenuTrigger({
  asChild = false,
  children,
  ...props
}: React.ComponentProps<'button'> & { asChild?: boolean }) {
  const opened = React.use(OpenedCtx)
  const child = asChild ? (
    (React.Children.only(children) as React.ReactElement<Record<string, unknown>>)
  ) : (
    <button type="button" data-slot="dropdown-menu-trigger" {...props}>
      {children}
    </button>
  )
  // the previous substrate said open on the trigger with data-state; kept,
  // because trigger styling keys on it
  return (
    <MMenu.Target>
      {React.cloneElement(child, {
        'data-state': opened ? 'open' : 'closed',
      } as Record<string, unknown>)}
    </MMenu.Target>
  )
}

function DropdownMenuContent({
  className,
  children,
  ...props
}: React.ComponentProps<'div'> & {
  align?: 'start' | 'center' | 'end'
  side?: 'top' | 'right' | 'bottom' | 'left'
  sideOffset?: number
}) {
  const opened = React.use(OpenedCtx)
  const { align: _align, side: _side, sideOffset: _sideOffset, ...rest } = props
  return (
    <MMenu.Dropdown
      data-slot="dropdown-menu-content"
      // presses inside this layer belong to it: a menu or popover BENEATH
      // listens for outside presses on mousedown, and a portal makes this
      // list "outside" - without the stop, holding the mouse on an option
      // unmounted everything under the cursor before the click could land
      onMouseDown={(event) => event.stopPropagation()}
      onTouchStart={(event) => event.stopPropagation()}
      // while open, the Escape the menu answers stops here instead of
      // travelling on to a modal's window listener underneath
      onKeyDown={(event) => {
        if (event.key === 'Escape' && opened) event.stopPropagation()
      }}
      className={cn('min-w-48 overflow-x-hidden overflow-y-auto', className)}
      {...rest}
    >
      {children}
    </MMenu.Dropdown>
  )
}

// the widget marks the active row with data-hovered, whether it got there
// by pointer or by arrow keys; the product accent follows that mark
const itemClasses =
  "group/dropdown-menu-item relative flex w-full cursor-default items-center gap-2.5 rounded-xl px-3 py-2 text-sm outline-hidden select-none data-hovered:bg-accent data-hovered:text-accent-foreground not-data-[variant=destructive]:data-hovered:**:text-accent-foreground data-[variant=destructive]:text-destructive data-[variant=destructive]:data-hovered:bg-destructive/10 data-[variant=destructive]:data-hovered:text-destructive dark:data-[variant=destructive]:data-hovered:bg-destructive/20 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 data-[variant=destructive]:*:[svg]:text-destructive"

function DropdownMenuItem({
  className,
  inset,
  variant = 'default',
  onSelect,
  disabled,
  ...props
}: React.ComponentProps<'button'> & {
  inset?: boolean
  variant?: 'default' | 'destructive'
  onSelect?: () => void
}) {
  return (
    <MMenu.Item
      data-slot="dropdown-menu-item"
      data-inset={inset}
      data-variant={variant}
      {...(disabled === undefined ? {} : { disabled })}
      {...(onSelect === undefined ? {} : { onClick: onSelect })}
      className={cn(itemClasses, 'data-inset:pl-9.5', className)}
      {...props}
    />
  )
}

function DropdownMenuCheckboxItem({
  className,
  children,
  checked,
  inset,
  onCheckedChange,
  disabled,
  ...props
}: React.ComponentProps<'button'> & {
  inset?: boolean
  checked?: boolean
  onCheckedChange?: (checked: boolean) => void
}) {
  return (
    <MMenu.Item
      role="menuitemcheckbox"
      aria-checked={checked === true}
      data-slot="dropdown-menu-checkbox-item"
      data-inset={inset}
      closeMenuOnClick={false}
      {...(disabled === undefined ? {} : { disabled })}
      onClick={() => onCheckedChange?.(!(checked === true))}
      className={cn(itemClasses, 'py-2 pr-8 pl-3 data-inset:pl-9.5', className)}
      {...props}
    >
      <span
        className="pointer-events-none absolute right-2 flex items-center justify-center"
        data-slot="dropdown-menu-checkbox-item-indicator"
      >
        {checked === true && <CheckIcon />}
      </span>
      {children}
    </MMenu.Item>
  )
}

const RadioCtx = React.createContext<{
  value: string | null
  onValueChange?: (value: string) => void
}>({ value: null })

function DropdownMenuRadioGroup({
  value,
  onValueChange,
  children,
}: {
  value?: string
  onValueChange?: (value: string) => void
  children?: React.ReactNode
}) {
  return (
    <div role="group" data-slot="dropdown-menu-radio-group">
      <RadioCtx
        value={{ value: value ?? null, ...(onValueChange === undefined ? {} : { onValueChange }) }}
      >
        {children}
      </RadioCtx>
    </div>
  )
}

function DropdownMenuRadioItem({
  className,
  children,
  inset,
  value,
  disabled,
  ...props
}: React.ComponentProps<'button'> & {
  inset?: boolean
  value: string
}) {
  const group = React.use(RadioCtx)
  const checked = group.value === value
  return (
    <MMenu.Item
      role="menuitemradio"
      aria-checked={checked}
      data-slot="dropdown-menu-radio-item"
      data-inset={inset}
      {...(disabled === undefined ? {} : { disabled })}
      onClick={() => group.onValueChange?.(value)}
      className={cn(itemClasses, 'py-2 pr-8 pl-3 data-inset:pl-9.5', className)}
      {...props}
    >
      <span
        className="pointer-events-none absolute right-2 flex items-center justify-center"
        data-slot="dropdown-menu-radio-item-indicator"
      >
        {checked && <CheckIcon />}
      </span>
      {children}
    </MMenu.Item>
  )
}

function DropdownMenuLabel({
  className,
  inset,
  ...props
}: React.ComponentProps<'div'> & { inset?: boolean }) {
  return (
    <MMenu.Label
      data-slot="dropdown-menu-label"
      data-inset={inset}
      className={cn('px-3 py-2.5 text-xs text-muted-foreground data-inset:pl-9.5', className)}
      {...props}
    />
  )
}

function DropdownMenuSeparator({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <MMenu.Divider
      data-slot="dropdown-menu-separator"
      className={cn('-mx-1 my-1 border-border/50', className)}
      {...props}
    />
  )
}

function DropdownMenuShortcut({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="dropdown-menu-shortcut"
      className={cn('ml-auto text-xs tracking-widest text-muted-foreground', className)}
      {...props}
    />
  )
}

function DropdownMenuGroup({ children }: { children?: React.ReactNode }) {
  return (
    <div role="group" data-slot="dropdown-menu-group">
      {children}
    </div>
  )
}

function DropdownMenuSub({ children }: { children?: React.ReactNode }) {
  return (
    <MMenu.Sub offset={6} position="right-start">
      {children}
    </MMenu.Sub>
  )
}

function DropdownMenuSubTrigger({
  className,
  inset,
  children,
}: React.ComponentProps<'button'> & { inset?: boolean }) {
  return (
    <MMenu.Sub.Target>
      <MMenu.Sub.Item
        data-slot="dropdown-menu-sub-trigger"
        data-inset={inset}
        className={cn(itemClasses, 'gap-2 data-inset:pl-9.5', className)}
        rightSection={<ChevronRightIcon className="ml-auto" />}
      >
        {children}
      </MMenu.Sub.Item>
    </MMenu.Sub.Target>
  )
}

function DropdownMenuSubContent({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <MMenu.Sub.Dropdown
      data-slot="dropdown-menu-sub-content"
      className={cn('min-w-36 overflow-hidden', className)}
      {...props}
    />
  )
}

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
}
