import type { PeopleImportContext } from '@qualy/ui-contract'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { useQuery } from '@tanstack/react-query'
import { useApiQuery } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { CheckboxGroup } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { authApi } from '../api.ts'
import { authMessages as m } from '../i18n.ts'
import OrgNodePicker from './OrgNodePicker.tsx'

// Naming a slice of the organization instead of naming people.
//
// The units come from the same picker every other screen uses - tree, search,
// filter by kind, ticking one covers everything under it - and the kinds of
// person are the other half of the query. What running it does is the asking
// screen's business.

const styles = stylex.create({
  page: { display: 'flex', flexDirection: 'column', gap: 20 },
  section: { display: 'flex', flexDirection: 'column', gap: 8 },
  head: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  title: { fontSize: 14, lineHeight: '1.25rem', fontWeight: 500 },
})

export default function PeopleImportPicker({ context }: { context: PeopleImportContext }) {
  const query = useApiQuery(authApi)
  const { format } = useI18n()
  const options = useQuery(query.identity.getUserOptions.queryOptions({ query: {} }))
  const types = options.data?.userTypes ?? []
  const allChosen =
    types.length > 0 && types.every((type) => context.value.userTypeIds.includes(type.id))

  return (
    <div {...stylex.props(styles.page)}>
      <div {...stylex.props(styles.section)}>
        <p {...stylex.props(styles.title)}>{format(m.importUnits)}</p>
        <OrgNodePicker
          context={{
            value: context.value.orgNodeIds,
            onChange: (orgNodeIds) => context.onChange({ ...context.value, orgNodeIds }),
          }}
        />
      </div>

      <div {...stylex.props(styles.section)}>
        <div {...stylex.props(styles.head)}>
          <p {...stylex.props(styles.title)}>{format(m.importTypes)}</p>
          {types.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                context.onChange({
                  ...context.value,
                  // one button for both directions: with everything ticked the
                  // only thing left to want is none of it
                  userTypeIds: allChosen ? [] : types.map((type) => type.id),
                })
              }
            >
              {format(allChosen ? m.importClearTypes : m.importAllTypes)}
            </Button>
          )}
        </div>
        <CheckboxGroup
          legend={format(m.importTypes)}
          options={types.map((type) => ({ value: type.id, label: type.name }))}
          selected={[...context.value.userTypeIds]}
          onChange={(userTypeIds) => context.onChange({ ...context.value, userTypeIds })}
          emptyLabel={format(m.importNoTypes)}
        />
      </div>
    </div>
  )
}
