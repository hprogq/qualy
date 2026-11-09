import { createContext, useContext } from 'react'
import { usePendingNavigation } from '@qualy/web-runtime'

export const SectionNavigation = createContext<readonly string[] | undefined>(undefined)

export function useSectionNavigation(to: string, exact: boolean) {
  return usePendingNavigation(to, exact, useContext(SectionNavigation))
}
