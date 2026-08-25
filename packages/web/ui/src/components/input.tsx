import * as React from 'react'
import { InputText } from '@primereact/ui/inputtext'

// The product text input over Prime's InputText: full-width by default like
// its predecessor, geometry and palette from the theme preset (form field
// tokens plus the inputtext css in theme/qualy-preset.ts).
function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <InputText
      type={type}
      fluid
      data-slot="input"
      {...(className === undefined ? {} : { className })}
      {...props}
    />
  )
}

export { Input }
