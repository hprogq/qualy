import * as React from 'react'
import { Tag } from '@primereact/ui/tag'
import { Slot } from 'radix-ui'

// The product badge over Prime's Tag. Callers keep the six product variants;
// default/secondary/destructive ride Tag severities recolored by the preset,
// the variants Tag does not know (outline/ghost/link) are painted by the
// preset css keyed on data-variant. asChild keeps its Radix meaning through
// the same Slot-as-root trick the button uses.
type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline' | 'ghost' | 'link'

const severityOf: Record<BadgeVariant, 'secondary' | 'danger' | undefined> = {
  default: undefined,
  secondary: 'secondary',
  destructive: 'danger',
  outline: undefined,
  ghost: undefined,
  link: undefined,
}

function Badge({
  className,
  variant = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'span'> & { variant?: BadgeVariant | null; asChild?: boolean }) {
  const resolved = variant ?? 'default'
  return (
    <Tag
      {...(asChild ? { as: Slot.Root } : {})}
      {...(severityOf[resolved] === undefined ? {} : { severity: severityOf[resolved] })}
      data-slot="badge"
      data-variant={resolved}
      {...(className === undefined ? {} : { className })}
      {...props}
    />
  )
}

export { Badge }
