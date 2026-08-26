import * as React from 'react'
import { Avatar as MAvatar } from '@mantine/core'

// The Qualy avatar keeps its established compound API over the widget
// avatar. Every consumer in the product shows initials - the image path is
// unused - so the adapter mines the declared fallback and hands it to the
// widget as the placeholder. The fallback's className lands on the
// placeholder slot, which is the element that fills the frame; the root
// className sizes and shapes the frame, exactly as before.

const sizes = { sm: 24, default: 32, lg: 40 } as const

function Avatar({
  className,
  size = 'default',
  children,
  ...props
}: Omit<React.ComponentProps<'div'>, 'children'> & {
  size?: 'default' | 'sm' | 'lg'
  children?: React.ReactNode
}) {
  let fallbackClassName: string | undefined
  let fallbackContent: React.ReactNode = null
  React.Children.forEach(children, (child) => {
    if (React.isValidElement<{ className?: string; children?: React.ReactNode }>(child)) {
      if (child.type === AvatarFallback) {
        fallbackClassName = child.props.className
        fallbackContent = child.props.children
      }
    }
  })
  return (
    <MAvatar
      data-slot="avatar"
      data-size={size}
      size={sizes[size]}
      className={className}
      classNames={{ placeholder: fallbackClassName ?? '' }}
      {...props}
    >
      {fallbackContent}
    </MAvatar>
  )
}

/** a declaration the avatar reads; it renders nothing of its own */
function AvatarFallback(_props: { className?: string; children?: React.ReactNode }) {
  return null
}

export { Avatar, AvatarFallback }
