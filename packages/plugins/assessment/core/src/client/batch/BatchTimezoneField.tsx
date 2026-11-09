import { useMemo, useState } from 'react'
import { useDocumentNow } from '@qualy/web-runtime'
import { useLocale } from '@qualy/web-i18n'
import { Field } from '@qualy/ui/admin'
import { SearchSelect, type SearchSelectOption } from '@qualy/ui/search-select'
import cities from './timezone-data/cities.json' with { type: 'json' }
import { readableZone, utcOffsetOf } from './zone.ts'
import * as m from '#messages'

const cityNames: Readonly<Record<string, string | readonly (string | null)[]>> = cities

function placeOf(zone: string, locale: string): string | undefined {
  if (zone === 'UTC' || zone === 'Etc/UTC') return m.settings_timezoneUtcName()
  if (zone.startsWith('Etc/')) return undefined
  const city = cityNames[zone]
  const english = typeof city === 'string' ? undefined : city?.[1]
  const chinese = typeof city === 'string' ? city : city?.[0]
  return (
    (locale === 'zh-CN' ? (chinese ?? english) : english) ??
    zone.split('/').at(-1)?.replaceAll('_', ' ')
  )
}

const optionOf = (
  zone: string,
  offset: string | undefined,
  place?: string,
): SearchSelectOption => ({
  value: zone,
  label: offset === undefined ? zone : m.settings_timezoneOption({ zone, offset }),
  ...(offset === undefined
    ? {}
    : {
        details: {
          title: zone,
          description:
            place === undefined ? offset : m.settings_timezoneOptionDetails({ place, offset }),
        },
        // The description is display-only; accept UTC+8 as well as UTC+08:00.
        keywords: [offset.replace(/([+-])0(?=\d)/, '$1').replace(/:00$/, '')],
      }),
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
  const locale = useLocale()
  const now = useDocumentNow()
  const [openedAt, setOpenedAt] = useState<number | null>(null)
  // Freeze the displayed offsets together when the dropdown opens. The
  // server and first browser render share the document clock for the label.
  const at = openedAt ?? now
  const options = useMemo(() => {
    const savedOffset = readableZone(value) === undefined ? undefined : utcOffsetOf(value, at)
    if (openedAt === null) return [optionOf(value, savedOffset)]
    const supported =
      typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : []
    const zones = new Set(['Asia/Shanghai', 'UTC', value, ...supported])
    return [...zones].map((zone) =>
      optionOf(zone, zone === value ? savedOffset : utcOffsetOf(zone, at), placeOf(zone, locale)),
    )
  }, [at, locale, openedAt, value])
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
