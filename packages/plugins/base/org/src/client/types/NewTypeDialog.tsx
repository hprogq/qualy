import { formatPlatformFailure as formatError, getApiErrorCode } from '@qualy/web-i18n'
import { useState } from 'react'

import { Field, FormDialog } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'

import { type Api, type Run } from '../shape.ts'
import * as commonMessages from '@qualy/web-i18n/messages'
import * as m from '#messages'

/** a new kind of unit has only a name; what it may hold is set once it exists */
export function NewTypeDialog({
  open,
  api,
  run,
  onCreated,
  onClose,
}: {
  open: boolean
  api: Api
  run: Run
  onCreated: (id: string) => void
  onClose: () => void
}) {
  const [name, setName] = useState('')
  // a name another kind already has is the name's to fix, said under it
  const [taken, setTaken] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const nameTaken = (error: unknown) => getApiErrorCode(error) === 'ORG_TYPE_CONFLICT'
  const close = () => {
    setTaken(null)
    onClose()
  }
  const submit = () => {
    setBusy(true)
    setTaken(null)
    void run(api.org.createType({ payload: { name: name.trim() } }), nameTaken)
      .then((created) => {
        setName('')
        close()
        const id =
          (created as { type?: { id?: string }; id?: string } | undefined)?.type?.id ??
          (created as { id?: string } | undefined)?.id
        if (id) onCreated(id)
      })
      .catch((error: unknown) => {
        if (nameTaken(error)) setTaken(formatError(error))
      })
      .finally(() => setBusy(false))
  }
  return (
    <FormDialog
      open={open}
      title={m.type_new()}
      onClose={close}
      footer={
        <>
          <Button variant="outline" onClick={close}>
            {commonMessages.action_cancel()}
          </Button>
          <Button disabled={name.trim() === '' || busy} onClick={submit}>
            {m.action_create()}
          </Button>
        </>
      }
    >
      <Field label={m.node_name()} required error={taken}>
        {(id, control) => (
          <Input
            id={id}
            {...control}
            autoFocus
            value={name}
            onChange={(event) => {
              setName(event.target.value)
              setTaken(null)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && name.trim() !== '' && !busy) submit()
            }}
          />
        )}
      </Field>
    </FormDialog>
  )
}
