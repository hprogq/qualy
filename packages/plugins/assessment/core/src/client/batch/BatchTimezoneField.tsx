import { useMemo, useState } from 'react'
import { useDocumentNow } from '@qualy/web-runtime'
import { Field } from '@qualy/ui/admin'
import { SearchSelect, type SearchSelectOption } from '@qualy/ui/search-select'
import { readableZone, utcOffsetOf } from './zone.ts'
import * as m from '#messages'

const optionOf = (zone: string, offset: string | undefined): SearchSelectOption => ({
  value: zone,
  label: offset === undefined ? zone : m.settings_timezoneOption({ zone, offset }),
  // Accept short forms such as UTC+8 alongside UTC+08:00.
  ...(offset === undefined
    ? {}
    : { keywords: [offset.replace(/([+-])0(?=\d)/, '$1').replace(/:00$/, '')] }),
})

export function BatchTimezoneField({
  value,
  disabled,
  onChange,
}: {
  value: string
  disabled: boolean
  onChange: (value: string) => void
}) {
  const now = useDocumentNow()
  const [openedAt, setOpenedAt] = useState<number | null>(null)
  // Freeze the displayed offsets together when the dropdown opens. The
  // server and first browser render share the document clock for the label.
  const at = openedAt ?? now
  const options = useMemo(() => {
    const selected = optionOf(
      value,
      readableZone(value) === undefined ? undefined : utcOffsetOf(value, at),
    )
    if (openedAt === null) return [selected]
    const supported =
      typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : []
    const zones = new Set(['Asia/Shanghai', 'UTC', value, ...supported])
    return [...zones].map((zone) =>
      zone === value ? selected : optionOf(zone, utcOffsetOf(zone, at)),
    )
  }, [at, openedAt, value])
  return (
    <Field label={m.settings_timezone()} hint={m.settings_timezoneHint()}>
      {(id, control) => (
        <SearchSelect
          id={id}
          {...control}
          value={value}
          disabled={disabled}
          options={options}
          placeholder={m.settings_timezoneSearch()}
          noMatches={m.settings_timezoneNoMatches()}
          onOpen={() => setOpenedAt(Date.now())}
          onValueChange={onChange}
        />
      )}
    </Field>
  )
}
