'use client'

import { FieldFill } from './field-fill.ts'
import * as React from 'react'
import { Combobox, InputBase as MInputBase, InputPlaceholder, useCombobox } from '@mantine/core'
import * as stylex from '@stylexjs/stylex'
import type { StyleXStyles } from '@stylexjs/stylex'
import { clsx } from 'clsx'

import { tokens } from '../theme/tokens.stylex.ts'
import { dropIn } from '../lib/overlay-motion.ts'
import { panel } from '../lib/panel.ts'
import { seatOf } from '../lib/xstyle.ts'
import { CheckIcon } from 'lucide-react'

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
//
// One lit row, the one Enter picks. The widget keeps the row its keys are on
// as an index in its store and as a mark in the list, and the pointer moves
// both (SelectItem). A list opens with the choice in force lit, so the keys
// start from it and Enter on a list just opened keeps that choice; it closes
// with the index cleared. The index outlives the list's rows - a closed list
// leaves the document - so a row the pointer crossed before the list closed
// was otherwise what Enter took on the next opening, with nothing lit.

interface SelectState {
  value: string | undefined
  onValueChange?: (value: string) => void
  disabled: boolean
  items: ReadonlyMap<string, React.ReactNode>
  opened: boolean
  toggle: () => void
  /** make an option the one Enter picks, as the pointer comes onto it */
  highlight: (option: HTMLElement) => void
  /**
   * The ref of the list's options element: as the list enters the document
   * it lights the choice in force and starts saying which row is lit.
   */
  listed: (list: HTMLElement | null) => (() => void) | undefined
}
const SelectCtx = React.createContext<SelectState | null>(null)
/**
 * The id of the lit row, said to assistive technology as the active one. Its
 * own context, read by the trigger alone: it moves with every key press, and
 * the options have no need to render again each time it does.
 */
const LitCtx = React.createContext<string | undefined>(undefined)

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

type ContentAlign = 'start' | 'center' | 'end'

/** the edge of its trigger the open list lines up with, as its content says */
function alignOf(node: React.ReactNode): ContentAlign | undefined {
  let found: ContentAlign | undefined
  React.Children.forEach(node, (child) => {
    if (found !== undefined || !React.isValidElement(child)) return
    const props = child.props as { align?: ContentAlign; children?: React.ReactNode }
    if (child.type === SelectContent) found = props.align ?? 'start'
    else if (props.children !== undefined) found = alignOf(props.children)
  })
  return found
}

const PLACEMENT = { start: 'bottom-start', center: 'bottom', end: 'bottom-end' } as const

/**
 * The panels a list opened from inside them must not spill out of. Past a
 * modal panel's edge the list lies over the veil and reads as though it had
 * come loose from the dialog; on the page, the window is the only bound.
 */
const MODAL_PANEL =
  '[data-slot="dialog-content"], [data-slot="alert-dialog-content"], [data-slot="sheet-content"]'

/** the room kept between an open list and the edge that bounds it */
const EDGE_ROOM = 8

