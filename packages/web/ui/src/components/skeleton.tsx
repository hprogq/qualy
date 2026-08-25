import { Skeleton as MSkeleton } from '@mantine/core'

// A loading placeholder. Size stays the consumer's business - callers shape
// it with classes (or StyleX) exactly as before; the widget only supplies
// the surface and the shimmer. No size props are exposed, so there is no
// second, stronger channel for a class to lose against.
function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return <MSkeleton data-slot="skeleton" className={className} {...props} />
}

export { Skeleton }
