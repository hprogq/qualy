import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { useApi, useApiQuery, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { Feedback, Field, FormDialog } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@qualy/ui/select'
import { iamMessages as m } from '../../i18n.ts'
import { authApi } from '../../api.ts'
import type { EntranceKind } from './MethodFields.tsx'

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
  const run = useRunApi()
  const query = useApiQuery(authApi)
  const queryClient = useQueryClient()
  const { format, formatText, formatError } = useI18n()
  const [type, setType] = useState('')
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [feedback, setFeedback] = useState<string | null>(null)
  const kind = kinds.find((one) => one.type === type) ?? (kinds.length === 1 ? kinds[0] : undefined)

  // every opening starts empty: a half-typed entrance from last time is not
  // where anybody expects to begin
  useEffect(() => {
    if (!open) return
    setType('')
    setName('')
    setCode('')
    setFeedback(null)
  }, [open])

  const create = useMutation({
    mutationFn: () =>
      run(
        api.identity.createAuthProvider({
          payload: { type: kind!.type, code: code.trim(), name: name.trim() },
        }),
      ),
    onMutate: () => setFeedback(null),
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: query.identity.key() })
      onCreated(created.id)
    },
    onError: (error: unknown) => setFeedback(formatError(error)),
  })

  const ready = kind !== undefined && name.trim() !== '' && ADDRESS.test(code.trim())

  return (
    <FormDialog
      open={open}
      title={format(m.methodNew)}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {format(m.cancel)}
          </Button>
          <Button type="submit" form="new-entrance" disabled={!ready || create.isPending}>
            {format(m.create)}
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
          <Field label={format(m.providerKindLabel)} required>
            {(id) => (
              <Select value={type === '' ? undefined : type} onValueChange={setType}>
                <SelectTrigger id={id}>
                  <SelectValue placeholder={format(m.methodKindPick)} />
                </SelectTrigger>
                <SelectContent>
                  {kinds.map((one) => (
                    <SelectItem key={one.type} value={one.type}>
                      {formatText(one.label)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>
        )}
        <Field label={format(m.nameLabel)} required hint={format(m.methodNameHint)}>
          {(id) => <Input id={id} value={name} onChange={(event) => setName(event.target.value)} />}
        </Field>
        <Field label={format(m.providerCodeLabel)} required hint={format(m.methodCodeHint)}>
          {(id) => (
            <Input
              id={id}
              autoComplete="off"
              spellCheck={false}
              className={stylex.props(styles.mono).className}
              value={code}
              aria-invalid={code !== '' && !ADDRESS.test(code.trim())}
              onChange={(event) => setCode(event.target.value.toLowerCase())}
            />
          )}
        </Field>
      </form>
    </FormDialog>
  )
}
