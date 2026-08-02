import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { useApi, useApiQuery } from '@qualy/web-runtime'
import { Button } from '@qualy/ui/button'

// header-actions contribution: shows the signed-in user and a logout button,
// or a login link for anonymous visitors
export default function UserMenu() {
  const api = useApi()
  const orpc = useApiQuery()
  const me = useQuery({ ...orpc.auth.me.queryOptions(), retry: false })

  if (me.isPending) return null
  if (me.isError) {
    return (
      <Button variant="outline" size="sm" asChild>
        <Link to="/login">登录</Link>
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
          void api.auth.logout().then(() => window.location.assign('/login'))
        }}
      >
        退出登录
      </Button>
    </div>
  )
}
