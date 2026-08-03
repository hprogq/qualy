import type { ReactNode } from 'react'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { Alert, AlertDescription } from '@qualy/ui/alert'
import { Button } from '@qualy/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@qualy/ui/card'
import { Spinner } from '@qualy/ui/spinner'

// the shape every administration screen shares: a titled panel, a loading
// state, an error state with retry and an inline feedback line

export function AdminPanel({
  title,
  actions,
  children,
}: {
  title: string
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <CardTitle className="text-base">{title}</CardTitle>
        {actions}
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  )
}

export function QueryState({
  pending,
  error,
  onRetry,
  children,
}: {
  pending: boolean
  error: unknown
  onRetry: () => void
  children: ReactNode
}) {
  const { format, formatError } = useI18n()
  if (pending) {
    return (
      <div className="flex justify-center py-8">
        <Spinner aria-label={format(commonMessages.loading)} />
      </div>
    )
  }
  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription className="space-y-3">
          <p>{formatError(error)}</p>
          <Button variant="outline" size="sm" onClick={onRetry}>
            {format(commonMessages.retry)}
          </Button>
        </AlertDescription>
      </Alert>
    )
  }
  return <>{children}</>
}

export function Feedback({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <Alert variant="destructive" role="alert">
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  )
}
