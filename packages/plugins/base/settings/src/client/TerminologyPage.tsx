import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { useApi, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { supportedLocales, type SupportedLocale } from '@qualy/i18n-contract'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { AsyncSection, Field, PageHeader, Panel } from '@qualy/ui/admin'
import { Badge } from '@qualy/ui/badge'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'
import { toast } from '@qualy/ui/toast'
import { settingsApi } from './api.ts'
import { settingsMessages as m } from './i18n.ts'
import { TERMINOLOGY_KEY, useTerminology } from './terms.ts'

// The words this tenant uses, one light section per term rather than a
// table: a dozen terms at most, each with a box per language. A box left
// empty means the default; the default is written under it so nobody has
// to remember what "empty" resolves to.

const styles = stylex.create({
  page: { display: 'flex', flexDirection: 'column', gap: 24 },
  list: { display: 'flex', flexDirection: 'column', gap: 24 },
  term: {
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
    paddingTop: 16,
    borderTopWidth: { default: 1, ':first-child': 0 },
    borderTopStyle: 'solid',
    borderTopColor: tokens.divider,
  },
  termHead: { display: 'flex', flexDirection: 'column', gap: 4 },
  termTitle: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 500 },
  termNote: { margin: 0, fontSize: 12, lineHeight: 1.6, color: tokens.mutedForeground },
  boxes: {
    display: 'grid',
    gap: 16,
    gridTemplateColumns: { default: 'minmax(0, 1fr)', '@media (min-width: 720px)': 'repeat(2, minmax(0, 1fr))' },
  },
  actions: { display: 'flex', justifyContent: 'flex-end', gap: 8 },
  empty: { margin: 0, fontSize: 14, color: tokens.mutedForeground },
})

const LOCALE_NAME = {
  'zh-CN': m.localeZhCN,
  'en-US': m.localeEnUS,
} as const

export default function TerminologyPage() {
  const { format, formatText, formatError } = useI18n()
  const terminology = useTerminology()
  const categories = [...(terminology.data?.categories ?? [])].sort((a, b) => a.order - b.order)
  const terms = terminology.data?.terms ?? []
  return (
    <div {...stylex.props(styles.page)}>
      <PageHeader title={format(m.title)} description={format(m.hint)} />
      <AsyncSection
        pending={terminology.isPending}
        error={terminology.isError ? formatError(terminology.error) : null}
        loadingLabel={format(m.loading)}
        retryLabel={format(m.retry)}
        onRetry={() => void terminology.refetch()}
      >
        {terms.length === 0 ? (
          <p {...stylex.props(styles.empty)}>{format(m.empty)}</p>
        ) : (
          <div {...stylex.props(styles.list)}>
            {categories.map((category) => {
              const own = terms
                .filter((term) => term.categoryId === category.id)
                .sort((a, b) => a.order - b.order)
              if (own.length === 0) return null
              return (
                <Panel key={category.id} title={formatText(category.label)}>
                  {own.map((term) => (
                    <TermEditor key={`${term.id}:${term.version}`} term={term} />
                  ))}
                </Panel>
              )
            })}
          </div>
        )}
      </AsyncSection>
    </div>
  )
}

type Term = NonNullable<ReturnType<typeof useTerminology>['data']>['terms'][number]

/** one term: a box per language, saved as one resource under the version it was read at */
function TermEditor({ term }: { term: Term }) {
  const { format, formatText, formatError } = useI18n()
  const api = useApi(settingsApi)
  const run = useRunApi()
  const queryClient = useQueryClient()
  const [drafts, setDrafts] = useState<Record<SupportedLocale, string>>(() => ({
    'zh-CN': term.override['zh-CN'] ?? '',
    'en-US': term.override['en-US'] ?? '',
  }))
  const [saving, setSaving] = useState(false)
  const customised = supportedLocales.some((locale) => (term.override[locale] ?? '') !== '')
  const dirty = supportedLocales.some(
    (locale) => drafts[locale].trim() !== (term.override[locale] ?? ''),
  )
  const [namespace, name] = term.id.split('/') as [string, string]

  const write = async (override: Record<SupportedLocale, string>) => {
    setSaving(true)
    try {
      await run(
        api.settings.putTerm({
          params: { namespace, name },
          payload: { version: term.version, override },
        }),
      )
      await queryClient.invalidateQueries({ queryKey: TERMINOLOGY_KEY })
      toast.success(format(m.saved))
    } catch (error) {
      toast.error(formatError(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div {...stylex.props(styles.term)} data-testid="term" data-term={term.id}>
      <div {...stylex.props(styles.termHead)}>
        <span {...stylex.props(styles.termTitle)}>
          {formatText(term.label)}
          {customised && <Badge variant="secondary">{format(m.customised)}</Badge>}
        </span>
        {term.description !== null && (
          <p {...stylex.props(styles.termNote)}>{formatText(term.description)}</p>
        )}
      </div>
      <div {...stylex.props(styles.boxes)}>
        {supportedLocales.map((locale) => (
          <Field
            key={locale}
            label={format(LOCALE_NAME[locale])}
            hint={format(m.defaultWord, { value: term.defaults[locale] ?? '' })}
          >
            {(id) => (
              <Input
                id={id}
                value={drafts[locale]}
                maxLength={term.maxLength}
                placeholder={term.defaults[locale]}
                disabled={saving}
                onChange={(event) =>
                  setDrafts((current) => ({ ...current, [locale]: event.target.value }))
                }
              />
            )}
          </Field>
        ))}
      </div>
      <div {...stylex.props(styles.actions)}>
        <Button
          variant="ghost"
          disabled={saving || (!customised && !dirty)}
          onClick={() => void write({ 'zh-CN': '', 'en-US': '' })}
        >
          {format(m.reset)}
        </Button>
        <Button disabled={saving || !dirty} onClick={() => void write(drafts)}>
          {format(m.save)}
        </Button>
      </div>
    </div>
  )
}
