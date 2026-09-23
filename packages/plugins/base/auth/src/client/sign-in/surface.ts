import { useTheme } from '@qualy/web-runtime'

/** the ground a drawing stands on */
export type IconSurface = 'light' | 'dark'

/**
 * Where a drawing stands: on the page's own ground, or on its inverse - the
 * filled button that is dark on a light page and light on a dark one.
 */
export function useIconSurface(tone: 'plain' | 'inverse' = 'plain'): IconSurface {
  const { resolved } = useTheme()
  if (tone === 'plain') return resolved
  return resolved === 'dark' ? 'light' : 'dark'
}