function Select(props: {
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  disabled?: boolean
  children?: React.ReactNode
}) {
  const { value, defaultValue, onValueChange, disabled = false, children } = props
  /**
   * Whether the caller owns the answer, decided by whether they said so.
   *
   * `value ?? inner` reads a controlled `undefined` as "nobody is holding
   * this" and falls back to the last pick, so a form that cleared a choice
   * went on showing the label it had cleared - and the next submit sent a
   * value the screen was no longer claiming. The prop being PRESENT is what
   * says who owns it; what it holds is the answer, absence included.
   */
  const controlled = 'value' in props
  const [inner, setInner] = React.useState(defaultValue)
  const [opened, setOpened] = React.useState(false)
  // the modal panel the trigger sits in, found as the list opens
  const [bound, setBound] = React.useState<Element | null>(null)
  const [lit, setLit] = React.useState<string | undefined>(undefined)
  const store = useCombobox({
    onDropdownOpen: () => {
      setBound(store.targetRef.current?.closest(MODAL_PANEL) ?? null)
      setOpened(true)
    },
    onDropdownClose: () => {
      // the widget's own select does the same: the next opening starts from
      // the choice, not from the row the pointer last crossed
      store.resetSelectedOption()
      setOpened(false)
    },
  })
  const { updateSelectedOptionIndex } = store
  // Stable, because it is the options element's ref: a new one each render
  // would detach and reattach the list, lighting the choice again after
  // every key press.
  const listed = React.useCallback(
    (list: HTMLElement | null) => {
      if (list === null) return undefined
      const options = [...list.querySelectorAll<HTMLElement>('[data-combobox-option]')]
      const current = options.findIndex(
        (option) =>
          option.hasAttribute('data-combobox-active') &&
          !option.hasAttribute('data-combobox-disabled'),
      )
      if (current !== -1) {
        const option = options[current]!
        option.setAttribute('data-combobox-selected', 'true')
        updateSelectedOptionIndex(current)
        // Into view within the list alone. The list enters the document
        // before it is placed, and asking the row itself to come into view
        // would scroll whatever else it takes to get there, the page too.
        const box = list.closest<HTMLElement>('[data-slot="select-content"]')
        if (box !== null) {
          const at =
            option.getBoundingClientRect().top -
            box.getBoundingClientRect().top -
            box.clientTop +
            box.scrollTop
          const end = at + option.offsetHeight
          if (at < box.scrollTop) box.scrollTop = at
          else if (end > box.scrollTop + box.clientHeight) box.scrollTop = end - box.clientHeight
        }
      }
      // Every way a row gets lit - keys, pointer, opening - moves the mark,
      // so the mark is what the trigger reports as the active row. Selected
      // stays the choice in force: the widget's keys also say the row they
      // are on as selected, which left two rows claiming it, or none.
      const report = () => {
        for (const option of list.querySelectorAll('[data-combobox-option]')) {
          option.setAttribute('aria-selected', String(option.hasAttribute('data-combobox-active')))
        }
        setLit(list.querySelector('[data-combobox-selected]')?.id || undefined)
      }
      report()
      const watch = new MutationObserver(report)
      watch.observe(list, {
        subtree: true,
        attributes: true,
        attributeFilter: ['data-combobox-selected'],
      })
      return () => {
        watch.disconnect()
        setLit(undefined)
      }
    },
    [updateSelectedOptionIndex],
  )
  const chosen = controlled ? value : inner
  const items = new Map<string, React.ReactNode>()
  collectItems(children, items)
  const boundary = bound ?? 'clippingAncestors'
  const state = React.useMemo<SelectState>(
    () => ({
      value: chosen,
      ...(onValueChange === undefined ? {} : { onValueChange }),
      disabled,
      items,
      opened,
      toggle: () => store.toggleDropdown(),
      highlight: (option) => {
        // the widget's own list, in the order its keys walk it
        const list = option.closest('[role="listbox"]')
        if (list === null) return
        const options = [...list.querySelectorAll<HTMLElement>('[data-combobox-option]')]
        for (const other of options) {
          if (other !== option) other.removeAttribute('data-combobox-selected')
        }
        option.setAttribute('data-combobox-selected', 'true')
        store.updateSelectedOptionIndex(options.indexOf(option))
      },
      listed,
    }),
    // the item map is rebuilt each render by design; identity is not stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chosen, onValueChange, disabled, opened, listed, children],
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
      // The list is as wide as its widest option and never narrower than
      // its trigger. The widget's own list is the trigger's width exactly,
      // so a field showing a short choice folded every longer option over
      // two or three lines.
      //
      // A list wider than its field starts where the field starts. Centred
      // under it, as the widget places a list by default, it stuck out on
      // both sides at once: over the field to its left, and past the edge
      // of a dialog onto the veil. Where there is no room on the far side
      // it slides back, and it never leaves the window or the modal panel
      // it was opened from - its measure is capped at that room, and past
      // the cap an option wraps. A key at the end of a toolbar asks for the
      // end edge instead (SelectContent's `align`).
      width="max-content"
      position={PLACEMENT[alignOf(children) ?? 'start']}
      middlewares={{
        flip: true,
        shift: { mainAxis: true, padding: EDGE_ROOM, boundary },
        size: {
          padding: EDGE_ROOM,
          boundary,
          apply: ({ rects, availableWidth, elements }) => {
            elements.floating.style.minWidth = `max(9rem, ${rects.reference.width}px)`
            elements.floating.style.maxWidth = `min(24rem, ${Math.floor(availableWidth)}px)`
          },
        },
      }}
      transitionProps={dropIn}
      disabled={disabled}
      onOptionSubmit={(next) => {
        // Picking the choice already in force changes nothing and says
        // nothing: Enter on a list just opened lands on it, and a caller
        // that goes back to its first page on a new filter must not do so
        // for the same one.
        if (next !== chosen) {
          // an uncontrolled select keeps its own answer; a controlled one is
          // told what it holds, and writing here too would leave a stale
          // copy to fall back on
          if (!controlled) setInner(next)
          onValueChange?.(next)
        }
        store.closeDropdown()
      }}
    >
      <SelectCtx value={state}>
        <LitCtx value={opened ? lit : undefined}>{children}</LitCtx>
      </SelectCtx>
    </Combobox>
  )
}

