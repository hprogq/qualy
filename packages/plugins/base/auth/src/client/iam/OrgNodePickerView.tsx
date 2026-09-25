import type { OrgNodePickerViewContext } from '@qualy/ui-contract'
import { OrgNodeChooser } from './OrgNodePicker.tsx'

// The unit tree over the units a caller hands it, and nothing else: it never
// touches the directory, so this drawing needs no permission of its own.

const NO_KINDS: ReadonlyMap<string, string> = new Map()

export default function OrgNodePickerView({ context }: { context: OrgNodePickerViewContext }) {
  return (
    <OrgNodeChooser
      context={context}
      nodes={context.nodes}
      typeNames={NO_KINDS}
      loading={context.loading === true}
      truncated={false}
    />
  )
}
