'use client'

import * as React from 'react'
import { Menu as PrimeMenu } from '@primereact/ui/menu'
import { Slot } from 'radix-ui'
import { CheckIcon, ChevronRightIcon } from 'lucide-react'

import { cn } from '../lib/utils.ts'

// The product dropdown menu over Prime's compound menu. The Radix-shaped
// surface stays for the fourteen screens that compose it. Prime highlights
// items with a class rather than real focus, so the state-dependent looks
// (highlight, destructive, disabled) live in the theme preset keyed on
// Prime's own markers; the geometry classes ride over verbatim.

function DropdownMenu({
  open,
  defaultOpen,
  onOpenChange,
  children,
}: {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  modal?: boolean
  children?: React.ReactNode
}) {
  return (
    <PrimeMenu.Root
      {...(open === undefined ? {} : { open })}
      {...(defaultOpen === undefined ? {} : { defaultOpen })}
      {...(onOpenChange === undefined
        ? {}
        : { onOpenChange: (event: { value?: boolean }) => onOpenChange(Boolean(event.value)) })}
    >
      {children}
    </PrimeMenu.Root>
  )
}

function DropdownMenuPortal({ children }: { children?: React.ReactNode }) {
  return <PrimeMenu.Portal>{children}</PrimeMenu.Portal>
}

function DropdownMenuTrigger({
  asChild = false,
  ...props
}: React.ComponentProps<'button'> & { asChild?: boolean }) {
  return (
    <PrimeMenu.Trigger
      {...(asChild ? { as: Slot.Root } : { type: 'button' as const })}
      data-slot="dropdown-menu-trigger"
      {...props}
    />
  )
}

function DropdownMenuContent({
  className,
  align = 'start',
  sideOffset = 4,
  children,
  ...props
}: React.ComponentProps<'div'> & {
  align?: 'start' | 'center' | 'end'
  sideOffset?: number
}) {
  return (
    <PrimeMenu.Portal>
      <PrimeMenu.Positioner align={align} sideOffset={sideOffset}>
        <PrimeMenu.Popup
          data-slot="dropdown-menu-content"
          className={cn('min-w-48', className)}
          {...props}
        >
          <PrimeMenu.List>{children}</PrimeMenu.List>
        </PrimeMenu.Popup>
      </PrimeMenu.Positioner>
    </PrimeMenu.Portal>
  )
}

function DropdownMenuGroup({ ...props }: React.ComponentProps<'div'>) {
  return <PrimeMenu.Group data-slot="dropdown-menu-group" {...props} />
}

function DropdownMenuItem({
  className,
  inset,
  variant = 'default',
  onSelect,
  ...props
}: React.ComponentProps<'div'> & {
  inset?: boolean
  variant?: 'default' | 'destructive'
  disabled?: boolean
  onSelect?: (event: Event) => void
}) {
  return (
    <PrimeMenu.Item
      data-slot="dropdown-menu-item"
      data-inset={inset}
      data-variant={variant}
      {...(onSelect === undefined
        ? {}
        : {
            onSelect: (event: { originalEvent?: Event }) =>
              onSelect(event.originalEvent ?? new Event('select')),
          })}
      className={cn("data-inset:pl-9.5 [&_svg:not([class*='size-'])]:size-4", className)}
      {...props}
    />
  )
}

function DropdownMenuCheckboxItem({
  className,
  children,
  checked,
  onCheckedChange,
  inset,
  ...props
}: React.ComponentProps<'div'> & {
  inset?: boolean
  checked?: boolean
  onCheckedChange?: (checked: boolean) => void
  disabled?: boolean
}) {
  return (
    <PrimeMenu.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      data-inset={inset}
      {...(checked === undefined ? {} : { checked })}
      {...(onCheckedChange === undefined
        ? {}
        : {
            onCheckedChange: (event: { checked?: boolean }) =>
              onCheckedChange(Boolean(event.checked)),
          })}
      className={cn("data-inset:pl-9.5 [&_svg:not([class*='size-'])]:size-4", className)}
      {...props}
    >
      <span
        className="pointer-events-none absolute right-2 flex items-center justify-center"
        data-slot="dropdown-menu-checkbox-item-indicator"
      >
        <PrimeMenu.CheckboxItemIndicator>
          <CheckIcon />
        </PrimeMenu.CheckboxItemIndicator>
      </span>
      {children}
    </PrimeMenu.CheckboxItem>
  )
}

function DropdownMenuRadioGroup({
  value,
  onValueChange,
  ...props
}: React.ComponentProps<'div'> & {
  value?: string
  onValueChange?: (value: string) => void
}) {
  return (
    <PrimeMenu.RadioItemGroup
      data-slot="dropdown-menu-radio-group"
      {...(value === undefined ? {} : { value })}
      {...(onValueChange === undefined
        ? {}
        : { onValueChange: (event: { value?: unknown }) => onValueChange(String(event.value)) })}
      {...props}
    />
  )
}

function DropdownMenuRadioItem({
  className,
  children,
  inset,
  ...props
}: React.ComponentProps<'div'> & {
  inset?: boolean
  value: string
  disabled?: boolean
}) {
  return (
    <PrimeMenu.RadioItem
      data-slot="dropdown-menu-radio-item"
      data-inset={inset}
      className={cn("data-inset:pl-9.5 [&_svg:not([class*='size-'])]:size-4", className)}
      {...props}
    >
      <span
        className="pointer-events-none absolute right-2 flex items-center justify-center"
        data-slot="dropdown-menu-radio-item-indicator"
      >
        <PrimeMenu.RadioItemIndicator>
          <CheckIcon />
        </PrimeMenu.RadioItemIndicator>
      </span>
      {children}
    </PrimeMenu.RadioItem>
  )
}

function DropdownMenuLabel({
  className,
  inset,
  ...props
}: React.ComponentProps<'div'> & {
  inset?: boolean
}) {
  return (
    <PrimeMenu.Label
      data-slot="dropdown-menu-label"
      data-inset={inset}
      className={cn('text-xs text-muted-foreground data-inset:pl-9.5', className)}
      {...props}
    />
  )
}

function DropdownMenuSeparator({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <PrimeMenu.Separator
      data-slot="dropdown-menu-separator"
      className={cn('', className)}
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

function DropdownMenuSub({ children }: { children?: React.ReactNode }) {
  return <PrimeMenu.Submenu data-slot="dropdown-menu-sub">{children}</PrimeMenu.Submenu>
}

function DropdownMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: React.ComponentProps<'div'> & {
  inset?: boolean
}) {
  return (
    <PrimeMenu.SubmenuTrigger
      data-slot="dropdown-menu-sub-trigger"
      data-inset={inset}
      className={cn("data-inset:pl-9.5 [&_svg:not([class*='size-'])]:size-4", className)}
      {...props}
    >
      {children}
      <ChevronRightIcon className="ml-auto" />
    </PrimeMenu.SubmenuTrigger>
  )
}

function DropdownMenuSubContent({ className, children, ...props }: React.ComponentProps<'div'>) {
  return (
    <PrimeMenu.Portal>
      <PrimeMenu.Positioner>
        <PrimeMenu.Popup
          data-slot="dropdown-menu-sub-content"
          className={cn('min-w-36', className)}
          {...props}
        >
          <PrimeMenu.List>{children}</PrimeMenu.List>
        </PrimeMenu.Popup>
      </PrimeMenu.Positioner>
    </PrimeMenu.Portal>
  )
}

export {
  DropdownMenu,
  DropdownMenuPortal,
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