// The trigger's own width opinion lives in its StyleX base, where an xstyle
// override wins property by property in the same composition. It used to be
// a utility class with higher cascade priority, which forced callers that
// sized a field to repeat that implementation detail.
const triggerStyles = stylex.create({
  base: {
    // fit by default, as the closed control has always been: the caller
    // whose field must fill or fix its width says so through xstyle
    width: 'fit-content',
  },
  // inside a form field: the width of the field, like the input above it
  fill: { width: '100%' },
  // the control itself, drawn as a quiet key: the height and ground of an
  // icon key beside it, and no box. With no border to colour, keyboard focus
  // is a ring of its own
  quiet: {
    height: 32,
    minHeight: 32,
    borderRadius: tokens.radiusMd,
    backgroundColor: { default: 'transparent', ':hover': tokens.surfaceMuted },
    paddingInline: 8,
    color: tokens.foreground,
    outline: 'none',
    boxShadow: { default: 'none', ':focus-visible': `0 0 0 2px ${tokens.focusRing}` },
  },
})

const styles = stylex.create({
  value: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'center',
    gap: 6,
    overflow: 'hidden',
    whiteSpace: 'nowrap',
  },
  // the list's measure - its floor is its trigger, set as it is placed -
  // and past a line's comfortable length an option wraps; its surface is the
  // anchored panels' material
  content: {
    maxHeight: '18rem',
    maxWidth: 'min(24rem, calc(100vw - 16px))',
    overflowX: 'hidden',
    overflowY: 'auto',
  },
  // The reserved indicator seat and the row's shape, and how it answers.
  //
  // The widget marks the option the keyboard is on with
  // data-combobox-selected and fills it with the primary behind a hard-coded
  // white - a black bar in the light scheme and white on near-white in the
  // dark - and grounds the row under the pointer separately, so an arrow
  // press and a pointer left two rows lit alike while Enter took the arrow's
  // one. The pointer moves the keyboard's mark instead (SelectItem), and the
  // mark alone is drawn, in the wash a menu row wears: one lit row, the one
  // Enter picks. Disabled is the widget's own.
  item: {
    position: 'relative',
    display: 'flex',
    width: '100%',
    alignItems: 'center',
    gap: 10,
    paddingRight: 32,
    borderRadius: tokens.radiusMd,
    backgroundColor: {
      default: 'transparent',
      '[data-combobox-selected]': tokens.hoverSurface,
    },
    color: { default: null, '[data-combobox-selected]': tokens.foreground },
  },
  // the indicator seat is always reserved, so choosing never reflows the row
  tick: {
    pointerEvents: 'none',
    position: 'absolute',
    right: 8,
    display: 'flex',
    width: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inert: {
    pointerEvents: 'none',
  },
  said: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 2,
    textAlign: 'left',
  },
  aside: {
    fontSize: 12,
    lineHeight: '1rem',
    color: tokens.mutedForeground,
  },
  group: {
    scrollMarginBlock: 4,
    padding: 4,
  },
  label: {
    paddingInline: 12,
    paddingBlock: 10,
    fontSize: 12,
    lineHeight: '1rem',
    color: tokens.mutedForeground,
  },
  separator: {
    pointerEvents: 'none',
    marginInline: -4,
    marginBlock: 4,
    height: 1,
    backgroundColor: `color-mix(in oklab, ${tokens.border} 50%, transparent)`,
  },
})

