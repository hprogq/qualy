import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { orgNodePicker, type OrgNodePickerContext } from '@qualy/ui-contract'
import { PageLink, UiSlot, useApi, useRunApi, useApiQuery } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { useTerm } from '@qualy/plugin-settings/client/terms'
import { authTerms } from '@qualy/auth-contract/terms'
import * as stylex from '@stylexjs/stylex'
import { ChevronsUpDownIcon } from 'lucide-react'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { CardEmpty } from '@qualy/ui/screen'
import { Feedback, Field, FormDialog } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@qualy/ui/select'
import { iamMessages as m } from '../i18n.ts'
import { authApi } from '../api.ts'

// Making one person. Four answers: their name, their number, what kind of
// person they are, and where they stand.
//
// Where they stand used to be a sentence - "they will be filed under
// whichever unit the roster is showing" - which is a rule the reader has to
// hold in their head and cannot act on. It is a field now, filled in from
// the roster because that is nearly always right, and changed in the
// product's own unit picker when it is not.

const styles = stylex.create({
  form: { display: 'flex', flexDirection: 'column', gap: 20 },
  fullField: { width: '100%' },
  // the chosen unit, as a field that opens the picker
  unitField: {
    width: '100%',
    justifyContent: 'space-between',
    fontWeight: 400,
  },
  unitWord: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  unitEmpty: { color: tokens.mutedForeground },
  chevron: { flexShrink: 0, opacity: 0.5 },
  // Tall enough that the picker's own list never spills and hands the
  // dialog a second scrollbar: a search row, a kind filter and a tree whose
  // box will not go below 16rem do not fit in 20.
  seat: { display: 'flex', minHeight: 0, height: '25rem', flexDirection: 'column' },
  // no kind of person may stand here, which is a rule somebody has to go
  // and change rather than a field they can fill in
  barred: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    fontSize: 13,
    lineHeight: 1.6,
    color: tokens.mutedForeground,
  },
  barredLink: {
    alignSelf: 'flex-start',
    fontSize: 13,
    color: tokens.foreground,
    textDecorationLine: 'underline',
    textUnderlineOffset: 3,
  },
})

