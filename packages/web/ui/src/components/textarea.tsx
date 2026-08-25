import * as React from 'react'
import { Textarea as PrimeTextarea } from '@primereact/ui/textarea'

// The product textarea over Prime's: it grows with its content instead of
// dragging a resize handle, from the textarea css in theme/qualy-preset.ts.
function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <PrimeTextarea
      fluid
      data-slot="textarea"
      {...(className === undefined ? {} : { className })}
      {...props}
    />
  )
}

export { Textarea }