function SelectTrigger({
  className,
  xstyle,
  size = 'default',
  quiet = false,
  children,
  onKeyDown,
  'aria-invalid': ariaInvalid,
  ...props
}: React.ComponentProps<'button'> & {
  size?: 'sm' | 'default'
  /**
   * Drawn as a quiet key rather than a field: no box and no chevron, for a
   * toolbar whose neighbours are icon keys. What it shows must still say
   * the choice in force.
   */
  quiet?: boolean
  /**
   * The standard StyleX seat, composed over the trigger's base styles -
   * sizing a field is its main use. `className` stays as the legacy escape
   * hatch: its utilities still win by cascade for callers not yet on
   * StyleX, but that is the layer contract, not a promise of this API.
   */
  xstyle?: StyleXStyles
}) {
  const { disabled, opened, toggle } = useSelect()
  const lit = React.use(LitCtx)
  // the product marks invalid controls with aria-invalid; the widget wants
  // its own error prop
  const invalid = ariaInvalid === true || ariaInvalid === 'true'
  const fill = React.useContext(FieldFill)
  const sx = stylex.props(triggerStyles.base, fill && triggerStyles.fill, xstyle)
  return (
    // `aria-expanded` is stated HERE rather than on the button, because the
    // widget clones its child with a config that always carries that key -
    // valued undefined unless `withExpandedAttribute` is set - and
    // `cloneElement` writes undefined straight over whatever the child said.
    // So the attribute was absent in both states and every select in the
    // product shipped `role="combobox"` with no expanded state to hear.
    //
    // Its own `withExpandedAttribute` is not the answer either: the value it
    // computes is `listId && dropdownOpened`, and `listId` is a ref rather
    // than state, so with `keepMounted={false}` the options register their id
    // without re-rendering the target and the attribute stays false while the
    // list is open. Measured - that is what the case below caught first.
    //
    // A prop given to Target lands in the rest it spreads AFTER the config,
    // so this one wins, and `opened` is the state the product already keeps.
    //
    // The active row is said the same way. The widget's own value moves with
    // its keys only, so it went on naming the row the keys had left while
    // the pointer lit another, and outlived the list it named.
    <Combobox.Target aria-expanded={opened} aria-activedescendant={lit}>
      <MInputBase
        component="button"
        type="button"
        role="combobox"
        pointer
        data-slot="select-trigger"
        data-size={size}
        size={size === 'sm' ? 'xs' : 'sm'}
        style={sx.style}
        className={clsx(sx.className, className)}
        {...(invalid ? { error: true } : {})}
        {...(quiet
          ? {
              variant: 'unstyled',
              classNames: { input: stylex.props(triggerStyles.quiet).className ?? '' },
            }
          : {
              // the widget's chevron grey carries a blue cast; it speaks in
              // the secondary text grey like every other quiet glyph here
              rightSection: <Combobox.Chevron color="var(--q-muted-foreground)" />,
              rightSectionPointerEvents: 'none' as const,
            })}
        disabled={disabled}
        onClick={(event) => {
          // WebKit does not focus buttons on pointer clicks. The combobox
          // keeps keyboard navigation and Escape on this trigger in every engine.
          event.currentTarget.focus()
          toggle()
        }}
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
    <span data-slot="select-value" {...stylex.props(styles.value)}>
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
  /**
   * The trigger's edge the list lines up with when it is the wider of the
   * two: `start` by default, `end` for a key at the end of a toolbar. Read
   * by the root, which places the list.
   */
  align?: ContentAlign
}) {
  const { listed } = useSelect()
  return (
    <Combobox.Dropdown
      data-slot="select-content"
      // presses inside this layer belong to it: a menu or popover BENEATH
      // listens for outside presses on mousedown, and a portal makes this
      // list "outside" - without the stop, holding the mouse on an option
      // unmounted everything under the cursor before the click could land
      onMouseDown={(event) => event.stopPropagation()}
      onTouchStart={(event) => event.stopPropagation()}
      {...seatOf(stylex.props(panel.material, styles.content), className)}
    >
      <Combobox.Options ref={listed}>{children}</Combobox.Options>
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
  const { value: chosen, highlight } = useSelect()
  const selected = chosen === value
  const { onMouseMove, ...rest } = props
  return (
    <Combobox.Option
      value={value}
      {...(disabled === undefined ? {} : { disabled })}
      // the tick is drawn for the eye only; the choice in force is said to
      // assistive technology here, as the widget's own select says it
      aria-selected={selected}
      active={selected}
      data-slot="select-item"
      // Moving, not entering: a list the keys scroll slides rows under a
      // pointer that never moved, and those must not take the mark back.
      onMouseMove={(event) => {
        onMouseMove?.(event)
        const option = event.currentTarget
        if (disabled === true || option.hasAttribute('data-combobox-selected')) return
        highlight(option)
      }}
      {...rest}
      {...seatOf(stylex.props(styles.item), className)}
    >
      {/* the indicator seat is always reserved, so choosing never reflows the row */}
      <span aria-hidden {...stylex.props(styles.tick)}>
        {selected && <CheckIcon {...stylex.props(styles.inert)} />}
      </span>
      {description === undefined ? (
        <span data-slot="select-item-text">{children}</span>
      ) : (
        <span {...stylex.props(styles.said)}>
          <span data-slot="select-item-text">{children}</span>
          <span {...stylex.props(styles.aside)}>{description}</span>
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
      {...props}
      {...seatOf(stylex.props(styles.group), className)}
    />
  )
}

function SelectLabel({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-slot="select-label" {...props} {...seatOf(stylex.props(styles.label), className)} />
  )
}

function SelectSeparator({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="select-separator"
      aria-hidden
      {...props}
      {...seatOf(stylex.props(styles.separator), className)}
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
