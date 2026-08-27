'use client'

import * as React from 'react'
import { Menu as MMenu } from '@mantine/core'

import clsx from 'clsx'
import * as stylex from '@stylexjs/stylex'

import { tokens } from '../theme/tokens.stylex.ts'
import { seatOf } from '../lib/xstyle.ts'
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
      {...rest}
      {...seatOf(stylex.props(styles.content), className)}
    >
      {children}
    </MMenu.Dropdown>
  )
}

// The widget marks the active row with data-hovered, whether it got there by
// pointer or by arrow keys; the product accent follows that mark.
//
// The row's own look is stated here. What a caller puts INSIDE a row - an
// icon, a second line of muted text - is reached by relation in theme.css,
// which a compiled style cannot do.
const styles = stylex.create({
  content: {
    minWidth: '12rem',
    overflowX: 'hidden',
    overflowY: 'auto',
  },
  subContent: {
    minWidth: '9rem',
    overflow: 'hidden',
  },
  item: {
    position: 'relative',
    display: 'flex',
    width: '100%',
    cursor: 'default',
    alignItems: 'center',
    gap: 10,
    borderRadius: 14,
    paddingInline: 12,
    paddingBlock: 8,
    fontSize: 14,
    lineHeight: '1.25rem',
    outlineStyle: 'none',
    userSelect: 'none',
    backgroundColor: { default: null, '[data-hovered]': tokens.surfaceMuted },
    color: { default: null, '[data-hovered]': tokens.surfaceMutedForeground },
    pointerEvents: { default: null, '[data-disabled]': 'none' },
    opacity: { default: null, '[data-disabled]': 0.5 },
  },
  // a row that removes something says so in its own ink, and answers the
  // pointer in it rather than in the accent
  itemDestructive: {
    color: { default: tokens.danger, '[data-hovered]': tokens.danger },
    backgroundColor: { default: null, '[data-hovered]': tokens.dangerSurface },
  },
  // room for the indicator column, kept whether or not this row has one
  inset: {
    paddingLeft: { default: null, '[data-inset]': 38 },
  },
  ticked: {
    paddingBlock: 8,
    paddingRight: 32,
    paddingLeft: 12,
  },
  indicator: {
    pointerEvents: 'none',
    position: 'absolute',
    right: 8,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    paddingInline: 12,
    paddingBlock: 10,
    fontSize: 12,
    lineHeight: '1rem',
    color: tokens.mutedForeground,
    paddingLeft: { default: null, '[data-inset]': 38 },
  },
  separator: {
    marginInline: -4,
    marginBlock: 4,
    borderColor: `color-mix(in oklab, ${tokens.border} 50%, transparent)`,
  },
  shortcut: {
    marginLeft: 'auto',
    fontSize: 12,
    lineHeight: '1rem',
    letterSpacing: '0.1em',
    color: tokens.mutedForeground,
  },
  subTriggerGap: {
    gap: 8,
  },
  trailing: {
    marginLeft: 'auto',
  },
})

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
      {...props}
      className={clsx(
        stylex.props(styles.item, variant === 'destructive' && styles.itemDestructive, styles.inset)
          .className,
        className,
      )}
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
      {...props}
      className={clsx(stylex.props(styles.item, styles.ticked, styles.inset).className, className)}
    >
      <span {...stylex.props(styles.indicator)} data-slot="dropdown-menu-checkbox-item-indicator">
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
      {...props}
      className={clsx(stylex.props(styles.item, styles.ticked, styles.inset).className, className)}
    >
      <span {...stylex.props(styles.indicator)} data-slot="dropdown-menu-radio-item-indicator">
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
      {...props}
      className={clsx(stylex.props(styles.label).className, className)}
    />
  )
}

function DropdownMenuSeparator({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <MMenu.Divider
      data-slot="dropdown-menu-separator"
      {...props}
      className={clsx(stylex.props(styles.separator).className, className)}
    />
  )
}

function DropdownMenuShortcut({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="dropdown-menu-shortcut"
      {...props}
      {...seatOf(stylex.props(styles.shortcut), className)}
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
        className={clsx(
          stylex.props(styles.item, styles.subTriggerGap, styles.inset).className,
          className,
        )}
        rightSection={<ChevronRightIcon {...stylex.props(styles.trailing)} />}
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
      {...props}
      className={clsx(stylex.props(styles.subContent).className, className)}
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
