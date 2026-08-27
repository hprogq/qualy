import { useMemo, useState } from 'react'
import { CheckIcon, ChevronsUpDownIcon, SearchIcon } from 'lucide-react'
import { useI18n } from '@qualy/web-i18n'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@qualy/ui/popover'
import { ScrollArea } from '@qualy/ui/scroll-area'
import * as stylex from '@stylexjs/stylex'
import type { StyleXStyles } from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { iamMessages as m } from '../i18n.ts'

const styles = stylex.create({
  dropdown: {
    minWidth: 256,
    padding: 0,
  },
  triggerFace: {
    width: '100%',
    justifyContent: 'space-between',
    fontWeight: 400,
  },
  chosenWord: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  placeholderWord: {
    color: tokens.mutedForeground,
  },
  chevron: {
    flexShrink: 0,
    opacity: 0.5,
  },
  searchRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.border,
    paddingInline: 12,
    paddingBlock: 8,
  },
  searchGlass: {
    width: 16,
    height: 16,
    flexShrink: 0,
    color: tokens.mutedForeground,
  },
  bareInput: {
    height: 28,
    borderWidth: 0,
    paddingInline: 0,
    boxShadow: 'none',
  },
  listBox: {
    maxHeight: '16rem',
  },
  noMatch: {
    paddingInline: 12,
    paddingBlock: 24,
    textAlign: 'center',
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
    color: tokens.mutedForeground,
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    padding: 4,
  },
  rowButton: {
    display: 'flex',
    width: '100%',
    minWidth: 0,
    alignItems: 'center',
    gap: 8,
    borderRadius: tokens.radiusMd,
    paddingBlock: 6,
    paddingRight: 8,
    textAlign: 'left',
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
    transitionProperty: 'color, background-color, border-color',
    transitionDuration: '150ms',
    transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)',
  },
  rowOffered: {
    backgroundColor: {
      default: null,
      ':hover': tokens.surfaceMuted,
    },
  },
  rowWithheld: {
    cursor: 'not-allowed',
    color: tokens.mutedForeground,
  },
  rowCurrent: {
    backgroundColor: {
      default: tokens.surfaceMuted,
      ':hover': tokens.surfaceMuted,
    },
  },
  rowName: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  spacer: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
  },
  tick: {
    width: 16,
    height: 16,
    flexShrink: 0,
  },
})

export type PickableNode = {
  orgNodeId: string
  name: string
  depth: number
  manageable: boolean
}

/**
 * Choosing one unit out of the tree the caller administers.
 *
 * A dropdown of flat names loses the only thing that tells two similarly
 * named units apart, so the rows keep their depth and the search keeps
 * whatever matches. Units the caller may not administer are shown and not
 * offered: seeing where something sits is part of choosing correctly.
 */
export function NodePicker({
  nodes,
  value,
  onChange,
  placeholder,
  label,
  id,
  disabled = false,
  xstyle,
}: {
  nodes: readonly PickableNode[]
  value: string
  onChange: (orgNodeId: string) => void
  placeholder: string
  /** spoken name, since the trigger reads out whatever unit is chosen */
  label?: string
  id?: string
  disabled?: boolean
  /** StyleX seat for the trigger; the popover face stays the picker's own */
  xstyle?: StyleXStyles
}) {
  const { format } = useI18n()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const current = nodes.find((node) => node.orgNodeId === value)

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (needle === '') return nodes
    return nodes.filter((node) => node.name.toLowerCase().includes(needle))
  }, [nodes, search])

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setSearch('')
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          disabled={disabled}
          {...(id === undefined ? {} : { id })}
          {...(label === undefined ? {} : { 'aria-label': label })}
          className={stylex.props(styles.triggerFace, xstyle).className}
        >
          <span
            {...stylex.props(styles.chosenWord, current === undefined && styles.placeholderWord)}
          >
            {current?.name ?? placeholder}
          </span>
          <ChevronsUpDownIcon
            className={stylex.props(styles.chevron).className}
            data-icon="inline-end"
          />
        </Button>
      </PopoverTrigger>
      {/* the picker's own width and padding, merged into the popover's */}
      <PopoverContent align="start" width="target" xstyle={styles.dropdown}>
        <div {...stylex.props(styles.searchRow)}>
          <SearchIcon className={stylex.props(styles.searchGlass).className} aria-hidden />
          <Input
            autoFocus
            aria-label={format(m.nodeSearch)}
            placeholder={format(m.nodeSearch)}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className={stylex.props(styles.bareInput).className}
          />
        </div>
        <ScrollArea className={stylex.props(styles.listBox).className}>
          {shown.length === 0 ? (
            <p {...stylex.props(styles.noMatch)}>{format(m.nodeNoMatch)}</p>
          ) : (
            <ul {...stylex.props(styles.list)}>
              {shown.map((node) => (
                <li key={node.orgNodeId}>
                  <button
                    type="button"
                    disabled={!node.manageable}
                    aria-current={node.orgNodeId === value}
                    onClick={() => {
                      onChange(node.orgNodeId)
                      setOpen(false)
                      setSearch('')
                    }}
                    {...stylex.props(
                      styles.rowButton,
                      node.manageable ? styles.rowOffered : styles.rowWithheld,
                      node.orgNodeId === value && styles.rowCurrent,
                    )}
                    // the depth is the whole reason a name is unambiguous, so
                    // it is spacing rather than a prefix that search would eat
                    style={{ paddingLeft: `${0.5 + Math.min(node.depth, 6) * 0.75}rem` }}
                  >
                    <span {...stylex.props(styles.rowName)}>{node.name}</span>
                    <span {...stylex.props(styles.spacer)} />
                    {node.orgNodeId === value && (
                      <CheckIcon className={stylex.props(styles.tick).className} aria-hidden />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  )
}
