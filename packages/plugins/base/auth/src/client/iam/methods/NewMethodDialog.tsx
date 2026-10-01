import { assertNever, getApiErrorCode } from '@qualy/web-i18n'
import { useApiMutation, useApi, useApiQuery } from '@qualy/web-runtime'
import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'

import { Feedback, Field, FormDialog, useSettledCheck } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@qualy/ui/select'

import { authApi } from '../../api.ts'
import { type EntranceKind } from './form-values.ts'
import * as m from '#messages'

// A new entrance: which kind, what it is called and where it answers. What
// that kind needs to be told is filled in on the entrance itself, which opens
// as soon as it exists; it stays out of service until it has everything. The
// address is asked for once and said to be for good, because it is in every
// sign-in link from then on.

const ADDRESS = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const styles = stylex.create({
  form: { display: 'flex', flexDirection: 'column', gap: 14 },
  mono: { fontFamily: "'SFMono-Regular', ui-monospace, Menlo, Consolas, monospace" },
})

export function NewMethodDialog({
  open,
  kinds,
  onClose,
  onCreated,
}: {
  open: boolean
  kinds: readonly EntranceKind[]
  onClose: () => void
  onCreated: (providerId: string) => void
}) {
  const api = useApi(authApi)
  const query = useApiQuery(authApi)
  const queryClient = useQueryClient()

  const [type, setType] = useState('')
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [feedback, setFeedback] = useState<string | null>(null)
  // an address another entrance answers at is the address's to fix
  const [taken, setTaken] = useState<string | null>(null)
  const shape = useSettledCheck(code, (typed) =>
    ADDRESS.test(typed.trim()) ? null : m.loginMethods_codeInvalid(),
  )
  const kind = kinds.find((one) => one.type === type) ?? (kinds.length === 1 ? kinds[0] : undefined)

  // every opening starts empty: a half-typed entrance from last time is not
  // where anybody expects to begin
  useEffect(() => {
    if (!open) return
    setType('')
    setName('')
    setCode('')
    setFeedback(null)
    setTaken(null)
  }, [open])

  const create = useApiMutation({
    mutationFn: () =>
      api.identity.createAuthProvider({
        payload: { type: kind!.type, code: code.trim(), name: name.trim() },
      }),
    onMutate: () => {
      setFeedback(null)
      setTaken(null)
    },
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: query.identity.key() })
      onCreated(created.id)
    },
    onError: (error) => {
      let failure: string
      switch (error._tag) {
        case 'AUTH_PROVIDER_CONFLICT':
          failure = m.error_providerConflict()
          break
        case 'AUTH_PROVIDER_KIND_UNAVAILABLE':
          failure = m.error_providerKindUnavailable()
          break
        default:
          assertNever(error)
      }
      return getApiErrorCode(error) === 'AUTH_PROVIDER_CONFLICT'
        ? setTaken(failure)
        : setFeedback(failure)
    },
  })

  const ready = kind !== undefined && name.trim() !== '' && ADDRESS.test(code.trim())

  return (
    <FormDialog
      open={open}
      title={m.loginMethods_new()}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {m.action_cancel()}
          </Button>
          <Button type="submit" form="new-entrance" disabled={!ready || create.isPending}>
            {m.action_create()}
          </Button>
        </>
      }
    >
      <form
        id="new-entrance"
        data-testid="new-entrance"
        {...stylex.props(styles.form)}
        onSubmit={(event) => {
          event.preventDefault()
          if (ready) create.mutate()
        }}
      >
        <Feedback message={feedback} />
        {kinds.length > 1 && (
          <Field label={m.loginMethods_kind()} required>
            {(id, control) => (
              <Select value={type === '' ? undefined : type} onValueChange={setType}>
                <SelectTrigger id={id} {...control}>
                  <SelectValue placeholder={m.loginMethods_kindPick()} />
                </SelectTrigger>
                <SelectContent>
                  {kinds.map((one) => (
                    <SelectItem key={one.type} value={one.type}>
                      {one.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>
        )}
        <Field label={m.field_name()} required hint={m.loginMethods_nameHint()}>
          {(id, control) => (
            <Input
              id={id}
              {...control}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          )}
        </Field>
        <Field
          label={m.loginMethods_code()}
          required
          hint={m.loginMethods_codeHintNew()}
          error={taken ?? shape.error}
        >
          {(id, control) => (
            <Input
              id={id}
              {...control}
              autoComplete="off"
              spellCheck={false}
              className={stylex.props(styles.mono).className}
              value={code}
              onBlur={shape.onBlur}
              onChange={(event) => {
                setCode(event.target.value.toLowerCase())
                setTaken(null)
              }}
            />
          )}
        </Field>
      </form>
    </FormDialog>
  )
}
