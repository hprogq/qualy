import type { ReactNode } from 'react'
import { Button } from '@primereact/ui/button'

// Infrastructure probe for the UI platform migration: the first PrimeReact
// widget in the tree, used by the theme smoke test to prove the provider
// injects the Qualy preset (styled background, .dark flips it). Business
// code keeps importing @qualy/ui adapters; this probe is not one and goes
// away when the real Button adapter lands.
export function PrimeButtonProbe({ children }: { children: ReactNode }) {
  return <Button>{children}</Button>
}
