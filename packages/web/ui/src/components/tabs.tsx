import {
  createContext,
  useCallback,
  useContext,
  useId,
  useRef,
  type ComponentProps,
  type KeyboardEvent,
} from 'react'
import { cn } from '../lib/cn.ts'

// Tabs over native elements, like the dialogs in this package: the WAI-ARIA
// tabs pattern is small enough to own outright - a tablist with roving focus,
// arrow-key movement, and panels tied to their tabs by id.

interface TabsContextValue {
  value: string
  onValueChange: (value: string) => void
  baseId: string
}

const TabsContext = createContext<TabsContextValue | null>(null)

const useTabs = () => {
  const context = useContext(TabsContext)
  if (!context) throw new Error('Tabs components must sit inside <Tabs>')
  return context
}

const tabId = (baseId: string, value: string) => `${baseId}-tab-${value}`
const panelId = (baseId: string, value: string) => `${baseId}-panel-${value}`

export function Tabs({
  value,
  onValueChange,
  className,
  children,
  ...props
}: ComponentProps<'div'> & { value: string; onValueChange: (value: string) => void }) {
  const baseId = useId()
  return (
    <TabsContext.Provider value={{ value, onValueChange, baseId }}>
      <div className={cn('flex flex-col gap-4', className)} {...props}>
        {children}
      </div>
    </TabsContext.Provider>
  )
}

export function TabsList({ className, children, ...props }: ComponentProps<'div'>) {
  const ref = useRef<HTMLDivElement>(null)
  const onKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    const tabs = [...(ref.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [])]
    const at = tabs.findIndex((tab) => tab === document.activeElement)
    if (at === -1 || tabs.length === 0) return
    event.preventDefault()
    const next = tabs[(at + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]!
    next.focus()
    next.click()
  }, [])
  return (
    <div
      ref={ref}
      role="tablist"
      onKeyDown={onKeyDown}
      className={cn(
        'inline-flex h-9 w-fit items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export function TabsTrigger({
  value,
  className,
  children,
  ...props
}: ComponentProps<'button'> & { value: string }) {
  const tabs = useTabs()
  const selected = tabs.value === value
  return (
    <button
      type="button"
      role="tab"
      id={tabId(tabs.baseId, value)}
      aria-selected={selected}
      aria-controls={panelId(tabs.baseId, value)}
      tabIndex={selected ? 0 : -1}
      onClick={() => tabs.onValueChange(value)}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
        selected ? 'bg-background text-foreground shadow-sm' : 'hover:text-foreground',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}

export function TabsContent({
  value,
  className,
  children,
  ...props
}: ComponentProps<'div'> & { value: string }) {
  const tabs = useTabs()
  if (tabs.value !== value) return null
  return (
    <div
      role="tabpanel"
      id={panelId(tabs.baseId, value)}
      aria-labelledby={tabId(tabs.baseId, value)}
      tabIndex={0}
      className={cn('outline-none', className)}
      {...props}
    >
      {children}
    </div>
  )
}