export function NewUserForm({
  open,
  onClose,
  orgNodeId,
  orgNodeName,
  userTypesAt,
}: {
  open: boolean
  onClose: () => void
  /** where the roster stands, which is where a new person goes unless told otherwise */
  orgNodeId: string
  orgNodeName: string
  /** the kinds of person a given unit may hold, which is the rule this form obeys */
  userTypesAt: (orgNodeId: string) => readonly { id: string; code: string; name: string }[]
}) {
  const api = useApi(authApi)
  const run = useRunApi()
  const query = useApiQuery(authApi)
  const queryClient = useQueryClient()
  const { format, formatError } = useI18n()
  const businessNoWord = useTerm(authTerms.businessNumber)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [businessNo, setBusinessNo] = useState('')
  const [userTypeId, setUserTypeId] = useState('')
  const [unit, setUnit] = useState(orgNodeId)
  const [picking, setPicking] = useState(false)

  // the roster's unit is the default, not the rule: it is taken again each
  // time the form opens, and anything chosen inside it stands until then
  useEffect(() => {
    if (open) setUnit(orgNodeId)
  }, [open, orgNodeId])

  const options = userTypesAt(unit)
  const named = useQueryNodeName(unit, orgNodeId, orgNodeName)
  // a kind that the unit they moved to will not hold is not a kind they chose
  useEffect(() => {
    if (userTypeId !== '' && !options.some((type) => type.id === userTypeId)) setUserTypeId('')
  }, [options, userTypeId])

  const create = useMutation({
    mutationFn: () =>
      run(
        api.identity.createUser({
          payload: {
            displayName,
            userTypeId,
            primaryOrgNodeId: unit,
            businessNo: businessNo.trim() === '' ? undefined : businessNo.trim(),
          },
        }),
      ),
    onMutate: () => setFeedback(null),
    onSuccess: async () => {
      setDisplayName('')
      setBusinessNo('')
      onClose()
      await queryClient.invalidateQueries({ queryKey: query.identity.key() })
    },
    onError: (error: unknown) => setFeedback(formatError(error)),
  })

  const picker: OrgNodePickerContext = {
    value: unit === '' ? [] : [unit],
    onChange: (ids) => {
      setUnit(ids[0] ?? unit)
      setPicking(false)
    },
    single: true,
  }

  return (
    <>
      <FormDialog
        open={open && !picking}
        title={format(m.newUser)}
        onClose={onClose}
        footer={
          <>
            <Button variant="outline" onClick={onClose}>
              {format(m.cancel)}
            </Button>
            <Button
              type="submit"
              form="new-user"
              disabled={
                create.isPending || displayName.trim() === '' || userTypeId === '' || unit === ''
              }
            >
              {format(m.create)}
            </Button>
          </>
        }
      >
        <Feedback message={feedback} />
        <form
          id="new-user"
          {...stylex.props(styles.form)}
          onSubmit={(event) => {
            event.preventDefault()
            create.mutate()
          }}
        >
          <Field label={format(m.personNameLabel)}>
            {(id) => (
              <Input
                id={id}
                autoFocus
                // the browser reads a lone name field as its own record of
                // the person at the keyboard and offers to fill it in; this
                // is somebody else's name, typed by an administrator
                autoComplete="off"
                name="new-user-display-name"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            )}
          </Field>
          <Field label={businessNoWord}>
            {(id) => (
              <Input
                id={id}
                autoComplete="off"
                name="new-user-business-no"
                value={businessNo}
                onChange={(event) => setBusinessNo(event.target.value)}
              />
            )}
          </Field>
          <Field label={format(m.personPlacement)}>
            {(id) => (
              <Button
                id={id}
                type="button"
                variant="outline"
                justify="space-between"
                data-testid="new-user-unit"
                className={stylex.props(styles.unitField).className}
                onClick={() => setPicking(true)}
              >
                <span {...stylex.props(styles.unitWord, named === '' && styles.unitEmpty)}>
                  {named === '' ? format(m.movePick) : named}
                </span>
                <ChevronsUpDownIcon
                  className={stylex.props(styles.chevron).className}
                  data-icon="inline-end"
                />
              </Button>
            )}
          </Field>
          <Field label={format(m.userTypeLabel)}>
            {(id) =>
              options.length === 0 ? (
                // Not an empty dropdown. No kind of person may stand at this
                // unit, which is a rule set on the types themselves - so the
                // form says so and offers the way to that page rather than a
                // control that cannot be used.
                <span data-testid="new-user-no-types" {...stylex.props(styles.barred)}>
                  {format(m.newUserNoTypes)}
                  <PageLink
                    page="auth/user-types"
                    className={stylex.props(styles.barredLink).className}
                  >
                    {format(m.newUserNoTypesGo)}
                  </PageLink>
                </span>
              ) : (
                <Select value={userTypeId} onValueChange={setUserTypeId}>
                  <SelectTrigger id={id} xstyle={styles.fullField}>
                    <SelectValue placeholder={format(m.selectUserType)} />
                  </SelectTrigger>
                  <SelectContent>
                    {options.map((type) => (
                      <SelectItem key={type.id} value={type.id}>
                        {type.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )
            }
          </Field>
        </form>
      </FormDialog>

      {/* one at a time: the picker takes the dialog's place rather than
          standing over it, because two stacked sheets on a phone leave
          nothing of the first one to come back to */}
      <FormDialog
        open={picking}
        size="medium"
        title={format(m.personPlacement)}
        description={format(m.movePick)}
        onClose={() => setPicking(false)}
        footer={
          <Button variant="outline" size="sm" onClick={() => setPicking(false)}>
            {format(m.cancel)}
          </Button>
        }
      >
        <div data-testid="new-user-picker" {...stylex.props(styles.seat)}>
          <UiSlot
            token={orgNodePicker}
            context={picker}
            fallback={<CardEmpty>{format(m.movePickerUnavailable)}</CardEmpty>}
          />
        </div>
      </FormDialog>
    </>
  )
}

/** the chosen unit's name, which the roster knows for its own and the picker for the rest */
function useQueryNodeName(unit: string, rosterId: string, rosterName: string) {
  const query = useApiQuery(authApi)
  const options = useQuery(query.identity.getUserOptions.queryOptions({ query: {} }))
  return useMemo(() => {
    if (unit === '') return ''
    if (unit === rosterId) return rosterName
    return options.data?.nodes.find((node) => node.orgNodeId === unit)?.name ?? ''
  }, [unit, rosterId, rosterName, options.data])
}
