import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router'
import { useApi, useApiQuery } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { Button } from '@qualy/ui/button'
import { authMessages as m } from './i18n.ts'

// header-actions contribution: shows the signed-in user and a logout button,
// or a login link for anonymous visitors
export default function UserMenu() {
  const api = useApi()
  const orpc = useApiQuery()
  const { format } = useI18n()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const me = useQuery({ ...orpc.auth.me.queryOptions(), retry: false })

  if (me.isPending) return null
  if (me.isError) {
    return (
      <Button variant="outline" size="sm" asChild>
        <Link to="/login">{format(m.signIn)}</Link>
      </Button>
    )
  }
  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-muted-foreground">{me.data.user.displayName}</span>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          void api.auth
            .logout()
            .then(() => queryClient.invalidateQueries())
            .then(() => navigate('/login'))
        }}
      >
        {format(m.signOut)}
      </Button>
    </div>
  )
}
