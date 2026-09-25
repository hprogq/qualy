import { useMemo } from 'react'
import type { OrgNodePickerViewContext } from '@qualy/ui-contract'
import { OrgNodeChooser } from './OrgNodePicker.tsx'

// The unit tree over the units a caller hands it, and nothing else: it never
// touches the directory, so this drawing needs no permission of its own. The
// kinds of unit are the caller's to name too; with them, it narrows by kind.

export default function OrgNodePickerView({ context }: { context: OrgNodePickerViewContext }) {
  const typeNames = useMemo(
    () => new Map((context.orgTypes ?? []).map((type) => [type.id, type.name])),
    [context.orgTypes],
  )
  return (
    <OrgNodeChooser
      context={context}
      nodes={context.nodes}
      typeNames={typeNames}
      loading={context.loading === true}
      truncated={false}
    />
  )
}
