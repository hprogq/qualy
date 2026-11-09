'use client'

import { useMemo, useState } from 'react'
import { Select as MSelect } from '@mantine/core'
import * as stylex from '@stylexjs/stylex'
import { panel } from '../lib/panel.ts'
import { tokens } from '../theme/tokens.stylex.ts'

export interface SearchSelectOption {
  value: string
  label: string
  /** Additional names that may find this option without becoming its label. */
  keywords?: readonly string[]
}

const styles = stylex.create({
  option: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 8,
    borderRadius: tokens.radiusMd,
    backgroundColor: {
      default: 'transparent',
      ':hover': tokens.hoverSurface,
      '[data-combobox-selected]': tokens.hoverSurface,
    },
    color: tokens.foreground,
  },
})

const normalize = (text: string) =>
  text.normalize('NFKD').replace(/\p{M}/gu, '').replaceAll('−', '-').toLowerCase()

/** An editable filter over a closed set of values, never a free-text field. */
export function SearchSelect({
  id,
  'aria-describedby': describedBy,
  disabled,
  value,
  options,
  placeholder,
  noMatches,
  onOpen,
  onValueChange,
}: {
  id: string
  'aria-describedby'?: string
  disabled?: boolean
  value: string
  options: readonly SearchSelectOption[]
  placeholder: string
  noMatches: string
  onOpen?: () => void
  onValueChange: (value: string) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const [opened, setOpened] = useState(false)
  const { byValue, searchIndex, data } = useMemo(
    () => ({
      byValue: new Map(options.map((option) => [option.value, option])),
      searchIndex: new Map(
        options.map(({ value, label, keywords }) => [
          value,
          normalize([label, value, ...(keywords ?? [])].join(' ')),
        ]),
      ),
      data: options.slice(),
    }),
    [options],
  )
  const selected = byValue.get(value)?.label ?? value
  return (
    <MSelect
      id={id}
      data-slot="search-select"
      value={value}
      disabled={disabled}
      onChange={(next) => {
        if (next !== null) onValueChange(next)
      }}
      searchable
      allowDeselect={false}
      autoComplete="off"
      placeholder={placeholder}
      nothingFoundMessage={noMatches}
      checkIconPosition="right"
      chevronColor="var(--q-muted-foreground)"
      maxDropdownHeight={280}
      classNames={{
        dropdown: stylex.props(panel.material).className ?? '',
        option: stylex.props(styles.option).className ?? '',
      }}
      attributes={{
        input: {
          'aria-autocomplete': 'list',
          'aria-describedby': describedBy,
          'aria-expanded': opened,
        },
      }}
      data={data}
      searchValue={draft ?? selected}
      onSearchChange={(next) => setDraft(next === selected ? null : next)}
      onDropdownOpen={() => {
        setOpened(true)
        onOpen?.()
      }}
      onDropdownClose={() => {
        setOpened(false)
        setDraft(null)
      }}
      onFocus={(event) => event.currentTarget.select()}
      onClick={(event) => {
        if (draft === null) event.currentTarget.select()
      }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return
        // Enter picks an option, but never submits the surrounding form.
        if (event.key === 'Enter') event.preventDefault()
        if (opened && event.key === 'Escape') event.stopPropagation()
      }}
      selectFirstOptionOnChange
      // Do not let the widget's deferred selected-value lookup overwrite the
      // first search match when typing opens the dropdown after Escape.
      selectFirstOptionOnDropdownOpen
      filter={({ options: candidates, search }) => {
        const terms = normalize(search).trim().split(/\s+/)
        return candidates.filter(
          (candidate) =>
            'value' in candidate &&
            terms.every((term) => searchIndex.get(candidate.value)?.includes(term)),
        )
      }}
    />
  )
}
